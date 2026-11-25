// IA para las tareas de clips (títulos, texto en pantalla, descripciones, webcam). Proveedores, en este orden:
//   · Tu propio modelo: cualquier servidor compatible con la API de OpenAI (Ollama, LM Studio, llama-server, OpenRouter,
//     OpenAI, DeepSeek, Mistral…). Si está configurado va primero; los demás quedan de respaldo.
//   · Groq y Gemini (el orden entre ellos lo decide cada tarea). Gemini tiene un tope diario propio (ia.gemini_max_dia).
// Todo se configura desde la app (Ajustes › IA). Claves (GROQ_API_KEY, GEMINI_API_KEY, PROPIO_API_KEY) en
// ~/.config/streamclipper/claves.env (permisos 600), en el .env de OpenShorts o en variables de entorno; nunca en la base de datos.
import { readFileSync , mkdirSync, writeFileSync, chmodSync , existsSync } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { db, ajustes, guardarAjustes } from './db.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS ia_uso (dia TEXT NOT NULL, proveedor TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, fallos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, proveedor))`);

const GROQ_TEXTO = 'openai/gpt-oss-120b'; // probado el 22-nov-2026 con clips reales: el mejor en textos
const GROQ_VISION = 'qwen/qwen3.8-27b'; // el único de la cuenta que acepta imágenes (22-nov-2026)
const GEMINI = 'gemini-3.1-flash-lite';

function leerEnv(f) { try { return readFileSync(f, 'utf8'); } catch { return ''; } }
function clave(nombre) {
  const fuentes = [path.join(os.homedir(), '.config', 'streamclipper', 'claves.env'), path.join(path.dirname(ajustes()['clips.salida'] || '/nada'), '.env')];
  for (const f of fuentes) { const m = leerEnv(f).match(new RegExp(`^${nombre}=(.+)$`, 'm')); if (m && m[1].trim()) return m[1].trim(); }
  return process.env[nombre] || '';
}
const hoy = () => new Date().toLocaleDateString('sv');
function contar(proveedor, fallo = false) {
  db.prepare('INSERT INTO ia_uso (dia, proveedor, n, fallos) VALUES (?, ?, ?, ?) ON CONFLICT(dia, proveedor) DO UPDATE SET n = n + excluded.n, fallos = fallos + excluded.fallos')
    .run(hoy(), proveedor, fallo ? 0 : 1, fallo ? 1 : 0);
}
export const claveGroq = () => clave('GROQ_API_KEY');
export const contarUso = (proveedor, fallo = false) => contar(proveedor, fallo);
export function usoHoy() {
  const filas = db.prepare('SELECT proveedor, n, fallos FROM ia_uso WHERE dia = ?').all(hoy());
  const de = (p) => filas.find((f) => f.proveedor === p) || { n: 0, fallos: 0 };
  return { groq: de('groq'), gemini: de('gemini'), propio: de('propio'), geminiMax: Number(ajustes()['ia.gemini_max_dia'] ?? 30), groqConfigurado: !!clave('GROQ_API_KEY'), geminiConfigurado: !!clave('GEMINI_API_KEY'), propioConfigurado: propioConfigurado() };
}
// JSON de la respuesta. Los modelos locales a menudo lo envuelven en ```json, en texto o en <think>…</think>: se busca el objeto.
function json(txt) {
  const s = String(txt || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*```(?:json)?|```\s*$/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  throw new Error(`la respuesta no es JSON: ${s.slice(0, 120)}`);
}
// Escribe (o quita) una clave en claves.env (600) sin tocar las demás.
function guardarClave(nombre, valor) {
  const f = path.join(os.homedir(), '.config', 'streamclipper', 'claves.env');
  const resto = leerEnv(f).split('\n').filter((l) => l.trim() && !l.startsWith(`${nombre}=`));
  if (valor) resto.push(`${nombre}=${valor}`);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, resto.join('\n') + '\n', { mode: 0o600 }); try { chmodSync(f, 0o600); } catch {}
}

