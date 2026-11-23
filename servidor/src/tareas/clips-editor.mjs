// Editor de clips: reencuadrar (contenido y cámara), alargar o acortar el inicio y el final, y cambiar o mover los textos.
// El clip se describe con una «receta» y se renderiza desde el vídeo fuente (la grabación local o el original que guarda
// OpenShorts), en vertical (1080×1920) y horizontal (1920×1080) a la vez. La vista previa la hace el navegador de quien
// edita (dibuja en un canvas la misma receta sobre un proxy ligero de la fuente); el servidor solo renderiza al guardar.
//
// Receta (tiempos en segundos de la FUENTE; recortes en fracciones 0–1 de la fuente; destinos en píxeles del lienzo):
// { inicio, fin, coldOpen: null | { inicio, fin },
//   v: { fondo: 'oscuro' | 'difuminado', linea: bool, capas: [{ id, src: {x,y,w,h}, dst: {x,y,w,h} }], textos: [...], subs: { activo, y, tam } },
//   h: { …igual, lienzo 1920×1080 } }
// texto: { id, texto, x, y (centro), tam, color, caja (null | color), cuando: 'siempre' | 'inicio' | 'final', seg }
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, statSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { db, DATOS, ajustes } from '../db.mjs';
import { detectarWebcam, ponerLogoYRevisar } from './clips-post.mjs';
import { perfil as perfilCampana } from './campanas.mjs';
import { emocionClip } from './clips-emocion.mjs';
import { aprenderEncuadre, webcamAprendida, layoutAprendido } from './automatizaciones.mjs';

const LIENZO = { v: { W: 1080, H: 1920 }, h: { W: 1920, H: 1080 } };
const BANDA = 280;
const CODIF = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
const FUENTE_TXT = () => path.join(path.dirname(ajustes()['clips.salida']), 'fonts', 'Montserrat-ExtraBold.ttf');
const DIR_EDITOR = () => { const d = path.join(DATOS, 'editor'); mkdirSync(d, { recursive: true }); return d; };

const ejecutar = (bin, args, timeout = 900000) => new Promise((ok, mal) => {
  execFile('nice', ['-n', '5', bin, ...args], { timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => (err ? mal(new Error(String(stderr || err.message).slice(-500))) : ok(String(stdout))));
});
const medir = async (f) => {
  try {
    const j = JSON.parse(await ejecutar('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', f], 60000));
    return { w: j.streams?.[0]?.width || 0, h: j.streams?.[0]?.height || 0, dur: Number(j.format?.duration) || 0 };
  } catch { return { w: 0, h: 0, dur: 0 }; }
};

// ---------- datos del clip ----------
const fila = (id) => db.prepare('SELECT * FROM clip_videos WHERE id = ?').get(Number(id));
function leer(id, n) {
  const v = fila(id); if (!v) throw new Error('Ese vídeo no existe');
  const clips = JSON.parse(v.clips || '[]');
  const c = clips.find((x) => x.n === Number(n)); if (!c) throw new Error('Ese clip no existe');
  return { v, clips, c };
}
// Guarda cambios en un clip sin pisar los demás (relee la fila justo antes).
function guardarClip(id, n, cambios) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { clips } = leer(id, n);
    const i = clips.findIndex((x) => x.n === Number(n));
    clips[i] = { ...clips[i], ...cambios };
    db.prepare('UPDATE clip_videos SET clips = ? WHERE id = ?').run(JSON.stringify(clips), Number(id));
    db.exec('COMMIT');
    return clips[i];
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Vídeo fuente: la grabación local (directos, tramos, archivos) o el original que descargó OpenShorts.
export function fuenteDe(v) {
  if (v.fuente && !/^https?:\/\//.test(v.fuente) && existsSync(v.fuente) && !v.fuente.endsWith('.ts')) return v.fuente;
  if (!v.job || !/^[\w-]+$/.test(v.job)) return null;
  try {
    const d = path.join(ajustes()['clips.salida'], v.job);
    const m = JSON.parse(readFileSync(path.join(d, readdirSync(d).find((f) => f.endsWith('_metadata.json'))), 'utf8'));
    const f = m.source_video && path.join(d, path.basename(m.source_video));
    return f && existsSync(f) ? f : null;
  } catch { return null; }
}
function transcripcion(v) {
  try {
    const d = path.join(ajustes()['clips.salida'], v.job);
    return JSON.parse(readFileSync(path.join(d, readdirSync(d).find((f) => f.endsWith('_metadata.json'))), 'utf8')).transcript?.segments || [];
  } catch { return []; }
}
const palabras = (segs, a, b) => segs.flatMap((s) => (s.end < a || s.start > b ? [] : (s.words || [])))
  .filter((w) => w.start >= a && w.end <= b).map((w) => ({ t: +w.start.toFixed(2), f: +w.end.toFixed(2), w: String(w.word).trim() }));

const lineasGancho = (t, max = 20) => {
  const out = []; let cur = '';
  for (const w of String(t || '').toUpperCase().split(/\s+/).filter(Boolean)) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur); return out.slice(0, 3).join('\n');
};
const fr = (x) => Math.max(0, Math.min(1, +x.toFixed(4)));

