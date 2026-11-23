// Recopilatorios horizontales («Mejores momentos de streamers | #1»).
//  1. Cada clip puede tener una versión 16:9 sacada de su fuente tal cual (sin reencuadrar), con el audio normalizado.
//     Se pide a mano desde la galería o sola para los canales marcados «horizontal».
//  2. El usuario aprueba las que valen; se acumulan en una bolsa.
//  3. Un recopilatorio toma la bolsa, propone un orden (fuerte al principio, el mejor al final, sin repetir canal seguido)
//     y el usuario lo edita: orden, recorte de cada clip y texto del separador.
//  4. Montaje: avance de 3 momentos con gancho → cartela de título → [separador + clip con el nombre del creador]… →
//     pantalla final con todos los canales (foto y nombre). Los gráficos se hacen con HyperFrames (un solo render corto)
//     y el resto con ffmpeg, así un vídeo de 9 min no tarda más que unos minutos de codificación.
//  5. Queda en la galería con su descripción (capítulos y créditos a cada creador) para publicarlo como cualquier clip.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db, RAIZ } from '../db.mjs';
import { videos } from './clips.mjs';
import { avisarSinFallo } from '../avisos.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS recop_clips (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL, n INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | listo | error
  archivo TEXT, dur REAL, reaccion REAL,
  aprobado INTEGER NOT NULL DEFAULT 0,        -- 1 = vale para un recopilatorio
  recop_id INTEGER,                           -- recopilatorio en el que está (NULL = en la bolsa)
  error TEXT, creado TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (video_id, n)
);
CREATE TABLE IF NOT EXISTS recopilatorios (
  id INTEGER PRIMARY KEY,
  numero INTEGER NOT NULL, titulo TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',           -- [{ id (recop_clips), ini, fin (s dentro del clip), texto }]
  estado TEXT NOT NULL DEFAULT 'borrador',    -- borrador | cola | montando | listo | error
  paso TEXT, error TEXT, archivo TEXT, descripcion TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')), terminado TEXT
);
`);

const DIR = path.join(RAIZ, 'datos', 'recop');
const HF = path.join(os.homedir(), 'apps', 'hyperframes');
const SFX = path.join(os.homedir(), 'apps', 'estudio', 'sfx');
// Sin narración. Cartela ≤ 2 s y separadores de 0,5 s (un golpe de color con el número y un barrido de sonido).
export const DUR = { teaser: 1.8, intro: 2, sep: 0.5, sepTexto: 0.5, outro: 12 };
export const OBJETIVO = { min: 480, max: 600 };
const TITULO = 'Mejores momentos de streamers | #{n}';
const CODIF = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];

const correr = (cmd, args, { timeout = 900000, env, cwd } = {}) => new Promise((ok, mal) => {
  const p = spawn('nice', ['-n', '10', cmd, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out = (out + d).slice(-20000); });
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  const t = setTimeout(() => p.kill('SIGKILL'), timeout);
  p.on('error', (e) => { clearTimeout(t); mal(e); });
  p.on('close', (code) => { clearTimeout(t); code === 0 ? ok(out) : mal(new Error(`${cmd}: ${(err || out).trim().split('\n').slice(-2).join(' ').slice(0, 300) || `salió con ${code}`}`)); });
});
const ffmpeg = (args, timeout) => correr('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args], { timeout });
const duracion = (f) => correr('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { timeout: 60000 }).then((s) => Number(s.trim()) || 0);
const tieneAudio = (f) => correr('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { timeout: 60000 }).then((s) => !!s.trim()).catch(() => false);
let fuenteTexto = null;
const fuenteFfmpeg = async () => fuenteTexto ??= (await correr('fc-match', ['-f', '%{file}', 'Noto Sans:black'], { timeout: 10000 }).catch(() => '')).trim() || '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- puntuación de reacción ----------
// Los picos del vídeo (voz, cara, palabras, chat) que caen dentro del clip. La voz y la cara pesan más: en un recopilatorio
// lo que engancha es la reacción exagerada del streamer.
const PESO = { voz: 1.5, cara: 1.5, palabras: 1.3, chat: 1 };
export function reaccion(picos, c) {
  if (typeof picos === 'string') { try { picos = JSON.parse(picos); } catch { picos = []; } }
  if (!c || c.inicio == null) return 0;
  let s = 0;
  for (const p of picos || []) if (p.t >= c.inicio - 2 && p.t <= c.fin + 1) s += (Number(p.intensidad) || 1) * Math.max(...(p.tipos?.length ? p.tipos : [p.tipo]).map((t) => PESO[t] || 1));
  return +(s * 10 + (c.puntos || 0) / 10).toFixed(1);
}

// ---------- versiones horizontales ----------
export function pedir(videoId, n) {
  const v = videos.uno(videoId), c = v?.clips?.find((x) => x.n === Number(n));
  if (!c) throw new Error('Ese clip no existe');
  if (c.inicio == null || ['estudio', 'recop'].includes(v.tipo)) throw new Error('Este clip no sale de un vídeo o directo');
  db.prepare(`INSERT INTO recop_clips (video_id, n, reaccion) VALUES (?,?,?)
    ON CONFLICT(video_id, n) DO UPDATE SET estado = CASE WHEN estado IN ('error','descartado') THEN 'pendiente' ELSE estado END, error = NULL, descartado = NULL`).run(v.id, c.n, reaccion(v.picos, c));
  return db.prepare('SELECT * FROM recop_clips WHERE video_id = ? AND n = ?').get(v.id, c.n);
}

async function hacerHorizontal(r) {
  const v = videos.uno(r.video_id), c = v?.clips?.find((x) => x.n === r.n);
  if (!c || c.inicio == null) throw new Error('El clip ya no existe o no tiene tiempos de la fuente');
  mkdirSync(path.join(DIR, 'clips'), { recursive: true });
  const salida = path.join(DIR, 'clips', `${r.video_id}-${r.n}.mp4`);
  let ini = Math.max(0, c.inicio - 0.5);
  const dur = +(c.fin - ini + 0.5).toFixed(2);
  let fuente = v.fuente, tmp = null;
  if (!existsSync(fuente)) {
    // Vídeo de una plataforma: solo se baja el tramo del clip.
    if (!/^https?:\/\//.test(fuente)) throw new Error('La grabación original ya no está en el servidor');
    tmp = path.join(DIR, 'clips', `tmp-${r.id}.mp4`);
    await correr('yt-dlp', ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--download-sections', `*${ini}-${ini + dur}`, '--force-keyframes-at-cuts', '--merge-output-format', 'mp4', '--no-part', '-o', tmp, fuente], { timeout: 1800000 });
    fuente = tmp; ini = 0;
  }
  try {
    await ffmpeg(['-ss', String(ini), '-t', String(dur), '-i', fuente,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
      '-af', `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, dur - 0.3).toFixed(2)}:d=0.3`, ...CODIF, salida], 1800000);
  } finally { if (tmp) rmSync(tmp, { force: true }); }
  const real = await duracion(salida);
  db.prepare("UPDATE recop_clips SET estado='listo', archivo=?, dur=?, reaccion=?, error=NULL WHERE id=?").run(salida, +real.toFixed(2), reaccion(v.picos, c), r.id);
}

// Canales marcados «horizontal»: sus clips de los últimos 7 días se piden solos.
let ultimoAuto = 0;
function pedirAutomaticos() {
  if (Date.now() - ultimoAuto < 5 * 60000) return;
  ultimoAuto = Date.now();
  const filas = db.prepare(`SELECT v.id, v.clips, v.picos, v.tipo FROM clip_videos v JOIN clip_canales c ON c.id = v.canal_id
    WHERE c.horizontal = 1 AND v.estado = 'listo' AND COALESCE(v.terminado, v.creado) > datetime('now', '-7 days')`).all();
  const ins = db.prepare('INSERT OR IGNORE INTO recop_clips (video_id, n, reaccion) VALUES (?,?,?)');
  for (const v of filas) for (const c of JSON.parse(v.clips || '[]')) if (c.inicio != null && c.final) ins.run(v.id, c.n, reaccion(v.picos, c));
}

export function aprobar(id, si) {
  const r = db.prepare('SELECT * FROM recop_clips WHERE id = ?').get(Number(id));
  if (!r || r.estado !== 'listo') throw new Error('La versión horizontal aún no está lista');
  if (!si && r.recop_id) {
    const rc = db.prepare('SELECT estado FROM recopilatorios WHERE id = ?').get(r.recop_id);
    if (rc && rc.estado !== 'borrador') throw new Error('Está en un recopilatorio ya montado: edítalo antes');
    if (rc) quitarDeItems(r.recop_id, r.id);
  }
  db.prepare('UPDATE recop_clips SET aprobado = ?, recop_id = CASE WHEN ? THEN recop_id ELSE NULL END WHERE id = ?').run(si ? 1 : 0, si ? 1 : 0, r.id);
}
function quitarDeItems(recopId, rcId) {
  const rc = db.prepare('SELECT items FROM recopilatorios WHERE id = ?').get(recopId);
  if (rc) db.prepare('UPDATE recopilatorios SET items = ? WHERE id = ?').run(JSON.stringify(JSON.parse(rc.items).filter((x) => x.id !== rcId)), recopId);
}
export function reintentar(id) { db.prepare("UPDATE recop_clips SET estado='pendiente', error=NULL WHERE id=? AND estado='error'").run(Number(id)); }

// ---------- datos para el panel ----------
function info(r) {
  const v = videos.uno(r.video_id), c = v?.clips?.find((x) => x.n === r.n) || {};
  const canal = v?.canal_id ? db.prepare('SELECT nombre, url FROM clip_canales WHERE id = ?').get(v.canal_id) : null;
  return { ...r, titulo: c.titulo || '', gancho: c.gancho || '', canal: canal?.nombre || '', canalUrl: c.canalUrl || canal?.url || '', original: c.original || '', video: v?.titulo || '', pico: c.pico?.t != null ? +(c.pico.t - c.inicio + 0.5).toFixed(1) : null };
}
const parseRecop = (x) => x && { ...x, items: JSON.parse(x.items || '[]') };
export function estado() {
  return {
    clips: db.prepare('SELECT * FROM recop_clips ORDER BY id DESC LIMIT 600').all().map(info),
    recops: db.prepare('SELECT * FROM recopilatorios ORDER BY id DESC LIMIT 30').all().map(parseRecop),
    dur: DUR, objetivo: OBJETIVO,
  };
}
export const porClip = () => Object.fromEntries(db.prepare('SELECT r.id, r.video_id, r.n, r.estado, r.aprobado, r.recop_id, r.dur, r.reaccion, r.error, p.numero FROM recop_clips r LEFT JOIN recopilatorios p ON p.id = r.recop_id').all()
  .map((r) => [`${r.video_id}-${r.n}`, r]));
export const archivoClip = (id) => db.prepare("SELECT archivo FROM recop_clips WHERE id = ? AND estado = 'listo'").get(Number(id))?.archivo || null;
export const archivoRecop = (id) => db.prepare("SELECT archivo FROM recopilatorios WHERE id = ? AND archivo IS NOT NULL").get(Number(id))?.archivo || null;

// ---------- recopilatorios ----------
// Orden propuesto: el segundo más fuerte abre (retiene desde el primer segundo), el más fuerte cierra, y en medio
// de más a menos sin repetir creador seguido.
function ordenar(pool) {
  const p = [...pool].sort((a, b) => (b.reaccion || 0) - (a.reaccion || 0));
  if (p.length < 3) return p;
  const resto = p.slice(2), out = [p[1]];
  while (resto.length) {
    const prev = out[out.length - 1].canal;
    const i = resto.findIndex((x) => x.canal !== prev);
    out.push(resto.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return [...out, p[0]];
}
// ids: los clips elegidos por el banco (banco.mjs); sin ids, toda la bolsa aprobada (botón del panel).
export function crear(ids = null) {
  let pool = db.prepare("SELECT * FROM recop_clips WHERE aprobado = 1 AND recop_id IS NULL AND estado = 'listo'").all();
  if (ids) { const s = new Set(ids.map(Number)); pool = pool.filter((r) => s.has(r.id)); }
  pool = pool.map(info);
  if (!pool.length) throw new Error('No hay clips aprobados para recopilatorio');
  const numero = (db.prepare('SELECT MAX(numero) AS n FROM recopilatorios').get().n || 0) + 1;
  const items = ordenar(pool).map((r) => ({ id: r.id, ini: 0, fin: r.dur, texto: '' }));
  const id = Number(db.prepare('INSERT INTO recopilatorios (numero, titulo, items) VALUES (?,?,?)').run(numero, TITULO.replace('{n}', numero), JSON.stringify(items)).lastInsertRowid);
  const marcar = db.prepare('UPDATE recop_clips SET recop_id = ? WHERE id = ?');
  for (const it of items) marcar.run(id, it.id);
  return id;
}
export function guardar(id, { titulo, items }) {
  const rc = parseRecop(db.prepare('SELECT * FROM recopilatorios WHERE id = ?').get(Number(id)));
  if (!rc) throw new Error('No existe');
  if (!['borrador', 'listo', 'error'].includes(rc.estado)) throw new Error('Se está montando: espera a que termine');
  const limpios = [];
  for (const it of items || []) {
    const r = db.prepare("SELECT * FROM recop_clips WHERE id = ? AND estado = 'listo' AND aprobado = 1").get(Number(it.id));
    if (!r || (r.recop_id && r.recop_id !== rc.id) || limpios.some((x) => x.id === r.id)) continue;
    const ini = Math.max(0, Math.min(Number(it.ini) || 0, r.dur - 1)), fin = Math.max(ini + 1, Math.min(Number(it.fin) || r.dur, r.dur));
    limpios.push({ id: r.id, ini: +ini.toFixed(2), fin: +fin.toFixed(2), texto: String(it.texto || '').trim().slice(0, 90) });
  }
  db.prepare('UPDATE recop_clips SET recop_id = NULL WHERE recop_id = ?').run(rc.id);
  const marcar = db.prepare('UPDATE recop_clips SET recop_id = ? WHERE id = ?');
  for (const it of limpios) marcar.run(rc.id, it.id);
  db.prepare("UPDATE recopilatorios SET titulo = ?, items = ?, estado = 'borrador', error = NULL WHERE id = ?").run(String(titulo || rc.titulo).trim().slice(0, 100), JSON.stringify(limpios), rc.id);
}
export function encolar(id) {
  const rc = parseRecop(db.prepare('SELECT * FROM recopilatorios WHERE id = ?').get(Number(id)));
  if (!rc) throw new Error('No existe');
  if (rc.items.length < 3) throw new Error('Hacen falta al menos 3 clips');
  db.prepare("UPDATE recopilatorios SET estado = 'cola', paso = 'En cola', error = NULL WHERE id = ? AND estado IN ('borrador','listo','error')").run(rc.id);
}
export function editar(id) { db.prepare("UPDATE recopilatorios SET estado = 'borrador', paso = NULL WHERE id = ? AND estado IN ('listo','error')").run(Number(id)); }
export function borrar(id) {
  const rc = db.prepare('SELECT estado FROM recopilatorios WHERE id = ?').get(Number(id));
  if (!rc) return;
  if (['cola', 'montando'].includes(rc.estado)) throw new Error('Se está montando: espera a que termine');
  db.prepare('UPDATE recop_clips SET recop_id = NULL WHERE recop_id = ?').run(Number(id));
  db.prepare('DELETE FROM recopilatorios WHERE id = ?').run(Number(id));
}

// ---------- fotos de los canales ----------
const slug = (s) => String(s).toLowerCase().replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/[^a-z0-9@_-]+/g, '-').slice(0, 60);
async function avatar(url) {
  mkdirSync(path.join(DIR, 'avatares'), { recursive: true });
  const base = path.join(DIR, 'avatares', slug(url)), img = `${base}.jpg`, meta = `${base}.json`;
  if (existsSync(img) && existsSync(meta) && Date.now() - statSync(meta).mtimeMs < 30 * 86400000) return { img, ...JSON.parse(readFileSync(meta, 'utf8')) };
  const raiz = String(url).replace(/\/(videos|streams|featured|shorts)\/?$/, '');
  const j = JSON.parse(await correr('yt-dlp', ['--flat-playlist', '--playlist-items', '0', '-J', raiz], { timeout: 120000 }));
  const t = (j.thumbnails || []).find((x) => /avatar/.test(x.id || '')) || (j.thumbnails || []).slice(-1)[0];
  if (t?.url) { const r = await fetch(t.url); if (r.ok) writeFileSync(img, Buffer.from(await r.arrayBuffer())); }
  const datos = { nombre: j.channel || j.uploader || j.title || '', url: raiz, handle: (raiz.match(/@[\w.-]+/) || [''])[0] };
  writeFileSync(meta, JSON.stringify(datos));
  return { img: existsSync(img) ? img : null, ...datos };
}

// ---------- montaje ----------
// Composición HyperFrames con todos los gráficos seguidos: cartela de título, un separador por clip y la pantalla final.
function composicion(rc, clips, creadores) {
  const seps = [];
  let t = DUR.intro;
  clips.forEach((c, i) => { const d = DUR.sep; seps.push({ ...c, k: i + 1, t, d }); t += d; });
  const tOutro = t, total = +(t + DUR.outro).toFixed(2);
  const [arriba, abajo] = rc.titulo.split('|').map((s) => s.trim());
  const foto = creadores.length <= 4 ? 260 : creadores.length <= 8 ? 200 : 150; // pocos creadores: fotos más grandes
  const html = `<!doctype html>