// ---------- Tu propio modelo (API compatible con OpenAI) ----------
// Direcciones listas para elegir en la app. La de cada servicio es la «base» de su API (la que termina en /v1 o similar).
export const PRESETS = [
  { id: 'ollama', nombre: 'Ollama (en tu equipo)', url: 'http://127.0.0.1:11434/v1', clave: false, ejemplo: 'qwen3:8b' },
  { id: 'lmstudio', nombre: 'LM Studio (en tu equipo)', url: 'http://127.0.0.1:1234/v1', clave: false, ejemplo: '' },
  { id: 'llamacpp', nombre: 'llama-server (llama.cpp)', url: 'http://127.0.0.1:8080/v1', clave: false, ejemplo: '' },
  { id: 'openrouter', nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', clave: true, ejemplo: 'google/gemini-2.5-flash' },
  { id: 'openai', nombre: 'OpenAI', url: 'https://api.openai.com/v1', clave: true, ejemplo: 'gpt-4.1-mini' },
  { id: 'deepseek', nombre: 'DeepSeek', url: 'https://api.deepseek.com/v1', clave: true, ejemplo: 'deepseek-chat' },
  { id: 'mistral', nombre: 'Mistral', url: 'https://api.mistral.ai/v1', clave: true, ejemplo: 'mistral-small-latest' },
  { id: 'otro', nombre: 'Otro (compatible con OpenAI)', url: '', clave: true, ejemplo: '' },
];
// Acepta la dirección como la pegue la gente: con o sin /v1, con /chat/completions al final, sin http://…
export function baseOpenAI(url) {
  let u = String(url || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|completions|models)$/i, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `${/^(localhost|127\.|192\.168\.|10\.|\[?::1)/i.test(u) ? 'http' : 'https'}://${u}`;
  if (!/\/v\d+[a-z]*$/i.test(u) && !/\/openai$/i.test(u) && !/\/api\/v\d/i.test(u)) u += '/v1';
  return u;
}
const propioCfg = () => { const a = ajustes(); return { url: baseOpenAI(a['ia.propio_url']), modelo: String(a['ia.propio_modelo'] || '').trim(), vision: a['ia.propio_vision'] === true, clave: clave('PROPIO_API_KEY') }; };
export const propioConfigurado = () => { const c = propioCfg(); return !!(c.url && c.modelo); };

// Mensajes de error que entienda cualquiera (son los que ve la gente al pulsar «Guardar y probar»).
function errorModelo(url, e, status = 0, txt = '') {
  if (status === 401 || status === 403) return new Error('El servicio rechaza la clave de API (revísala o crea otra)');
  if (status === 404) return new Error(`No encontrado en ${url}: revisa la dirección y el nombre del modelo${/model/i.test(txt) ? ` (${txt.slice(0, 120)})` : ''}`);
  if (status === 429) return new Error('El servicio dice que has superado tu cupo (429): espera o revisa tu plan');
  if (status) return new Error(`Tu modelo respondió ${status}: ${txt.slice(0, 200)}`);
  const m = String(e?.cause?.code || e?.code || e?.name || e?.message || '');
  if (/ECONNREFUSED/.test(m)) return new Error(`Nada responde en ${url}: ¿está abierto el programa del modelo (Ollama, LM Studio…)? Si corre en otro equipo, usa su IP en vez de 127.0.0.1`);
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return new Error(`No se encuentra la dirección ${url}`);
  if (/Timeout|AbortError/i.test(m)) return new Error('Tu modelo tardó demasiado en contestar (más de 5 min): prueba uno más pequeño');
  return new Error(`No se pudo hablar con tu modelo: ${String(e?.message || e).slice(0, 160)}`);
}

export async function modelosPropio({ url, clave: k } = {}) {
  const base = baseOpenAI(url ?? propioCfg().url); if (!base) throw new Error('Escribe la dirección de tu modelo');
  const key = (k && k !== '__guardada__') ? k : clave('PROPIO_API_KEY');
  let r;
  try { r = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw errorModelo(base, e); }
  const txt = await r.text();
  if (!r.ok) throw errorModelo(base, null, r.status, txt);
  let j = {}; try { j = JSON.parse(txt); } catch {}
  return { url: base, modelos: (j.data || j.models || []).map((m) => m.id || m.name).filter((id) => id && !/embed|whisper|tts|rerank/i.test(id)).sort() };
}

async function propio(prompt, imagenes, { soloConImagenes = false, cfg = propioCfg(), timeoutMs = 300000 } = {}) {
  if (!cfg.url || !cfg.modelo) throw new Error('Tu modelo sin configurar');
  // Sin visión: las tareas que solo tienen sentido con imágenes pasan al siguiente proveedor; las demás van solo con texto.
  if (imagenes.length && !cfg.vision) { if (soloConImagenes) throw new Error('Tu modelo sin configurar para imágenes'); imagenes = []; }
  const content = imagenes.length
    ? [...imagenes.slice(0, 5).map((b) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b}` } })), { type: 'text', text: prompt }]
    : prompt;
  const headers = { 'Content-Type': 'application/json', ...(cfg.clave ? { Authorization: `Bearer ${cfg.clave}` } : {}) };
  if (/openrouter\.ai/.test(cfg.url)) Object.assign(headers, { 'HTTP-Referer': 'https://github.com/2mingho/streamclipper', 'X-Title': 'StreamClipper' });
  const pedir = async (conFormato) => {
    const body = { model: cfg.modelo, messages: [{ role: 'user', content }], temperature: 0.4, stream: false, ...(conFormato ? { response_format: { type: 'json_object' } } : {}) };
    let r; try { r = await fetch(`${cfg.url}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw errorModelo(cfg.url, e); }
    return { r, txt: await r.text() };
  };
  // Primero con «responde en JSON»; hay servidores que no lo aceptan (LM Studio, algunos de llama.cpp): se repite sin él.
  let { r, txt } = await pedir(true);
  if (r.status === 400 || r.status === 422 || r.status === 500) ({ r, txt } = await pedir(false));
  if (!r.ok) throw errorModelo(cfg.url, null, r.status, txt);
  let j = {}; try { j = JSON.parse(txt); } catch { throw new Error(`Tu modelo devolvió algo que no es la API de OpenAI: ${txt.slice(0, 120)}`); }
  return json(j.choices?.[0]?.message?.content);
}

