// IA en la nube para las tareas de clips: Groq primero y Gemini como reserva, para no gastar la cuota de Gemini del
// usuario (la usa para otras cosas). Gemini además tiene un tope diario propio (ajuste ia.gemini_max_dia).
//   · Groq: texto con llama-3.3-70b-versatile; texto + imágenes con Llama 4 Scout (visión). API compatible con OpenAI.
//   · Gemini: la clave del .env de OpenShorts.
// Claves: GROQ_API_KEY en ~/.config/streamclipper/claves.env (permisos 600) o en el .env de OpenShorts; nunca en la base de datos.
import { readFileSync , mkdirSync, writeFileSync, chmodSync , existsSync } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { db, ajustes } from './db.mjs';

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
  return { groq: de('groq'), gemini: de('gemini'), geminiMax: Number(ajustes()['ia.gemini_max_dia'] ?? 30), groqConfigurado: !!clave('GROQ_API_KEY') };
}
const json = (txt) => JSON.parse(String(txt || '').replace(/^\s*```(json)?|```\s*$/g, '').trim());

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
export async function pedirJSON(prompt, { imagenes = [], preferir = 'groq' } = {}) {
  const orden = preferir === 'gemini' ? [['gemini', gemini], ['groq', groq]] : [['groq', groq], ['gemini', gemini]];
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
