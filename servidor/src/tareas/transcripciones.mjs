// Transcripción propia para Gemini (23-nov-2026): los tramos de campaña son archivos del servidor y muchos vídeos (p. ej. los
// de xQc) no tienen subtítulos en YouTube, así que Gemini no puede «leerlos». El servidor los transcribe con whisper.cpp, de uno
// en uno y en segundo plano, y el MCP se lo pasa a Gemini (herramienta leer_transcripcion) con los tiempos del vídeo original.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import path from 'node:path';
import { db, ajustes, DATOS } from '../db.mjs';
import { pendientes } from '../gemini-vigia.mjs';

export const DIR = path.join(DATOS, 'transcripciones');
const correr = (cmd, args, timeout) => new Promise((ok, mal) => execFile(cmd, args, { timeout, maxBuffer: 64 << 20 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-300))) : ok(so))));
export const ruta = (id) => path.join(DIR, `${id}.json`);

let ocupado = false, falloHasta = 0;
export async function cicloTranscripciones() {
  const cfg = ajustes();
  if (ocupado || cfg['gemini.transcribir'] === false || Date.now() < falloHasta) return;
  if (loadavg()[0] > cpus().length * 1.5) return; // con el servidor muy cargado, espera
  const ids = new Set(pendientes().map((v) => v.id)); if (!ids.size) return;
  const v = db.prepare(`SELECT v.id, v.fuente, v.titulo, v.offset_s, COALESCE(v.campana, c.campana) campana FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
    WHERE v.id IN (${[...ids].join(',')}) ORDER BY (COALESCE(v.campana, c.campana) IS NULL), v.id`).all()
    .find((x) => x.fuente && !/^https?:/.test(x.fuente) && existsSync(x.fuente) && !existsSync(ruta(x.id)));
  if (!v) return;
  ocupado = true; const t0 = Date.now(); mkdirSync(DIR, { recursive: true });
  const base = path.join(DIR, `tmp-${v.id}`), wav = `${base}.wav`;
  try {
    await correr('ffmpeg', ['-v', 'error', '-y', '-nostdin', '-i', v.fuente, '-vn', '-ac', '1', '-ar', '16000', wav], 600000);
    await correr(cfg['whisper.binario'], ['-m', cfg['whisper.modelo'], '-l', v.campana ? 'en' : 'es', '-t', String(cfg['whisper.hilos'] || 4), '-np', '-oj', '-of', base, '-f', wav], 3600000);
    const j = JSON.parse(readFileSync(`${base}.json`, 'utf8')), off = Number(v.offset_s) || 0;
    const frases = (j.transcription || []).map((x) => ({ s: Math.round(x.offsets.from / 100) / 10 + off, e: Math.round(x.offsets.to / 100) / 10 + off, t: String(x.text).trim() })).filter((x) => x.t);
    writeFileSync(ruta(v.id), JSON.stringify({ id: v.id, titulo: v.titulo, offset_s: off, idioma: v.campana ? 'en' : 'es', fecha: new Date().toISOString(), frases }));
    console.log(`Transcripción para Gemini: vídeo ${v.id} (${frases.length} frases) en ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) { falloHasta = Date.now() + 30 * 60000; console.error(`Transcripción para Gemini ${v.id}:`, e.message); }
  finally { rmSync(wav, { force: true }); rmSync(`${base}.json`, { force: true }); ocupado = false; }
}

// ¿Gemini aún no pudo ver este tramo? Pasa cuando el vídeo depende de transcripciones del servidor (algún tramo suyo la tiene)
// y la de este tramo falta o es más nueva que la última marca del vídeo. Así un tramo no se da por «analizado sin momentos»
// solo porque Gemini marcó otro tramo del mismo vídeo.
export function tramoSinVer(v) {
  if (!(Number(v.offset_s) > 0) || !v.video) return false;
  const hermanos = db.prepare('SELECT id FROM clip_videos WHERE video = ?').all(v.video).map((r) => r.id);
  if (!hermanos.some((id) => existsSync(ruta(id)))) return false;
  if (!existsSync(ruta(v.id))) return true;
  let fecha = 0; try { fecha = Date.parse(JSON.parse(readFileSync(ruta(v.id), 'utf8')).fecha); } catch {}
  const ult = db.prepare('SELECT MAX(creado) m FROM ia_escenas WHERE video = ? OR video = ?').get(String(v.video), String(v.id))?.m;
  return !ult || Date.parse(`${ult.replace(' ', 'T')}Z`) < fecha;
}

// Limpieza: transcripciones de vídeos que ya no esperan a Gemini (más de 3 días).
export function limpiarTranscripciones() {
  if (!existsSync(DIR)) return;
  const vivos = new Set(pendientes().map((v) => String(v.id)));
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) { const id = f.replace(/\.json$/, ''); if (!vivos.has(id)) { try { const d = JSON.parse(readFileSync(path.join(DIR, f), 'utf8')); if (Date.now() - Date.parse(d.fecha) > 3 * 86400000) rmSync(path.join(DIR, f), { force: true }); } catch {} } }
}
