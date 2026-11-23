// Vigía de las pasadas de Gemini (decisión del 22-nov-2026).
// Gemini analiza los vídeos pendientes a las horas de «gemini.pasadas» (tarea del usuario en la app de Gemini vía MCP).
// Si «gemini.espera_min» después de la hora no ha marcado nada y hay vídeos esperando, llega un aviso al móvil con 3 botones:
//   · Intentar en 10 min: el usuario lanza la pasada a mano; a los 10 min se vuelve a mirar (y se avisa otra vez si sigue sin nada).
//   · Recortar con señales propias: esos vídeos se recortan con el algoritmo propio (clip_videos.sin_ia = 1).
//   · Descartar: esos vídeos salen de la cola.
// Sin respuesta en «gemini.contestar_h», se aplica «gemini.al_vencer».
import { tramoSinVer } from './tareas/transcripciones.mjs';
import { randomBytes } from 'node:crypto';
import { db, ajustes, columna } from './db.mjs';
import { avisarSinFallo } from './avisos.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS gemini_pasadas (clave TEXT PRIMARY KEY, estado TEXT NOT NULL, token TEXT, videos TEXT,
  avisado INTEGER, reintento_en INTEGER, resuelto TEXT, creado TEXT DEFAULT (datetime('now')));`);
columna('clip_videos', 'sin_ia', 'INTEGER DEFAULT 0');

const log = (...a) => console.log('Gemini (vigía):', ...a);
const sqlUtc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// Vídeos que esperan a Gemini ahora mismo (mismo criterio que la cola con «solo Gemini»).
export function pendientes() {
  return db.prepare(`SELECT v.id, v.titulo, v.video, v.offset_s FROM clip_videos v
    WHERE v.estado IN ('propuesto','cola','troceando') AND v.tipo NOT IN ('estudio','recop') AND v.canal_id IS NOT NULL AND COALESCE(v.sin_ia,0) = 0
      AND NOT (v.urgente = 1 AND COALESCE(v.fuente,'') NOT LIKE '%-tramo%')
      AND COALESCE(v.fuente,'') NOT LIKE '%twitch.tv/%/clip/%'
      AND (NOT EXISTS (SELECT 1 FROM ia_escenas e WHERE e.video = v.video OR e.video = CAST(v.id AS TEXT)) OR COALESCE(v.offset_s, 0) > 0)`).all()
    .filter((v) => !db.prepare('SELECT 1 FROM ia_escenas e WHERE e.video = ? OR e.video = ?').get(String(v.video || ''), String(v.id)) || tramoSinVer(v));
}
const marcasDesde = (ms) => db.prepare('SELECT COUNT(*) n FROM ia_escenas WHERE creado >= ?').get(sqlUtc(ms)).n;

function horasDeHoy(cfg, ahora) {
  return String(cfg['gemini.pasadas'] || '').split(/[,\s]+/).filter((h) => /^\d{1,2}:\d{2}$/.test(h)).map((h) => {
    const [H, M] = h.split(':').map(Number); const d = new Date(ahora); d.setHours(H, M, 0, 0); return d;
  });
}
const claveDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

async function mandarAviso(clave, vids) {
  const cfg = ajustes();
  const token = randomBytes(18).toString('base64url');
  db.prepare("UPDATE gemini_pasadas SET estado='avisado', token=?, avisado=?, reintento_en=NULL WHERE clave=?").run(token, Date.now(), clave);
  if (cfg['avisos.gemini'] === false) return;
  const base = String(cfg['avisos.panel'] || '').replace(/\/$/, '');
  const url = (op) => `${base}/api/gemini/aviso?t=${token}&op=${op}`;
  const lista = vids.slice(0, 6).map((v) => `• ${String(v.titulo || '').slice(0, 70)}`).join('\n') + (vids.length > 6 ? `\n…y ${vids.length - 6} más` : '');
  await avisarSinFallo(`Gemini no ha marcado nada (pasada de las ${clave.slice(11)})`,
    `${vids.length} vídeo${vids.length > 1 ? 's' : ''} esperan sus momentos:\n${lista}`,
    { prioridad: 4, etiquetas: ['hourglass'], enlace: `${base}/#/cola`,
      acciones: base ? [
        { action: 'http', label: 'Intentar en 10 min', url: url('reintentar'), method: 'POST', clear: true },
        { action: 'http', label: 'Señales propias', url: url('propias'), method: 'POST', clear: true },
        { action: 'http', label: 'Descartar', url: url('descartar'), method: 'POST', clear: true },
      ] : [] });
}

