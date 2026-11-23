// Vídeos largos sin OpenShorts (motor propio, el de por defecto): se eligen los mejores momentos y cada uno se monta como
// un clip corto (encuadre propio, subtítulos si hay whisper, gancho y logo de campaña), igual que un clip de Twitch.
//   1. Momentos: los que marcó una IA por MCP si los hay; si no, «lo más reproducido» de YouTube (heatmap de yt-dlp);
//      si no, los picos de voz del audio (gritos, risas, subidones); si nada de eso da señal, momentos repartidos.
//   2. Ventanas de 20–55 s, sin solaparse, las N mejores (Ajustes › Clips › «Clips por vídeo largo»).
//   3. Solo se descargan esas ventanas (yt-dlp --download-sections) o se cortan del archivo local con ffmpeg.
//   4. Cada ventana entra en la cola como un vídeo corto (offset_s = su inicio en el original) y el vídeo largo queda
//      como «recortado en N momentos».
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { db, ajustes } from '../db.mjs';
import { picosVoz } from './clips-picos.mjs';

const ANTES = 8;       // la reacción llega después de lo que la provoca: la ventana empieza unos segundos antes del pico
const MIN = 20, MAX = 55, LARGO = 35;
const esUrl = (s) => /^https?:\/\//i.test(String(s));
const correr = (cmd, args, timeout = 600000) => new Promise((ok, mal) => {
  execFile(cmd, args, { timeout, maxBuffer: 64 << 20 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).split('\n').filter((l) => l && !/^WARNING/.test(l)).join(' ').slice(-400))) : ok(String(so))));
});
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const paso = (id, t) => db.prepare('UPDATE clip_videos SET paso = ? WHERE id = ?').run(t, id);

async function duracion(v) {
  if (Number(v.duracion_s) > 0) return Number(v.duracion_s);
  try {
    const out = esUrl(v.fuente) ? await correr('yt-dlp', ['--skip-download', '--no-warnings', '--no-playlist', '--print', '%(duration)s', v.fuente], 120000)
      : await correr('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', v.fuente], 60000);
    return Number(out.trim()) || 0;
  } catch { return 0; }
}

// Ventanas a partir de puntos { t, peso } (segundos del vídeo): las de más peso, sin solaparse.
function elegir(puntos, dur, n, largo = LARGO) {
  const out = [];
  for (const p of [...puntos].sort((a, b) => b.peso - a.peso)) {
    const a = Math.max(0, Math.min(Math.max(0, dur - largo), Math.round(p.t - ANTES)));
    const b = Math.min(dur, a + largo);
    if (b - a < MIN) continue;
    if (out.every((w) => b <= w.a || a >= w.b)) out.push({ a, b, peso: p.peso, origen: p.origen });
    if (out.length >= n) break;
  }
  return out.sort((x, y) => x.a - y.a);
}

// Momentos marcados por una IA (MCP: marcar_escenas), en segundos del original.
function deIA(v) {
  try {
    return db.prepare('SELECT momentos FROM ia_escenas WHERE video = ? OR video = ? ORDER BY id DESC LIMIT 3').all(String(v.video || ''), String(v.id))
      .flatMap((r) => { try { return JSON.parse(r.momentos); } catch { return []; } })
      .filter((m) => m.fin_s > m.inicio_s)
      .map((m) => ({ a: Math.max(0, m.inicio_s), b: m.inicio_s + Math.min(MAX, Math.max(MIN, m.fin_s - m.inicio_s)), peso: Number(m.puntuacion) || 1, origen: 'ia' }));
  } catch { return []; }
}

async function deMapa(v) {
  if (!esUrl(v.fuente) || !/youtube\.com|youtu\.be/i.test(v.fuente)) return [];
  try {
    const h = JSON.parse((await correr('yt-dlp', ['--skip-download', '--no-warnings', '--no-playlist', '--print', '%(heatmap)j', v.fuente], 180000)).trim());
    if (!Array.isArray(h) || h.length < 10) return [];
    const vals = h.map((x) => x.value).sort((a, b) => a - b), med = vals[Math.floor(vals.length / 2)];
    // Picos locales claramente por encima de lo normal (el principio de casi todos los vídeos se re-ve: fuera los 10 primeros s).
    return h.filter((x, i) => x.start_time > 10 && x.value > med * 1.15 && x.value >= (h[i - 1]?.value ?? 0) && x.value >= (h[i + 1]?.value ?? 0))
      .map((x) => ({ t: (x.start_time + x.end_time) / 2, peso: x.value, origen: 'mapa' }));
  } catch { return []; }
}

async function deAudio(v, entrada) {
  let f = esUrl(v.fuente) ? null : v.fuente, temporal = null;
  try {
    if (!f) {
      temporal = path.join(entrada, `audio-${v.id}`);
      for (const x of readdirSync(entrada)) if (x.startsWith(path.basename(temporal) + '.')) rmSync(path.join(entrada, x), { force: true });
      await correr('yt-dlp', ['-f', 'bestaudio/best', '--no-part', '--no-playlist', '--no-warnings', '-o', `${temporal}.%(ext)s`, v.fuente], 3 * 3600000);
      f = readdirSync(entrada).map((x) => path.join(entrada, x)).find((x) => x.startsWith(temporal + '.'));
    }
    if (!f || !existsSync(f)) return [];
    return (await picosVoz(f)).map((p) => ({ t: p.t, peso: Number(p.intensidad) || 1, origen: 'voz' }));
  } catch (e) { console.error('Clips: picos de voz:', String(e.message).slice(0, 160)); return []; }
  finally { if (temporal) for (const x of readdirSync(entrada)) if (x.startsWith(path.basename(temporal) + '.')) rmSync(path.join(entrada, x), { force: true }); }
}

