// Avisos al móvil con ntfy (autoalojado en el servidor; app ntfy en el teléfono).
// Se publica en JSON (no en cabeceras) para que los acentos y los emojis lleguen bien.
import { ajustes } from './db.mjs';

// prioridad: 1 mínima … 3 normal … 5 urgente. etiquetas: nombres de emoji de ntfy (warning, rotating_light…).
export async function avisar(titulo, mensaje, { prioridad = 3, etiquetas = [], enlace = '', forzar = false, acciones = [] } = {}) {
  const cfg = ajustes();
  if (!forzar && !cfg['avisos.activo']) return { enviado: false, motivo: 'desactivado' };
  const url = String(cfg['avisos.url'] || '').trim();
  if (!/^https?:\/\/[^/]+\/[\w-]+$/.test(url)) throw new Error('La dirección del tema ntfy debe ser como http://servidor:8080/mi-tema');
  const { origin, pathname } = new URL(url);
  const cuerpo = { topic: pathname.slice(1), title: titulo, message: String(mensaje).slice(0, 3500), priority: prioridad, tags: etiquetas };
  const clic = enlace || cfg['avisos.panel'];
  if (clic) cuerpo.click = clic;
  if (acciones.length) cuerpo.actions = acciones.slice(0, 3);
  const cab = { 'Content-Type': 'application/json' };
  if (cfg['avisos.token']) cab.Authorization = `Bearer ${cfg['avisos.token']}`;
  const r = await fetch(origin, { method: 'POST', headers: cab, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ntfy respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { enviado: true };
}

// Nunca deja que un aviso fallido rompa la tarea que lo envía.
export function avisarSinFallo(...args) {
  return avisar(...args).catch((e) => console.error('Aviso no enviado:', e.message));
}
