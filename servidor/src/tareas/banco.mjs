// Banco de clips del canal y selección automática (pedido del editor, 21-nov-2026).
//
// Nota de un clip = pesoEmocion · emoción/100 + pesoPuntos · puntos/100   (por defecto 0,6 y 0,4: la emoción pesa más)
//   · emoción 0–100: clips-emocion.mjs sobre el audio del clip (dinámica, subidones de voz, exclamaciones);
//   · puntos 0–100: los de la IA que propuso el momento (Gemini por MCP) o, si no, los de OpenShorts.
//
// 1. Aprobación automática de clips del canal (clips.autopiloto): solo con la revisión de encuadre superada (qa.ok) y nota ≥ mínimo,
//    de la mejor a la peor, hasta clips.auto_por_dia al día (contando también los que apruebe el editor). Medido el 21-nov-2026
//    con 339 valoraciones del editor: puntos, emoción y la marca de la IA NO separan «Sirve» de «No sirve» (AUC ≈ 0,5); el 62 % de
//    los descartes eran de encuadre. Por eso la revisión de encuadre es obligatoria y la nota solo ordena.
// 2. Banco en 16:9: cada clip aprobado pide su versión horizontal (autopiloto.alAprobar) y aquí se puntúa.
// 3. Ronda de recopilatorio (el día antes de cada martes y viernes): los recop.clips mejores por nota (10), ajustados a 8–10 min,
//    van al recopilatorio. De los que sobran, solo los recop.arrastre mejores (5) compiten en la ronda siguiente (como mucho
//    recop.max_arrastres veces); el resto se descarta y se borra su copia 16:9. Cada resultado queda en banco_resultados
//    (feedback para las IA del MCP).
import { existsSync, rmSync } from 'node:fs';
import { db, ajustes } from '../db.mjs';
import { emocionClip } from './clips-emocion.mjs';
import * as Recop from './recopilatorios.mjs';

const DEF = { 'banco.peso_emocion': 0.6, 'banco.peso_puntos': 0.4, 'recop.clips': 10, 'recop.arrastre': 5, 'recop.max_arrastres': 2, 'recop.min_clips': 6,
  'clips.auto_por_dia': 5, 'clips.auto_nota_min': 0.55 };
const cfg = () => ({ ...DEF, ...ajustes() });
const log = (...a) => console.log('Banco:', ...a);

if (!db.prepare('PRAGMA table_info(clip_videos)').all().some((c) => c.name === 'campana')) db.exec('ALTER TABLE clip_videos ADD COLUMN campana TEXT');
const cols = db.prepare('PRAGMA table_info(recop_clips)').all().map((c) => c.name);
for (const [c, t] of [['emocion', 'REAL'], ['puntos', 'REAL'], ['nota', 'REAL'], ['arrastres', 'INTEGER NOT NULL DEFAULT 0'], ['descartado', 'TEXT']])
  if (!cols.includes(c)) db.exec(`ALTER TABLE recop_clips ADD COLUMN ${c} ${t}`);
db.exec(`CREATE TABLE IF NOT EXISTS banco_resultados (id INTEGER PRIMARY KEY, recop_clip_id INTEGER, video_id INTEGER, n INTEGER,
  resultado TEXT NOT NULL, recop_id INTEGER, nota REAL, emocion REAL, puntos REAL, fecha TEXT DEFAULT (datetime('now')))`);

export function nota(emocion, puntos, k = cfg()) {
  if (emocion == null && puntos == null) return null;
  return +(Number(k['banco.peso_emocion']) * (emocion ?? 0) / 100 + Number(k['banco.peso_puntos']) * (puntos ?? 0) / 100).toFixed(4);
}
const clipDe = (videoId, n) => {
  const v = db.prepare('SELECT id, tipo, clips FROM clip_videos WHERE id = ?').get(videoId);
  return { v, c: v ? JSON.parse(v.clips || '[]').find((x) => x.n === Number(n)) : null };
};
const puntosDe = (c) => (c?.ia?.puntos ?? c?.puntos ?? null);
// Guarda campos en el clip (mismo patrón que clips-editor.guardarClip: transacción inmediata sobre el JSON).
function guardarEnClip(videoId, n, cambios) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = db.prepare('SELECT clips FROM clip_videos WHERE id = ?').get(videoId);
    const clips = JSON.parse(v?.clips || '[]'), i = clips.findIndex((x) => x.n === Number(n));
    if (i >= 0) { clips[i] = { ...clips[i], ...cambios }; db.prepare('UPDATE clip_videos SET clips = ? WHERE id = ?').run(JSON.stringify(clips), videoId); }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// ---------- 2. puntuar el banco (una versión 16:9 por llamada: es un pase de ffmpeg sobre el audio) ----------
