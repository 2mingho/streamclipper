// Vigía del servidor (fase 8, 22-nov-2026): cada 5 min mira la salud del equipo y avisa al móvil de lo que falla.
// Avisa una vez por problema (y lo recuerda cada 6 h si sigue); cuando se arregla, manda «resuelto».
// No toca nada por su cuenta: solo avisa. Los problemas activos se ven en Sistema y en Actividad › En marcha.
import { db, ajustes } from './db.mjs';
import { estadoSistema } from './sistema.mjs';
import { avisarSinFallo } from './avisos.mjs';

const activos = new Map(); // clave → { titulo, texto, nivel, desde, avisado }
let ultimo = 0, corriendo = false;
const RECORDAR_MS = 6 * 3600e3;

function problemas(s, cfg) {
  const out = [];
  const add = (clave, nivel, titulo, texto) => out.push({ clave, nivel, titulo, texto });
  for (const x of s.servicios || []) if (!['active', 'simulado', 'activating', 'reloading'].includes(x.estado))
    add(`servicio:${x.id}`, 'alto', `${x.nombre}: no funciona`, `Estado: ${x.estado}. Reinícialo desde Sistema o mira su registro.`);
  const minPct = Number(cfg['servidor.disco_min_pct'] ?? 10);
  for (const d of s.discos || []) { const pct = d.total ? (d.libre / d.total) * 100 : 100;
    if (pct < minPct) add(`disco:${d.punto}`, pct < minPct / 2 ? 'alto' : 'medio', `${d.nombre}: queda poco espacio`, `Libre: ${Math.round(d.libre / 1e9)} GB (${Math.round(pct)} %).`); }
  const tMax = Number(cfg['servidor.temp_max'] ?? 88);
  if (s.temperatura != null && s.temperatura >= tMax) add('temperatura', 'alto', 'El servidor está muy caliente', `${Math.round(s.temperatura)} °C. Revisa la ventilación.`);
  if (s.memoria?.total && s.memoria.disponible / s.memoria.total < 0.05) add('memoria', 'medio', 'Memoria casi llena', `Disponible: ${Math.round(s.memoria.disponible / 1e6)} MB.`);
  const b = s.bateria;
  if (b && b.enchufado === false) add('corriente', 'alto', 'Sin corriente: el servidor va con batería', `Batería al ${b.carga ?? '?'} %.`);
  else if (b && b.carga != null && b.carga < 20 && b.estado !== 'Charging') add('bateria', 'medio', 'Batería baja', `${b.carga} %.`);
  if (process.env.VIGILAR_TAILSCALE === '1' && !s.red?.tailscale) add('tailscale', 'medio', 'Tailscale desconectado', 'Desde fuera de casa no se llega al servidor.');
  if (s.reinicioPendiente) add('reinicio', 'bajo', 'Reinicio pendiente', 'Hay un núcleo nuevo: reinicia el servidor desde Sistema cuando te venga bien.');
  return out;
}

export async function revisar({ forzar = false } = {}) {
  if (corriendo || (!forzar && Date.now() - ultimo < 5 * 60e3)) return lista();
  corriendo = true; ultimo = Date.now();
  try {
    const cfg = ajustes(), s = await estadoSistema();
    const ahora = problemas(s, cfg), claves = new Set(ahora.map((p) => p.clave));
    const avisa = cfg['avisos.servidor'] !== false;
    for (const p of ahora) {
      const prev = activos.get(p.clave);
      const toca = !prev || (p.nivel !== 'bajo' && Date.now() - prev.avisado > RECORDAR_MS);
      activos.set(p.clave, { ...p, desde: prev?.desde || new Date().toISOString(), avisado: toca ? Date.now() : prev.avisado });
      if (toca && avisa && (p.nivel !== 'bajo' || !prev)) avisarSinFallo(p.titulo, p.texto, { prioridad: p.nivel === 'alto' ? 5 : 4, etiquetas: ['warning'], enlace: cfg['avisos.panel'] ? `${String(cfg['avisos.panel']).replace(/\/$/, '')}/#/sistema` : '' });
    }
    for (const [k, p] of activos) if (!claves.has(k)) {
      activos.delete(k);
      if (avisa && p.nivel !== 'bajo') avisarSinFallo(`Resuelto: ${p.titulo}`, 'Ya está bien.', { prioridad: 2, etiquetas: ['white_check_mark'] });
    }
  } catch (e) { console.error('Vigía del servidor:', e.message); }
  finally { corriendo = false; }
  return lista();
}
db.exec('CREATE TABLE IF NOT EXISTS vigia_externos (clave TEXT PRIMARY KEY, nivel TEXT, titulo TEXT, texto TEXT, desde TEXT)');
const externos = {
  get: (k) => db.prepare('SELECT * FROM vigia_externos WHERE clave = ?').get(k),
  set: (k, v) => db.prepare('INSERT INTO vigia_externos (clave, nivel, titulo, texto, desde) VALUES (?,?,?,?,?) ON CONFLICT(clave) DO UPDATE SET nivel=excluded.nivel, titulo=excluded.titulo, texto=excluded.texto').run(k, v.nivel, v.titulo, v.texto, v.desde),
  delete: (k) => db.prepare('DELETE FROM vigia_externos WHERE clave = ?').run(k),
  values: () => db.prepare('SELECT * FROM vigia_externos').all(),
  [Symbol.iterator]: function* () { for (const r of db.prepare('SELECT * FROM vigia_externos').all()) yield [r.clave, r]; },
};
export function ponerExterno(clave, nivel, titulo, texto) {
  const prev = externos.get(clave); externos.set(clave, { clave, nivel, titulo, texto, desde: prev?.desde || new Date().toISOString() });
  if (!prev && ajustes()['avisos.servidor'] !== false) avisarSinFallo(titulo, texto, { prioridad: nivel === 'alto' ? 5 : 4, etiquetas: ['warning'] });
}
export function quitarExternos(prefijo, salvo = new Set()) {
  for (const [k, p] of externos) if (k.startsWith(prefijo) && !salvo.has(k)) { externos.delete(k); if (ajustes()['avisos.servidor'] !== false) avisarSinFallo(`Resuelto: ${p.titulo}`, 'Ya está bien.', { prioridad: 2, etiquetas: ['white_check_mark'] }); }
}
export const lista = () => [...activos.values(), ...externos.values()].map(({ clave, nivel, titulo, texto, desde }) => ({ clave, nivel, titulo, texto, desde }));
export function cicloVigia() { revisar().catch(() => {}); }
