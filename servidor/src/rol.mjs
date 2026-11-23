// Servidor en dos procesos (23-nov-2026), para poder actualizar sin esperar a que terminen los trabajos:
//   ROL=web       → panel, API y app en el puerto público. Se reinicia en 1 s sin tocar nada en marcha.
//   ROL=trabajos  → planificador, descargas, whisper, recortes, renders, subidas… en 127.0.0.1:PUERTO_TRABAJOS.
//   (sin ROL)     → todo en uno, como antes (vuelta atrás: quitar ROL del servicio).
// La web atiende ella misma lo que solo lee o escribe la base de datos; lo que depende de colas o procesos en memoria
// del proceso de trabajos se le reenvía tal cual, ya autenticado (cabecera interna con secreto compartido, solo desde 127.0.0.1).
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATOS } from './db.mjs';

export const ROL = ['web', 'trabajos'].includes(process.env.ROL) ? process.env.ROL : 'todo';
export const conTrabajos = ROL !== 'web';   // planificador y tareas de fondo
export const separado = ROL !== 'todo';
export const PUERTO_TRABAJOS = Number(process.env.PUERTO_TRABAJOS || 8796);

const FICH = path.join(DATOS, 'trabajos-interno.token');
function secreto() {
  if (!existsSync(FICH)) { try { writeFileSync(FICH, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); } catch {} }
  return readFileSync(FICH, 'utf8').trim();
}
const SECRETO = separado ? secreto() : '';
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// En el proceso de trabajos: ¿la petición viene de la web (ya autenticada)? Devuelve el id de usuario o null.
export function usuarioInterno(req) {
  if (ROL !== 'trabajos' || !req.headers['x-interno'] || !LOCAL.has(req.socket?.remoteAddress)) return null;
  const a = Buffer.from(String(req.headers['x-interno'])), b = Buffer.from(SECRETO);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Number(req.headers['x-usuario']) || null;
}

// Rutas que viven en el proceso de trabajos (colas, procesos y estados en memoria, o trabajos largos).
const PREFIJOS = ['/api/acelerador', '/api/editor', '/api/recop', '/api/operaciones', '/api/cuentas/youtube/', '/api/tiktok/',
  '/api/energia/', '/api/estadisticas/actualizar'];
const EXACTAS = new Set(['GET /api/primeros-pasos', 'GET /api/diagnostico', 'GET /api/pendientes', 'GET /api/sistema', 'GET /api/sistema/alertas', 'GET /api/acelerador', 'POST /api/acelerador']);
const CLIPS_LOCALES = new Set(['/api/clips/valorar', '/api/clips/recuperar']);
export function deTrabajos(metodo, p) {
  if (ROL !== 'web') return false;
  if (EXACTAS.has(`${metodo} ${p}`) || PREFIJOS.some((x) => p.startsWith(x))) return true;
  if (metodo === 'POST' && p.startsWith('/api/sistema/') && p !== '/api/sistema/autoprueba' && p !== '/api/sistema/proceso') return true;
  if (metodo === 'POST' && (p.startsWith('/api/clips/') || p.startsWith('/api/subidas/')) && !CLIPS_LOCALES.has(p)) return true;
  return false;
}

// Reenvía la petición entera al proceso de trabajos y devuelve su respuesta tal cual.
export function reenviar(req, res, usuarioId = null) {
  return new Promise((ok) => {
    const cab = { ...req.headers, 'x-interno': SECRETO, host: `127.0.0.1:${PUERTO_TRABAJOS}` };
    delete cab['x-usuario']; if (usuarioId) cab['x-usuario'] = String(usuarioId);
    const r = http.request({ host: '127.0.0.1', port: PUERTO_TRABAJOS, method: req.method, path: req.url, headers: cab }, (rr) => {
      res.writeHead(rr.statusCode, rr.headers); rr.pipe(res); rr.on('end', ok); rr.on('error', ok);
    });
    r.on('error', () => {
      if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'El servicio de trabajos se está reiniciando: prueba en unos segundos' })); }
      ok();
    });
    req.pipe(r);
  });
}