// Aplica una decisión a los vídeos de esa pasada que siguen sin marcas.
export function aplicar(clave, op, por = 'aviso') {
  const p = db.prepare('SELECT * FROM gemini_pasadas WHERE clave = ?').get(clave); if (!p) throw new Error('Esa pasada no existe');
  const ids = new Set(JSON.parse(p.videos || '[]'));
  const vids = pendientes().filter((v) => ids.has(v.id));
  if (op === 'reintentar') {
    db.prepare("UPDATE gemini_pasadas SET estado='reintento', reintento_en=?, token=NULL WHERE clave=?").run(Date.now() + 10 * 60000, clave);
    log(`${clave}: se vuelve a mirar en 10 min (${por})`); return { texto: 'Vale: lanza la pasada en Gemini; en 10 min recojo lo que marque.' };
  }
  if (op === 'propias') {
    for (const v of vids) db.prepare("UPDATE clip_videos SET sin_ia = 1, estado = CASE WHEN estado = 'propuesto' THEN 'cola' ELSE estado END WHERE id = ?").run(v.id);
    db.prepare("UPDATE gemini_pasadas SET estado='resuelto', resuelto=?, token=NULL WHERE clave=?").run(`propias (${por})`, clave);
    log(`${clave}: ${vids.length} vídeos con señales propias (${por})`); return { texto: `${vids.length} vídeo(s) se recortan con señales propias.` };
  }
  if (op === 'descartar') {
    for (const v of vids) db.prepare("UPDATE clip_videos SET estado='descartado', error='Gemini no lo analizó en su pasada (descartado)' WHERE id = ?").run(v.id);
    db.prepare("UPDATE gemini_pasadas SET estado='resuelto', resuelto=?, token=NULL WHERE clave=?").run(`descartar (${por})`, clave);
    log(`${clave}: ${vids.length} vídeos descartados (${por})`); return { texto: `${vids.length} vídeo(s) descartados.` };
  }
  if (op === 'esperar') { db.prepare("UPDATE gemini_pasadas SET estado='resuelto', resuelto=?, token=NULL WHERE clave=?").run(`esperar (${por})`, clave); return { texto: 'Esperan a la próxima pasada.' }; }
  throw new Error('Acción no válida');
}

// Botón del aviso (sin sesión: lo protege el token de un solo uso).
export function desdeAviso(token, op) {
  const p = token && db.prepare("SELECT clave FROM gemini_pasadas WHERE token = ? AND estado = 'avisado'").get(String(token));
  if (!p) throw new Error('Ese aviso ya se contestó o caducó');
  return aplicar(p.clave, op, 'botón del aviso');
}

// Solo cuentan las pasadas en que Gemini sí trabajó (marcó otros vídeos): si Gemini no funcionó, el vídeo no tiene la culpa.
// Vídeo ofrecido en N pasadas sin que Gemini lo marque: no se le vuelve a ofrecer (cupo y tiempo) y se recorta con las
// señales propias del servidor (o se descarta / sigue esperando, según «gemini.atascados»).
function retirarAtascados(cfg) {
  const max = Number(cfg['gemini.max_pasadas'] ?? 2), que = cfg['gemini.atascados'] || 'propias';
  if (!max || que === 'esperar') return;
  for (const v of pendientes()) {
    const veces = db.prepare("SELECT COUNT(*) n FROM gemini_pasadas p, json_each(p.videos) j WHERE j.value = ? AND ((p.estado = 'ok' AND p.resuelto IS NULL) OR p.resuelto LIKE 'Gemini marcó%') AND p.creado >= (SELECT COALESCE(creado, '1970') FROM clip_videos WHERE id = ?)").get(v.id, v.id).n;
    if (veces < max) continue;
    if (que === 'descartar') db.prepare("UPDATE clip_videos SET estado = 'descartado' WHERE id = ?").run(v.id);
    else db.prepare('UPDATE clip_videos SET sin_ia = 1 WHERE id = ?').run(v.id);
    log(`vídeo ${v.id} sin marcar en ${veces} pasadas → ${que === 'descartar' ? 'descartado' : 'se recorta con señales propias'}`);
  }
}