// Guardar desde la app: prueba la conexión con una petición real antes de guardar nada.
export async function guardarPropio({ url, modelo, vision = false, clave: k = '', quitar = false } = {}) {
  if (quitar) { guardarClave('PROPIO_API_KEY', ''); guardarAjustes({ 'ia.propio_url': '', 'ia.propio_modelo': '', 'ia.propio_vision': false }); return { ok: true, configurado: false }; }
  const base = baseOpenAI(url); modelo = String(modelo || '').trim();
  if (!base) throw new Error('Escribe la dirección de tu modelo');
  if (!modelo) throw new Error('Elige o escribe el nombre del modelo');
  const nueva = k && k !== '__guardada__' ? String(k).trim() : null;
  const cfg = { url: base, modelo, vision: !!vision, clave: nueva ?? clave('PROPIO_API_KEY') };
  const t0 = Date.now();
  const r = await propio('Devuelve solo este JSON, sin nada más: {"ok": true, "saludo": "hola"}', [], { cfg, timeoutMs: 180000 });
  if (!r || typeof r !== 'object') throw new Error('Tu modelo contestó, pero no con JSON');
  if (nueva !== null) guardarClave('PROPIO_API_KEY', nueva);
  guardarAjustes({ 'ia.propio_url': base, 'ia.propio_modelo': modelo, 'ia.propio_vision': !!vision });
  return { ok: true, configurado: true, url: base, modelo, segundos: +((Date.now() - t0) / 1000).toFixed(1) };
}
export function estadoPropio() {
  const c = propioCfg();
  return { url: c.url, modelo: c.modelo, vision: c.vision, clave: !!c.clave, configurado: propioConfigurado(), presets: PRESETS };
}

// Clave de Gemini desde la app (antes solo se podía en el .env de OpenShorts).
export async function guardarClaveGemini({ clave: k, quitar = false }) {
  if (!quitar) {
    k = String(k || '').trim();
    if (!/^[A-Za-z0-9_-]{30,}$/.test(k)) throw new Error('Esa no parece una clave de Gemini (se crea en aistudio.google.com/apikey)');
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': k }, signal: AbortSignal.timeout(15000) });
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error('Google dice que la clave no es válida');
    if (!r.ok) throw new Error(`Google respondió ${r.status}; prueba en un rato`);
  }
  guardarClave('GEMINI_API_KEY', quitar ? '' : k);
  return { ok: true, configurado: !quitar };
}
export const geminiConfigurado = () => !!clave('GEMINI_API_KEY');