// Receta por defecto, a partir de cómo salió el clip (juego + cara, juego solo, o encuadre de OpenShorts).
function recetaInicial(v, c, m, webcam, cierre) {
  const asp = m.w / m.h, juegoH = Math.round(1080 / asp / 2) * 2;
  const textos = [{ id: 'gancho', texto: lineasGancho(c.gancho || c.titulo), x: 540, y: BANDA / 2, tam: 66, color: '#ffffff', caja: null, cuando: 'siempre', seg: 0 }];
  (cierre || []).slice(0, 2).forEach((t, i) => textos.push({ id: `cierre${i + 1}`, texto: t, x: 540, y: i ? 580 : 480, tam: i ? 60 : 46, color: '#000000', caja: '#ffffff', cuando: 'final', seg: 3 }));
  let capas, fondo = 'oscuro', linea = false, subsY = 1500;
  if (webcam?.cam && c.encuadre === 'cara+juego') {
    const [bx, by, bw, bh] = webcam.cam, cara = webcam.cara, caraH0 = c.zonaTexto || Math.min(Math.round(1080 * bh / bw), 1920 - juegoH - 300);
    const caraH = caraH0 - (caraH0 % 2), prop = 1080 / caraH; let cw, ch;
    if (bw / bh > prop) { ch = bh; cw = bh * prop; } else { cw = bw; ch = bw / prop; }
    const fx = cara ? cara[0] + cara[2] / 2 : bx + bw / 2, fy = cara ? cara[1] + cara[3] / 2 : by + bh * 0.4;
    const cx = Math.min(bx + bw - cw, Math.max(bx, fx - cw / 2)), cy = Math.min(by + bh - ch, Math.max(by, fy - ch / 2));
    capas = [{ id: 'camara', src: { x: fr(cx / m.w), y: fr(cy / m.h), w: fr(cw / m.w), h: fr(ch / m.h) }, dst: { x: 0, y: 0, w: 1080, h: caraH } },
      { id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 1920 - juegoH, w: 1080, h: juegoH } }];
    textos[0] = { ...textos[0], y: caraH - 130, caja: '#000000', cuando: 'inicio', seg: 3.5 };
    textos.forEach((t, i) => { if (t.id.startsWith('cierre')) Object.assign(t, { y: caraH - (t.id === 'cierre1' ? 230 : 130) }); });
    subsY = caraH - 95;
  } else if (webcam?.cam && ['gaming', 'reaccion'].includes(v.tipo)) {
    const [bx, by, bw, bh] = webcam.cam, cara = webcam.cara;
    const caraY = BANDA + juegoH; let caraH = Math.min(1920 - caraY, Math.round(1080 * bh / bw)); caraH -= caraH % 2;
    const prop = 1080 / caraH; let cw, ch;
    if (bw / bh > prop) { ch = bh; cw = bh * prop; } else { cw = bw; ch = bw / prop; }
    const fx = cara ? cara[0] + cara[2] / 2 : bx + bw / 2, fy = cara ? cara[1] + cara[3] / 2 : by + bh * 0.4;
    const cx = Math.min(bx + bw - cw, Math.max(bx, fx - cw / 2)), cy = Math.min(by + bh - ch, Math.max(by, fy - ch / 2));
    capas = [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: BANDA, w: 1080, h: juegoH } },
      { id: 'camara', src: { x: fr(cx / m.w), y: fr(cy / m.h), w: fr(cw / m.w), h: fr(ch / m.h) }, dst: { x: 0, y: caraY, w: 1080, h: caraH } }];
    linea = true; subsY = 1920 - caraY - caraH >= 170 ? Math.round(caraY + caraH + (1920 - caraY - caraH) / 2) : caraY + 90;
  } else if (['gaming'].includes(v.tipo) || c.encuadre === 'juego') {
    capas = [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: BANDA + 120, w: 1080, h: juegoH } }];
    fondo = 'difuminado'; subsY = BANDA + 120 + juegoH + 130;
  } else {
    // Persona hablando o reacción con el encuadre de OpenShorts: recorte 9:16 centrado, a pantalla completa.
    const w = Math.min(1, (m.h * 9 / 16) / m.w);
    capas = [{ id: 'contenido', src: { x: fr((1 - w) / 2), y: 0, w: fr(w), h: 1 }, dst: { x: 0, y: 0, w: 1080, h: 1920 } }];
    subsY = 1450;
  }
  const co = c.coldOpen ? { inicio: +(c.inicio + c.coldOpen.inicio).toFixed(2), fin: +(c.inicio + c.coldOpen.fin).toFixed(2) } : null;
  return {
    inicio: c.inicio, fin: c.fin, coldOpen: co,
    v: { fondo, linea, capas, textos, subs: { activo: true, y: subsY, tam: 76 } },
    h: { fondo: 'oscuro', linea: false, capas: [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1920, h: 1080 } }],
      textos: (cierre || []).slice(0, 2).map((t, i) => ({ id: `cierre${i + 1}`, texto: t, x: 960, y: i ? 190 : 100, tam: i ? 56 : 42, color: '#000000', caja: '#ffffff', cuando: 'final', seg: 3 })),
      subs: { activo: false, y: 960, tam: 64 } },
  };
}

// Todo lo que necesita el editor para abrir un clip.
export async function abrir(id, n, { cierre = null } = {}) {
  const { v, c } = leer(id, n);
  const fuente = fuenteDe(v);
  if (!fuente) throw new Error('El vídeo fuente de este clip ya no está en el servidor: no se puede reencuadrar');
  const m = await medir(fuente);
  let webcam = c.webcam ?? null;
  if (c.webcam === undefined && ['gaming', 'reaccion'].includes(v.tipo) && (webcam = webcamAprendida(v.canal_id, m.w, m.h))) guardarClip(id, n, { webcam });
  else if (c.webcam === undefined && ['gaming', 'reaccion'].includes(v.tipo)) {
    webcam = await detectarWebcam(fuente, [(c.inicio + c.fin) / 2, c.inicio + 2]).catch(() => null);
    guardarClip(id, n, { webcam });
  }
  const receta = c.receta || recetaInicial(v, c, m, webcam, cierre);
  const margen = 30, desde = Math.max(0, Math.min(receta.inicio, c.inicio) - margen), hasta = Math.min(m.dur || 1e9, Math.max(receta.fin, c.fin) + margen);
  return {
    clip: { id: v.id, n: c.n, titulo: c.titulo, gancho: c.gancho, tipo: v.tipo, puntos: c.puntos, original: { inicio: c.inicio, fin: c.fin }, editado: c.editado || null, horizontal: !!c.horizontalEditado, render: c.render || null },
    fuente: { w: m.w, h: m.h, dur: m.dur }, ventana: { desde: +desde.toFixed(2), hasta: +hasta.toFixed(2) },
    receta, webcam, palabras: palabras(transcripcion(v), desde, hasta), logo: logoDelClip(v, c),
  };
}
// Logo de la campaña (solo vertical): dónde va. Es una capa fija: el render lo pone siempre encima de todo.
function logoDelClip(v, c) {
  const slug = v.campana || (v.canal_id ? db.prepare('SELECT campana FROM clip_canales WHERE id = ?').get(v.canal_id)?.campana : null);
  const pc = slug ? perfilCampana(slug) : null;
  if (!pc?.logo?.archivo || !existsSync(pc.logo.archivo)) return null;
  const ancho = Math.round(pc.logo.ancho || 760);
  return { campana: pc.nombre, url: `/api/campanas/logo?slug=${encodeURIComponent(slug)}`, pos: c.logoPos || { x: Math.round((1080 - ancho) / 2), y: 860, w: ancho, h: null } };
}

