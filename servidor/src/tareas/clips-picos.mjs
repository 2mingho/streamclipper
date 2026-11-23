// Picos del chat de un directo: dónde se dispararon los comentarios. El chat reacciona tarde (latencia del directo +
// lo que se tarda en escribir), así que lo que provocó un pico pasó unos 10–20 s antes: los clips deben empezar ahí.
// El chat se graba con yt-dlp junto al directo (<grabación>.live_chat.json, una línea JSON por mensaje o lote).
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';

// Mensajes del chat con su segundo dentro de la grabación (t) y su texto.
export function leerChat(archivo, inicioEpoch) {
  if (!archivo || !existsSync(archivo)) return [];
  const out = [];
  for (const l of readFileSync(archivo, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    for (const a of j.replayChatItemAction?.actions || []) {
      const r = a.addChatItemAction?.item?.liveChatTextMessageRenderer || a.addChatItemAction?.item?.liveChatPaidMessageRenderer;
      if (!r?.timestampUsec) continue;
      const texto = (r.message?.runs || []).map((x) => x.text || (x.emoji ? x.emoji.shortcuts?.[0] || '' : '')).join('').trim();
      out.push({ t: Number(r.timestampUsec) / 1e6 - inicioEpoch, texto, pago: !!a.addChatItemAction.item.liveChatPaidMessageRenderer });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// Picos dentro de [desde, hasta) (segundos de la grabación), en segundos relativos a `desde`.
// Ventanas de 5 s suavizadas; un pico es una ventana claramente por encima de lo normal en ese tramo, separado de otros 45 s.
export function picosChat(mensajes, desde, hasta, { max = 8 } = {}) {
  const msj = mensajes.filter((m) => m.t >= desde && m.t < hasta);
  if (msj.length < 30) return [];
  const paso = 5, n = Math.ceil((hasta - desde) / paso), bins = new Array(n).fill(0);
  for (const m of msj) bins[Math.min(n - 1, Math.floor((m.t - desde) / paso))] += m.pago ? 3 : 1;
  const suave = bins.map((_, i) => (bins[i - 1] || 0) * 0.25 + bins[i] * 0.5 + (bins[i + 1] || 0) * 0.25);
  const orden = [...suave].sort((a, b) => a - b), mediana = orden[Math.floor(n / 2)] || 0;
  const media = suave.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(suave.reduce((a, b) => a + (b - media) ** 2, 0) / n);
  const umbral = Math.max(mediana * 1.8, media + 1.2 * sd, 4);
  const candidatos = suave.map((v, i) => ({ i, v })).filter((x) => x.v >= umbral && x.v >= (suave[x.i - 1] || 0) && x.v >= (suave[x.i + 1] || 0)).sort((a, b) => b.v - a.v);
  const elegidos = [];
  for (const c of candidatos) { if (elegidos.every((e) => Math.abs(e.i - c.i) * paso >= 45)) elegidos.push(c); if (elegidos.length >= max) break; }
  return elegidos.sort((a, b) => a.i - b.i).map((c) => {
    const t = c.i * paso + paso / 2, abs = desde + t;
    const muestra = msj.filter((m) => m.t >= abs - 6 && m.t <= abs + 8 && m.texto).slice(0, 12).map((m) => m.texto.slice(0, 80));
    return { t: Math.round(t), intensidad: +(c.v / Math.max(1, mediana)).toFixed(1), muestra };
  });
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Texto para el enfoque de Gemini (OpenShorts): los picos como momentos prioritarios.
export function enfoquePicos(picos) {
  if (!picos?.length) return '';
  return 'MOMENTOS CLAVE según el chat del directo (picos de comentarios; el chat reacciona con 10–20 s de retraso): '
    + picos.map((p) => `${mmss(p.t)} (×${p.intensidad}${p.muestra[0] ? `, el chat decía: «${p.muestra.slice(0, 3).join(' / ')}»` : ''})`).join('; ')
    + '. Prioriza clips que contengan estos momentos y que EMPIECEN entre 10 y 20 segundos ANTES de cada pico, para que se vea qué lo provocó; el clip debe terminar después de la reacción.';
}

// ---------- reacciones del streamer (sin API: audio, cara y palabras) ----------
// Una risa exagerada, un grito, un enfado o una sorpresa se notan en tres sitios a la vez: el volumen de la voz sube de
// golpe, la cara se mueve mucho en su recuadro y en la transcripción aparecen exclamaciones. Cada señal da picos con
// { t (s del tramo), intensidad, tipo }; combinadas, las que coinciden pesan más. La reacción es instantánea, así que lo
// que la provocó está unos 8–12 s antes (en el chat, 15–22 s).
const ffmpegTexto = (args, timeout = 900000) => new Promise((ok, mal) => execFile('nice', ['-n', '10', 'ffmpeg', '-hide_banner', '-nostdin', ...args], { timeout, maxBuffer: 256 << 20 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-300))) : ok(String(so) + String(se)))));

// Serie (t, valor) → picos: valor muy por encima de su entorno (mediana de ±30 s), separados 30 s.
function picosSerie(serie, { umbral, max = 10, tipo, escala = 1 }) {
  if (serie.length < 20) return [];
  const paso = serie[1].t - serie[0].t || 0.5, ventana = Math.round(30 / paso);
  const res = serie.map((p, i) => {
    const vecinos = serie.slice(Math.max(0, i - ventana), i + ventana).map((x) => x.v).sort((a, b) => a - b);
    return { t: p.t, d: p.v - vecinos[Math.floor(vecinos.length / 2)] };
  });
  const cand = res.filter((p, i) => p.d >= umbral && p.d >= (res[i - 1]?.d ?? -1e9) && p.d >= (res[i + 1]?.d ?? -1e9)).sort((a, b) => b.d - a.d);
  const out = [];
  for (const c of cand) { if (out.every((o) => Math.abs(o.t - c.t) >= 30)) out.push(c); if (out.length >= max) break; }
  return out.map((c) => ({ t: Math.round(c.t), intensidad: +(1 + (c.d - umbral) / umbral * escala).toFixed(1), tipo }));
}

// Volumen (RMS en dB cada 0,5 s) del tramo [desde, desde+dur) del archivo. Un grito o una carcajada sube 8 dB o más sobre
// lo normal de su entorno (el entorno incluye el juego, así que una explosión sola rara vez basta: se confirma con las otras señales).
export async function picosVoz(archivo, desde = 0, dur = null) {
  const out = await ffmpegTexto(['-ss', String(desde), ...(dur ? ['-t', String(dur)] : []), '-i', archivo, '-vn', '-ac', '1', '-ar', '16000',
    '-af', 'astats=metadata=1:reset=1:length=0.5,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-']);
  const serie = []; let t = null;
  for (const l of out.split('\n')) {
    let m;
    if ((m = l.match(/pts_time:([\d.]+)/))) t = Number(m[1]);
    else if ((m = l.match(/RMS_level=(-?[\d.]+|-inf)/)) && t != null) serie.push({ t, v: m[1] === '-inf' ? -90 : Math.max(-90, Number(m[1])) });
  }
  return picosSerie(serie, { umbral: 8, tipo: 'voz' });
}

// Movimiento dentro del recuadro de la webcam (cambio entre fotogramas, 5 por segundo). `cam` = [x, y, w, h].
export async function picosCara(archivo, cam, desde = 0, dur = null) {
  if (!cam) return [];
  const [x, y, w, h] = cam.map((n) => Math.round(n));
  const out = await ffmpegTexto(['-ss', String(desde), ...(dur ? ['-t', String(dur)] : []), '-i', archivo, '-an',
    '-vf', `fps=5,crop=${w}:${h}:${x}:${y},scale=96:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-`, '-f', 'null', '-']);
  const crudo = []; let t = null;
  for (const l of out.split('\n')) {
    let m;
    if ((m = l.match(/pts_time:([\d.]+)/))) t = Number(m[1]);
    else if ((m = l.match(/scene_score=([\d.]+)/)) && t != null) crudo.push({ t, v: Number(m[1]) * 100 });
  }
  // Media por medio segundo (los movimientos bruscos duran varios fotogramas).
  const serie = [];
  for (let i = 0; i < crudo.length; i += 2.5) { const g = crudo.slice(Math.floor(i), Math.floor(i + 2.5)); if (g.length) serie.push({ t: g[0].t, v: g.reduce((a, b) => a + b.v, 0) / g.length }); }
  return picosSerie(serie, { umbral: 6, tipo: 'cara' });
}

// Exclamaciones en la transcripción (segmentos de Whisper con palabras): risas, sorpresa, enfado.
const EXCLAMA = /^(ja(ja)+|je(je)+|jsjs\w*|ay+|wow+|guau|uff+|no+|qu[eé]+|dios|diablo|co[ñn]o|mierda|carajo|mano|loco|brutal|increíble|hermano|mira|espera|oye|madre|joder|what|bro)$/i;
export function picosPalabras(segmentos) {
  const ws = [];
  for (const s of segmentos || []) for (const w of s.words || []) ws.push({ t: w.start, w: String(w.word).toLowerCase().replace(/[^\wáéíóúñü]/g, '') });
  if (ws.length < 30) return [];
  const fin = ws.at(-1).t, serie = [];
  for (let t = 0; t < fin; t += 1) {
    const vent = ws.filter((x) => x.t >= t - 3 && x.t < t + 3);
    const ex = vent.filter((x) => EXCLAMA.test(x.w)).length, rep = vent.length - new Set(vent.map((x) => x.w)).size;
    serie.push({ t, v: ex * 2 + Math.max(0, rep - 2) + (vent.length > 16 ? 1 : 0) });
  }
  return picosSerie(serie, { umbral: 4, tipo: 'palabras', escala: 0.5 });
}

// Une picos de varias señales: los que caen a menos de 6 s se funden (intensidad sumada, tipos juntos).
export function combinarPicos(...listas) {
  const todos = listas.flat().filter(Boolean).sort((a, b) => a.t - b.t), out = [];
  for (const p of todos) {
    const tp = p.tipos || [p.tipo || 'chat'], o = out.find((x) => Math.abs(x.t - p.t) <= 6);
    if (o) { o.intensidad = +(o.intensidad + p.intensidad * 0.8).toFixed(1); o.tipos = [...new Set([...o.tipos, ...tp])]; if (p.muestra?.length) o.muestra = p.muestra; if (!tp.includes('chat')) o.t = Math.min(o.t, p.t); }
    else out.push({ ...p, tipos: tp, muestra: p.muestra || [] });
  }
  // Una reacción confirmada por dos señales vale más que una sola muy alta. La cara sola no cuenta (ajustes de cámara,
  // animaciones del recuadro): tiene que acompañarla la voz o lo que dice.
  for (const o of out) if (o.tipos.length >= 2) o.intensidad = +(o.intensidad * 1.25).toFixed(1);
  return out.filter((o) => !(o.tipos.length === 1 && o.tipos[0] === 'cara')).sort((a, b) => b.intensidad - a.intensidad).slice(0, 10).sort((a, b) => a.t - b.t);
}
// Cuánto antes del pico empieza lo que lo provocó: el chat va tarde; la voz y la cara reaccionan al momento.
export const antelacion = (p) => ((p.tipos || [p.tipo]).every((x) => x === 'chat' || !x) ? [15, 22] : [8, 12]);

// Texto para el enfoque de OpenShorts con las reacciones (además de los picos de chat).
export function enfoqueReacciones(picos) {
  const r = (picos || []).filter((p) => (p.tipos || []).some((x) => x !== 'chat'));
  if (!r.length) return '';
  return 'REACCIONES FUERTES DEL STREAMER detectadas en el audio (gritos, carcajadas, sorpresa): '
    + r.map((p) => `${mmss(p.t)} (×${p.intensidad})`).join(', ')
    + '. Son los mejores candidatos: risas exageradas, enfados, sustos y sorpresas. El clip debe empezar unos 8–12 s antes para mostrar qué las provocó y terminar después de la reacción.';
}
