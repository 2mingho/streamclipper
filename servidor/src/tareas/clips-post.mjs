// Postproceso de los clips de OpenShorts (después del montaje, antes de publicarlos):
//  · Gancho al principio ("cold open"): Gemini elige en cada clip la frase más fuerte (1,5–4 s, de dentro del
//    clip, no del arranque) y se antepone. Estructura final: frase fuerte → arranque con el texto de gancho
//    de OpenShorts → historia → remate.
//  · Cara de cerca cuando el contenido se pausa (vídeos de reacción): donde la parte de arriba (el vídeo al que
//    se reacciona) se queda congelada, se pasa a la cara a pantalla completa.
// Los clips nuevos se guardan en datos/clips/<id del vídeo>/; los originales de OpenShorts no se tocan.
import { RAIZ } from '../db.mjs';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATOS, ajustes } from '../db.mjs';
// Python con OpenCV para detectar la webcam (herramientas/webcam_detect.py).
const PYTHON_CV = process.env.PYTHON_CV || 'python3';
import { pedirJSON } from '../ia-nube.mjs';
import { picosCara, picosPalabras, combinarPicos, antelacion } from './clips-picos.mjs';
import { conTagsCampana } from './campanas.mjs';

const ffmpeg = (args, timeout = 600000) => new Promise((ok, mal) => {
  execFile('nice', ['-n', '5', 'ffmpeg', '-v', 'error', '-y', ...args], { timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => (err ? mal(new Error(String(stderr || err.message).slice(-400))) : ok(String(stderr || stdout))));
});
// Medidas de un vídeo con ffprobe: { w, h, dur }.
const medir = (f) => new Promise((ok) => {
  execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', f], { timeout: 60000 }, (err, stdout) => {
    try { const j = JSON.parse(stdout); ok({ w: j.streams?.[0]?.width || 0, h: j.streams?.[0]?.height || 0, dur: Number(j.format?.duration) || 0 }); }
    catch { ok({ w: 0, h: 0, dur: 0 }); }
  });
});
// Ancho y alto en píxeles de una imagen (el logo de una campaña): { ancho_px, alto_px }.
const medirImagen = (f) => new Promise((ok) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', f], { timeout: 30000 },
  (err, so) => { try { const s = JSON.parse(so).streams[0]; ok({ ancho_px: s.width, alto_px: s.height }); } catch { ok({ ancho_px: 2172, alto_px: 724 }); } }));
const ffmpegSalida = (args, timeout = 600000) => new Promise((ok, mal) => {
  execFile('nice', ['-n', '5', 'ffmpeg', '-hide_banner', ...args], { timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => (err ? mal(new Error(String(stderr || err.message).slice(-400))) : ok(String(stderr))));
});

// ---------- IA: Groq primero, Gemini de reserva con tope diario (ver src/ia-nube.mjs) ----------
const gemini = (prompt, { imagenes = [], preferir = 'gemini' } = {}) => pedirJSON(prompt, { imagenes, preferir }); // vídeos: Gemini primero, Groq de respaldo

// Palabras del clip con su tiempo relativo al inicio del clip.
function palabrasDelClip(segmentos, ini, fin) {
  const out = [];
  for (const s of segmentos || []) {
    if (s.end < ini || s.start > fin) continue;
    for (const w of s.words || []) if (w.start >= ini && w.end <= fin + 0.2) out.push({ t: +(w.start - ini).toFixed(2), f: +(w.end - ini).toFixed(2), w: String(w.word).trim() });
  }
  return out;
}

// Una sola llamada para todos los clips del vídeo.
async function elegirGanchos(clips, segmentos) {
  const datos = clips.map((c) => {
    const pal = palabrasDelClip(segmentos, c.inicio, c.fin);
    return { n: c.n, duracion: +(c.fin - c.inicio).toFixed(1), titulo: c.titulo, palabras: pal.map((p) => `${p.t}|${p.w}`).join(' ') };
  }).filter((c) => c.palabras);
  if (!datos.length) return {};
  const prompt = `Eres editor de vídeos cortos virales (TikTok, Reels, Shorts). Para cada clip vas a elegir un "cold open":
un fragmento de 1,5 a 4 segundos SACADO DE DENTRO DEL CLIP que se pondrá también al principio, antes de que empiece,
para que quien lo vea se quede hasta el final por ver de dónde sale esa frase.

Reglas:
- Elige la frase más impactante, graciosa, polémica o intrigante del clip: el pico, un grito, una frase absurda o una revelación.
- Debe empezar como mínimo 3 segundos después del inicio del clip (el arranque ya se ve de todos modos).
- Empieza y termina en límites de palabra; que se entienda sola y que termine en una palabra completa.
- Si ningún fragmento funciona solo (todo depende del contexto), devuelve null para ese clip.

Formato de las palabras: "segundo|palabra" (segundos desde el inicio del clip).
CLIPS:
${JSON.stringify(datos)}

Devuelve solo JSON: {"ganchos":[{"n":<número de clip>,"inicio":<segundo>,"fin":<segundo>,"frase":"<texto>"} o {"n":<número>,"inicio":null}]}`;
  const r = await gemini(prompt);
  const out = {};
  for (const g of r.ganchos || []) {
    const c = clips.find((x) => x.n === Number(g.n));
    if (!c || g.inicio == null) continue;
    const pal = palabrasDelClip(segmentos, c.inicio, c.fin);
    // Ajustar a las palabras reales: primera que empieza en el inicio pedido y última que acaba en el fin pedido.
    const a = pal.find((p) => p.t >= Number(g.inicio) - 0.15);
    const b = [...pal].reverse().find((p) => p.f <= Number(g.fin) + 0.25);
    if (!a || !b) continue;
    const ini = Math.max(0, a.t - 0.08), fin = Math.min(c.fin - c.inicio, b.f + 0.15);
    if (ini < 2.5 || fin - ini < 1.2 || fin - ini > 4.8) continue;
    out[c.n] = { inicio: +ini.toFixed(2), fin: +fin.toFixed(2), frase: String(g.frase || '').slice(0, 200) };
  }
  return out;
}

const CODIF = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];

