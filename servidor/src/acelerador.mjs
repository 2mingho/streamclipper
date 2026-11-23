// Acelerador: la laptop con GPU (RTX 5060) hace el trabajo pesado cuando está encendida.
// Modelo "tirar": el agente de la laptop pregunta al servidor si hay trabajo (espera larga de 25 s), así no hay que
// abrir puertos en Windows. Si la laptop no está, no recoge a tiempo o falla, quien llamó sigue en el servidor.
// Medido el 16-11-2026: la laptop es 8-15 veces más rápida en whisper y en Gemma, con resultados idénticos.
import { randomUUID, randomBytes } from 'node:crypto';
import { ajustes, guardarAjustes } from './db.mjs';

const cola = [];             // trabajos esperando a que la laptop los recoja
const enCurso = new Map();   // id -> trabajo recogido
const esperando = [];        // peticiones de la laptop esperando trabajo
let agente = null;           // { visto, info, capacidades }
const stats = { hechos: 0, fallidos: 0, desde: new Date().toISOString(), porTipo: {}, ultimo: null };

export function tokenAcelerador() {
  let t = ajustes()['acelerador.token'];
  if (!t) { t = randomBytes(24).toString('hex'); guardarAjustes({ 'acelerador.token': t }); }
  return t;
}

export const laptopConectada = () => !!agente && Date.now() - agente.visto < 45000;

// ¿Se le puede mandar este tipo de trabajo ahora? (activado en Ajustes, conectada y aceptando ese tipo)
export function aceleradorDisponible(tipo) {
  return ajustes()['acelerador.activo'] !== false && laptopConectada() && (agente.capacidades || []).includes(tipo);
}

// La laptop solo sirve los modelos que tiene (los anuncia en info.modelos).
export const aceleradorTieneModelo = (m) => (agente?.info?.modelos || []).includes(m);

// Encarga un trabajo a la laptop y espera el resultado. Rechaza si no lo recoge en 20 s o tarda más de timeoutMs.
export function encargar(tipo, datos, { timeoutMs = 300000, archivo = null } = {}) {
  return new Promise((resolve, reject) => {
    const t = { id: randomUUID(), tipo, datos, archivo, resolve, reject, timeoutMs, creado: Date.now() };
    t.timerRecogida = setTimeout(() => {
      const i = cola.indexOf(t); if (i >= 0) cola.splice(i, 1);
      reject(new Error('la laptop no recogió el trabajo a tiempo'));
    }, 20000);
    cola.push(t);
    despachar();
  });
}

function despachar() {
  for (let i = 0; i < esperando.length; i++) {
    const p = esperando[i];
    const j = cola.findIndex((t) => p.capacidades.includes(t.tipo));
    if (j < 0) continue;
    const [t] = cola.splice(j, 1);
    esperando.splice(i, 1); i--;
    clearTimeout(p.timer); clearTimeout(t.timerRecogida);
    enCurso.set(t.id, t);
    t.inicio = Date.now();
    t.timerFin = setTimeout(() => {
      enCurso.delete(t.id); stats.fallidos++;
      t.reject(new Error('la laptop tardó demasiado'));
    }, t.timeoutMs);
    p.resolve({ id: t.id, tipo: t.tipo, datos: t.datos, audio: t.archivo ? `/api/acelerador/audio/${t.id}` : null });
  }
}

// La laptop pide trabajo. Devuelve un trabajo o null tras 25 s (y así sirve de latido).
export function esperarTrabajo({ capacidades = [], info = {} }) {
  // info.acepta = todo lo que la laptop acepta ahora (cada hueco pide solo su tipo en `capacidades`).
  agente = { visto: Date.now(), info, capacidades: Array.isArray(info.acepta) ? info.acepta : capacidades };
  if (!capacidades.length) {
    // Solo latido. Si además ya no acepta nada (pausa o batería), se sueltan sus peticiones en espera.
    if (!agente.capacidades.length) for (const p of esperando.splice(0)) { clearTimeout(p.timer); p.resolve(null); }
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const p = { capacidades, resolve };
    p.timer = setTimeout(() => { const i = esperando.indexOf(p); if (i >= 0) esperando.splice(i, 1); resolve(null); }, 25000);
    esperando.push(p);
    despachar();
  });
}

export function recibirResultado({ id, ok, resultado, error }) {
  const t = enCurso.get(id);
  if (!t) return { ok: false, motivo: 'trabajo desconocido o caducado' };
  enCurso.delete(id); clearTimeout(t.timerFin);
  stats.ultimo = { tipo: t.tipo, ok: !!ok, s: Math.round((Date.now() - t.inicio) / 100) / 10, fecha: new Date().toISOString() };
  if (ok) { stats.hechos++; stats.porTipo[t.tipo] = (stats.porTipo[t.tipo] || 0) + 1; t.resolve(resultado); }
  else { stats.fallidos++; t.reject(new Error(`laptop: ${error || 'error'}`)); }
  return { ok: true };
}

export const archivoDeTrabajo = (id) => enCurso.get(id)?.archivo || null;

export function estadoAcelerador() {
  return {
    activo: ajustes()['acelerador.activo'] !== false,
    conectada: laptopConectada(),
    visto: agente ? new Date(agente.visto).toISOString() : null,
    info: agente?.info || null,
    acepta: agente?.capacidades || [],
    cola: cola.length, enCurso: [...enCurso.values()].map((t) => ({ tipo: t.tipo, s: Math.round((Date.now() - t.inicio) / 1000) })),
    stats,
  };
}