// Proxy ligero (720p, un fotograma clave por medio segundo) de la ventana que se edita, para que el navegador lo mueva con soltura.
export async function proxy(id, n, desde, hasta) {
  const { v } = leer(id, n);
  const fuente = fuenteDe(v); if (!fuente) throw new Error('Sin vídeo fuente');
  desde = Math.max(0, Number(desde) || 0); hasta = Number(hasta) || desde + 120;
  const f = path.join(DIR_EDITOR(), `proxy-${v.id}-${Math.round(desde * 10)}-${Math.round(hasta * 10)}.mp4`);
  if (!existsSync(f)) {
    const tmp = `${f}.tmp.mp4`;
    // 540p y «ultrafast»: es solo para ver y encuadrar (los recortes van en fracciones, el render sale de la fuente original).
    await ejecutar('ffmpeg', ['-v', 'error', '-y', '-ss', String(desde), '-t', String(Math.min(600, hasta - desde)), '-i', fuente, '-vf', 'scale=-2:540', '-r', '30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp]);
    renameSync(tmp, f);
  }
  return f;
}

// ---------- render ----------
const escF = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const color = (c) => `0x${String(c || '#ffffff').replace('#', '').slice(0, 6)}`;
const par = (x) => Math.max(2, Math.round(x / 2) * 2);

// ---------- recursos propios: imágenes (stickers, marcos, logos) y audio (música, efectos) ----------
// Se guardan una vez por contenido (sha1) en datos/editor-recursos y se pueden reutilizar en cualquier clip.
const RECURSOS = path.join(DATOS, 'editor-recursos'), INDICE = path.join(RECURSOS, 'indice.json');
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const esAudio = (id) => /\.(mp3|m4a|wav|ogg)$/.test(id);
const esVideo = (id) => /\.(mp4|webm|mov)$/.test(id);
const leerIndice = () => { try { return JSON.parse(readFileSync(INDICE, 'utf8')); } catch { return []; } };
export const rutaRecurso = (id) => { if (!/^[a-f0-9]{24}\.(png|jpg|webp|mp3|m4a|wav|ogg|mp4|webm|mov)$/.test(String(id || ''))) return null; const f = path.join(RECURSOS, id); return existsSync(f) ? f : null; };
export function subirRecurso(nombre, datos) {
  const m = /^data:([\w/.+-]+);base64,(.+)$/s.exec(String(datos || ''));
  if (!m || !EXT[m[1]]) throw new Error('Formato no admitido: imágenes PNG, JPG o WebP; vídeo MP4, WebM o MOV; audio MP3, M4A, WAV u OGG');
  const buf = Buffer.from(m[2], 'base64'), ext = EXT[m[1]], audio = esAudio(`x.${ext}`);
  const vid = esVideo(`x.${ext}`);
  if (buf.length > (audio || vid ? 21e6 : 8e6)) throw new Error(audio ? 'El audio pasa de 21 MB' : vid ? 'El vídeo pasa de 21 MB: recórtalo o bájale la calidad' : 'La imagen pasa de 8 MB');
  mkdirSync(RECURSOS, { recursive: true });
  const id = `${createHash('sha1').update(buf).digest('hex').slice(0, 24)}.${ext}`;
  if (!existsSync(path.join(RECURSOS, id))) writeFileSync(path.join(RECURSOS, id), buf);
  const ind = leerIndice().filter((r) => r.id !== id);
  const r = { id, nombre: String(nombre || id).replace(/[\\/]/g, '').slice(0, 80), tipo: audio ? 'audio' : vid ? 'video' : 'imagen', creado: new Date().toISOString() };
  ind.unshift(r); writeFileSync(INDICE, JSON.stringify(ind.slice(0, 300)));
  return r;
}
export const recursos = () => leerIndice().filter((r) => rutaRecurso(r.id));
export function borrarRecurso(id) { const f = rutaRecurso(id); if (f) rmSync(f, { force: true }); writeFileSync(INDICE, JSON.stringify(leerIndice().filter((r) => r.id !== id))); return { ok: true }; }
// Ventana de tiempo de un elemento (textos e imágenes): todo el clip, los primeros N s o los últimos N s.
const ventanaDe = (el, total, inicioClip) => (el.cuando === 'rango' && el.fin > el.ini ? [Math.min(total, inicioClip + el.ini), Math.min(total, inicioClip + el.fin)] : el.cuando === 'final' ? [Math.max(inicioClip, total - (el.seg || 3)), total] : el.cuando === 'inicio' ? [inicioClip, inicioClip + (el.seg || 3)] : [inicioClip, total]);

// Composición de un formato a partir de la entrada `ent` (etiqueta de ffmpeg) → etiqueta de salida. Sin textos.
function componer(F, fmt, m, ent, dur, sal, sufijo) {
  const { W, H } = LIENZO[F];
  const capas = (fmt.capas || []).filter((k) => k.src?.w > 0 && k.src?.h > 0 && k.dst?.w > 0 && k.dst?.h > 0);
  const n = capas.length + 1, partes = [];
  partes.push(`[${ent}]split=${n}${Array.from({ length: n }, (_, i) => `[s${sufijo}${i}]`).join('')}`);
  // Fondo: el difuminado se calcula a un cuarto de tamaño y luego se amplía (mismo aspecto, mucho más rápido);
  // el oscuro es un color sólido (la rama de vídeo se descarta con un recorte mínimo que no cuesta nada).
  partes.push(fmt.fondo === 'difuminado'
    ? `[s${sufijo}0]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=8:1,eq=brightness=-0.15,scale=${W}:${H},setsar=1[bg${sufijo}]`
    : `[s${sufijo}0]scale=16:16,drawbox=x=0:y=0:w=16:h=16:color=0x0b0b0f:t=fill,scale=${W}:${H}:flags=neighbor,setsar=1[bg${sufijo}]`);
  let base = `bg${sufijo}`;
  capas.forEach((k, i) => {
    // El recorte toma siempre la proporción del hueco de destino (centrado en lo elegido): nunca se deforma la imagen.
    let sw = k.src.w * m.w, sh = k.src.h * m.h; const objetivo = k.dst.w / k.dst.h, ccx = k.src.x * m.w + sw / 2, ccy = k.src.y * m.h + sh / 2;
    if (sw / sh > objetivo) sw = sh * objetivo; else sh = sw / objetivo;
    const cw = Math.min(par(sw), m.w - (m.w % 2)), ch = Math.min(par(sh), m.h - (m.h % 2));
    const cx = Math.round(Math.min(m.w - cw, Math.max(0, ccx - cw / 2))), cy = Math.round(Math.min(m.h - ch, Math.max(0, ccy - ch / 2)));
    partes.push(`[s${sufijo}${i + 1}]crop=${cw}:${ch}:${cx}:${cy},scale=${par(k.dst.w)}:${par(k.dst.h)}:flags=lanczos,setsar=1[c${sufijo}${i}]`);
    const sigue = i === capas.length - 1 && !(fmt.linea && capas.length > 1) ? sal : `o${sufijo}${i}`;
    partes.push(`[${base}][c${sufijo}${i}]overlay=${Math.round(k.dst.x)}:${Math.round(k.dst.y)}:shortest=1[${sigue}]`);
    base = sigue;
  });
  if (!capas.length) partes.push(`[${base}]null[${sal}]`);
  else if (fmt.linea && capas.length > 1) {
    const cam = capas.find((k) => k.id === 'camara') || capas[1];
    partes.push(`[${base}]drawbox=x=0:y=${Math.round(cam.dst.y) - 3}:w=${W}:h=6:color=0xffd23f:t=fill[${sal}]`);
  }
  return partes.join(';');
}

// Subtítulos karaoke (.ass) de grupos de 3 palabras, desplazados `offset` s (por el cold open).
function ass(pal, ini, F, subs, offset) {
  const { W, H } = LIENZO[F];
  const t = (s) => { const cs = Math.max(0, Math.round(s * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const limpia = (w) => w.replace(/[{}\\]/g, '').toUpperCase();
  const p = pal.map((x) => ({ ...x, t: x.t - ini + offset, f: x.f - ini + offset }));
  const ev = [];
  for (let g = 0; g < p.length; g += 3) {
    const grupo = p.slice(g, g + 3);
    grupo.forEach((q, i) => {
      const fin = grupo[i + 1] ? grupo[i + 1].t : (p[g + 3] ? Math.min(p[g + 3].t, q.f + 0.6) : q.f + 0.6);
      ev.push(`Dialogue: 0,${t(q.t)},${t(fin)},K,,0,0,0,,{\\pos(${W / 2},${Math.round(subs.y)})}${grupo.map((r, j) => (j === i ? `{\\c&H3FD2FF&}${limpia(r.w)}{\\c&HFFFFFF&}` : limpia(r.w))).join(' ')}`);
    });
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`
    + `Style: K,Montserrat ExtraBold,${Math.round(subs.tam || 76)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,5,40,40,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev.join('\n')}\n`;
}

// Textos: una línea por drawtext (centradas en x; el bloque, centrado en y). Interlineado 1,2 × tamaño, igual que la vista previa.
function textos(lista, total, inicioClip, dir, base) {
  const out = [];
  lista.forEach((tx, k) => {
    const lineas = String(tx.texto || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const lh = Math.round(tx.tam * 1.2), y0 = tx.y - (lineas.length * lh) / 2;
    const [a, b] = ventanaDe(tx, total, inicioClip), fd = Math.min(tx.fade || 0, (b - a) / 2);
    const alfa = fd > 0 ? `:alpha='if(lt(t,${(a + fd).toFixed(2)}),(t-${a.toFixed(2)})/${fd.toFixed(2)},if(gt(t,${(b - fd).toFixed(2)}),(${b.toFixed(2)}-t)/${fd.toFixed(2)},1))'` : '';
    lineas.forEach((l, i) => {
      const f = path.join(dir, `${base}.t${k}-${i}.txt`); writeFileSync(f, l);
      out.push(`drawtext=fontfile='${escF(FUENTE_TXT())}':textfile='${escF(f)}':fontsize=${Math.round(tx.tam)}:fontcolor=${color(tx.color)}`
        + (tx.caja ? `:box=1:boxcolor=${color(tx.caja)}@0.96:boxborderw=${Math.round(tx.tam * 0.3)}` : ':borderw=3:bordercolor=black@0.6')
        + `:x=${Math.round(tx.x)}-text_w/2:y=${Math.round(y0 + i * lh)}${alfa}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`);
    });
  });
  return out;
}

async function renderFormato(F, receta, fuente, m, pal, dest) {
  const fmt = receta[F]; const dir = path.dirname(dest), base = path.basename(dest, '.mp4');
  const dur = +(receta.fin - receta.inicio).toFixed(2);
  if (dur < 3 || dur > 180) throw new Error('El clip debe durar entre 3 s y 3 min');
  const co = receta.coldOpen && receta.coldOpen.fin > receta.coldOpen.inicio ? receta.coldOpen : null;
  const coDur = co ? +(co.fin - co.inicio).toFixed(2) : 0;
  const entradas = ['-ss', String(receta.inicio), '-t', String(dur), '-i', fuente];
  const partes = [componer(F, fmt, m, '0:v', dur, 'vm', 'm'), '[0:a]asetpts=PTS-STARTPTS[am]'];
  if (co) {
    entradas.push('-ss', String(co.inicio), '-t', String(coDur), '-i', fuente);
    partes.push(componer(F, fmt, m, '1:v', coDur, 'vc0', 'c'), `[vc0]fade=t=out:st=${(coDur - 0.12).toFixed(2)}:d=0.12:color=white[vc]`,
      `[1:a]asetpts=PTS-STARTPTS,afade=t=out:st=${(coDur - 0.08).toFixed(2)}:d=0.08[ac]`, '[vc][ac][vm][am]concat=n=2:v=1:a=1[vj][aj]');
  }
  const vj = co ? 'vj' : 'vm', aj = co ? 'aj' : 'am', total = coDur + dur;
  const filtros = textos(fmt.textos || [], total, coDur, dir, base);
  let fass = null;
  if (fmt.subs?.activo && pal.length) { fass = path.join(dir, `${base}.ass`); writeFileSync(fass, ass(pal, receta.inicio, F, fmt.subs, coDur)); }
  const finales = [...filtros, ...(fass ? [`ass='${escF(fass)}':fontsdir='${escF(path.dirname(FUENTE_TXT()))}'`] : [])];
  const nEnt = () => entradas.filter((x) => x === '-i').length;
  let cur = vj;
  (fmt.imagenes || []).forEach((im, k) => {
    const idx = nEnt(), [a, b] = ventanaDe(im, total, coDur), fd = Math.min(im.fade || 0, (b - a) / 2);
    const fades = fd > 0 ? `,fade=t=in:st=${a.toFixed(2)}:d=${fd.toFixed(2)}:alpha=1,fade=t=out:st=${(b - fd).toFixed(2)}:d=${fd.toFixed(2)}:alpha=1` : '';
    const op = im.op < 1 ? `,colorchannelmixer=aa=${im.op.toFixed(2)}` : '';
    if (im.tipo === 'video') { // vídeo encima: su tramo, desplazado a su segundo de entrada, sin su audio
      entradas.push('-ss', String(im.desde || 0), '-t', (b - a).toFixed(2), '-i', rutaRecurso(im.archivo));
      partes.push(`[${idx}:v]setpts=PTS-STARTPTS+${a.toFixed(2)}/TB,scale=${par(im.w)}:${par(im.h)},format=rgba${op}${fades}[im${k}]`);
    } else {
      entradas.push('-loop', '1', '-t', total.toFixed(2), '-i', rutaRecurso(im.archivo));
      partes.push(`[${idx}:v]scale=${par(im.w)}:${par(im.h)},format=rgba${op}${fades}[im${k}]`);
    }
    partes.push(`[${cur}][im${k}]overlay=${Math.round(im.x)}:${Math.round(im.y)}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})':eof_action=pass[vi${k}]`);
    cur = `vi${k}`;
  });
  let ajf = aj;
  const audios = receta.audios || [];
  if (audios.length || (receta.voz ?? 1) !== 1) {
    const nombres = ['[avz]'];
    partes.push(`[${aj}]volume=${receta.voz ?? 1}[avz]`);
    audios.forEach((au, k) => {
      const idx = nEnt(), ini = Math.min(total - 0.1, coDur + au.ini), largo = Math.max(0.1, total - ini), fd = Math.min(au.fade || 0, largo / 2), ms = Math.round(ini * 1000);
      entradas.push(...(au.bucle ? ['-stream_loop', '-1'] : []), '-ss', String(au.desde || 0), '-i', rutaRecurso(au.archivo));
      partes.push(`[${idx}:a]atrim=0:${largo.toFixed(2)},asetpts=PTS-STARTPTS,volume=${au.volumen}${fd > 0 ? `,afade=t=in:st=0:d=${fd.toFixed(2)},afade=t=out:st=${(largo - fd).toFixed(2)}:d=${fd.toFixed(2)}` : ''},adelay=delays=${ms}:all=1[amu${k}]`);
      nombres.push(`[amu${k}]`);
    });
    partes.push(`${nombres.join('')}amix=inputs=${nombres.length}:duration=first:dropout_transition=0:normalize=0[amx]`);
    ajf = 'amx';
  }
  const fu = receta.fundido || {};
  if (fu.entrada > 0) finales.push(`fade=t=in:st=0:d=${fu.entrada}`);
  if (fu.salida > 0) finales.push(`fade=t=out:st=${Math.max(0, total - fu.salida).toFixed(2)}:d=${fu.salida}`);
  if (fu.entrada > 0 || fu.salida > 0) {
    partes.push(`[${ajf}]${[fu.entrada > 0 ? `afade=t=in:st=0:d=${fu.entrada}` : '', fu.salida > 0 ? `afade=t=out:st=${Math.max(0, total - fu.salida).toFixed(2)}:d=${fu.salida}` : ''].filter(Boolean).join(',')}[afu]`);
    ajf = 'afu';
  }
  partes.push(`[${cur}]${finales.length ? finales.join(',') : 'null'}[v]`);
  const tmp = `${dest}.tmp.mp4`;
  try {
    await ejecutar('ffmpeg', ['-v', 'error', '-y', ...entradas, '-filter_complex', partes.join(';'), '-map', '[v]', '-map', `[${ajf}]`, '-r', '30', ...CODIF, tmp]);
    renameSync(tmp, dest);
  } finally {
    for (const f of readdirSync(dir).filter((f) => f.startsWith(`${base}.t`) && f.endsWith('.txt'))) rmSync(path.join(dir, f), { force: true });
    if (fass) rmSync(fass, { force: true });
    rmSync(tmp, { force: true });
  }
}

// Valida y limpia la receta que manda el navegador (nada de rutas ni campos extra).
function validar(r, m) {
  const num = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
  const rect01 = (q) => ({ x: num(q?.x, 0, 1), y: num(q?.y, 0, 1), w: num(q?.w, 0.01, 1), h: num(q?.h, 0.01, 1) });
  const fmt = (f, F) => {
    const { W, H } = LIENZO[F];
    return {
      fondo: f?.fondo === 'difuminado' ? 'difuminado' : 'oscuro', linea: !!f?.linea,
      capas: (f?.capas || []).slice(0, 3).map((k) => ({ id: String(k.id || 'capa').slice(0, 20), src: rect01(k.src), dst: { x: num(k.dst?.x, -W, W), y: num(k.dst?.y, -H, H), w: num(k.dst?.w, 2, W * 2), h: num(k.dst?.h, 2, H * 2) } })),
      textos: (f?.textos || []).slice(0, 8).map((t) => ({ id: String(t.id || 'texto').slice(0, 20), texto: String(t.texto || '').slice(0, 200), x: num(t.x, 0, W), y: num(t.y, 0, H), tam: num(t.tam, 16, 220),
        color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#ffffff', caja: /^#[0-9a-f]{6}$/i.test(t.caja) ? t.caja : null, cuando: ['inicio', 'final', 'rango'].includes(t.cuando) ? t.cuando : 'siempre', seg: num(t.seg, 1, 30), ini: num(t.ini, 0, 600), fin: num(t.fin, 0, 600), fade: num(t.fade, 0, 2) })),
      subs: { activo: !!f?.subs?.activo, y: num(f?.subs?.y, 0, H), tam: num(f?.subs?.tam, 30, 140) },
      imagenes: (f?.imagenes || []).filter((i) => rutaRecurso(i?.archivo) && !esAudio(i.archivo)).slice(0, 6).map((i) => ({ id: String(i.id || 'imagen').slice(0, 20), archivo: i.archivo,
        x: num(i.x, -W, W), y: num(i.y, -H, H), w: num(i.w, 8, W * 2), h: num(i.h, 8, H * 2), op: i.op == null ? 1 : num(i.op, 0.1, 1), cuando: ['inicio', 'final', 'rango'].includes(i.cuando) ? i.cuando : 'siempre', seg: num(i.seg, 1, 30), ini: num(i.ini, 0, 600), fin: num(i.fin, 0, 600), fade: num(i.fade, 0, 2),
        tipo: esVideo(i.archivo) ? 'video' : 'imagen', desde: num(i.desde, 0, 3600) })),
    };
  };
  const inicio = num(r.inicio, 0, m.dur), fin = num(r.fin, inicio + 3, m.dur);
  const co = r.coldOpen && Number(r.coldOpen.fin) > Number(r.coldOpen.inicio) ? { inicio: num(r.coldOpen.inicio, 0, m.dur), fin: num(r.coldOpen.fin, 0, m.dur) } : null;
  // Audios: varios (música y efectos), cada uno con su segundo de entrada; «audio» (uno solo) es el formato anterior.
  const lista = Array.isArray(r.audios) ? r.audios : r.audio ? [{ ...r.audio, ini: 0, bucle: true }] : [];
  const audios = lista.filter((a) => rutaRecurso(a?.archivo) && esAudio(a.archivo)).slice(0, 4).map((a) => ({ archivo: a.archivo, nombre: String(a.nombre || '').slice(0, 80),
    volumen: a.volumen == null ? 0.35 : num(a.volumen, 0, 1.5), ini: num(a.ini, 0, 600), desde: num(a.desde, 0, 3600), fade: num(a.fade, 0, 3), bucle: a.bucle !== false }));
  const voz = num(r.voz ?? r.audio?.voz ?? 1, 0, 1.5), fundido = { entrada: num(r.fundido?.entrada, 0, 3), salida: num(r.fundido?.salida, 0, 3) };
  return { inicio: +inicio.toFixed(2), fin: +fin.toFixed(2), coldOpen: co && co.fin - co.inicio <= 6 ? co : null, v: fmt(r.v, 'v'), h: fmt(r.h, 'h'), audios, voz, fundido };
}

// Logo de campaña en el editor: si hay dos bloques apilados (cara y juego) con hueco suficiente entre ellos, el logo va
// centrado en ese hueco; así no tapa la cara aunque se cambie el diseño. Si no cabe, se queda donde estaba.
function logoEnHueco(fmt, pos, logo) {
  if (!pos?.w || !pos?.h) return null;
  const capas = (fmt?.capas || []).map((k) => k.dst).sort((a, b) => a.y - b.y);
  for (let i = 0; i + 1 < capas.length; i++) {
    const fin = capas[i].y + capas[i].h, sig = capas[i + 1].y, m = logo?.margen ?? 14;
    if (sig - fin >= pos.h + 2 * m) return { ...pos, x: Math.round((1080 - pos.w) / 2), y: Math.round(fin + (sig - fin - pos.h) / 2) };
  }
  return null;
}

// Cola de renders: de uno en uno (el servidor es modesto); el estado queda en c.render.
const cola = []; let trabajando = false;
export function encolarRender(id, n, recetaCruda, { publicarCopia, auto = false } = {}) {
  const { v, c } = leer(id, n);
  const fuente = fuenteDe(v); if (!fuente) throw new Error('Sin vídeo fuente');
  if (cola.some((t) => t.id === Number(id) && t.n === Number(n))) throw new Error('Ese clip ya está en cola para renderizar');
  guardarClip(id, n, { render: { estado: 'en cola', desde: new Date().toISOString() } });
  cola.push({ id: Number(id), n: Number(n), recetaCruda, fuente, publicarCopia, auto });
  siguiente();
  return { enCola: cola.length };
}
// Al terminar un vídeo: si su canal tiene un diseño aprendido para ese tipo (y el recorte propio no lo aplica ya con la caja
// de la webcam), cada clip se re-renderiza solo con él. Queda como «editado»: «Deshacer» en el editor vuelve al original.
export async function aplicarEncuadreAprendido(videoId, cierre = null) {
  const v = fila(videoId); if (!v || v.campana || ['estudio', 'recop'].includes(v.tipo)) return 0;
  const L = layoutAprendido(v.canal_id, v.tipo); if (!L) return 0;
  if (['gaming', 'reaccion'].includes(v.tipo) && L.conCamara && L.webcam) return 0; // ya lo usa el recorte propio
  const fuente = fuenteDe(v); if (!fuente) return 0;
  const m = await medir(fuente); let k = 0;
  for (const c of JSON.parse(v.clips || '[]')) {
    if (c.formato === 'horizontal' || c.receta || c.inicio == null) continue;
    const r = recetaInicial(v, c, m, c.webcam ?? null, cierre);
    r.v = { ...r.v, fondo: L.fondo, linea: L.linea, capas: L.capas, subs: { ...r.v.subs, y: L.subsY ?? r.v.subs.y } };
    try { encolarRender(v.id, c.n, r, { auto: true }); k++; } catch (e) { console.error(`Encuadre aprendido ${v.id}/${c.n}:`, e.message); }
  }
  return k;
}

// Al terminar un vídeo: versión horizontal de cada clip (receta por defecto, o la editada) y su emoción, en segundo plano.
export function encolarHorizontales(videoId, cierre) {
  const v = fila(videoId); if (!v || !fuenteDe(v)) return 0;
  let n = 0;
  for (const c of JSON.parse(v.clips || '[]')) {
    if (c.horizontal || c.horizontalEditado || cola.some((t) => t.id === v.id && t.n === c.n)) continue;
    cola.push({ tipo: 'horizontal', id: v.id, n: c.n, cierre, fuente: fuenteDe(v) }); n++;
  }
  siguiente();
  return n;
}
async function horizontalAuto(t) {
  const { v, c } = leer(t.id, t.n);
  const m = await medir(t.fuente);
  const receta = c.receta || recetaInicial(v, c, m, c.webcam ?? null, t.cierre);
  const pal = palabras(transcripcion(v), receta.inicio, receta.fin);
  const dir = path.join(DATOS, 'clips', String(v.id)); mkdirSync(dir, { recursive: true });
  const fh = path.join(dir, `${String(c.n).padStart(2, '0')}-h.mp4`);
  await renderFormato('h', receta, t.fuente, m, pal, fh);
  // Emoción (informativa: se muestra y permite ordenar; no cambia la puntuación — medido el 20-11-2026 contra tus valoraciones).
  const archivo = c.final && existsSync(c.final) ? c.final : fh;
  const e = await emocionClip(archivo, pal).catch(() => null);
  guardarClip(t.id, t.n, { horizontal: fh, ...(e ? { emocion: e.emocion, emocionDetalle: e.detalle } : {}) });
  // Copia junto al vertical en la carpeta compartida (si el clip sigue ahí; no en Descartados).
  const dest = v.carpeta && c.copia ? path.join(v.carpeta, c.copia) : null;
  if (dest && existsSync(dest)) { try { copyFileSync(fh, dest.replace(/\.mp4$/, ' (horizontal).mp4')); } catch {} }
}
async function siguiente() {
  if (trabajando || !cola.length) return;
  trabajando = true;
  // Lo que pide el editor (alguien esperando) va antes que las horizontales automáticas.
  const i = Math.max(0, cola.findIndex((x) => x.tipo !== 'horizontal'));
  const [t] = cola.splice(i, 1);
  if (t.tipo === 'horizontal') {
    try { await horizontalAuto(t); } catch (e) { console.error(`Editor: horizontal de ${t.id}/${t.n}:`, e.message); }
    finally { trabajando = false; siguiente(); }
    return;
  }
  try {
    const { v, c } = leer(t.id, t.n);
    guardarClip(t.id, t.n, { render: { estado: 'renderizando', desde: new Date().toISOString() } });
    const m = await medir(t.fuente);
    const receta = validar(t.recetaCruda, m);
    const pal = palabras(transcripcion(v), receta.inicio, receta.fin);
    const dir = path.join(DATOS, 'clips', String(v.id)); mkdirSync(dir, { recursive: true });
    const nn = String(c.n).padStart(2, '0');
    const fv = path.join(dir, `${nn}-editado.mp4`), fh = path.join(dir, `${nn}-editado-h.mp4`);
    await renderFormato('v', receta, t.fuente, m, pal, fv);
    await renderFormato('h', receta, t.fuente, m, pal, fh);
    // Clip de campaña: el editor vuelve a poner el logo (última capa) y repite su revisión (fallo 3).
    const slug = v.campana || (v.canal_id ? db.prepare('SELECT campana FROM clip_canales WHERE id = ?').get(v.canal_id)?.campana : null);
    const pc = slug ? perfilCampana(slug) : null;
    let extra = {};
    if (pc?.logo?.archivo) {
      try { const r = await ponerLogoYRevisar(fv, pc.logo, logoEnHueco(receta.v, c.logoPos, pc.logo) || c.logoPos || null); extra = { logoPos: r.logoPos, qaLogo: r.qaLogo, post: [...new Set([...(c.post || []), 'logo'])] }; }
      catch (e) { extra = { qaLogo: { ok: false, motivo: `logo no aplicado al editar: ${String(e.message).slice(0, 100)}` } }; }
      console.log(`Editor: logo de ${slug} en ${v.id}/${c.n}: ${extra.qaLogo?.ok ? 'revisión ok' : extra.qaLogo?.motivo}`);
    }
    // El original de antes de editar se conserva (c.antesDeEditar) por si se quiere volver atrás.
    const cambios = { receta, final: fv, horizontalEditado: fh, editado: new Date().toISOString(), inicio: receta.inicio, fin: receta.fin,
      antesDeEditar: c.antesDeEditar || { final: c.final || null, inicio: c.inicio, fin: c.fin }, render: { estado: 'listo', fin: new Date().toISOString() }, ...extra };
    guardarClip(t.id, t.n, cambios);
    if (!t.auto) aprenderEncuadre(v, c, receta, m); // lo que re-renderiza la app sola no «enseña»
    try { t.publicarCopia?.(v, { ...c, ...cambios }); } catch (e) { console.error('Editor: copia en la carpeta compartida:', e.message); }
    console.log(`Editor: clip ${v.id}/${c.n} renderizado (vertical y horizontal, ${(receta.fin - receta.inicio).toFixed(1)} s)`);
  } catch (e) {
    try { guardarClip(t.id, t.n, { render: { estado: 'error', error: String(e.message).slice(0, 300), fin: new Date().toISOString() } }); } catch {}
    console.error('Editor:', e.message);
  } finally { trabajando = false; siguiente(); }
}
// Pie del clip: título y texto de publicación (descripción/hashtags). Es lo que se sube a YouTube y a TikTok.
export function guardarTextos(id, n, { titulo, texto }) {
  const cambios = {};
  if (titulo != null) { const t = String(titulo).replace(/\s+/g, ' ').trim().slice(0, 100); if (!t) throw new Error('El título no puede quedar vacío'); cambios.titulo = t; }
  if (texto != null) cambios.tiktok = String(texto).trim().slice(0, 2200);
  if (!Object.keys(cambios).length) throw new Error('Nada que guardar');
  return guardarClip(id, n, cambios);
}
export const estadoRender = (id, n) => leer(id, n).c.render || null;

// «Detectar cara» del editor: la IA busca la cámara del streamer y su cara en el instante t (segundos de la fuente).
export async function detectar(id, n, t) {
  const { v } = leer(id, n);
  const fuente = fuenteDe(v); if (!fuente) throw new Error('Sin vídeo fuente');
  const r = await detectarWebcam(fuente, [Math.max(0, Number(t) || 0)]);
  if (r?.cam) guardarClip(id, n, { webcam: r });
  return r || {};
}

// Volver al clip de antes de editar.
export function deshacer(id, n) {
  const { c } = leer(id, n);
  if (!c.antesDeEditar) throw new Error('Este clip no se ha editado');
  return guardarClip(id, n, { final: c.antesDeEditar.final, inicio: c.antesDeEditar.inicio, fin: c.antesDeEditar.fin, receta: null, horizontalEditado: null, editado: null, render: null, antesDeEditar: null });
}
export const archivoHorizontal = (id, n) => { const { c } = leer(id, n); const f = [c.horizontalEditado, c.horizontal].find((x) => x && existsSync(x)); return f || null; };
// ---------- editor precalentado (de noche) ----------
let precalentando = false, ultimaVuelta = 0, ultimaLimpieza = 0;
export async function precalentarEditor({ ocupado = false } = {}) {
  const cfg = ajustes();
  if (cfg['editor.precalentar'] === false || precalentando || ocupado) return;
  const ahora = new Date(), h = ahora.getHours();
  const desde = Number(String(cfg['editor.precalentar_desde'] || '23:00').split(':')[0]), hasta = Number(String(cfg['editor.precalentar_hasta'] || '07:00').split(':')[0]);
  const dentro = desde > hasta ? (h >= desde || h < hasta) : (h >= desde && h < hasta);
  if (!dentro || Date.now() - ultimaVuelta < 5 * 60e3) return;
  const os = await import('node:os');
  if (os.loadavg()[0] > os.cpus().length * 0.7) return; // el servidor está trabajando en otra cosa: otra vuelta
  precalentando = true; ultimaVuelta = Date.now();
  try {
    // Limpieza (una vez al día): proxies de más de 4 días.
    if (Date.now() - ultimaLimpieza > 20 * 3600e3) {
      ultimaLimpieza = Date.now(); const dir = DIR_EDITOR(); let borrados = 0;
      for (const f of readdirSync(dir).filter((x) => x.startsWith('proxy-') && x.endsWith('.mp4'))) {
        try { if (Date.now() - statSync(path.join(dir, f)).mtimeMs > 4 * 864e5) { rmSync(path.join(dir, f), { force: true }); borrados++; } } catch {}
      }
      if (borrados) console.log(`Editor: ${borrados} proxies de más de 4 días borrados`);
    }
    const publicados = new Set(db.prepare("SELECT video_id || '-' || n AS k FROM clip_subidas WHERE estado IN ('ok','subiendo')").all().map((r) => r.k));
    const descartados = new Set(db.prepare('SELECT video_id || \'-\' || n AS k FROM clip_valoraciones WHERE valor = -1').all().map((r) => r.k));
    const vids = db.prepare("SELECT id, clips FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop') AND terminado >= datetime('now', '-2 days') ORDER BY id DESC").all();
    let hechos = 0;
    for (const v of vids) for (const c of JSON.parse(v.clips || '[]')) {
      if (hechos >= 4) return; // pocos por vuelta (cada 5 min): no acapara el servidor
      const k = `${v.id}-${c.n}`;
      if (c.proxyListo || publicados.has(k) || descartados.has(k) || c.formato === 'horizontal') continue;
      try {
        const d = await abrir(v.id, c.n); // mide la webcam (lo que más tarda al abrir) y calcula la ventana
        await proxy(v.id, c.n, d.ventana.desde, d.ventana.hasta);
        guardarClip(v.id, c.n, { proxyListo: new Date().toISOString() }); hechos++;
      } catch (e) { guardarClip(v.id, c.n, { proxyListo: 'error' }); console.error(`Editor: precalentado de ${k}:`, String(e.message).slice(0, 120)); }
    }
    if (hechos) console.log(`Editor: ${hechos} clips preparados para editar al instante`);
  } finally { precalentando = false; }
}

export const pendientesRender = () => ({ editor: cola.filter((t) => t.tipo !== 'horizontal').length, horizontales: cola.filter((t) => t.tipo === 'horizontal').length, trabajando });
