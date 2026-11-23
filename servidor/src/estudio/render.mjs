// Motor de producción del Estudio: voz por escena, render fotograma a fotograma de las plantillas (escena.html) con
// el navegador del servidor, montaje con ffmpeg, subtítulos (.srt), capítulos y miniatura.
// Todo es determinista: el mismo proyecto da el mismo vídeo. Sin GPU (la voz natural de la laptop es opcional).
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLA = pathToFileURL(path.join(AQUI, 'escena.html')).href;
const ESTUDIO = path.join(os.homedir(), 'apps', 'estudio');
export const VOZ_SERVIDOR = { modelo: path.join(ESTUDIO, 'voces', 'es_MX-claude-high.onnx'), velocidad: 1.05 };
export const FPS = 30;
const PAUSA = 0.45; // silencio al final de cada escena (respiración entre ideas)

const run = (cmd, args, opts = {}) => new Promise((ok, mal) => execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-500))) : ok(String(so)))));
const duracion = async (f) => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).trim()) || 0;

// ---------- voz ----------
// Texto para la voz: sin marcas de énfasis y con siglas y símbolos legibles.
const paraVoz = (t) => String(t).replace(/\*/g, '').replace(/%/g, ' por ciento').replace(/\$\s?([\d.,]+)/g, '$1 dólares').replace(/\s+/g, ' ').trim();
export async function vozServidor(texto, wav) {
  await new Promise((ok, mal) => {
    const p = spawn(path.join(ESTUDIO, 'piper', 'piper'), ['--model', VOZ_SERVIDOR.modelo, '--length_scale', String(VOZ_SERVIDOR.velocidad), '--sentence_silence', '0.28', '--output_file', wav], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    p.on('exit', (c) => (c === 0 ? ok() : mal(new Error(`piper: ${err}`)))); p.stdin.end(paraVoz(texto));
  });
}

// Voz natural generada en la laptop (GPU): se sube a voz-cache/<voz>/<sha1 del texto>.wav y aquí se usa si existe;
// si falta alguna frase, esa escena sale con la voz del servidor.
export const VOZ_CACHE = path.join(ESTUDIO, 'voz-cache');
export const IMG_CACHE = path.join(ESTUDIO, 'img-cache');
const IMG_BASE = pathToFileURL(IMG_CACHE).href;
export function imagenesQueFaltan(proyecto, { soloPrimera = false } = {}) { return proyecto.escenas.flatMap((e) => (e.visual?.tipo === 'pintada' ? (e.visual.planos || []).filter((p, i) => !soloPrimera || i === 0).filter((p) => !p.clave || !existsSync(path.join(IMG_CACHE, p.clave, 'frente.png'))).map((p, i) => `${e.id}#${i}`) : [])); }
export const claveVoz = (texto) => createHash('sha1').update(String(texto).replace(/\*/g, '').replace(/\s+/g, ' ').trim()).digest('hex');
export function vozDe(proyecto) {
  if (!proyecto.voz) return vozServidor;
  return async (texto, wav) => { const f = path.join(VOZ_CACHE, proyecto.voz, `${claveVoz(texto)}.wav`); if (existsSync(f)) copyFileSync(f, wav); else await vozServidor(texto, wav); };
}
export function vocesQueFaltan(proyecto) { return proyecto.voz ? proyecto.escenas.filter((e) => !existsSync(path.join(VOZ_CACHE, proyecto.voz, `${claveVoz(e.narracion)}.wav`))).map((e) => e.id) : []; }

// Efectos de sonido sintetizados (sin licencias): barrido, golpe y pop.
const SFX = path.join(ESTUDIO, 'sfx');
async function asegurarSfx() {
  mkdirSync(SFX, { recursive: true });
  const def = { barrido: ['-f', 'lavfi', '-i', 'anoisesrc=d=0.5:c=pink:a=0.8', '-af', 'highpass=f=500,lowpass=f=5000,afade=t=in:d=0.22:curve=exp,afade=t=out:st=0.24:d=0.26,volume=0.9'],
    golpe: ['-f', 'lavfi', '-i', 'aevalsrc=0.9*sin(2*PI*(110-70*t)*t)*exp(-7*t)+0.25*(random(0)-0.5)*exp(-30*t):d=0.6:s=48000'],
    pop: ['-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*(500+1400*t)*t)*exp(-22*t):d=0.18:s=48000'] };
  for (const [n, a] of Object.entries(def)) { const f = path.join(SFX, `${n}.wav`); if (!existsSync(f)) await run('ffmpeg', ['-v', 'error', '-y', ...a, '-ar', '48000', '-ac', '1', f]); }
}
async function mezclarSfx(video, eventos) {
  if (!eventos.length) return;
  await asegurarSfx();
  const tipos = ['barrido', 'golpe', 'pop'].filter((x) => eventos.some((e) => e.tipo === x));
  const partes = [], salidas = [];
  tipos.forEach((tp, i) => { const ev = eventos.filter((e) => e.tipo === tp), et = ev.map((_, j) => `[${tp}${j}]`);
    partes.push(`[${i + 1}:a]volume=${tp === 'barrido' ? 0.32 : tp === 'golpe' ? 0.45 : 0.3}${ev.length > 1 ? `,asplit=${ev.length}` : ''}${et.join('')}`);
    ev.forEach((e, j) => { const ms = Math.max(0, Math.round((e.t - (tp === 'barrido' ? 0.12 : 0)) * 1000)); partes.push(`[${tp}${j}]adelay=${ms}|${ms}[d${tp}${j}]`); salidas.push(`[d${tp}${j}]`); }); });
  partes.push(`[0:a]${salidas.join('')}amix=inputs=${salidas.length + 1}:normalize=0:duration=first[a]`);
  const tmp = video.replace(/\.mp4$/, '.sfx.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', video, ...tipos.flatMap((tp) => ['-i', path.join(SFX, `${tp}.wav`)]), '-filter_complex', partes.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp]);
  await run('mv', [tmp, video]);
}