// Frase fuerte delante + clip completo. Un destello blanco breve separa el gancho del arranque.
async function anteponerGancho(src, g, dest) {
  const fc = `[0:v]trim=${g.inicio}:${g.fin},setpts=PTS-STARTPTS,fade=t=out:st=${(g.fin - g.inicio - 0.12).toFixed(2)}:d=0.12:color=white[tv];`
    + `[0:a]atrim=${g.inicio}:${g.fin},asetpts=PTS-STARTPTS,afade=t=out:st=${(g.fin - g.inicio - 0.08).toFixed(2)}:d=0.08[ta];`
    + '[0:v]setpts=PTS-STARTPTS[mv];[0:a]asetpts=PTS-STARTPTS[ma];[tv][ta][mv][ma]concat=n=2:v=1:a=1[v][a]';
  await ffmpeg(['-i', src, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', ...CODIF, dest]);
}

// ---------- cara de cerca cuando el contenido se pausa (reacciones) ----------
// En el encuadre de reacción (INSET/SCREENCAST) el contenido va arriba y la cara abajo. Se mide dónde la franja
// de arriba se queda quieta (freezedetect) y en esos tramos se muestra la franja de la cara ampliada.
async function tramosCongelados(src, caja) {
  const { x, y, w, h } = caja;
  const log = await ffmpegSalida(['-i', src, '-vf', `crop=${w}:${h}:${x}:${y},scale=240:-2,freezedetect=n=-55dB:d=1.2`, '-an', '-f', 'null', '-'], 300000);
  const tramos = []; let ini = null;
  for (const l of log.split('\n')) {
    let m;
    if ((m = l.match(/freeze_start: ([\d.]+)/))) ini = Number(m[1]);
    else if ((m = l.match(/freeze_end: ([\d.]+)/)) && ini != null) { tramos.push([ini, Number(m[1])]); ini = null; }
  }
  if (ini != null) tramos.push([ini, 9999]);
  return tramos.filter(([a, b]) => b - a >= 1.2);
}

// Zonas del clip vertical en el encuadre de recuadro (INSET) de OpenShorts, con su misma geometría
// (camera_inset.inset_filtergraph): pantalla entera a todo el ancho, debajo la webcam ampliada, y relleno
// difuminado repartido arriba y abajo. `caja` = recuadro de la webcam en el vídeo original (x, y, w, h).
function zonasInset(caja, origW, origH, W, H) {
  const [bx, , bw, bh] = caja;
  let camH = Math.min(Math.round(W * bh / bw), Math.floor(H * 0.40)); camH -= camH % 2;
  let pantH = Math.round(W * origH / origW); pantH -= pantH % 2;
  pantH = Math.max(2, Math.min(pantH, H - camH - 2));
  const pantY = Math.floor((H - pantH - camH) / 2);
  const s = W / origW;
  // Para medir las pausas: el lado de la pantalla donde NO está la webcam (se mueve aunque el vídeo esté pausado).
  const camX0 = Math.round(bx * s), camX1 = Math.round((bx + bw) * s);
  const contenido = camX0 > W - camX1
    ? { x: 0, y: pantY, w: Math.max(32, camX0 - 8), h: pantH }
    : { x: Math.min(W - 32, camX1 + 8), y: pantY, w: Math.max(32, W - camX1 - 8), h: pantH };
  return { contenido, cara: { x: 0, y: pantY + pantH, w: W, h: camH }, pantY };
}

// Mediana de los recuadros de webcam que OpenShorts escribió en su registro ("Webcam inset at (x, y, w, h)").
export function cajaWebcam(logs = []) {
  const cajas = logs.map((l) => String(l).match(/Webcam inset at \((\d+), (\d+), (\d+), (\d+)\)/)).filter(Boolean).map((m) => m.slice(1).map(Number));
  if (!cajas.length) return null;
  const med = (i) => cajas.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(cajas.length / 2)];
  return [med(0), med(1), med(2), med(3)];
}

const dimensiones = async (f) => { const m = await medir(f); return m.w && m.h ? [m.w, m.h] : null; };

// Donde el contenido se queda quieto, la cara pasa a ocupar la pantalla y su franja enteras. Para no repetir ni
// cortar nada se parte del clip SIN subtítulos de OpenShorts, se amplía la cara y se vuelven a poner sus subtítulos
// (el mismo .ass); esa versión sustituye al clip final solo durante las pausas. No actúa en los primeros 4 s, donde
// va el texto de gancho de OpenShorts.
async function acercarCara(src, layoutJson, caja, origen, dest) {
  const rangos = (layoutJson?.ranges || []).filter((r) => r.layout === 'inset');
  if (!rangos.length || !caja) return false;
  const dir = path.dirname(src), nombre = path.basename(src);
  const marca = (nombre.match(/^subtitled_(\d+)_/) || [])[1];
  const crudo = path.join(dir, nombre.replace(/^(subtitled_\d+_|hooked_\d+_)+/, ''));
  const ass = marca && readdirSync(dir).find((f) => f.startsWith(`autosubs_${marca}_`) && f.endsWith('.ass'));
  if (!existsSync(crudo)) return false;
  const [W, H] = (await dimensiones(src)) || [1080, 1920];
  const [oW, oH] = (origen && existsSync(origen) && await dimensiones(origen)) || [1920, 1080];
  const z = zonasInset(caja, oW, oH, W, H);
  const congelados = (await tramosCongelados(crudo, z.contenido))
    .map(([a, b]) => [Math.max(a, 4), b])
    .filter(([a, b]) => b - a >= 1.2 && rangos.some((r) => a < r.end - 0.5 && b > r.start + 0.5));
  if (!congelados.length) return false;
  const top = z.pantY, bajo = z.cara.y + z.cara.h;
  const altoZ = (bajo - top) - ((bajo - top) % 2);
  let cw = Math.round(z.cara.h * W / altoZ); cw = Math.min(W, cw - (cw % 2));
  const cx = Math.round((W - cw) / 2);
  const activo = congelados.map(([a, b]) => `between(t,${(a + 0.15).toFixed(2)},${Math.min(b, 9998).toFixed(2)})`).join('+');
  const esc = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const fuentes = path.join(path.dirname(ajustes()['clips.salida']), 'fonts');
  const subs = ass ? `,ass='${esc(path.join(dir, ass))}':fontsdir='${esc(fuentes)}'` : '';
  const fc = `[1:v]split[r][c];[c]crop=${cw}:${z.cara.h}:${cx}:${z.cara.y},scale=${W}:${altoZ}:flags=lanczos,setsar=1[zoom];`
    + `[r][zoom]overlay=0:${top}${subs}[zsub];[0:v][zsub]overlay=0:0:enable='${activo}'[v]`;
  await ffmpeg(['-i', src, '-i', crudo, '-filter_complex', fc, '-map', '[v]', '-map', '0:a?', ...CODIF, dest]);
  return congelados;
}

// ---------- encuadre «juego + cara» (directos de juegos y reacciones) ----------
// 1080×1920: arriba una franja con el texto de gancho (0–280), debajo la pantalla del juego TAL CUAL se grabó, a todo
// el ancho y sin deformar (280–888 en 16:9), y debajo el recorte de la cara del creador ampliado (888–1920). Los
// subtítulos karaoke van sobre la junta entre juego y cara. Se compone desde la grabación original (no desde el clip de
// OpenShorts), así que se aprovecha toda su resolución.
const W = 1080, H = 1920, BANDA = 280;
const FUENTE_TXT = () => path.join(path.dirname(ajustes()['clips.salida']), 'fonts', 'Montserrat-ExtraBold.ttf');

// Mueve la ventana del clip para que empiece 10–20 s antes del pico de chat que contiene (y no corte la reacción).
export function ajustarVentana(c, picos, durFuente, max = 50) {
  const dentro = (picos || []).filter((p) => p.t >= c.inicio - 25 && p.t <= c.fin + 3).sort((a, b) => b.intensidad - a.intensidad);
  if (!dentro.length) return false;
  const p = dentro[0], [cerca, lejos] = antelacion(p);
  let ini = Math.min(c.inicio, p.t - cerca), fin = Math.max(c.fin, p.t + 12);
  ini = Math.max(0, Math.max(ini, p.t - lejos));
  if (fin - ini > max) fin = ini + max;
  c.inicio = +ini.toFixed(2); c.fin = +Math.min(fin, durFuente || fin).toFixed(2); c.pico = p;
  return true;
}
// Picos fuertes que ningún clip recoge: clip nuevo alrededor de cada uno (los textos los pone Gemini al verificarlos).
export function clipsDePicos(clips, picos, durFuente) {
  const nuevos = [];
  // Solo picos fuertes y fiables: del chat, o reacciones confirmadas por dos señales (voz, cara, palabras).
  for (const p of (picos || []).filter((x) => x.intensidad >= 2.5 && ((x.tipos || ['chat']).includes('chat') || (x.tipos || []).length >= 2))) {
    if ([...clips, ...nuevos].some((c) => p.t >= c.inicio - 5 && p.t <= c.fin + 5)) continue;
    const [cerca] = antelacion(p), ini = Math.max(0, p.t - cerca - 3), fin = Math.min(durFuente || p.t + 24, p.t + 20);
    if (fin - ini < 18) continue;
    nuevos.push({ n: clips.length + nuevos.length + 1, archivo: '', titulo: '', puntos: null, gancho: '', tiktok: '', instagram: '', inicio: ini, fin, porque: (p.tipos || []).includes('chat') ? 'Pico de comentarios del chat' : 'Reacción fuerte del streamer', pico: p, dePico: true });
  }
  return nuevos;
}

async function fotogramaB64(fuente, t, ancho = 640) {
  const f = path.join(DATOS, 'clips', `.fot-${process.pid}-${Math.round(t * 100)}.jpg`);
  await ffmpeg(['-ss', String(Math.max(0, t)), '-i', fuente, '-frames:v', '1', '-vf', `scale=${ancho}:-2`, '-q:v', '5', f], 60000);
  const b = readFileSync(f).toString('base64'); rmSync(f, { force: true }); return b;
}

// Títulos y textos que describen DE VERDAD el clip: Gemini ve 3 fotogramas del tramo exacto, lo que se dice y lo que
// escribía el chat, y reescribe título, gancho en pantalla y descripciones. También puntúa el clip.
export async function textosVerificados(c, segmentos, fuente, contexto = '', idioma = 'es', extra = '', pista = {}) {
  // pista.relativo: `fuente` es el clip ya montado (repaso posterior), y lo dicho sale de c.dicho (guardado al montarlo).
  const pal = segmentos ? palabrasDelClip(segmentos, c.inicio, c.fin).map((p) => p.w).join(' ') : String(c.dicho || '');
  if (pal) c.dicho = pal.slice(0, 2500);
  const dur = c.fin - c.inicio, t0 = pista.relativo ? 0 : c.inicio;
  const imagenes = [];
  for (const k of [0.2, 0.5, 0.8]) { try { imagenes.push(await fotogramaB64(fuente, t0 + dur * k, 432)); } catch {} } // 432 px: cabe en el límite del plan gratuito de Groq
  const juego = pista.juego || c.sugerido?.juego || '';
  const creador = pista.creador || '';
  const prompt = idioma === 'en' ? promptIngles({ c, pal, dur, contexto, extra, juego, creador }) : `Eres editor de Shorts/TikTok en español. Te paso 3 fotogramas (al 20 %, 50 % y 80 %) de un clip de ${Math.round(dur)} s
de un directo, lo que se DICE en ese clip y, si lo hubo, lo que escribía el chat en el momento clave.
${contexto ? `Contexto del canal: ${contexto}\n` : ''}${creador ? `CREADOR: ${creador}\n` : ''}${juego ? `JUEGO CONFIRMADO: ${juego} (no lo cambies por ningún otro)\n` : ''}${c.sugerido?.motivo ? `UN ANALISTA QUE VIO EL VÍDEO ENTERO DICE QUE AQUÍ PASA: «${c.sugerido.motivo}»${c.sugerido.titulo ? ` · su título: «${c.sugerido.titulo}»` : ''}\n` : ''}LO QUE SE DICE: «${pal.slice(0, 2500) || '(casi nada hablado)'}»
${c.pico?.muestra?.length ? `EL CHAT ESCRIBÍA: «${c.pico.muestra.join(' / ')}»\n` : ''}${c.pico && (c.pico.tipos || []).some((x) => x !== 'chat') ? `REACCIÓN FUERTE DEL STREAMER hacia el segundo ${Math.round(c.pico.t - c.inicio)} del clip (detectada en ${c.pico.tipos.filter((x) => x !== 'chat').join(', ')}): el título y el gancho deben girar en torno a esa reacción y a qué la provocó.\n` : ''}${c.titulo && !c.sugerido ? `Propuesta anterior (puede estar mal): «${c.titulo}»\n` : ''}
Reglas: cuenta SOLO lo que pasa en ESTE clip (nada inventado), pero cuéntalo para que den ganas de verlo: emoción, giro, tensión o
humor; verbos fuertes y concretos («le roban», «pierde», «descubre», «se vuelve loco»), detalles que choquen (números, lo absurdo, lo
inesperado), lenguaje de redes en español neutro. Prohibido el tono de noticia o de resumen plano («Vegetta777 encuentra un coche en
GTA VI» es plano; «A Vegetta777 le roban el coche de Fast & Furious a los 5 segundos» engancha). Sin comillas raras ni mayúsculas sostenidas. Los TRES textos (título, gancho y descripciones) nombran al CREADOR, dicen QUÉ HACE o le pasa y en QUÉ JUEGO.
TÍTULO: empieza por el nombre del streamer tal como lo conoce su público (forma corta: «Auron», «Grefg», «Willyrex», «DaniRep»), sigue con
lo que hace o le pasa contado con gracia y tensión (gerundio o frase con giro: «Auron robando todo el dinero a los clientes», «Grefg encuentra
a una abuela de 78 años en la app de citas»), y termina con « en <JUEGO>» y, si cabe, « | <juego como se busca>» (p. ej. « en GTA VI | GTA 6»).
JUEGO: ${juego ? `es ${juego}. ` : ''}La fuente fiable es el «Título del vídeo original» del contexto. Si dice GTA 6 / GTA VI, el juego es GTA VI aunque los gráficos te
recuerden a GTA V u otro juego: NUNCA escribas GTA V, GTA 5, GTA Online, San Andreas, Red Dead, Far Cry u otro juego distinto. Si el
título original no nombra ningún juego, usa el que se vea o se diga; si no se sabe con certeza, no pongas juego.
GANCHO: el texto fijo arriba del vídeo, máx. 40 caracteres: nombre del creador + lo que hace (y el juego si cabe), que deje una pregunta
abierta y SIN destripar el final (p. ej. «DaniRep encuentra a Bigfoot en GTA VI…», «Lo que Willyrex halló en este búnker»).
DESCRIPCIONES: 1–2 frases que digan quién es, qué hace y en qué juego, + 3–4 hashtags (uno del creador y #gta6 si es GTA VI).
Devuelve solo JSON: {"titulo":"<máx 70 caracteres>","gancho":"<máx 40 caracteres>","tiktok":"<1–2 frases + 3–4 hashtags>","instagram":"<1–2 frases + 3–4 hashtags>",
"puntos":<0–100, potencial viral real de ESTE clip>,"porque":"<una frase: qué pasa y por qué engancha>"}`;
  // Gemini a veces responde 503/429 (saturado): hasta 3 intentos con 20 s y 60 s de espera.
  let r;
  for (let i = 0; ; i++) {
    try { r = await gemini(prompt, { imagenes }); break; }
    catch (e) { if (i >= 2 || !/503|429|high demand|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed/i.test(e.message)) throw e; await new Promise((ok) => setTimeout(ok, i ? 60000 : 20000)); }
  }
  for (const k of ['titulo', 'gancho', 'tiktok', 'instagram', 'porque']) if (r[k]) c[k] = String(r[k]).trim().slice(0, k === 'titulo' ? 90 : 400);
  if (Number.isFinite(Number(r.puntos))) c.puntos = Math.round(Number(r.puntos));
  c.verificado = true;
}

// Repaso sin IA de los textos: el juego nunca puede ser otro (GTA V, GTA Online…) cuando se sabe cuál es, y el título,
// el gancho en pantalla y las descripciones nombran al creador y al juego.
const OTROS_JUEGOS = /\b(GTA\s*(?:V|5)(?![\w])|GTA\s*Online|Grand Theft Auto\s*(?:V|5)(?![\w])|San Andreas|Red Dead(?: Redemption)?(?: 2)?|Far Cry(?: \d)?)/gi;
export function juegoDeTitulo(titulo = '') {
  return /\bGTA\s*(?:VI|6)\b|Grand Theft Auto\s*(?:VI|6)\b/i.test(titulo) ? 'GTA VI' : '';
}
export function repasarTextos(c, { creador = '', juego = '', idioma = 'es' } = {}) {
  const j = juego || c.sugerido?.juego || '';
  const esGta6 = /GTA\s*(VI|6)/i.test(j);
  const nombreJ = esGta6 ? (idioma === 'en' ? 'GTA 6' : 'GTA VI') : j;
  const fix = (t) => (esGta6 && t ? String(t).replace(OTROS_JUEGOS, nombreJ) : t);
  for (const k of ['titulo', 'gancho', 'tiktok', 'instagram', 'porque']) if (c[k]) c[k] = fix(c[k]);
  const tiene = (t, x) => !!x && String(t || '').toLowerCase().includes(x.toLowerCase());
  // El creador cuenta como nombrado también por su forma corta: «Peanut» (TheBurntPeanut), «Speed» (IShowSpeed), «Kai» (Kai Cenat).
  const formas = (x) => [x, ...String(x).replace(/^the(?=[A-Z])/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/)].filter((k) => k.length >= 3);
  const nombrado = (t) => formas(creador).some((k) => tiene(t, k));
  const conJuego = (t) => !j || /GTA|Grand Theft/i.test(String(t || '')) || tiene(t, j);
  if (creador) {
    if (c.titulo && !nombrado(c.titulo)) c.titulo = `${creador}: ${c.titulo}`.slice(0, 90);
    if (c.gancho && !nombrado(c.gancho)) {
      // Cabe en 3 líneas de ~20 caracteres: se recortan palabras del final si hace falta.
      let g = `${creador} ${c.gancho.charAt(0).toLowerCase()}${c.gancho.slice(1)}`;
      while (g.length > 58 && g.includes(' ')) g = g.slice(0, g.lastIndexOf(' '));
      c.gancho = g;
    }
    for (const k of ['tiktok', 'instagram']) if (c[k] && !nombrado(c[k])) c[k] = `${creador}${nombreJ ? (idioma === 'en' ? ` in ${nombreJ}` : ` en ${nombreJ}`) : ''}: ${c[k]}`;
  }
  if (nombreJ) {
    if (c.titulo && !conJuego(c.titulo) && c.titulo.length < 78) c.titulo = `${c.titulo} ${idioma === 'en' ? 'in' : 'en'} ${nombreJ}`;
    for (const k of ['tiktok', 'instagram']) if (c[k] && !conJuego(c[k])) c[k] = `${c[k]} (${nombreJ})`;
  }
  if (esGta6 && idioma !== 'en') for (const k of ['tiktok', 'instagram']) if (c[k] && !/#gta6/i.test(c[k])) c[k] = `${c[k]} #gta6`;
}

// Mismo encargo para campañas en inglés (público de EE. UU., Reino Unido, Canadá y Australia).
function promptIngles({ c, pal, dur, contexto, extra, juego = '', creador = '' }) {
  return `You edit YouTube Shorts for a US/UK/Canada/Australia audience. You get 3 frames (at 20 %, 50 % and 80 %) of a ${Math.round(dur)} s clip
from a stream, what is SAID in the clip and, if any, what the chat was typing at the key moment.
${contexto ? `Channel context: ${contexto}\n` : ''}${creador ? `CREATOR: ${creador}\n` : ''}${juego ? `CONFIRMED GAME: ${/VI|6/.test(juego) ? 'GTA 6' : juego} (never replace it with another game)\n` : ''}${c.sugerido?.motivo ? `AN ANALYST WHO WATCHED THE FULL VIDEO SAYS THIS HAPPENS HERE: «${c.sugerido.motivo}»${c.sugerido.titulo ? ` · their title: «${c.sugerido.titulo}»` : ''}\n` : ''}${extra ? `Campaign rules: ${extra}\n` : ''}WHAT IS SAID: «${pal.slice(0, 2500) || '(almost nothing spoken)'}»
${c.pico?.muestra?.length ? `CHAT WAS TYPING: «${c.pico.muestra.join(' / ')}»\n` : ''}${c.pico && (c.pico.tipos || []).some((x) => x !== 'chat') ? `STRONG STREAMER REACTION around second ${Math.round(c.pico.t - c.inicio)} of the clip: title and hook should revolve around that reaction and what caused it.\n` : ''}
Rules: tell ONLY what happens in THIS clip (nothing invented), but make people NEED to watch: emotion, twist, tension or humor; strong
concrete verbs («gets robbed», «loses it», «finds», «rage quits»), striking details (numbers, the absurd, the unexpected), natural
American internet English. No flat news tone («xQc finds a car in GTA 6» is flat; «xQc's car gets stolen 5 seconds after he bought it» hooks). No ALL CAPS sentences.
Title, hook AND descriptions all name the CREATOR, say WHAT they do or what happens to them, and in WHICH GAME.
TITLE: start with the streamer's name as fans know it (short form: «Speed», «Kai», «xQc», «Peanut», «Typical Gamer»), then what they do or what happens
to them told with humor and tension, and end with « in GTA 6» when it fits. Max 70 characters. No hashtags in the title.
GAME: the reliable source is the «original video title» in the context. If it says GTA 6 / GTA VI, the game is GTA 6 even if graphics look like GTA V: NEVER write GTA V, GTA 5, GTA Online, San Andreas or Red Dead.
HOOK: the text fixed at the top of the video, max 40 characters: creator's name + what they do (and the game if it fits), curiosity WITHOUT spoiling the ending (e.g. «Speed meets the craziest NPC in GTA 6»).
Return only JSON: {"titulo":"<max 70 chars>","gancho":"<max 40 chars>","tiktok":"<1–2 sentences: who, what, which game; no hashtags>","instagram":"<1–2 sentences: who, what, which game; no hashtags>",
"puntos":<0–100, real viral potential of THIS clip for a US/UK audience>,"porque":"<one sentence in Spanish: what happens and why it hooks>"}`;
}

// Subtítulos karaoke (.ass) del tramo: grupos de 3 palabras, la palabra que suena en amarillo, sobre la junta juego/cara.
function assKaraoke(segmentos, ini, fin, y, { desde = 0, hasta = Infinity } = {}) {
  const pal = palabrasDelClip(segmentos, ini, fin).filter((p) => p.t >= desde && p.t < hasta);
  const t = (s) => { const cs = Math.max(0, Math.round(s * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const limpia = (w) => w.replace(/[{}\\]/g, '').toUpperCase();
  const ev = [];
  for (let g = 0; g < pal.length; g += 3) {
    const grupo = pal.slice(g, g + 3);
    grupo.forEach((p, i) => {
      const fin2 = grupo[i + 1] ? grupo[i + 1].t : (pal[g + 3] ? Math.min(pal[g + 3].t, p.f + 0.6) : p.f + 0.6);
      const txt = grupo.map((q, j) => (j === i ? `{\\c&H3FD2FF&}${limpia(q.w)}{\\c&HFFFFFF&}` : limpia(q.w))).join(' ');
      ev.push(`Dialogue: 0,${t(p.t)},${t(fin2)},K,,0,0,0,,{\\pos(540,${y})}${txt}`);
    });
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`
    + `Style: K,Montserrat ExtraBold,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,5,40,40,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev.join('\n')}\n`;
}

// Dónde están la webcam del creador y su cara en la grabación (Gemini, cajas 0–1000 sobre 2 fotogramas). Devuelve
// { cam: [x, y, w, h], cara: [x, y, w, h] } en píxeles de la grabación, o null si no hay webcam.
// Webcam del tramo exacto de un clip (OpenCV, 16 fotogramas de [inicio-20, fin+20]). Devuelve {cam, cara}, 'pantalla'
// (la cámara ocupa toda la imagen en ese clip) o null (no concluyente: se usa la del tramo).
async function webcamDelClip(fuente, c) {
  const a = Math.max(0, c.inicio - 20), b = c.fin + 20;
  const ts = Array.from({ length: 16 }, (_, i) => (a + (b - a) * (i + 0.5) / 16).toFixed(2));
  const out = await new Promise((ok, mal) => execFile(PYTHON_CV,
    [path.join(RAIZ, 'herramientas', 'webcam_detect.py'), fuente, ts.join(',')], { timeout: 240000, maxBuffer: 1 << 20 },
    (e, so) => (e ? mal(e) : ok(String(so)))));
  const r = JSON.parse(out.trim().split('\n').pop());
  if (r.modo === 'inset' && r.cam && r.confianza >= 0.6) return { cam: r.cam, cara: r.cara || null };
  if (r.modo === 'pantalla') return 'pantalla';
  return null;
}

export async function detectarWebcam(fuente, tiempos = [60, 300]) {
  const m = await medir(fuente);
  // 1) Detector determinista (OpenCV): el recuadro de la cámara es la zona fija y estable que contiene la cara.
  //    16 fotogramas repartidos ±2 min alrededor de los tiempos pedidos.
  try {
    const dur = m.dur || 0, c = tiempos.reduce((a, b) => a + b, 0) / Math.max(1, tiempos.length);
    const ts = Array.from({ length: 16 }, (_, i) => Math.max(0, Math.min(Math.max(0, dur - 1), c - 120 + i * 16)).toFixed(2));
    const out = await new Promise((ok, mal) => execFile(PYTHON_CV,
      [path.join(RAIZ, 'herramientas', 'webcam_detect.py'), fuente, ts.join(',')], { timeout: 240000, maxBuffer: 1 << 20 },
      (e, so) => (e ? mal(e) : ok(String(so)))));
    const r = JSON.parse(out.trim().split('\n').pop());
    if (r.modo === 'inset' && r.cam && r.confianza >= 0.6) return { cam: r.cam, cara: r.cara || null };
  } catch (e) { console.error('Clips: webcam (OpenCV):', String(e.message).slice(0, 200)); }
  // 2) Respaldo: Gemini sobre 1–2 fotogramas.
  for (const t of tiempos.filter((x) => x < (m.dur || 1e9))) {
    try {
      const img = await fotogramaB64(fuente, t, 1024);
      const r = await gemini('En esta captura de un directo hay (quizá) un recuadro con la webcam del streamer superpuesto al juego. '
        + 'Devuelve solo JSON {"webcam":[ymin,xmin,ymax,xmax] o null,"cara":[ymin,xmin,ymax,xmax] o null} con coordenadas normalizadas 0–1000: '
        + '"webcam" = el recuadro completo de la cámara (sin marcos decorativos ni el nombre); "cara" = la cara de la persona dentro de ese recuadro.', { imagenes: [img], preferir: 'gemini' });
      const caja = (b) => (Array.isArray(b) && b.length === 4 ? [Math.round(b[1] / 1000 * m.w), Math.round(b[0] / 1000 * m.h), Math.round((b[3] - b[1]) / 1000 * m.w), Math.round((b[2] - b[0]) / 1000 * m.h)] : null);
      const cam = caja(r.webcam), cara = caja(r.cara);
      if (cam && cam[2] > 40 && cam[3] > 40 && cam[2] < m.w * 0.9) return { cam, cara: cara && cara[2] > 10 ? cara : null };
    } catch {}
  }
  return null;
}

// Cambia el texto fijo de arriba de un clip ya montado con el encuadre propio («juego+cara»): tapa la franja 0–BANDA (mismo
// fondo) y escribe el gancho nuevo, salvo en los 3 últimos segundos (ahí está el cierre). Sustituye c.final.
export async function cambiarGancho(c, texto) {
  if (!c.final || !existsSync(c.final) || !['juego+cara', 'juego+zoom'].includes(c.encuadre)) return false; // en «cara+juego» el gancho va sobre la cara: se cambia al volver a montar
  const { dur } = await medir(c.final); if (!dur) return false;
  const dir = path.dirname(c.final), base = path.basename(c.final, '.mp4') + '.g2';
  const escF = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const lineas = lineasGancho(texto), tam = lineas.length > 2 ? 62 : 70, alto = lineas.length * (tam + 14), hasta = Math.max(1, dur - 3).toFixed(2);
  const capas = [`drawbox=x=0:y=0:w=${W}:h=${BANDA}:color=0x0b0b0f:t=fill:enable='lt(t,${hasta})'`, ...lineas.map((l, i) => {
    const f = path.join(dir, `${base}.${i}.txt`); writeFileSync(f, l);
    return `drawtext=fontfile='${escF(FUENTE_TXT())}':textfile='${escF(f)}':fontsize=${tam}:fontcolor=white:x=(w-text_w)/2:y=${Math.round((BANDA - alto) / 2 + i * (tam + 14))}:enable='lt(t,${hasta})'`; })];
  const tmp = path.join(dir, `${base}.mp4`);
  try {
    await ffmpeg(['-i', c.final, '-vf', capas.join(','), '-map', '0:v', '-map', '0:a?', ...CODIF, tmp]);
    renameSync(tmp, c.final); c.gancho = texto; return true;
  } finally { for (const f of readdirSync(dir).filter((x) => x.startsWith(base + '.'))) rmSync(path.join(dir, f), { force: true }); }
}

// Parte el gancho en 1–3 líneas de ~20 caracteres.
function lineasGancho(t) {
  const out = []; let cur = '';
  for (const w of String(t || '').toUpperCase().split(/\s+/).filter(Boolean)) { if ((cur + ' ' + w).trim().length > 20 && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur); return out.slice(0, 3);
}

// Zona del juego que se muestra arriba: la grabación sin la webcam. Si la cámara está pegada a un borde, se quitan las
// columnas (o filas) que ocupa, lo que menos imagen pierda; el juego queda entre 4:3 y 16:9 (se recorta el centro si
// hace falta). Devuelve [x, y, w, h] en píxeles de la grabación (la imagen entera si no hay webcam o no se puede).
export function recorteJuego(m, cam) {
  const todo = [0, 0, m.w, m.h];
  if (!cam || !m.w || !m.h) return todo;
  const [bx, by, bw, bh] = cam, M = 0.08;
  const ops = [];
  if (bx <= m.w * M) ops.push({ perd: (bx + bw) / m.w, r: [bx + bw, 0, m.w - bx - bw, m.h] });
  if (bx + bw >= m.w * (1 - M)) ops.push({ perd: (m.w - bx) / m.w, r: [0, 0, bx, m.h] });
  if (by <= m.h * M) ops.push({ perd: (by + bh) / m.h, r: [0, by + bh, m.w, m.h - by - bh] });
  if (by + bh >= m.h * (1 - M)) ops.push({ perd: (m.h - by) / m.h, r: [0, 0, m.w, by] });
  const op = ops.filter((o) => o.perd <= 0.4).sort((a, b) => a.perd - b.perd)[0];
  if (!op) return todo;
  let [x, y, w, h] = op.r;
  if (w / h < 4 / 3) { const nh = Math.round(w * 3 / 4); y += Math.round((h - nh) / 2); h = nh; }
  if (w / h > 16 / 9) { const nw = Math.round(h * 16 / 9); x += Math.round((w - nw) / 2); w = nw; }
  // Un pequeño margen para que no asome el borde decorativo del marco de la cámara.
  const pad = Math.round(m.w * 0.01);
  if (op.r[0] > 0) { x += pad; w -= pad; } else if (op.r[2] < m.w) w -= pad;
  w -= w % 2; h -= h % 2;
  return [Math.max(0, x), Math.max(0, y), w, h];
}

// logo = { archivo, ancho, margen } (perfil de campaña): se reserva una franja entre el juego y la cara (o bajo el juego) y se
// guarda su posición en c.logoPos; la capa del logo se pone al final (ponerLogo), encima de todo.
export async function componerJuegoCara(fuente, c, caja, segmentos, dest, logo = null, { sinCara = false } = {}) {
  const m = await medir(fuente);
  if (!m.w || !m.h) throw new Error('No puedo leer la grabación');
  const dur = +(c.fin - c.inicio).toFixed(2);
  // `caja` = { cam, cara } (detectarWebcam) o [x, y, w, h] (OpenShorts). La zona de la cara mide como mucho lo que da la
  // webcam entera a todo el ancho; si sobra espacio debajo, ahí van los subtítulos (así no tapan la cara).
  let cam = Array.isArray(caja) ? caja : caja?.cam, zoom = false;
  const cara = Array.isArray(caja) ? null : caja?.cara;
  // Panel del juego SIN la webcam (si no, la cara sale dos veces: arriba en pequeño y abajo en grande).
  const g = recorteJuego(m, cam);
  let juegoH = Math.round(W * g[3] / g[2]); juegoH -= juegoH % 2;
  const recJ = `crop=${g[2]}:${g[3]}:${g[0]}:${g[1]},`;
  c.camFuera = !!cam && (g[2] < m.w || g[3] < m.h); // la webcam no aparece en el panel del juego
  const lw = logo ? Math.round(logo.ancho) : 0, lh = logo ? Math.round(lw * (logo.alto_px || 724) / (logo.ancho_px || 2172)) : 0, lm = logo ? (logo.margen ?? 14) : 0;
  const franja = logo ? lh + 2 * lm : 0;
  const caraY = BANDA + juegoH + franja, libre = H - caraY;
  // Streamer sin cámara (avatar): abajo, en vez del fondo vacío, un zoom del centro de la acción que llena el resto de la
  // pantalla; arriba sigue el juego entero (con el avatar). Se reutiliza el panel de la cara con una «cámara» en el centro.
  if (!cam && sinCara) {
    const a = W / libre; let bh = Math.round(m.h * 0.62), bw = Math.round(bh * a);
    if (bw > m.w) { bw = m.w; bh = Math.round(bw / a); }
    cam = [Math.round((m.w - bw) / 2), Math.round((m.h - bh) / 2), bw, bh]; zoom = true;
  }
  if (logo && cam && !zoom) return componerCaraLogoJuego({ fuente, c, cam, cara, recJ, juegoH, logo, segmentos, dest, dur });
  let caraH = cam ? Math.min(libre, Math.round(W * cam[3] / cam[2])) : 0; caraH -= caraH % 2;
  const subY = !cam ? BANDA + 120 + juegoH + franja + 110 : libre - caraH >= 170 ? Math.round(caraY + caraH + (libre - caraH) / 2) : caraY + 10;
  c.logoPos = logo ? { x: Math.round((W - lw) / 2), y: (cam ? BANDA + juegoH : BANDA + 120 + juegoH) + lm, w: lw, h: lh } : null;
  const dir = path.dirname(dest), base = path.basename(dest, '.mp4');
  const fassFile = path.join(dir, `${base}.ass`);
  writeFileSync(fassFile, assKaraoke(segmentos, c.inicio, c.fin, subY));
  const escF = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const fuentes = path.dirname(FUENTE_TXT());
  // Texto de gancho en la franja de arriba (un archivo por línea: sin escapar nada dentro del filtro).
  const lineas = lineasGancho(c.gancho || c.titulo);
  const tam = lineas.length > 2 ? 62 : 70, alto = lineas.length * (tam + 14);
  const textos = lineas.map((l, i) => { const f = path.join(dir, `${base}.g${i}.txt`); writeFileSync(f, l);
    return `drawtext=fontfile='${escF(FUENTE_TXT())}':textfile='${escF(f)}':fontsize=${tam}:fontcolor=white:x=(w-text_w)/2:y=${Math.round((BANDA - alto) / 2 + i * (tam + 14))}`; }).join(',');
  let fc;
  if (cam) {
    // Recorte dentro de la webcam con la proporción de su zona, centrado en la cara (si se sabe dónde está).
    const [bx, by, bw, bh] = cam, prop = W / caraH;
    const fx = cara ? cara[0] + cara[2] / 2 : bx + bw / 2, fy = cara ? cara[1] + cara[3] / 2 : by + bh * 0.4;
    let cw, ch;
    if (bw / bh > prop) { ch = bh; cw = Math.round(bh * prop); } else { cw = bw; ch = Math.round(bw / prop); }
    cw -= cw % 2; ch -= ch % 2;
    const cx = Math.round(Math.min(bx + bw - cw, Math.max(bx, fx - cw / 2))), cy = Math.round(Math.min(by + bh - ch, Math.max(by, fy - ch / 2)));
    fc = `[0:v]split[a][b];[a]${recJ}scale=${W}:${juegoH}:flags=lanczos,setsar=1[juego];[b]crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${caraH}:flags=lanczos,setsar=1[cara];`
      + `color=c=0x0b0b0f:s=${W}x${H}:d=${dur}[fondo];[fondo][juego]overlay=0:${BANDA}[t1];[t1][cara]overlay=0:${caraY},`
      + `drawbox=x=0:y=${caraY - 3}:w=${W}:h=6:color=0xffd23f:t=fill${textos ? ',' + textos : ''},ass='${escF(fassFile)}':fontsdir='${escF(fuentes)}'[v]`;
  } else {
    // Sin webcam detectada: el juego centrado sobre su propia imagen ampliada y difuminada.
    fc = `[0:v]split[a][b];[a]scale=${W}:${juegoH}:flags=lanczos,setsar=1[juego];[b]scale=-2:${H},crop=${W}:${H},boxblur=30:2,eq=brightness=-0.15[fondo];`
      + `[fondo][juego]overlay=0:${BANDA + 120}${textos ? ',' + textos : ''},ass='${escF(fassFile)}':fontsdir='${escF(fuentes)}'[v]`;
  }
  await ffmpeg(['-ss', String(c.inicio), '-t', String(dur), '-i', fuente, '-filter_complex', fc, '-map', '[v]', '-map', '0:a?', '-r', '30', ...CODIF, dest]);
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${base}.g`) && f.endsWith('.txt'))) rmSync(path.join(dir, f), { force: true });
  rmSync(fassFile, { force: true });
  c.encuadre = zoom ? 'juego+zoom' : cam ? 'juego+cara' : 'juego';
}

// Campaña: cara arriba (a todo el ancho, pegada al borde) · logo centrado en el hueco · juego abajo (pegado al borde).
// El gancho sale los primeros segundos en la parte baja del bloque de la cara, con fondo para leerse; después ese sitio es
// de los subtítulos (que no empiezan hasta que se va el gancho ni siguen en los 3 s del cierre). Nada tapa la cara ni el logo.
async function componerCaraLogoJuego({ fuente, c, cam, cara, recJ, juegoH, logo, segmentos, dest, dur }) {
  const lw = Math.round(logo.ancho), lh = Math.round(lw * (logo.alto_px || 724) / (logo.ancho_px || 2172)), lm = logo.margen ?? 14;
  const juegoY = H - juegoH, franja = lh + 2 * lm;
  let caraH = Math.min(Math.round(W * cam[3] / cam[2]), juegoY - franja); caraH -= caraH % 2;
  if (caraH < 400) throw new Error('No caben cara, logo y juego');
  c.logoPos = { x: Math.round((W - lw) / 2), y: Math.round(caraH + (juegoY - caraH - lh) / 2), w: lw, h: lh };
  const GANCHO = +Math.min(3.5, Math.max(1.5, dur * 0.25)).toFixed(2), subY = caraH - 95;
  const dir = path.dirname(dest), base = path.basename(dest, '.mp4'), fassFile = path.join(dir, `${base}.ass`);
  writeFileSync(fassFile, assKaraoke(segmentos, c.inicio, c.fin, subY, { desde: GANCHO, hasta: dur >= 6 ? dur - 3 : Infinity }));
  const escF = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const fuentes = path.dirname(FUENTE_TXT());
  const lineas = lineasGancho(c.gancho || c.titulo), tam = lineas.length > 2 ? 58 : 66, paso = tam + 26, y0 = caraH - 40 - lineas.length * paso;
  const textos = lineas.map((l, i) => { const f = path.join(dir, `${base}.g${i}.txt`); writeFileSync(f, l);
    return `drawtext=fontfile='${escF(FUENTE_TXT())}':textfile='${escF(f)}':fontsize=${tam}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=${y0 + i * paso}:enable='lt(t,${GANCHO})'`; }).join(',');
  // Recorte dentro de la webcam con la proporción de su zona, centrado en la cara.
  const [bx, by, bw, bh] = cam, prop = W / caraH;
  const fx = cara ? cara[0] + cara[2] / 2 : bx + bw / 2, fy = cara ? cara[1] + cara[3] / 2 : by + bh * 0.4;
  let cw, ch; if (bw / bh > prop) { ch = bh; cw = Math.round(bh * prop); } else { cw = bw; ch = Math.round(bw / prop); }
  cw -= cw % 2; ch -= ch % 2;
  const cx = Math.round(Math.min(bx + bw - cw, Math.max(bx, fx - cw / 2))), cy = Math.round(Math.min(by + bh - ch, Math.max(by, fy - ch / 2)));
  const fc = `[0:v]split[a][b];[a]${recJ}scale=${W}:${juegoH}:flags=lanczos,setsar=1[juego];[b]crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${caraH}:flags=lanczos,setsar=1[cara];`
    + `color=c=0x0b0b0f:s=${W}x${H}:d=${dur}[fondo];[fondo][cara]overlay=0:0[t1];[t1][juego]overlay=0:${juegoY}${textos ? ',' + textos : ''},ass='${escF(fassFile)}':fontsdir='${escF(fuentes)}'[v]`;
  try { await ffmpeg(['-ss', String(c.inicio), '-t', String(dur), '-i', fuente, '-filter_complex', fc, '-map', '[v]', '-map', '0:a?', '-r', '30', ...CODIF, dest]); }
  finally { for (const f of readdirSync(dir).filter((x) => x.startsWith(`${base}.g`) && x.endsWith('.txt'))) rmSync(path.join(dir, f), { force: true }); rmSync(fassFile, { force: true }); }
  c.encuadre = 'cara+juego'; c.zonaTexto = caraH; c.camFuera = true;
}

// ---------- cierre: invitación al canal del creador ----------
// En los últimos 3 s, arriba (zona libre en todos los encuadres, por debajo de la interfaz de TikTok/Shorts),
// dos líneas sobre fondo blanco: "Mira sus directos en" / "youtube.com/@canal".
async function anteponerCierre(src, lineas, dest, ys = [236, 330]) {
  const { dur } = await medir(src);
  if (dur < 6) return false;
  const fuente = path.join(path.dirname(ajustes()['clips.salida']), 'fonts', 'Montserrat-ExtraBold.ttf');
  const desde = (dur - 3).toFixed(2);
  const dir = path.dirname(dest);
  // Texto en archivos: así no hay que escapar ":", "@" ni comillas dentro del filtro.
  const filtros = lineas.slice(0, 2).map((t, i) => {
    const f = path.join(dir, `cierre-${i}.txt`);
    writeFileSync(f, t);
    return `drawtext=fontfile='${fuente}':textfile='${f}':fontsize=${i ? 60 : 46}:fontcolor=black:box=1:boxcolor=white@0.96:boxborderw=20:`
      + `x=(w-text_w)/2:y=${i ? ys[1] : ys[0]}:enable='gte(t,${desde})'`;
  }).join(',');
  await ffmpeg(['-i', src, '-vf', filtros, '-map', '0:v', '-map', '0:a?', ...CODIF, dest]);
  return true;
}

// ---------- entrada ----------
// clips: [{n, archivo, inicio, fin, ...}] (de OpenShorts). Devuelve los mismos con `final` (ruta nueva) si se tocaron.
export async function postprocesar({ videoId, tipo, job, clips, logs = [], cierre = null, picos = [], fuenteLocal = null, contexto = '', maxClip = 50, log = console.log, campana = null, momentosIA = [], creador = '', juego = '', segmentos: segmentosDados = null, sinCara = false }) {
  const logo = campana?.logo?.archivo && existsSync(campana.logo.archivo) ? { ...campana.logo, ...(await medirImagen(campana.logo.archivo)) } : null;
  if (campana?.logo?.archivo && !logo) log(`Clips: campaña ${campana.slug}: no encuentro el logo (${campana.logo.archivo})`);
  const cfg = ajustes();
  const origen = path.join(cfg['clips.salida'], job);
  const destDir = path.join(DATOS, 'clips', String(videoId));
  mkdirSync(destDir, { recursive: true });
  let segmentos = [], fuente = null;
  try {
    const meta = JSON.parse(readFileSync(path.join(origen, readdirSync(origen).find((f) => f.endsWith('_metadata.json'))), 'utf8'));
    segmentos = meta.transcript?.segments || [];
    if (meta.source_video) fuente = path.join(origen, path.basename(meta.source_video));
  } catch {}
  if (segmentosDados) segmentos = segmentosDados; // clips cortos: transcripción propia (sin OpenShorts)
  const caja = cajaWebcam(logs);
  // Encuadre propio «juego + cara» (juegos y reacciones con la grabación a mano): ventana ajustada a los picos del chat,
  // clips extra para los picos que nadie recogió, textos verificados con fotogramas y composición desde la grabación.
  const grabacion = [fuenteLocal, fuente].find((f) => f && existsSync(f));
  const propio = ['gaming', 'reaccion'].includes(tipo) && grabacion;
  // Webcam y cara medidas sobre la grabación (la caja de OpenShorts a veces no coincide); si no se puede, la de OpenShorts.
  // Encuadre aprendido del canal (lo último que el editor dejó al editar un clip suyo) antes que detectar otra vez.
  let aprendida = null;
  if (!sinCara && propio) { try { const cid = (await import('../db.mjs')).db.prepare('SELECT canal_id FROM clip_videos WHERE id = ?').get(Number(videoId))?.canal_id; const mm = await medir(grabacion); aprendida = (await import('./automatizaciones.mjs')).webcamAprendida(cid, mm.w, mm.h); } catch {} }
  const webcam = sinCara ? null : aprendida || (propio ? ((await detectarWebcam(grabacion, clips.slice(0, 2).map((c) => (c.inicio + c.fin) / 2)).catch(() => null)) || caja) : caja);
  if (aprendida) log(`Clips: encuadre aprendido del canal (del clip ${aprendida.desde})`);
  if (propio) log(`Clips: webcam ${JSON.stringify(webcam)}`);
  if (propio) {
    const durF = (await medir(grabacion)).dur;
    // Reacciones: movimiento de la cara en su recuadro y exclamaciones en lo que dice, junto a los picos de chat y voz del tramo.
    const cam = Array.isArray(webcam) ? webcam : webcam?.cam;
    let cara = [], palabras = [];
    try { cara = await picosCara(grabacion, cam); } catch (e) { log(`Clips: sin picos de cara (${e.message})`); }
    try { palabras = picosPalabras(segmentos); } catch {}
    picos = combinarPicos(picos, cara, palabras);
    if (picos.length) log(`Clips: picos ${picos.map((p) => `${Math.round(p.t)}s ×${p.intensidad} ${p.tipos.join('+')}`).join(', ')}`);
    if (momentosIA.length) {
      // Solo los momentos que marcó Gemini tras ver el vídeo entero, con su mismo inicio y fin (se montan desde la grabación).
      const nuevos = momentosIA.slice(0, 10).map((m, i) => {
        const ini = Math.max(0, m.inicio_s), fin = Math.min(durF || m.fin_s, m.fin_s);
        const base = clips.map((c) => ({ c, sol: Math.min(c.fin, fin) - Math.max(c.inicio, ini) })).sort((a, b) => b.sol - a.sol)[0];
        return { ...(base?.sol > 0 ? base.c : {}), n: i + 1, archivo: '', final: null, inicio: +ini.toFixed(2), fin: +fin.toFixed(2),
          titulo: m.titulo_sugerido || base?.c?.titulo || '', puntos: m.puntuacion ?? base?.c?.puntos ?? null, porque: m.motivo || '',
          sugerido: { titulo: m.titulo_sugerido || '', juego: m.juego || '', motivo: m.motivo || '' }, pico: undefined, dePico: false };
      }).filter((c) => c.fin - c.inicio >= 8);
      log(`Clips: ${nuevos.length} clip(s) de los momentos de Gemini (OpenShorts había propuesto ${clips.length}; se ignoran)`);
      clips.splice(0, clips.length, ...nuevos);
      for (const c of clips) { const p = (picos || []).filter((x) => x.t >= c.inicio && x.t <= c.fin).sort((a, b) => b.intensidad - a.intensidad)[0]; if (p) c.pico = p; }
    } else {
      for (const c of clips) if (ajustarVentana(c, picos, durF, maxClip)) log(`Clips: clip ${c.n} ajustado al pico de ${c.pico.tipos.join('+')} en ${Math.round(c.pico.t)} s`);
      const extra = clipsDePicos(clips, picos, durF);
      if (extra.length) { clips.push(...extra); log(`Clips: ${extra.length} clip(s) nuevos en picos que nadie había recogido`); }
    }
    for (const c of clips) {
      try { await textosVerificados(c, segmentos, grabacion, contexto, campana?.idioma || 'es', campana?.enfoque || '', { creador, juego }); } catch (e) { log(`Clips: textos del clip ${c.n} sin verificar (${e.message})`); }
      { repasarTextos(c, { creador, juego, idioma: campana?.idioma || 'es' }); conTagsCampana(c, campana); }
    }
    // Los clips de pico que Gemini no ve con potencial se descartan (no se montan).
    for (let i = clips.length - 1; i >= 0; i--) if (clips[i].dePico && (clips[i].puntos ?? 0) < 60) clips.splice(i, 1);
  } else if (momentosIA.length) {
    // Sin grabación propia no se pueden cortar tramos nuevos: solo quedan los clips de OpenShorts que caen en un momento de Gemini.
    const antes = clips.length;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i], d = Math.max(1, c.fin - c.inicio);
      if (!momentosIA.some((m) => (Math.min(c.fin, m.fin_s) - Math.max(c.inicio, m.inicio_s)) / d >= 0.4)) clips.splice(i, 1);
    }
    log(`Clips: ${clips.length} de ${antes} clips coinciden con los momentos de Gemini`);
    for (const c of clips) { repasarTextos(c, { creador, juego, idioma: campana?.idioma || 'es' }); conTagsCampana(c, campana); }
  }

  let ganchos = {};
  if (cfg['clips.gancho'] && segmentos.length) {
    try { ganchos = await elegirGanchos(clips, segmentos); log(`Clips: ganchos elegidos para ${Object.keys(ganchos).length} de ${clips.length} clips`); }
    catch (e) { log(`Clips: sin ganchos (${e.message})`); }
  }

  const montar = async (c, op = {}) => {
    let actual = path.join(origen, c.archivo || '-');
    const pasos = [];
    c.logoPos = null;
    // 0. encuadre propio desde la grabación (sustituye al clip de OpenShorts)
    let wcClip = op.webcam || webcam;
    if (sinCara) wcClip = null; // sin cámara: nada que buscar (el avatar no es una webcam)
    else if (propio && !op.webcam && !op.sinEncuadre) {
      try { const r = await webcamDelClip(grabacion, c); if (r) wcClip = r; log(`Clips: webcam del clip ${c.n}: ${JSON.stringify(r)}`); }
      catch (e) { log(`Clips: webcam del clip ${c.n} sin medir (${String(e.message).slice(0, 120)})`); }
    }
    if (propio && !op.sinEncuadre && wcClip !== 'pantalla') {
      try {
        const tmp = path.join(destDir, `${c.n}.base.mp4`);
        await componerJuegoCara(grabacion, c, wcClip, segmentos, tmp, logo, { sinCara });
        actual = tmp; pasos.push('encuadre');
      } catch (e) { log(`Clips: encuadre propio del clip ${c.n} falló (${e.message}); queda el de OpenShorts`); }
    }
    if (!existsSync(actual)) return;
    // 1. cara de cerca en las pausas (solo reacciones con el encuadre de OpenShorts)
    if (cfg['clips.zoom_pausa'] && tipo === 'reaccion' && !pasos.includes('encuadre')) {
      try {
        let layout = null;
        const lj = path.join(origen, c.archivo.replace(/^(subtitled_\d+_|hooked_\d+_)+/, '') + '.layout.json');
        if (existsSync(lj)) layout = JSON.parse(readFileSync(lj, 'utf8'));
        const tmp = path.join(destDir, `${c.n}.zoom.mp4`);
        const hecho = await acercarCara(actual, layout, caja, fuente, tmp);
        if (hecho) { actual = tmp; pasos.push('zoom'); c.pausas = hecho.map(([a, b]) => [+a.toFixed(1), +Math.min(b, c.fin - c.inicio).toFixed(1)]); }
      } catch (e) { log(`Clips: zoom del clip ${c.n} falló (${e.message})`); }
    }
    // 2. gancho al principio
    const g = ganchos[c.n];
    if (g) {
      try {
        const tmp = path.join(destDir, `${c.n}.gancho.mp4`);
        await anteponerGancho(actual, g, tmp);
        actual = tmp; pasos.push('gancho'); c.coldOpen = g;
      } catch (e) { log(`Clips: gancho del clip ${c.n} falló (${e.message})`); }
    }
    // 3. cierre con invitación al canal del creador
    if (cierre?.length) {
      try {
        const tmp = path.join(destDir, `${c.n}.cierre.mp4`);
        if (await anteponerCierre(actual, cierre, tmp, c.encuadre === 'cara+juego' && c.zonaTexto ? [c.zonaTexto - 250, c.zonaTexto - 150] : undefined)) { actual = tmp; pasos.push('cierre'); }
      } catch (e) { log(`Clips: cierre del clip ${c.n} falló (${e.message})`); }
    }
    // 4. logo de la campaña: la última capa, del primer al último fotograma (nada puede taparlo).
    if (logo) {
      const pos = c.logoPos || { x: Math.round((W - logo.ancho) / 2), y: 860, w: Math.round(logo.ancho), h: Math.round(logo.ancho * logo.alto_px / logo.ancho_px) };
      try {
        const tmp = path.join(destDir, `${c.n}.logo.mp4`);
        await ffmpeg(['-i', actual, '-i', logo.archivo, '-filter_complex', `[1:v]scale=${pos.w}:${pos.h}:flags=lanczos,format=rgba[l];[0:v][l]overlay=${pos.x}:${pos.y}:format=auto:eof_action=repeat[v]`,
          '-map', '[v]', '-map', '0:a?', ...CODIF, tmp]);
        actual = tmp; pasos.push('logo'); c.logoPos = pos;
      } catch (e) { log(`Clips: logo del clip ${c.n} falló (${e.message})`); c.logoPos = null; }
    }
    if (pasos.length) {
      const final = path.join(destDir, `${String(c.n).padStart(2, '0')}${op.sufijo || ''}.mp4`);
      renameSync(actual, final);
      for (const f of [`${c.n}.base.mp4`, `${c.n}.zoom.mp4`, `${c.n}.gancho.mp4`, `${c.n}.cierre.mp4`, `${c.n}.logo.mp4`, 'cierre-0.txt', 'cierre-1.txt']) rmSync(path.join(destDir, f), { force: true });
      c.final = final; c.post = pasos;
    }
  };
  for (const c of clips) await montar(c);
  // Revisión automática del encuadre (capa extra pedida por el editor): cara en su panel, sin cortar y sin franjas negras.
  const archivoDe = (c) => (c.final && existsSync(c.final) ? c.final : (c.archivo && existsSync(path.join(origen, c.archivo)) ? path.join(origen, c.archivo) : null));
  const revisar = async (c) => {
    const f = archivoDe(c); if (!f) return null;
    // Canal sin cámara (avatar, p. ej. TheBurntPeanut): no se exige cara, solo que no haya franjas negras.
    const modo = sinCara ? 'libre' : (c.post || []).includes('encuadre') ? (c.camFuera ? 'abajo-sincam' : 'abajo') : tipo === 'reaccion' ? 'cara' : 'libre';
    try {
      const salida = await new Promise((ok, mal) => execFile(path.join(RAIZ, '..', 'estudio', 'venv-cv', 'bin', 'python'), [path.join(RAIZ, 'herramientas', 'qa_encuadre.py'), f, modo],
        { timeout: 90000 }, (e, so) => (e ? mal(e) : ok(so))));
      return { ...JSON.parse(String(salida).trim().split('\n').pop()), modo };
    } catch (e) { log(`Clips: revisión de encuadre del clip ${c.n} falló (${e.message})`); return null; }
  };
  for (const c of clips) {
    c.qa = await revisar(c);
    if (!c.qa || c.qa.ok) continue;
    log(`Clips: el clip ${c.n} no pasa la revisión de encuadre (${c.qa.motivo}); se intenta rehacer`);
    const intentos = [];
    if ((c.post || []).includes('encuadre') && webcam && webcam !== 'pantalla') intentos.push({ webcam, sufijo: '-w', etiqueta: 'webcam del vídeo entero' });
    // El encuadre de OpenShorts NO es un arreglo en juegos/reacciones: corta la cara contra el borde, pone los subtítulos
    // encima y repite la webcam, y la revisión en modo «cara» no lo detecta (DaniRep y Willyrex, 21-22 nov). Si nuestro
    // encuadre no pasa, el clip se queda con qa.ok = false (no se publica solo) y lo decide el editor.
    if (!propio || !(c.post || []).includes('encuadre')) intentos.push({ sinEncuadre: true, sufijo: '-o', etiqueta: 'encuadre de OpenShorts' });
    const antes = { final: c.final, post: c.post, qa: c.qa };
    for (const op of intentos) {
      c.final = null; c.post = [];
      try { await montar(c, op); } catch (e) { log(`Clips: reintento «${op.etiqueta}» del clip ${c.n} falló (${e.message})`); }
      const q = await revisar(c);
      if (q?.ok) {
        if (antes.final && antes.final !== c.final) rmSync(antes.final, { force: true });
        c.qa = { ...q, arreglado: op.etiqueta }; log(`Clips: clip ${c.n} arreglado con ${op.etiqueta}`); break;
      }
      if (c.final && c.final !== antes.final) rmSync(c.final, { force: true });
      Object.assign(c, { final: antes.final, post: antes.post, qa: antes.qa });
    }
  }
  // Textos sin verificar (la IA no respondió): el clip no se publica solo, aunque el encuadre esté bien.
  if (propio) for (const c of clips) if (!c.verificado && c.qa) c.qa = { ...c.qa, ok: false, motivo: [c.qa.motivo, 'textos sin verificar (la IA no respondió)'].filter(Boolean).join('; ') };
  // Revisión del logo (campañas): presente, sin deformar y sin tapar en el primer y el último fotograma y cada 2 s.
  if (logo) for (const c of clips) {
    const f = archivoDe(c);
    if (!f || !c.logoPos || !(c.post || []).includes('logo')) { c.qaLogo = { ok: false, motivo: 'sin capa de logo' }; continue; }
    try {
      const so = await new Promise((ok, mal) => execFile(path.join(RAIZ, '..', 'estudio', 'venv-cv', 'bin', 'python'),
        [path.join(RAIZ, 'herramientas', 'qa_logo.py'), f, logo.archivo, String(c.logoPos.x), String(c.logoPos.y), String(c.logoPos.w), String(c.logoPos.h)],
        { timeout: 180000 }, (e, o) => (e ? mal(e) : ok(o))));
      c.qaLogo = JSON.parse(String(so).trim().split('\n').pop());
    } catch (e) { c.qaLogo = { ok: false, motivo: `revisión fallida: ${String(e.message).slice(0, 120)}` }; }
    if (!c.qaLogo.ok) log(`Clips: el clip ${c.n} NO pasa la revisión del logo (${c.qaLogo.motivo}): no se publicará solo`);
  }
  // Un clip de pico que no se pudo montar no tiene archivo: fuera.
  for (let i = clips.length - 1; i >= 0; i--) if (!clips[i].final && !clips[i].archivo) clips.splice(i, 1);
  return clips;
}