async function bajarVentana(v, w, base) {
  if (esUrl(v.fuente)) {
    await correr('yt-dlp', ['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--download-sections', `*${w.a}-${w.b}`,
      '--force-keyframes-at-cuts', '--merge-output-format', 'mp4', '--no-part', '--no-playlist', '--no-warnings', '--retries', '5', '-o', `${base}.%(ext)s`, v.fuente], 1800000);
  } else {
    await correr('ffmpeg', ['-v', 'error', '-y', '-nostdin', '-ss', String(w.a), '-i', v.fuente, '-t', String(w.b - w.a), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', `${base}.mp4`], 1800000);
  }
  return readdirSync(path.dirname(base)).map((x) => path.join(path.dirname(base), x)).find((x) => x.startsWith(base + '.') && x.endsWith('.mp4')) || null;
}

// Devuelve cuántos momentos entraron en la cola. Lanza si no se pudo (el que llama marca el vídeo con error).
export async function recortarLargo(v) {
  const cfg = ajustes(), n = Math.max(1, Math.min(20, Number(cfg['clips.momentos_por_video']) || 5));
  const entrada = cfg['clips.entrada']; mkdirSync(entrada, { recursive: true });
  db.prepare("UPDATE clip_videos SET estado = 'procesando', job = ?, enviado = ?, paso = 'Buscando los mejores momentos', error = NULL WHERE id = ?").run(`propio-${v.id}`, new Date().toISOString(), v.id);
  const dur = await duracion(v);
  if (!dur) throw new Error('No se pudo saber cuánto dura el vídeo (¿enlace privado o borrado?)');
  const libre = (w, lista) => lista.every((o) => w.b <= o.a || w.a >= o.b);
  let ventanas = [];
  for (const w of deIA(v).filter((x) => x.b <= dur + 1).sort((x, y) => y.peso - x.peso)) if (ventanas.length < n && libre(w, ventanas)) ventanas.push(w);
  if (ventanas.length < n) {
    paso(v.id, 'Buscando lo más reproducido');
    for (const w of elegir(await deMapa(v), dur, n)) if (ventanas.length < n && libre(w, ventanas)) ventanas.push(w);
  }
  if (ventanas.length < n) {
    paso(v.id, 'Escuchando el audio para encontrar reacciones');
    for (const w of elegir(await deAudio(v, entrada), dur, n)) if (ventanas.length < n && libre(w, ventanas)) ventanas.push(w);
  }
  if (!ventanas.length) { // sin ninguna señal: momentos repartidos por el vídeo
    const k = Math.max(1, Math.min(n, Math.floor(dur / (LARGO * 2))));
    for (let i = 0; i < k; i++) { const a = Math.max(0, Math.round((dur / (k + 1)) * (i + 1) - LARGO / 2)); ventanas.push({ a, b: Math.min(dur, a + LARGO), origen: 'reparto' }); }
  }
  const NOMBRE = { ia: 'marcas de la IA', mapa: 'lo más reproducido', voz: 'picos de voz', reparto: 'momentos repartidos (sin señales claras)' };
  const origen = [...new Set(ventanas.map((w) => NOMBRE[w.origen]))].join(' + ');
  ventanas = ventanas.slice(0, n).sort((x, y) => x.a - y.a);
  let hechos = 0;
  for (const [i, w] of ventanas.entries()) {
    paso(v.id, `Descargando el momento ${i + 1} de ${ventanas.length} (${mmss(w.a)})`);
    const base = path.join(entrada, `momento-${v.id}-${Math.round(w.a)}`);
    for (const x of readdirSync(entrada)) if (x.startsWith(path.basename(base) + '.')) rmSync(path.join(entrada, x), { force: true });
    let f = null;
    try { f = await bajarVentana(v, w, base); } catch (e) { console.error(`Clips: momento ${mmss(w.a)} de «${v.titulo}»:`, String(e.message).slice(0, 200)); }
    if (!f || statSync(f).size < 5e4) { if (f) rmSync(f, { force: true }); continue; }
    db.prepare(`INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, urgente, offset_s, campana, sin_ia, estado) VALUES (?,?,?,?,?,?,?,?,?,?,1,'cola')`)
      .run(v.canal_id, f, v.video, `${String(v.titulo || 'Vídeo').slice(0, 200)} · ${mmss(w.a)}`, Math.round(w.b - w.a), v.tipo, v.enfoque || '', v.urgente ? 1 : 0, Math.round(w.a), v.campana);
    hechos++;
  }
  if (!hechos) throw new Error('No se pudo descargar ningún momento del vídeo');
  db.prepare("UPDATE clip_videos SET estado = 'descartado', terminado = ?, paso = ?, error = NULL WHERE id = ?")
    .run(new Date().toISOString(), `Recortado en ${hechos} momento(s): ${origen}`, v.id);
  console.log(`Clips: «${v.titulo}»: ${hechos} momento(s) a la cola (${origen})`);
  return hechos;
}