// Audio de todas las escenas + tiempos. `voz(texto, wav)` permite usar otra voz (la de la laptop).
export async function audioProyecto(proyecto, dir, { voz = vozDe(proyecto), log = () => {} } = {}) {
  mkdirSync(path.join(dir, 'voz'), { recursive: true });
  const tiempos = []; let t = 0;
  for (const [i, e] of proyecto.escenas.entries()) {
    const wav = path.join(dir, 'voz', `${String(i + 1).padStart(2, '0')}-${e.id}.wav`);
    await voz(e.narracion, wav);
    const habla = await duracion(wav);
    const dur = Math.max(e.min_s || 3, habla + PAUSA);
    tiempos.push({ id: e.id, inicio: t, habla, duracion: dur, wav });
    t += dur;
    log(`voz ${e.id}: ${habla.toFixed(1)} s`);
  }
  // Pista completa: cada escena con su silencio de cola hasta su duración.
  const lista = path.join(dir, 'voz', 'lista.txt');
  const partes = [];
  for (const [i, x] of tiempos.entries()) {
    const rell = path.join(dir, 'voz', `rell-${i}.wav`);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', x.wav, '-af', `apad=whole_dur=${x.duracion.toFixed(3)}`, '-ar', '48000', '-ac', '1', rell]);
    partes.push(`file '${rell.replace(/'/g, "'\\''")}'`);
  }
  writeFileSync(lista, partes.join('\n'));
  const pista = path.join(dir, 'voz', 'pista.wav');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', pista]);
  return { tiempos, total: t, pista };
}

// ---------- navegador ----------
async function navegador(ancho, alto) {
  const { chromium } = await import('playwright-core');
  const opciones = { headless: true };
  if (process.platform === 'win32') opciones.channel = 'msedge';
  else { const exe = ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync); if (exe) opciones.executablePath = exe; }
  const b = await chromium.launch(opciones);
  const page = await b.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
  await page.goto(PLANTILLA);
  return { b, page };
}
const medidas = (vertical) => (vertical ? [1080, 1920] : [1920, 1080]);