// Logo de campaña en un clip ya montado (lo usa el editor al renderizar: fallo 3) + su revisión.
// Devuelve { logoPos, qaLogo }; el vídeo `f` se reescribe con el logo encima.
export async function ponerLogoYRevisar(f, logoCfg, posPrevia = null) {
  if (!logoCfg?.archivo || !existsSync(logoCfg.archivo)) return { logoPos: null, qaLogo: { ok: false, motivo: 'la campaña no tiene logo' } };
  const logo = { ...logoCfg, ...(await medirImagen(logoCfg.archivo)) };
  const pos = posPrevia || { x: Math.round((W - logo.ancho) / 2), y: 860, w: Math.round(logo.ancho), h: Math.round(logo.ancho * logo.alto_px / logo.ancho_px) };
  const tmp = f.replace(/\.mp4$/, '.logo.mp4');
  await ffmpeg(['-i', f, '-i', logo.archivo, '-filter_complex', `[1:v]scale=${pos.w}:${pos.h}:flags=lanczos,format=rgba[l];[0:v][l]overlay=${pos.x}:${pos.y}:format=auto:eof_action=repeat[v]`,
    '-map', '[v]', '-map', '0:a?', ...CODIF, tmp]);
  renameSync(tmp, f);
  let qaLogo;
  try {
    const so = await new Promise((ok, mal) => execFile(path.join(RAIZ, '..', 'estudio', 'venv-cv', 'bin', 'python'),
      [path.join(RAIZ, 'herramientas', 'qa_logo.py'), f, logo.archivo, String(pos.x), String(pos.y), String(pos.w), String(pos.h)], { timeout: 180000 }, (e, o) => (e ? mal(e) : ok(o))));
    qaLogo = JSON.parse(String(so).trim().split('\n').pop());
  } catch (e) { qaLogo = { ok: false, motivo: `revisión fallida: ${String(e.message).slice(0, 120)}` }; }
  return { logoPos: pos, qaLogo };
}