export async function puntuar() {
  const r = db.prepare("SELECT * FROM recop_clips WHERE estado = 'listo' AND aprobado = 1 AND recop_id IS NULL AND nota IS NULL AND archivo IS NOT NULL ORDER BY id LIMIT 1").get();
  if (!r) return false;
  const { c } = clipDe(r.video_id, r.n);
  let emo = c?.emocion ?? null;
  if (emo == null && existsSync(r.archivo)) emo = (await emocionClip(r.archivo).catch(() => null))?.emocion ?? null;
  const pts = puntosDe(c);
  db.prepare('UPDATE recop_clips SET emocion = ?, puntos = ?, nota = ? WHERE id = ?').run(emo, pts, nota(emo, pts) ?? 0, r.id);
  if (c && c.emocion == null && emo != null) guardarEnClip(r.video_id, r.n, { emocion: emo });
  return true;
}

// ---------- 3. ronda de recopilatorio ----------
const resultado = db.prepare('INSERT INTO banco_resultados (recop_clip_id, video_id, n, resultado, recop_id, nota, emocion, puntos) VALUES (?,?,?,?,?,?,?,?)');
export function bolsa() {
  return db.prepare("SELECT * FROM recop_clips WHERE estado = 'listo' AND aprobado = 1 AND recop_id IS NULL AND nota IS NOT NULL ORDER BY nota DESC, id").all();
}
export function ronda({ simular = false } = {}) {
  const k = cfg(), pool = bolsa();
  const sinNota = db.prepare("SELECT COUNT(*) n FROM recop_clips WHERE estado = 'listo' AND aprobado = 1 AND recop_id IS NULL AND nota IS NULL").get().n;
  if (sinNota) return { esperando: `faltan ${sinNota} clips por puntuar` };
  if (pool.length < Number(k['recop.min_clips'])) return { insuficiente: pool.length };
  // Los N mejores; luego se ajusta a la duración objetivo (8–10 min de clips).
  const N = Number(k['recop.clips']);
  const elegidos = pool.slice(0, N), resto = pool.slice(N);
  const total = () => elegidos.reduce((s, x) => s + (x.dur || 0), 0);
  while (total() < Recop.OBJETIVO.min && resto.length) elegidos.push(resto.shift());
  while (total() > Recop.OBJETIVO.max && elegidos.length > Number(k['recop.min_clips'])) resto.unshift(elegidos.pop());
  resto.sort((a, b) => b.nota - a.nota);
  const id = Recop.crear(elegidos.map((x) => x.id));
  Recop.encolar(id);
  for (const x of elegidos) resultado.run(x.id, x.video_id, x.n, 'seleccionado', id, x.nota, x.emocion, x.puntos);
  // Sobrantes: los mejores siguen en la bolsa (con un arrastre más); el resto se descarta y se borra su copia 16:9.
  const siguen = [], fuera = [];
  for (const x of resto) (siguen.length < Number(k['recop.arrastre']) && x.arrastres < Number(k['recop.max_arrastres']) ? siguen : fuera).push(x);
  for (const x of siguen) { db.prepare('UPDATE recop_clips SET arrastres = arrastres + 1 WHERE id = ?').run(x.id); resultado.run(x.id, x.video_id, x.n, 'arrastrado', id, x.nota, x.emocion, x.puntos); }
  for (const x of fuera) {
    if (!simular && x.archivo && existsSync(x.archivo)) { try { rmSync(x.archivo, { force: true }); } catch {} }
    db.prepare("UPDATE recop_clips SET estado = 'descartado', aprobado = 0, archivo = NULL, descartado = datetime('now') WHERE id = ?").run(x.id);
    resultado.run(x.id, x.video_id, x.n, 'descartado', id, x.nota, x.emocion, x.puntos);
  }
  const min = Math.round(total() / 60 * 10) / 10;
  log(`recopilatorio ${id}: ${elegidos.length} clips (${min} min de clips) · siguen ${siguen.length} · descartados ${fuera.length}`);
  return { recop: id, elegidos: elegidos.length, minutos: min, siguen: siguen.length, descartados: fuera.length };
}