async function groq(prompt, imagenes, modelo = null, intento = 0) {
  const k = clave('GROQ_API_KEY'); if (!k) throw new Error('Groq sin configurar');
  const content = imagenes.length
    ? [...imagenes.slice(0, 5).map((b) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b}` } })), { type: 'text', text: prompt }]
    : prompt;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
    body: JSON.stringify({ model: modelo || (imagenes.length ? (ajustes()['groq.modelo_vision'] || GROQ_VISION) : (ajustes()['groq.modelo_texto'] || GROQ_TEXTO)), messages: [{ role: 'user', content }], temperature: 0.4, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  // Plan gratuito: si pide esperar unos segundos (límite por minuto), espera y reintenta (hasta 2 veces).
  const espera = r.status === 429 && !/too large/i.test(j.error?.message || '') ? Number(String(j.error?.message || '').match(/try again in (?:(\d+)m)?([\d.]+)s/)?.slice(1).reduce((a, x, i) => a + (Number(x) || 0) * (i === 0 ? 60 : 1), 0) || 20) : 0;
  if (espera && intento < 2 && espera <= 90) { await new Promise((ok) => setTimeout(ok, (espera + 1) * 1000)); return groq(prompt, imagenes, modelo, intento + 1); }
  // Demasiado grande para el modelo con visión (plan gratuito): se repite solo con texto, con el modelo de textos.
  if (!r.ok && imagenes.length && /too large/i.test(j.error?.message || '')) return groq(prompt, [], null, intento);
  if (!r.ok) throw new Error(`Groq ${r.status}: ${j.error?.message || ''}`.slice(0, 200));
  return json(j.choices?.[0]?.message?.content);
}

async function gemini(prompt, imagenes) {
  const k = clave('GEMINI_API_KEY'); if (!k) throw new Error('Gemini sin clave');
  const u = usoHoy(); if (u.gemini.n >= u.geminiMax) throw new Error(`tope diario de Gemini alcanzado (${u.geminiMax})`);
  const parts = [...imagenes.map((b) => ({ inline_data: { mime_type: 'image/jpeg', data: b } })), { text: prompt }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || ''}`.slice(0, 200));
  return json(j.candidates?.[0]?.content?.parts?.map((p) => p.text).join(''));
}

// Pide una respuesta JSON. `preferir: 'gemini'` solo para lo que Gemini hace claramente mejor (cajas sobre imágenes);
// aun así respeta el tope diario y cae a Groq si no puede.
// Tu propio modelo, si está configurado, va siempre primero (lo eligió quien instaló la app). `soloConImagenes`: la tarea
// no tiene sentido sin mirar las imágenes (p. ej. localizar la webcam), así que un modelo sin visión se salta.
export async function pedirJSON(prompt, { imagenes = [], preferir = 'groq', soloConImagenes = false } = {}) {
  const nube = preferir === 'gemini' ? [['gemini', gemini], ['groq', groq]] : [['groq', groq], ['gemini', gemini]];
  const orden = [['propio', (p, im) => propio(p, im, { soloConImagenes })], ...nube];
  const errores = [];
  for (const [nombre, fn] of orden) {
    try { const r = await fn(prompt, imagenes); contar(nombre); return r; }
    catch (e) { if (!/sin configurar|sin clave|tope diario/.test(e.message)) contar(nombre, true); errores.push(e.message); }
  }
  throw new Error(errores.join(' · '));
}