let mirando = false;
export async function vigilarGemini() {
  if (mirando) return; mirando = true;
  try {
    const cfg = ajustes(); if (cfg['clips.solo_ia'] === false) return;
    try { retirarAtascados(cfg); } catch (e) { console.error('Gemini (atascados):', e.message); }
    const ahora = Date.now(), espera = (Number(cfg['gemini.espera_min']) || 10) * 60000, plazo = (Number(cfg['gemini.contestar_h']) || 2) * 3600000;
    for (const T of horasDeHoy(cfg, ahora)) {
      const t = T.getTime(), clave = claveDe(T);
      if (ahora < t + espera || ahora > t + 6 * 3600000) continue;
      let p = db.prepare('SELECT * FROM gemini_pasadas WHERE clave = ?').get(clave);
      if (!p) {
        const vids = pendientes();
        const ok = !vids.length || marcasDesde(t - 15 * 60000) > 0;
        db.prepare('INSERT INTO gemini_pasadas (clave, estado, videos) VALUES (?, ?, ?)').run(clave, ok ? 'ok' : 'nuevo', JSON.stringify(vids.map((v) => v.id)));
        if (ok) continue;
        if (ahora > t + espera + 30 * 60000) { db.prepare("UPDATE gemini_pasadas SET estado='ok', resuelto='servidor apagado a la hora del aviso' WHERE clave=?").run(clave); continue; }
        log(`${clave}: sin marcas y ${vids.length} vídeos esperando → aviso`);
        await mandarAviso(clave, vids); continue;
      }
      if (p.estado === 'reintento' && ahora >= p.reintento_en) {
        if (marcasDesde(p.reintento_en - 25 * 60000) > 0) { db.prepare("UPDATE gemini_pasadas SET estado='resuelto', resuelto='Gemini marcó tras reintentar' WHERE clave=?").run(clave); log(`${clave}: Gemini marcó tras el reintento`); continue; }
        const ids = new Set(JSON.parse(p.videos || '[]')), vids = pendientes().filter((v) => ids.has(v.id));
        if (!vids.length) { db.prepare("UPDATE gemini_pasadas SET estado='resuelto', resuelto='ya no queda nada pendiente' WHERE clave=?").run(clave); continue; }
        await mandarAviso(clave, vids); continue;
      }
      if (p.estado === 'avisado' && ahora > p.avisado + plazo) aplicar(clave, cfg['gemini.al_vencer'] || 'esperar', 'sin respuesta');
    }
  } finally { mirando = false; }
}

export function ultimas(n = 12) { return db.prepare('SELECT clave, estado, resuelto, videos FROM gemini_pasadas ORDER BY clave DESC LIMIT ?').all(n).map((p) => ({ ...p, videos: JSON.parse(p.videos || '[]').length })); }

// ---------- motivo de espera (una sola función: la usan la Cola y la app) ----------
export function proximaPasada(ahora = Date.now()) {
  const hs = horasDeHoy(ajustes(), ahora).map((d) => d.getTime()).sort((a, b) => a - b);
  const t = hs.find((x) => x > ahora) ?? (hs[0] != null ? hs[0] + 86400000 : null);
  return t ? new Date(t).toTimeString().slice(0, 5) : null;
}
export function motivoEspera(v, { momentos = 0, visto = false } = {}) {
  const cfg = ajustes();
  if (cfg['clips.solo_ia'] === false || v.sin_ia || !v.canal_id || v.esperar_ia === 0) return null;
  if (/twitch\.tv\/[^/]+\/clip\//i.test(v.fuente || '')) return null;
  if (v.urgente && !/-tramo/.test(v.fuente || '') && !/^camp-/.test(String(v.fuente || '').split('/').pop())) return null;
  const p = proximaPasada(), esperando = `Esperando a Gemini${p ? ` (pasada de las ${p})` : ''}`;
  if (v.estado === 'cola' && !momentos) return visto ? 'Gemini no marcó momentos en este tramo' : esperando;
  if ((v.estado === 'troceando' || v.estado === 'propuesto') && !visto && !momentos) return esperando;
  return null;
}
