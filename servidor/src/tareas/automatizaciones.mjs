// Automatizaciones del editor (23-nov-2026), a partir de lo que el editor repetía a mano:
//  1. Prefiltro: cada clip nuevo de streamers lo juzga Groq frente a los motivos y ejemplos de las valoraciones del editor.
//     Si está muy seguro de que no sirve, el clip pasa a «Descartados por la app»: sale de la revisión, se recupera con un toque
//     (o valorándolo) y, sin recuperar, se borra a los «prefiltro.dias» días. NUNCA cuenta como valoración del editor (no entra
//     en las lecciones de las IA): se guarda en su propia tabla.
//  2. Encuadre aprendido: cuando el editor renderiza un clip con la cámara del streamer, la caja de la webcam y el centro que
//     eligió quedan como encuadre del canal; los clips nuevos de ese canal lo usan en vez de volver a detectarlo.
import { existsSync } from 'node:fs';
import { db, ajustes, columna } from '../db.mjs';
import { chat } from '../llm.mjs';
import { MOTIVOS, lecciones } from './clips-valoracion.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS clip_prefiltro (video_id INTEGER NOT NULL, n INTEGER NOT NULL, descartado INTEGER NOT NULL DEFAULT 0,
  motivo TEXT, confianza REAL, razon TEXT, modelo TEXT, recuperado TEXT, fecha TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (video_id, n));`);
columna('clip_canales', 'encuadre_aprendido', 'TEXT');

const log = (...a) => console.log('Prefiltro:', ...a);
const MOTIVOS_PREFILTRO = ['aburrido', 'corte_malo', 'gancho_flojo', 'repetido', 'sin_contexto'];
const cfg = () => ({ 'prefiltro.activo': true, 'prefiltro.confianza': 0.85, 'prefiltro.dias': 3, 'prefiltro.modelo': 'openai/gpt-oss-120b', 'clips.encuadre_aprendido': true, ...ajustes() });
const dur = (c) => Math.round(((c.fin ?? 0) - (c.inicio ?? 0)) * 10) / 10;

// ---------- consultas que usan las demás partes ----------
// Oculto = descartado por la app, sin recuperar y sin valoración del editor.
export function oculto(videoId, n) {
  return !!db.prepare(`SELECT 1 FROM clip_prefiltro p WHERE p.video_id = ? AND p.n = ? AND p.descartado = 1 AND p.recuperado IS NULL
    AND NOT EXISTS (SELECT 1 FROM clip_valoraciones v WHERE v.video_id = p.video_id AND v.n = p.n)`).get(Number(videoId), Number(n));
}
export const dePrefiltro = (videoId, n) => db.prepare('SELECT descartado, motivo, confianza, razon, recuperado, fecha FROM clip_prefiltro WHERE video_id = ? AND n = ?').get(Number(videoId), Number(n)) || null;
export function recuperar(videoId, n) {
  const r = db.prepare("UPDATE clip_prefiltro SET recuperado = datetime('now') WHERE video_id = ? AND n = ? AND descartado = 1").run(Number(videoId), Number(n));
  if (!r.changes) throw new Error('Ese clip no está en «Descartados por la app»');
  return { ok: true };
}
// Para la limpieza (autopiloto): descartados por la app hace más de N días, sin recuperar ni valorar.
export function vencidos() {
  const d = Math.max(1, Number(cfg()['prefiltro.dias']) || 3);
  return db.prepare(`SELECT p.video_id, p.n, 'descartado por la app' m FROM clip_prefiltro p WHERE p.descartado = 1 AND p.recuperado IS NULL
    AND p.fecha < datetime('now', ?) AND NOT EXISTS (SELECT 1 FROM clip_valoraciones v WHERE v.video_id = p.video_id AND v.n = p.n)`).all(`-${d} days`);
}
export function resumen() {
  return db.prepare(`SELECT COUNT(*) total, SUM(descartado) descartados, SUM(descartado = 1 AND recuperado IS NOT NULL) recuperados
    FROM clip_prefiltro WHERE fecha >= datetime('now','-7 days')`).get();
}

// ---------- 1. prefiltro ----------
const linea = (x) => `«${x.titulo}»${x.gancho ? ` (gancho: «${x.gancho}»)` : ''} · ${x.dur}s${x.dicho ? ` · dice: «${x.dicho}»` : ''}`;
function ejemplos(v) {
  // Valoraciones reales del editor (no las del autopiloto); el encuadre no cuenta (eso no lo juzga el texto).
  const filas = db.prepare(`SELECT cv.valor, cv.etiquetas, cv.n, cv.video_id, v.clips, v.canal_id FROM clip_valoraciones cv JOIN clip_videos v ON v.id = cv.video_id
    WHERE cv.nota != 'autopiloto' AND v.tipo = ? AND cv.video_id != ? ORDER BY (v.canal_id = ?) DESC, cv.fecha DESC LIMIT 120`).all(v.tipo, v.id, v.canal_id ?? -1);
  const sirve = [], no = [];
  for (const f of filas) {
    const et = JSON.parse(f.etiquetas || '[]').filter((e) => e !== 'encuadre' && e !== 'subtitulos');
    if (f.valor === -1 && !et.length) continue; // descartado solo por encuadre o subtítulos
    const c = JSON.parse(f.clips || '[]').find((x) => x.n === f.n); if (!c) continue;
    const x = { titulo: c.titulo, gancho: c.gancho, dur: dur(c), dicho: String(c.dicho || '').slice(0, 160) };
    if (f.valor === 1 && sirve.length < 10) sirve.push(linea(x));
    if (f.valor === -1 && no.length < 12) no.push(`${linea(x)} → ${et.map((e) => MOTIVOS[e]?.[0] || e).join(', ')}`);
  }
  return { sirve, no };
}
const ESQUEMA = { type: 'object', additionalProperties: false, required: ['descartar', 'motivo', 'confianza', 'razon'], properties: {
  descartar: { type: 'boolean' }, motivo: { type: 'string', enum: [...MOTIVOS_PREFILTRO, 'ninguno'] },
  confianza: { type: 'number' }, razon: { type: 'string' } } };

export async function juzgar(v, c, { otros = [] } = {}) {
  const k = cfg(), ej = ejemplos(v), canal = v.canal_id ? db.prepare('SELECT nombre FROM clip_canales WHERE id = ?').get(v.canal_id)?.nombre : '';
  const prompt = [
    'Eres el filtro previo de un editor de Shorts. Decide si este clip lo descartaría él. Solo juzgas el CONTENIDO (no el encuadre).',
    `Motivos posibles: ${MOTIVOS_PREFILTRO.map((m) => `${m} = ${MOTIVOS[m][0]}`).join('; ')}.`,
    'Sé prudente: descartar = true solo si se parece claramente a lo que el editor descartó; ante la duda, false. confianza de 0 a 1.',
    lecciones({ tipo: v.tipo, canalId: v.canal_id }) || '',
    ej.no.length ? `Clips que el editor DESCARTÓ:\n- ${ej.no.join('\n- ')}` : '',
    ej.sirve.length ? `Clips que SÍ le sirvieron:\n- ${ej.sirve.join('\n- ')}` : '',
    otros.length ? `Otros clips del mismo vídeo (para «repetido»):\n- ${otros.join('\n- ')}` : '',
    `CLIP A JUZGAR (${canal || 'streamer'}, vídeo «${String(v.titulo || '').replace(/ · tramo.*$/, '').slice(0, 120)}»):`,
    linea({ titulo: c.titulo, gancho: c.gancho, dur: dur(c), dicho: String(c.dicho || '').slice(0, 600) }) + (c.porque ? ` · por qué se eligió: ${String(c.porque).slice(0, 200)}` : ''),
    'Responde solo JSON: {"descartar":bool,"motivo":"…","confianza":0-1,"razon":"una frase"}',
  ].filter(Boolean).join('\n\n');
  const txt = await chat('groq', { model: 'groq', modeloGroq: k['prefiltro.modelo'], messages: [{ role: 'user', content: prompt }], schema: ESQUEMA, max_tokens: 300 });
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a < 0) throw new Error('Groq no devolvió JSON');
  const r = JSON.parse(txt.slice(a, b + 1));
  return { descartar: !!r.descartar && MOTIVOS_PREFILTRO.includes(r.motivo), motivo: r.motivo, confianza: Math.max(0, Math.min(1, Number(r.confianza) || 0)), razon: String(r.razon || '').slice(0, 240) };
}

let corriendo = false, ultima = 0, pausaHasta = 0;
export async function cicloPrefiltro() {
  const k = cfg();
  if (k['prefiltro.activo'] === false || corriendo || Date.now() < pausaHasta || Date.now() - ultima < 4 * 60e3) return;
  corriendo = true; ultima = Date.now();
  try {
    const vids = db.prepare(`SELECT * FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop') AND canal_id IS NOT NULL
      AND COALESCE(campana, '') = '' AND COALESCE(terminado, creado) > datetime('now','-3 days') ORDER BY id DESC`).all();
    let hechos = 0;
    for (const v of vids) {
      const clips = JSON.parse(v.clips || '[]');
      for (const c of clips) {
        if (hechos >= 6) return;
        if (c.formato === 'horizontal' || !c.final || !existsSync(c.final)) continue;
        if (db.prepare(`SELECT 1 FROM clip_prefiltro WHERE video_id = ?1 AND n = ?2 UNION SELECT 1 FROM clip_valoraciones WHERE video_id = ?1 AND n = ?2
          UNION SELECT 1 FROM clip_subidas WHERE video_id = ?1 AND n = ?2`).get(v.id, c.n)) continue;
        const otros = clips.filter((x) => x.n !== c.n && x.formato !== 'horizontal').map((x) => `«${x.titulo}» (${Math.round(x.inicio)}–${Math.round(x.fin)} s)`).slice(0, 8);
        let r;
        try { r = await juzgar(v, c, { otros: otros.length ? [`este clip: ${Math.round(c.inicio)}–${Math.round(c.fin)} s`, ...otros] : [] }); }
        catch (e) {
          log(`${v.id}/${c.n}: ${String(e.message).slice(0, 120)}`);
          if (/429|per day|sin configurar/i.test(e.message)) pausaHasta = Date.now() + 30 * 60e3; // sin cupo: media hora de pausa
          return;
        }
        hechos++;
        const fuera = r.descartar && r.confianza >= Number(k['prefiltro.confianza']);
        db.prepare('INSERT OR REPLACE INTO clip_prefiltro (video_id, n, descartado, motivo, confianza, razon, modelo) VALUES (?,?,?,?,?,?,?)')
          .run(v.id, c.n, fuera ? 1 : 0, r.motivo, r.confianza, r.razon, k['prefiltro.modelo']);
        if (fuera) log(`${v.id}/${c.n} «${c.titulo}» → Descartados por la app (${r.motivo}, ${Math.round(r.confianza * 100)} %): ${r.razon}`);
      }
    }
  } finally { corriendo = false; }
}

// ---------- 2. encuadre aprendido por canal ----------
// Al renderizar desde el editor: caja de la webcam (la detectada para ese clip) + centro de la cámara que dejó el editor.
export function aprenderEncuadre(v, c, receta, m) {
  try {
    if (!v?.canal_id || v.campana || !m?.w || !m?.h || !receta?.v?.capas?.length) return;
    const previo = encuadreDeCanal(v.canal_id) || {};
    const clip = `${v.id}-${c.n}`, fecha = new Date().toISOString();
    const dato = { ...previo, layouts: { ...(previo.layouts || {}) } };
    // Diseño vertical completo de este tipo de vídeo (capas, fondo, línea y altura de subtítulos).
    dato.layouts[v.tipo] = { fondo: receta.v.fondo, linea: !!receta.v.linea, capas: receta.v.capas.map(({ id, src, dst }) => ({ id, src, dst })), subsY: receta.v.subs?.y ?? null, clip, fecha };
    const cap = receta.v.capas.find((x) => x.id === 'camara');
    if (['gaming', 'reaccion'].includes(v.tipo)) {
      if (cap) {
        const caja = c.webcam?.cam, s = cap.src;
        // Sin caja detectada, la propia zona elegida hace de caja.
        const camF = caja ? [caja[0] / m.w, caja[1] / m.h, caja[2] / m.w, caja[3] / m.h] : [s.x, s.y, s.w, s.h];
        Object.assign(dato, { cam: camF.map((x) => +x.toFixed(4)), zona: [s.x, s.y, s.w, s.h].map((x) => +x.toFixed(4)), clip, fecha });
      } else { delete dato.cam; delete dato.zona; } // quitó la cámara: manda el diseño (sin webcam)
    }
    db.prepare('UPDATE clip_canales SET encuadre_aprendido = ? WHERE id = ?').run(JSON.stringify(dato), v.canal_id);
    console.log(`Encuadre: aprendido para el canal ${v.canal_id} desde el clip ${v.id}/${c.n}`);
  } catch (e) { console.error('Encuadre (aprender):', e.message); }
}
// Lo que usa el recorte de un clip nuevo: { cam:[x,y,w,h] px, cara:[x,y,w,h] px, aprendido:true } o null.
export function webcamAprendida(canalId, w, h) {
  if (!canalId || !w || !h || cfg()['clips.encuadre_aprendido'] === false) return null;
  let d; try { d = JSON.parse(db.prepare('SELECT encuadre_aprendido FROM clip_canales WHERE id = ?').get(Number(canalId))?.encuadre_aprendido || 'null'); } catch { return null; }
  if (!d?.cam) return null;
  const px = (r) => [Math.round(r[0] * w), Math.round(r[1] * h), Math.round(r[2] * w), Math.round(r[3] * h)].map((x) => x - (x % 2));
  return { cam: px(d.cam), cara: d.zona ? px(d.zona) : null, aprendido: true, desde: d.clip };
}
// Diseño aprendido de un canal para un tipo de vídeo (o null).
export function layoutAprendido(canalId, tipo) {
  if (!canalId || cfg()['clips.encuadre_aprendido'] === false) return null;
  const d = encuadreDeCanal(canalId); const L = d?.layouts?.[tipo]; if (!L?.capas?.length) return null;
  return { ...L, conCamara: L.capas.some((x) => x.id === 'camara'), webcam: !!d.cam };
}
export const encuadreDeCanal = (canalId) => { try { return JSON.parse(db.prepare('SELECT encuadre_aprendido FROM clip_canales WHERE id = ?').get(Number(canalId))?.encuadre_aprendido || 'null'); } catch { return null; } };