// Clave de Groq desde la app (Ajustes › IA): se prueba y se escribe en claves.env (600), nunca en la base de datos.
export async function guardarClaveGroq({ clave: k, quitar = false }) {
  const f = path.join(os.homedir(), '.config', 'streamclipper', 'claves.env');
  const resto = leerEnv(f).split('\n').filter((l) => l.trim() && !/^GROQ_API_KEY=/.test(l));
  if (!quitar) {
    k = String(k || '').trim();
    if (!/^gsk_[A-Za-z0-9]{20,}$/.test(k)) throw new Error('Esa no parece una clave de Groq (empieza por gsk_)');
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) throw new Error('Groq dice que la clave no es válida');
    if (!r.ok) throw new Error(`Groq respondió ${r.status}; prueba en un rato`);
    resto.push(`GROQ_API_KEY=${k}`);
  }
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, resto.join('\n') + '\n', { mode: 0o600 }); chmodSync(f, 0o600);
  return { ok: true, configurado: !quitar };
}
export const groqConfigurado = () => !!clave('GROQ_API_KEY');

// ---------- modelos de Groq: lista, elección y prueba con un clip real ----------
const NO_CHAT = /whisper|tts|playai|orpheus|guard|distil|embed|transcri/i;
const CON_VISION = /vision|scout|maverick|llava|-vl|vl-|pixtral|gemma-3|qwen3.[5-9]/i;
export async function modelosGroq() {
  const k = clave('GROQ_API_KEY'); if (!k) throw new Error('Primero guarda la clave de Groq');
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq ${r.status}: ${j.error?.message || ''}`);
  const lista = (j.data || []).filter((m) => m.active !== false && !NO_CHAT.test(m.id))
    .map((m) => ({ id: m.id, de: m.owned_by || '', contexto: m.context_window || null, vision: CON_VISION.test(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const a = ajustes();
  return { modelos: lista, texto: a['groq.modelo_texto'] || GROQ_TEXTO, vision: a['groq.modelo_vision'] || GROQ_VISION };
}
// Prueba un modelo con la tarea real: título, texto en pantalla y juego de un clip reciente (con fotogramas si es de visión).
export async function probarGroq(modelo, tipo = 'texto') {
  const fila = db.prepare("SELECT v.id, v.titulo, v.clips, c.nombre canal FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id WHERE v.estado = 'listo' AND v.tipo NOT IN ('estudio','recop') AND v.clips LIKE '%\"final\"%' ORDER BY v.id DESC LIMIT 1").get();
  if (!fila) throw new Error('No hay clips terminados para probar');
  const clip = JSON.parse(fila.clips).find((x) => x.final && existsSync(x.final)) || JSON.parse(fila.clips)[0];
  const imagenes = [];
  if (tipo === 'vision' && clip?.final && existsSync(clip.final)) {
    const dur = Math.max(3, (clip.fin ?? 30) - (clip.inicio ?? 0));
    for (const t of [0.2, 0.5, 0.8]) {
      const jpg = await new Promise((ok) => execFile('ffmpeg', ['-v', 'error', '-ss', String((dur * t).toFixed(1)), '-i', clip.final, '-frames:v', '1', '-vf', 'scale=480:-2', '-f', 'image2', '-c:v', 'mjpeg', '-'],
        { encoding: 'buffer', timeout: 30000, maxBuffer: 8e6 }, (e, so) => ok(e ? null : so)));
      if (jpg?.length) imagenes.push(jpg.toString('base64'));
    }
  }
  const prompt = `Eres editor de clips verticales virales. Creador: ${String(fila.canal || '').replace(/\s*\(EN\)$/, '')}. Título del vídeo original: «${fila.titulo}». `
    + `Lo que se dice en el clip: «${String(clip?.dicho || clip?.tiktok || clip?.titulo || '').slice(0, 600)}». `
    + `${imagenes.length ? 'Tienes 3 fotogramas del clip: describe lo que se ve. ' : ''}`
    + 'Devuelve SOLO JSON: {"titulo": "creador + qué hace + juego, llamativo, máx. 90 caracteres", "gancho": "texto en pantalla, máx. 45 caracteres", "juego": "el juego exacto", "se_ve": "qué se ve (si hay fotogramas)"}';
  const t0 = Date.now();
  const r = await groq(prompt, imagenes, modelo);
  contar('groq');
  return { modelo, tipo, segundos: +((Date.now() - t0) / 1000).toFixed(1), fotogramas: imagenes.length, clip: `${fila.id}/${clip?.n}`, original: clip?.titulo || '', resultado: r };
}