// Fotograma fijo de una escena (para las propuestas y la miniatura).
export async function fotograma(proyecto, escena, png, { vertical = false, t = null, ancho, alto } = {}) {
  const [w, h] = ancho ? [ancho, alto] : medidas(vertical);
  const { b, page } = await navegador(w, h);
  try {
    const dur = escena.duracion_s || 6;
    await page.evaluate((cfg) => window.preparar(cfg), { escena, estilo: proyecto.estilo, marca: proyecto.marca, reparto: proyecto.reparto, duracion: dur, total: dur, vertical, imgBase: IMG_BASE });
    const tc = await page.evaluate(() => (window.tClave ? window.tClave() : null));
    await page.evaluate((x) => window.pintar(x), t ?? tc ?? Math.max(0.5, dur - 0.6));
    await page.screenshot({ path: png, type: 'png' });
  } finally { await b.close(); }
}

// Vídeo: escenas en orden, fotograma a fotograma, directo a ffmpeg (sin escribir imágenes en disco).
export async function video(proyecto, audio, salida, { vertical = false, ids = null, log = () => {} } = {}) {
  const [w, h] = medidas(vertical);
  const escenas = proyecto.escenas.filter((e) => !ids || ids.includes(e.id));
  const tiempos = escenas.map((e) => audio.tiempos.find((x) => x.id === e.id));
  const total = tiempos.reduce((a, x) => a + x.duracion, 0);
  // Audio del tramo: las mismas escenas, recortadas de la pista completa.
  let pista = audio.pista;
  if (ids) {
    pista = salida.replace(/\.mp4$/, '.wav');
    const filtro = tiempos.map((x, i) => `[0:a]atrim=${x.inicio.toFixed(3)}:${(x.inicio + x.duracion).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`).join(';') + `;${tiempos.map((_, i) => `[a${i}]`).join('')}concat=n=${tiempos.length}:v=0:a=1[s]`;
    await run('ffmpeg', ['-v', 'error', '-y', '-i', audio.pista, '-filter_complex', filtro, '-map', '[s]', pista]);
  }
  const ff = spawn('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', pista,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', salida], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errFf = ''; ff.stderr.on('data', (d) => { errFf = (errFf + d).slice(-600); });
  const fin = new Promise((ok, mal) => ff.on('exit', (c) => (c === 0 ? ok() : mal(new Error(`ffmpeg: ${errFf}`)))));
  const { b, page } = await navegador(w, h); const eventos = [];
  try {
    let acumulado = 0, hechos = 0;
    const totalFot = Math.round(total * FPS);
    for (const [i, e] of escenas.entries()) {
      const dur = tiempos[i].duracion;
      await page.evaluate((cfg) => window.preparar(cfg), { escena: e, estilo: proyecto.estilo, marca: proyecto.marca, reparto: proyecto.reparto, duracion: dur, total, inicioGlobal: acumulado, vertical, decoradoAnterior: escenas[i - 1]?.visual?.decorado ?? null, imgBase: IMG_BASE });
      for (const ev of await page.evaluate(() => (window.sonidos ? window.sonidos() : []))) eventos.push({ ...ev, t: acumulado + ev.t });
      const n = Math.round(dur * FPS);
      for (let f = 0; f < n; f++) {
        await page.evaluate((x) => window.pintar(x), f / FPS);
        const jpg = await page.screenshot({ type: 'jpeg', quality: 88 });
        if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
        if (++hechos % (FPS * 30) === 0) log(`render ${path.basename(salida)}: ${Math.round((hechos / totalFot) * 100)} %`);
      }
      acumulado += dur;
    }
  } finally { ff.stdin.end(); await b.close(); }
  await fin;
  if (ids) rmSync(pista, { force: true }); // la pista recortada del tramo ya está dentro del mp4
  await mezclarSfx(salida, eventos);
  return { salida, duracion: total };
}

// Short vertical a partir de un vídeo horizontal ya montado (proyectos HyperFrames): fondo de la paleta, franja con el
// título arriba, el vídeo a todo el ancho en el centro (sin recortar) y una tira de color abajo.
const FUENTE_TITULO = process.env.FUENTE_TITULO || path.join(path.dirname(process.env.OPENSHORTS_SALIDA || '/opt/openshorts/output'), 'fonts', 'Montserrat-ExtraBold.ttf');
export async function shortVertical(video, ini, dur, titulo, salida, { fondo = '0x0d0a1f', acento = '0xff3d8b' } = {}) {
  const txt = salida.replace(/\.mp4$/, '.titulo.txt');
  const palabras = String(titulo).toUpperCase().split(/\s+/), lineas = []; let cur = '';
  for (const w of palabras) { if ((cur + ' ' + w).trim().length > 18 && cur) { lineas.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lineas.push(cur);
  writeFileSync(txt, lineas.slice(0, 4).join('\n'));
  const esc = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const fc = `color=c=${fondo}:s=1080x1920:d=${dur.toFixed(2)}[bg];[0:v]scale=1080:608:flags=lanczos,setsar=1[v];[bg][v]overlay=0:620,`
    + `drawbox=x=90:y=1290:w=900:h=10:color=${acento}:t=fill,`
    + `drawtext=fontfile='${esc(FUENTE_TITULO)}':textfile='${esc(txt)}':fontsize=82:line_spacing=14:fontcolor=white:x=(w-text_w)/2:y=200[out]`;
  await run('nice', ['-n', '5', 'ffmpeg', '-v', 'error', '-y', '-ss', ini.toFixed(2), '-t', dur.toFixed(2), '-i', video, '-filter_complex', fc, '-map', '[out]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', salida], { timeout: 900000 });
  rmSync(txt, { force: true });
}
export const escalarImagen = (src, dest, w, h) => run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=${w}:${h}:flags=lanczos`, dest]);

// ---------- textos ----------
const hms = (s, sep = ',') => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4), x = Math.floor((ms % 6e4) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
// Subtítulos: cada frase de la narración repartida en el tiempo de habla de su escena según su longitud.
export function srt(proyecto, audio, { ids = null } = {}) {
  let n = 0, base = null; const out = [];
  for (const e of proyecto.escenas) {
    if (ids && !ids.includes(e.id)) continue;
    const x = audio.tiempos.find((y) => y.id === e.id);
    base ??= ids ? x.inicio : 0;
    const inicioEscena = ids ? out.length ? out.at(-1).finEscena : 0 : x.inicio;
    const frases = paraVoz(e.narracion).match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g)?.map((f) => f.trim()).filter(Boolean) || [];
    // Trozos de como mucho ~42 caracteres por línea, dos líneas por subtítulo.
    const trozos = frases.flatMap((f) => { const w = f.split(' '), r = []; let cur = ''; for (const p of w) { if ((cur + ' ' + p).trim().length > 80) { r.push(cur.trim()); cur = p; } else cur += ' ' + p; } if (cur.trim()) r.push(cur.trim()); return r; });
    const chars = trozos.reduce((a, s) => a + s.length, 0) || 1;
    let t = inicioEscena;
    for (const s of trozos) { const d = (s.length / chars) * x.habla; out.push({ n: ++n, a: t, b: t + d, texto: s, finEscena: inicioEscena + x.duracion }); t += d; }
    if (!trozos.length) out.push({ n: ++n, a: t, b: t, texto: '', finEscena: inicioEscena + x.duracion });
  }
  return out.filter((s) => s.texto).map((s) => `${s.n}\n${hms(s.a)} --> ${hms(s.b)}\n${s.texto}\n`).join('\n');
}
// Capítulos de YouTube a partir de las escenas que abren capítulo (el primero en 0:00).
export function capitulos(proyecto, audio) {
  const caps = proyecto.escenas.map((e) => ({ e, x: audio.tiempos.find((y) => y.id === e.id) })).filter(({ e }) => e.capitulo);
  if (caps.length && caps[0].x.inicio > 0) caps[0].x = { ...caps[0].x, inicio: 0 };
  return caps.map(({ e, x }) => `${hms(x.inicio, '').slice(3, 8).replace(/^0/, '')} ${e.capitulo}`);
}
