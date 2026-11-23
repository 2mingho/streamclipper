// Clips horizontales a petición: el usuario añade vídeos desde el panel (Canal → Clips horizontales) con sus opciones y la
// skill «clips-horizontales» de Claude Code trabaja sobre esta lista (por SSH, con horizontales-cli.mjs).
// Estados: cola → analizando → eligiendo (Claude propone momentos; el usuario marca cuáles quiere en el panel)
//          → elegido → cortando → listo | error | descartado.
// Los clips quedan en la carpeta compartida: <ARCHIVOS_DIR>/Clips/Horizontales/<id> <título>/.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { db, ARCHIVOS } from '../db.mjs';
import { avisarSinFallo } from '../avisos.mjs';

export const RAIZ = path.join(ARCHIVOS, 'Clips', 'Horizontales');
export const DERECHOS = { propio: 'Es mío', permiso: 'Tengo permiso del autor', plataforma: 'Clips permitidos por la plataforma' };
db.exec(`
CREATE TABLE IF NOT EXISTS hclips (
  id INTEGER PRIMARY KEY,
  fuente TEXT NOT NULL,                       -- URL (YouTube, Twitch, Kick…) o ruta de un archivo del servidor
  titulo TEXT NOT NULL DEFAULT '',            -- lo rellena Claude con el título real
  cantidad INTEGER NOT NULL DEFAULT 8,        -- cuántos clips quiere el usuario (máximo)
  dur_min INTEGER NOT NULL DEFAULT 30,        -- duración de cada clip (segundos)
  dur_max INTEGER NOT NULL DEFAULT 180,
  enfoque TEXT NOT NULL DEFAULT '',           -- qué momentos buscar (humor, épicos, explicaciones…)
  claves TEXT NOT NULL DEFAULT '',            -- frases que suelen marcar los buenos momentos, separadas por comas
  subtitulos INTEGER NOT NULL DEFAULT 0,      -- 1 = quemar subtítulos
  elegir INTEGER NOT NULL DEFAULT 1,          -- 1 = el usuario elige los momentos antes de cortar; 0 = Claude corta los mejores
  derechos TEXT NOT NULL DEFAULT 'propio',    -- propio | permiso | plataforma
  notas TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'cola',
  paso TEXT, error TEXT,
  candidatos TEXT NOT NULL DEFAULT '[]',      -- [{ n, inicio, fin, titulo, porque, senales }] (segundos del vídeo original)
  elegidos TEXT NOT NULL DEFAULT '[]',        -- [n]
  clips TEXT NOT NULL DEFAULT '[]',           -- [{ n, archivo, titulo, dur, origen, descripcion }]
  carpeta TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')), actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const parse = (r) => r && { ...r, candidatos: JSON.parse(r.candidatos), elegidos: JSON.parse(r.elegidos), clips: JSON.parse(r.clips), subtitulos: !!r.subtitulos, elegir: !!r.elegir };
const tocar = (id, campos) => {
  const k = Object.keys(campos);
  db.prepare(`UPDATE hclips SET ${k.map((x) => `${x} = @${x}`).join(', ')}, actualizado = datetime('now') WHERE id = @id`).run({ ...campos, id });
};
const entero = (v, def, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

export const uno = (id) => parse(db.prepare('SELECT * FROM hclips WHERE id = ?').get(Number(id)));
export const lista = () => db.prepare('SELECT * FROM hclips ORDER BY id DESC LIMIT 200').all().map(parse);

export function añadir(b) {
  const fuente = String(b.fuente || '').trim();
  if (!/^https?:\/\/\S+$/.test(fuente) && !fuente.startsWith('/')) throw new Error('Pon un enlace (https://…) o la ruta de un archivo del servidor');
  if (!DERECHOS[b.derechos]) throw new Error('Indica si el vídeo es tuyo o tienes permiso');
  const dmin = entero(b.dur_min, 30, 10, 1200), dmax = entero(b.dur_max, 180, 15, 1800);
  if (dmax < dmin) throw new Error('La duración máxima es menor que la mínima');
  return db.prepare(`INSERT INTO hclips (fuente, cantidad, dur_min, dur_max, enfoque, claves, subtitulos, elegir, derechos, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(fuente, entero(b.cantidad, 8, 1, 30), dmin, dmax, String(b.enfoque || '').trim(), String(b.claves || '').trim(),
    b.subtitulos ? 1 : 0, b.elegir === false || b.elegir === 0 ? 0 : 1, b.derechos, String(b.notas || '').trim()).lastInsertRowid;
}

// El usuario marca qué candidatos quiere (desde el panel). Lista vacía = descartar el vídeo.
export function elegir(id, elegidos) {
  const v = uno(id); if (!v) throw new Error('No existe');
  if (v.estado !== 'eligiendo') throw new Error('Este vídeo no está esperando tu elección');
  const ns = [...new Set((elegidos || []).map(Number))].filter((n) => v.candidatos.some((c) => c.n === n));
  tocar(v.id, ns.length ? { estado: 'elegido', elegidos: JSON.stringify(ns) } : { estado: 'descartado', elegidos: '[]' });
  return { ok: true, elegidos: ns.length };
}

// Quitar de la lista: lo que aún no se ha empezado se borra; lo demás queda como descartado.
export function quitar(id) {
  const v = uno(id); if (!v) return;
  if (v.estado === 'cola') db.prepare('DELETE FROM hclips WHERE id = ?').run(v.id);
  else tocar(v.id, { estado: 'descartado' });
}
export function reintentar(id) {
  const v = uno(id); if (!v) throw new Error('No existe');
  tocar(v.id, { estado: v.elegidos.length ? 'elegido' : 'cola', error: null, paso: null });
}

// ---- lo que usa la skill (horizontales-cli.mjs) ----
export function pendientes() {
  const l = lista();
  const sel = (...e) => l.filter((v) => e.includes(v.estado));
  return {
    cola: sel('cola').reverse(),                 // analizar: metadatos, momentos y propuesta de candidatos
    elegidos: sel('elegido').reverse(),          // cortar los momentos elegidos
    eligiendo: sel('eligiendo').map((v) => ({ id: v.id, titulo: v.titulo, candidatos: v.candidatos.length })),  // esperando al usuario
    en_curso: sel('analizando', 'cortando').map((v) => ({ id: v.id, titulo: v.titulo, estado: v.estado, paso: v.paso })),
    errores: sel('error').map((v) => ({ id: v.id, titulo: v.titulo, error: v.error })),
  };
}
export function estado(id, est, extra = {}) {
  const v = uno(id); if (!v) throw new Error('No existe');
  const campos = { estado: est, paso: extra.paso ?? null, error: extra.error ?? null };
  if (extra.titulo) campos.titulo = extra.titulo;
  tocar(v.id, campos);
  if (est === 'error') avisarSinFallo('Clips horizontales: error', `«${v.titulo || v.fuente}»: ${extra.error || 'error'}`, { etiquetas: ['warning'] });
  return uno(id);
}
// Claude propone los momentos. Si el usuario pidió no elegir, quedan elegidos los primeros `cantidad`.
export function proponer(id, candidatos, titulo) {
  const v = uno(id); if (!v) throw new Error('No existe');
  const cs = candidatos.map((c, i) => ({ n: i + 1, inicio: +c.inicio, fin: +c.fin, titulo: String(c.titulo || ''), porque: String(c.porque || ''), senales: String(c.senales || '') }));
  if (!cs.length || cs.some((c) => !(c.fin > c.inicio))) throw new Error('Candidatos vacíos o con tiempos inválidos');
  const auto = !v.elegir;
  tocar(v.id, { candidatos: JSON.stringify(cs), titulo: titulo || v.titulo, estado: auto ? 'elegido' : 'eligiendo', paso: null, error: null,
    elegidos: JSON.stringify(auto ? cs.slice(0, v.cantidad).map((c) => c.n) : []) });
  if (!auto) avisarSinFallo('Momentos para elegir', `«${titulo || v.titulo || v.fuente}»: ${cs.length} momentos propuestos. Elige cuáles cortar en Clips horizontales.`, { etiquetas: ['scissors'] });
  return uno(id);
}
export function terminar(id, clips, carpeta) {
  const v = uno(id); if (!v) throw new Error('No existe');
  tocar(v.id, { estado: 'listo', clips: JSON.stringify(clips), carpeta, paso: null, error: null });
  avisarSinFallo('Clips horizontales listos', `«${v.titulo || v.fuente}»: ${clips.length} clips en Clips/Horizontales`, { etiquetas: ['scissors'] });
  return uno(id);
}

// Un clip terminado (para verlo o bajarlo desde el panel).
export function archivo(id, n) {
  const v = uno(id); if (!v || !v.carpeta) return null;
  const c = v.clips.find((x) => x.n === Number(n)); if (!c) return null;
  const f = path.resolve(v.carpeta, c.archivo);
  return f.startsWith(path.resolve(RAIZ) + path.sep) && existsSync(f) ? f : null;
}
export const nombreCarpeta = (v) => path.join(RAIZ, `${v.id} ${(v.titulo || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)}`);
export const contenido = (v) => (v.carpeta && existsSync(v.carpeta) ? readdirSync(v.carpeta) : []);