// ---------- 1. aprobación automática de clips del canal ----------
let evaluando = false;
export async function aprobarCanal(alAprobar) {
  const k = cfg(); if (!k['clips.autopiloto'] || evaluando) return;
  evaluando = true;
  try {
    // Aprobados hoy (hora RD) de clips del canal: los del editor también cuentan para el cupo diario.
    const hoyRD = "datetime('now','-4 hours','start of day','+4 hours')";
    const hechos = db.prepare(`SELECT COUNT(*) n FROM clip_valoraciones l JOIN clip_videos v ON v.id = l.video_id
      WHERE l.valor = 1 AND l.fecha >= ${hoyRD} AND v.tipo NOT IN ('estudio','recop') AND COALESCE(v.campana, '') = ''`).get().n;
    let cupo = Number(k['clips.auto_por_dia']) - hechos; if (cupo <= 0) return;
    const filas = db.prepare(`SELECT id, clips FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop') AND COALESCE(campana, '') = ''
      AND COALESCE(terminado, creado) < datetime('now','-1 hour') AND COALESCE(terminado, creado) > datetime('now','-3 days')`).all();
    const cand = [];
    for (const v of filas) for (const c of JSON.parse(v.clips || '[]')) {
      if (c.formato === 'horizontal' || !c.qa?.ok || !c.final || !existsSync(c.final)) continue;
      if (db.prepare('SELECT 1 FROM clip_valoraciones WHERE video_id = ? AND n = ?').get(v.id, c.n)) continue;
      if (db.prepare('SELECT 1 FROM clip_prefiltro WHERE video_id = ? AND n = ? AND descartado = 1 AND recuperado IS NULL').get(v.id, c.n)) continue;
      cand.push({ v, c });
    }
    for (const x of cand) if (x.c.emocion == null) {  // emoción del vertical (un pase de ffmpeg por clip, solo la primera vez)
      const e = await emocionClip(x.c.final).catch(() => null);
      if (e) { x.c.emocion = e.emocion; guardarEnClip(x.v.id, x.c.n, { emocion: e.emocion, emocionDetalle: e.detalle }); }
    }
    const min = k['clips.auto_nota_pct'] != null ? Number(k['clips.auto_nota_pct']) / 100 : Number(k['clips.auto_nota_min']);
    const orden = cand.map((x) => ({ ...x, nota: nota(x.c.emocion, puntosDe(x.c), k) ?? 0 })).filter((x) => x.nota >= min).sort((a, b) => b.nota - a.nota);
    for (const x of orden) {
      if (cupo <= 0) break;
      db.prepare("INSERT OR IGNORE INTO clip_valoraciones (video_id, n, valor, etiquetas, nota) VALUES (?,?,1,'[]','autopiloto')").run(x.v.id, x.c.n);
      alAprobar(x.v.id, x.c.n); cupo--;
      log(`aprobado solo: vídeo ${x.v.id} clip ${x.c.n} (nota ${x.nota.toFixed(2)}, emoción ${x.c.emocion ?? '—'}, puntos ${puntosDe(x.c) ?? '—'})`);
    }
  } finally { evaluando = false; }
}

// Resumen para el panel, la skill y el MCP.
export function estado() {
  const k = cfg();
  return { pesos: { emocion: k['banco.peso_emocion'], puntos: k['banco.peso_puntos'] }, bolsa: bolsa().map((r) => ({ id: r.id, video_id: r.video_id, n: r.n, nota: r.nota, emocion: r.emocion, puntos: r.puntos, dur: r.dur, arrastres: r.arrastres })),
    resultados_14d: db.prepare("SELECT resultado, COUNT(*) n FROM banco_resultados WHERE fecha > datetime('now','-14 days') GROUP BY resultado").all() };
}