<html lang="es"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
  :root { --noche: #0b0a14; --tinta: #fff6ea; --rosa: #ff3d7f; --cian: #29e0e6; --sol: #ffb02e; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--noche); font-family: "Outfit", sans-serif; color: var(--tinta); }
  .esc { position: absolute; inset: 0; overflow: hidden; background: var(--noche); }
  .rayas { position: absolute; inset: -200px; background: repeating-linear-gradient(-28deg, rgba(255,61,127,.10) 0 46px, transparent 46px 120px); }
  #in-t1 { position: absolute; left: 0; right: 0; top: 330px; text-align: center; font-size: 150px; font-weight: 900; line-height: .95; letter-spacing: -.02em; text-transform: uppercase; }
  #in-t2 { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font-size: 70px; font-weight: 800; color: var(--sol); }
  #in-bar { position: absolute; left: 560px; width: 800px; top: 610px; height: 10px; background: var(--rosa); transform-origin: 0 50%; }
  .sep { background: var(--rosa); }
  .sep .rayas { background: repeating-linear-gradient(-28deg, rgba(255,255,255,.14) 0 46px, transparent 46px 120px); }
  .num { position: absolute; left: 0; right: 0; top: 230px; text-align: center; font-size: 560px; font-weight: 900; line-height: 1; color: var(--tinta); }
  .quien { position: absolute; left: 760px; top: 360px; display: flex; align-items: center; gap: 40px; }
  .quien img { width: 220px; height: 220px; border-radius: 50%; object-fit: cover; border: 8px solid var(--cian); }
  .quien b { display: block; font-size: 96px; font-weight: 900; line-height: 1; }
  .quien span { display: block; margin-top: 14px; font-size: 40px; color: var(--cian); font-family: "Space Mono", monospace; }
  .texto { position: absolute; left: 760px; right: 120px; top: 640px; font-size: 58px; font-weight: 800; line-height: 1.1; color: var(--sol); }
  #out-t { position: absolute; left: 0; right: 0; top: 70px; text-align: center; font-size: 78px; font-weight: 900; }
  #out-s { position: absolute; left: 0; right: 0; bottom: 70px; text-align: center; font-size: 36px; color: var(--cian); font-family: "Space Mono", monospace; }
  #rejilla { position: absolute; left: 120px; right: 120px; top: 200px; bottom: 160px; display: flex; flex-wrap: wrap; justify-content: center; align-content: center; gap: 36px 40px; }
  .cr { display: flex; flex-direction: column; align-items: center; gap: 14px; width: ${foto + 80}px; text-align: center; }
  .cr img, .cr .ini { width: ${foto}px; height: ${foto}px; border-radius: 50%; object-fit: cover; border: 6px solid var(--rosa); background: #241f3d; }
  .cr .ini { display: flex; align-items: center; justify-content: center; font-size: 80px; font-weight: 900; }
  .cr b { font-size: 34px; font-weight: 800; line-height: 1.05; }
  .cr span { font-size: 22px; color: var(--cian); font-family: "Space Mono", monospace; }
</style></head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
  <div id="intro" class="esc clip" data-start="0" data-duration="${DUR.intro}" data-track-index="1">
    <div class="rayas" id="in-rayas"></div><div id="in-t1">${esc(arriba)}</div><div id="in-bar"></div><div id="in-t2">${esc(abajo || '')}</div>
  </div>
${seps.map((s) => `  <div id="sep${s.k}" class="esc sep clip" data-start="${s.t.toFixed(2)}" data-duration="${s.d}" data-track-index="1">
    <div class="rayas" id="sep${s.k}-r"></div><div class="num" id="sep${s.k}-n">${s.k}</div>
  </div>
  <audio id="sfx-sep${s.k}" class="clip" src="assets/barrido.wav" data-start="${s.t.toFixed(2)}" data-duration="${DUR.sep}" data-track-index="5"></audio>`).join('\n')}
  <div id="outro" class="esc clip" data-start="${tOutro.toFixed(2)}" data-duration="${DUR.outro}" data-track-index="1">
    <div class="rayas"></div><div id="out-t">Gracias a estos creadores</div>
    <div id="rejilla">${creadores.map((c, i) => `<div class="cr" id="cr${i}">${c.foto ? `<img src="${c.foto}" alt="">` : `<div class="ini">${esc((c.nombre || '?')[0])}</div>`}<b>${esc(c.nombre)}</b><span>${esc(c.handle || '')}</span></div>`).join('')}</div>
    <div id="out-s">Todo el contenido pertenece a sus creadores · apóyalos en sus canales</div>
  </div>
  <audio id="sfx-in" class="clip" src="assets/golpe.wav" data-start="0.25" data-duration="1" data-track-index="5"></audio>
  ${creadores.map((c, i) => `<audio id="sfx-cr${i}" class="clip" src="assets/pop.wav" data-start="${(tOutro + 0.9 + i * 0.22).toFixed(2)}" data-duration="0.6" data-track-index="${6 + (i % 3)}"></audio>`).join('\n  ')}
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#in-rayas", { x: -120 }, { x: 0, duration: ${DUR.intro}, ease: "none" }, 0);
  tl.fromTo("#in-t1", { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.3, ease: "expo.out" }, 0.05);
  tl.fromTo("#in-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, 0.25);
  tl.fromTo("#in-t2", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.25, ease: "expo.out" }, 0.35);
${seps.map((s) => `  tl.fromTo("#sep${s.k}-n", { scale: 1.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.18, ease: "expo.out" }, ${s.t.toFixed(2)});
  tl.fromTo("#sep${s.k}-r", { x: -160 }, { x: 0, duration: ${DUR.sep}, ease: "none" }, ${s.t.toFixed(2)});`).join('\n')}
  tl.fromTo("#out-t", { opacity: 0, y: -40 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, ${(tOutro + 0.2).toFixed(2)});
  tl.fromTo(".cr", { opacity: 0, scale: 0.4, rotation: -8 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.45, ease: "back.out(2)", stagger: 0.22 }, ${(tOutro + 0.9).toFixed(2)});
  tl.fromTo("#out-s", { opacity: 0 }, { opacity: 1, duration: 0.5 }, ${(tOutro + 2).toFixed(2)});
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
</script>
</body></html>`;
  return { html, seps, tOutro, total };
}

async function segmento(src, ss, t, salida) {
  // Trozo de los gráficos con audio garantizado (silencio si no hay), con los mismos parámetros que el resto.
  const audio = await tieneAudio(src);
  await ffmpeg(['-ss', String(ss), '-t', String(t), '-i', src, '-f', 'lavfi', '-t', String(t), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', audio ? '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[a]' : '[1:a]anull[a]', '-map', '0:v', '-map', '[a]', ...CODIF, salida]);
}

async function montar(rc) {
  const paso = (p) => db.prepare('UPDATE recopilatorios SET paso = ? WHERE id = ?').run(p, rc.id);
  const trabajo = path.join(DIR, String(rc.id));
  rmSync(path.join(trabajo, 'partes'), { recursive: true, force: true });
  mkdirSync(path.join(trabajo, 'partes'), { recursive: true });
  const clips = rc.items.map((it) => ({ ...it, r: info(db.prepare('SELECT * FROM recop_clips WHERE id = ?').get(it.id)) })).filter((x) => x.r?.archivo && existsSync(x.r.archivo));
  if (clips.length < 3) throw new Error('Faltan clips (¿se borraron sus archivos?)');

  paso('Fotos de los canales');
  const proj = path.join(HF, `recop-${rc.id}`);
  rmSync(proj, { recursive: true, force: true });
  mkdirSync(path.join(proj, 'assets'), { recursive: true });
  for (const f of ['barrido.wav', 'golpe.wav', 'pop.wav']) copyFileSync(path.join(SFX, f), path.join(proj, 'assets', f));
  const creadores = [], porUrl = new Map();
  for (const c of clips) {
    const url = c.r.canalUrl;
    if (!url || porUrl.has(url)) continue;
    let a = { nombre: c.r.canal, handle: (url.match(/@[\w.-]+/) || [''])[0], url, img: null };
    try { a = { ...a, ...(await avatar(url)) }; } catch (e) { console.error('Recopilatorio: foto de', url, e.message); }
    const i = creadores.length;
    if (a.img) copyFileSync(a.img, path.join(proj, 'assets', `av${i}.jpg`));
    const cr = { nombre: a.nombre || c.r.canal, handle: a.handle, url: a.url || url, foto: a.img ? `assets/av${i}.jpg` : null };
    creadores.push(cr); porUrl.set(url, cr);
  }
  for (const c of clips) { const cr = porUrl.get(c.r.canalUrl); c.canal = cr?.nombre || c.r.canal; c.handle = cr?.handle || ''; c.foto = cr?.foto || null; }

  paso('Gráficos (HyperFrames)');
  const comp = composicion(rc, clips, creadores);
  writeFileSync(path.join(proj, 'index.html'), comp.html);
  for (const f of ['hyperframes.json', 'package.json']) if (existsSync(path.join(HF, 'plantilla', f))) copyFileSync(path.join(HF, 'plantilla', f), path.join(proj, f));
  const graficos = path.join(trabajo, 'partes', 'graficos.mp4');
  await correr('npx', ['hyperframes', 'render', '--output', graficos], { timeout: 1800000, cwd: proj, env: { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_RENDER_DETACHED: '1' } }).catch((e) => { throw new Error(`HyperFrames: ${e.message}`); });

  paso('Avance, separadores y clips');
  const fuente = await fuenteFfmpeg();
  const lista = [];
  // Avance: los 3 momentos de reacción más fuerte, 1,8 s cada uno, con su gancho en grande.
  const top = [...clips].sort((a, b) => (b.r.reaccion || 0) - (a.r.reaccion || 0)).slice(0, 3);
  for (const [i, c] of top.entries()) {
    const centro = c.r.pico ?? (c.ini + c.fin) / 2;
    const ss = Math.max(c.ini, Math.min(centro - 0.6, c.fin - DUR.teaser));
    const txt = path.join(trabajo, 'partes', `gancho${i}.txt`);
    const larga = String(c.texto || c.r.gancho || c.r.titulo).toUpperCase().trim();
    const frase = larga.length <= 44 ? larga : `${larga.slice(0, 44).replace(/\s+\S*$/, '')}…`; // sin cortar palabras
    writeFileSync(txt, frase);
    const tam = Math.max(48, Math.min(92, Math.floor(1720 / (frase.length * 0.64)))); // que quepa en una línea
    const out = path.join(trabajo, 'partes', `a${i}.mp4`);
    await ffmpeg(['-ss', String(ss), '-t', String(DUR.teaser), '-i', c.r.archivo, '-vf',
      `drawtext=fontfile=${fuente}:textfile=${txt}:fontsize=${tam}:fontcolor=white:borderw=7:bordercolor=black:x=(w-tw)/2:y=h*0.74`, ...CODIF, out]);
    lista.push(out);
  }
  const cIntro = path.join(trabajo, 'partes', 'intro.mp4');
  await segmento(graficos, 0, DUR.intro, cIntro); lista.push(cIntro);
  for (const [i, c] of clips.entries()) {
    const s = comp.seps[i];
    const sep = path.join(trabajo, 'partes', `s${i}.mp4`);
    await segmento(graficos, s.t, s.d, sep); lista.push(sep);
    // Clip con el nombre del creador abajo a la izquierda durante los primeros 4 s, y el texto del editor arriba los primeros 3 s.
    const nom = path.join(trabajo, 'partes', `n${i}.txt`);
    writeFileSync(nom, `${c.canal}${c.handle ? `  ${c.handle}` : ''}`);
    let arriba = '';
    if (c.texto) {
      const tx = path.join(trabajo, 'partes', `t${i}.txt`);
      writeFileSync(tx, c.texto.toUpperCase());
      const tam = Math.max(44, Math.min(76, Math.floor(1700 / (c.texto.length * 0.62))));
      arriba = `,drawtext=fontfile=${fuente}:textfile=${tx}:fontsize=${tam}:fontcolor=white:borderw=6:bordercolor=black:x=(w-tw)/2:y=70:enable='between(t,0,3)'`;
    }
    const d = +(c.fin - c.ini).toFixed(2);
    const alfa = "if(lt(t,0.6),(t-0.3)/0.3,if(lt(t,4),1,(4.3-t)/0.3))";
    const out = path.join(trabajo, 'partes', `c${i}.mp4`);
    await ffmpeg(['-ss', String(c.ini), '-t', String(d), '-i', c.r.archivo, '-vf',
      `drawbox=x=60:y=ih-170:w=iw*0.42:h=96:color=black@0.62:t=fill:enable='between(t,0.3,4.3)',drawtext=fontfile=${fuente}:textfile=${nom}:fontsize=46:fontcolor=white:x=90:y=h-148:alpha='${alfa}':enable='between(t,0.3,4.3)'${arriba}`,
      '-af', `afade=t=in:d=0.12,afade=t=out:st=${Math.max(0, d - 0.25).toFixed(2)}:d=0.25`, ...CODIF, out], 1800000);
    lista.push(out);
    c.durFinal = d; c.dur = s.d;
  }
  const cOutro = path.join(trabajo, 'partes', 'outro.mp4');
  await segmento(graficos, comp.tOutro, DUR.outro, cOutro); lista.push(cOutro);

  paso('Uniendo');
  const listaTxt = path.join(trabajo, 'partes', 'lista.txt');
  writeFileSync(listaTxt, lista.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const final = path.join(trabajo, `recopilatorio-${rc.numero}.mp4`);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listaTxt, '-c', 'copy', '-movflags', '+faststart', final], 1800000);
  const total = await duracion(final);

  // Capítulos y créditos: cada clip empieza tras el avance, la cartela y su separador.
  let t = DUR.teaser * top.length + DUR.intro;
  const capitulos = ['0:00 Intro'];
  for (const c of clips) { t += c.dur; capitulos.push(`${mmss(t)} ${c.canal} — ${c.r.titulo || 'momento'}`); t += c.durFinal; }
  capitulos.push(`${mmss(t)} Los creadores`);
  const desc = [rc.titulo, '',
    'Las reacciones más exageradas de los streamers: sustos, gritos, fallos y momentos que nadie esperaba. ¿Cuál es tu favorito? Te leo en los comentarios.', '',
    'CAPÍTULOS', ...capitulos, '',
    'CRÉDITOS — Todo el contenido de este vídeo pertenece a sus creadores. Síguelos y apóyalos en sus canales:',
    ...creadores.map((c) => `• ${c.nombre}${c.handle ? ` (${c.handle})` : ''}: ${c.url}`), '',
    'Momentos originales:', ...clips.filter((c) => c.r.original).map((c) => `• ${c.canal}: ${c.r.original}`), '',
    'Si eres uno de los creadores y quieres que retiremos tu momento, escríbenos y lo quitamos.', '',
    '#streamers #mejoresmomentos'].join('\n').slice(0, 4900);
  db.prepare("UPDATE recopilatorios SET estado = 'listo', paso = NULL, error = NULL, archivo = ?, descripcion = ?, terminado = datetime('now') WHERE id = ?").run(final, desc, rc.id);
  registrarEnGaleria(rc.id, { final, total, desc, creadores });
  rmSync(path.join(trabajo, 'partes'), { recursive: true, force: true });
  avisarSinFallo('Recopilatorio listo', `«${rc.titulo}» (${mmss(total)}). Revísalo en la galería antes de publicarlo.`, { etiquetas: ['clapper'] });
}

// En la galería, como un vídeo largo más: se publica con el mismo botón que los clips.
function registrarEnGaleria(id, { final, total, desc, creadores }) {
  const rc = db.prepare('SELECT * FROM recopilatorios WHERE id = ?').get(id);
  const pieza = [{ n: 1, formato: 'horizontal', titulo: rc.titulo, final, inicio: 0, fin: +total.toFixed(2), puntos: null, gancho: '',
    youtube: { titulo: rc.titulo, descripcion: desc, etiquetas: ['mejores momentos', 'streamers', 'recopilatorio', ...creadores.map((c) => c.nombre)].slice(0, 25), sintetico: false, short: false } }];
  const fuente = `recop:${id}`;
  const previa = db.prepare('SELECT id FROM clip_videos WHERE fuente = ?').get(fuente);
  if (previa) db.prepare("UPDATE clip_videos SET titulo=?, clips=?, carpeta=?, estado='listo', terminado=datetime('now') WHERE id=?").run(rc.titulo, JSON.stringify(pieza), path.dirname(final), previa.id);
  else db.prepare("INSERT INTO clip_videos (fuente, titulo, tipo, estado, job, clips, carpeta, terminado) VALUES (?,?,'recop','listo',?,?,?,datetime('now'))")
    .run(fuente, rc.titulo, `recop-${id}`, JSON.stringify(pieza), path.dirname(final));
}

// ---------- ciclo (lo llama el planificador cada minuto) ----------
let ocupado = false;
export const enCurso = () => ocupado;
export async function cicloRecop() {
  if (ocupado || process.platform !== 'linux') return;
  ocupado = true;
  try {
    try { pedirAutomaticos(); } catch (e) { console.error('Recopilatorios:', e.message); }
    const r = db.prepare("SELECT * FROM recop_clips WHERE estado = 'pendiente' ORDER BY id LIMIT 1").get();
    if (r) {
      try { await hacerHorizontal(r); }
      catch (e) { db.prepare("UPDATE recop_clips SET estado='error', error=? WHERE id=?").run(e.message.slice(0, 400), r.id); console.error('Recopilatorios: horizontal', r.id, e.message); }
      return; // de uno en uno: el resto en la siguiente vuelta
    }
    const rc = parseRecop(db.prepare("SELECT * FROM recopilatorios WHERE estado = 'cola' ORDER BY id LIMIT 1").get());
    if (rc) {
      db.prepare("UPDATE recopilatorios SET estado = 'montando' WHERE id = ?").run(rc.id);
      try { await montar(rc); }
      catch (e) {
        db.prepare("UPDATE recopilatorios SET estado = 'error', error = ?, paso = NULL WHERE id = ?").run(e.message.slice(0, 500), rc.id);
        avisarSinFallo('Recopilatorio: falló el montaje', `«${rc.titulo}»: ${e.message.slice(0, 200)}`, { prioridad: 4, etiquetas: ['warning'] });
      }
    }
  } finally { ocupado = false; }
}
// Al arrancar: lo que se quedó a medias por un reinicio vuelve a la cola.
db.prepare("UPDATE recopilatorios SET estado = 'cola' WHERE estado = 'montando'").run();
