// Telemetría anónima y opcional (TELEMETRY.md). Apagada por defecto: solo se envía algo si el dueño dice «Sí, ayudar».
// STREAMCLIPPER_TELEMETRIA=0 o DO_NOT_TRACK=1 la apagan siempre, digan lo que digan los ajustes.
// Qué se envía: solo los eventos y campos de LISTA de abajo (nada de títulos, enlaces, canales, rutas, mensajes de error,
// correos ni IP). El identificador es un número aleatorio de esta instalación, sin relación con el usuario ni el equipo.
// Envío: POST a PostHog (UE), en segundo plano, con tiempo límite; si falla, se pierde y no pasa nada.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, ajustes, guardarAjustes, RAIZ } from './db.mjs';

const HOST = 'https://eu.i.posthog.com';
const CLAVE = 'phc_xzQQiq3CzCHB5zL6EkHSf5WjAf7wPK3BiWWSxHSw7u2T'; // clave pública de ingesta (solo escribe eventos)
const LOG = process.env.STREAMCLIPPER_TELEMETRIA_LOG === '1';
export const VERSION = (() => { try { return JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version; } catch { return '0'; } })();

// Eventos permitidos y sus campos (cualquier otro campo se descarta antes de enviar).
const LISTA = {
  app_iniciada: ['version', 'os', 'node', 'herramientas'],
  primeros_pasos: ['paso', 'estado'],
  clip_creado: ['fuente', 'duracion_bucket', 'con_subtitulos'],
  uso_diario: ['clips_bucket'],
  error: ['tipo', 'paso'],
};
export const TIPOS_ERROR = ['descarga', 'duracion', 'sin_momentos', 'postproceso', 'transcripcion', 'openshorts', 'otro'];

export const forzadaOff = () => process.env.STREAMCLIPPER_TELEMETRIA === '0' || ['1', 'true'].includes(String(process.env.DO_NOT_TRACK || '').toLowerCase());
export const activa = () => !forzadaOff() && ajustes()['telemetria.activa'] === true;
export function estado() { const a = ajustes(); return { activa: activa(), preguntado: a['telemetria.preguntado'] === true, forzadaOff: forzadaOff() }; }

function idInstalacion() {
  let id = ajustes()['telemetria.id'];
  if (!/^[0-9a-f-]{36}$/.test(String(id || ''))) { id = randomUUID(); guardarAjustes({ 'telemetria.id': id }); }
  return id;
}

let cola = [], reloj = null;
export function evento(nombre, props = {}) {
  try {
    if (!LISTA[nombre]) return;
    if (!activa()) { if (LOG) console.log(`Telemetría: «${nombre}» no se envía (desactivada)`); return; }
    const limpias = Object.fromEntries(LISTA[nombre].filter((k) => k in props).map((k) => [k, props[k]]));
    if (cola.length >= 10) return; // como mucho unos pocos en cola: si algo se repite en bucle, no se acumula
    cola.push({ event: nombre, timestamp: new Date().toISOString(),
      properties: { ...limpias, distinct_id: idInstalacion(), $process_person_profile: false, $ip: null, $lib: 'streamclipper', $lib_version: VERSION } });
    clearTimeout(reloj); reloj = setTimeout(enviar, 2000); reloj.unref?.();
  } catch {}
}
export async function enviar() {
  const lote = cola.splice(0); if (!lote.length) return null;
  try {
    const r = await fetch(`${HOST}/batch/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: CLAVE, batch: lote }), signal: AbortSignal.timeout(8000) });
    if (LOG) console.log(`Telemetría: ${lote.map((e) => e.event).join(', ')} → HTTP ${r.status}`);
    return r.status;
  } catch (e) { if (LOG) console.log(`Telemetría: no se pudo enviar (${e.name})`); return null; }
}

// ---------- eventos concretos ----------
const sistema = () => `${process.platform} ${String(os.release()).split('.')[0]}`;
export function iniciada(herramientas = {}) {
  evento('app_iniciada', { version: VERSION, os: sistema(), node: Number(process.versions.node.split('.')[0]),
    herramientas: { ffmpeg: !!herramientas.ffmpeg, yt_dlp: !!herramientas['yt-dlp'], whisper: !!herramientas.whisper } });
}
// Pasos de «Primeros pasos»: cada paso se cuenta una sola vez, cuando se completa.
const PASOS = ['herramientas', 'video', 'procesando', 'revisar', 'streamer', 'youtube'];
export function pasos(lista) {
  if (!activa()) return;
  const hechos = new Set(ajustes()['telemetria.pasos'] || []);
  let cambio = false;
  for (const p of lista) if (p.hecho && !hechos.has(p.id)) { hechos.add(p.id); cambio = true; evento('primeros_pasos', { paso: PASOS.indexOf(p.id) + 1, estado: 'hecho' }); }
  if (cambio) guardarAjustes({ 'telemetria.pasos': [...hechos] });
}
const tramo = (s) => (s < 60 ? '<1m' : s < 600 ? '1-10m' : s < 3600 ? '10-60m' : '60m+');
export const fuenteDe = (url) => (/youtube\.com|youtu\.be/i.test(url || '') ? 'youtube' : /twitch\.tv/i.test(url || '') ? 'twitch' : /kick\.com/i.test(url || '') ? 'kick' : 'archivo');
// Solo los 3 primeros clips de la instalación (para saber si el primer recorte funciona); el resto va en el resumen diario.
export function clipCreado({ fuente, duracion, conSubtitulos }) {
  if (!activa()) return;
  const n = Number(ajustes()['telemetria.clips']) || 0;
  if (n >= 3) return;
  guardarAjustes({ 'telemetria.clips': n + 1 });
  evento('clip_creado', { fuente: fuenteDe(fuente), duracion_bucket: tramo(Number(duracion) || 0), con_subtitulos: !!conSubtitulos });
}
// Código corto del error (nunca el mensaje: puede llevar títulos o rutas).
export function tipoError(mensaje = '') {
  const m = String(mensaje);
  if (/OpenShorts/i.test(m)) return 'openshorts';
  if (/descarg|yt-dlp|HTTP Error|403|Sign in|unavailable|no se descargó/i.test(m)) return 'descarga';
  if (/cuánto dura|duraci/i.test(m)) return 'duracion';
  if (/momento/i.test(m)) return 'sin_momentos';
  if (/whisper|transcrib/i.test(m)) return 'transcripcion';
  if (/Postproceso|ffmpeg|encuadre/i.test(m)) return 'postproceso';
  return 'otro';
}
export function error(mensaje, paso = 'recorte') { evento('error', { tipo: tipoError(mensaje), paso: ['recorte', 'corto', 'largo', 'subida'].includes(paso) ? paso : 'recorte' }); }
// Resumen de uso una vez al día: cuántos clips se hicieron (en tramos, nunca el número exacto).
export function cicloDiario() {
  try {
    if (!activa()) return;
    const hoy = new Date().toISOString().slice(0, 10);
    if (ajustes()['telemetria.dia'] === hoy) return;
    guardarAjustes({ 'telemetria.dia': hoy });
    let n = 0;
    for (const r of db.prepare("SELECT clips FROM clip_videos WHERE estado = 'listo' AND terminado >= datetime('now','-1 day')").all()) { try { n += JSON.parse(r.clips || '[]').length; } catch {} }
    evento('uso_diario', { clips_bucket: n === 0 ? '0' : n <= 5 ? '1-5' : n <= 20 ? '6-20' : '21+' });
  } catch {}
}
export function cambiar(si) {
  guardarAjustes({ 'telemetria.activa': !!si, 'telemetria.preguntado': true });
  return estado();
}
