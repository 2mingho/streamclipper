// Cuentas de publicación por persona (fase 9b, 22-nov-2026): cada miembro del equipo conecta sus canales de YouTube y
// sus cuentas de TikTok; al publicar se elige a cuál va (sin elegir: la cuenta por defecto de esa red).
// Los tokens siguen en archivos protegidos (~/.config/streamclipper-youtube y streamclipper-tiktok, 0600), nunca en la base de datos:
// la cuenta de siempre usa token.json; las nuevas, cuentas/<red>-<id>.json.
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { db, columna } from './db.mjs';
import { duenoId } from './usuarios.mjs';

export const DIRS = { youtube: path.join(os.homedir(), '.config', 'streamclipper-youtube'), tiktok: path.join(os.homedir(), '.config', 'streamclipper-tiktok') };
db.exec(`CREATE TABLE IF NOT EXISTS cuentas_red (
  id INTEGER PRIMARY KEY,
  red TEXT NOT NULL,                -- youtube | tiktok
  nombre TEXT NOT NULL,             -- canal o usuario de la red
  externo TEXT,                     -- id del canal (YouTube) o del usuario (TikTok), para no duplicar
  usuario_id INTEGER,               -- quién la conectó
  archivo TEXT NOT NULL,            -- archivo del token, relativo a la carpeta de la red
  por_defecto INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);`);
for (const t of ['clip_subidas', 'clip_tiktok']) columna(t, 'cuenta_id', 'INTEGER');

// La conexión de siempre (token.json) pasa a ser una cuenta más, del dueño y por defecto.
function sembrar() {
  for (const red of ['youtube', 'tiktok']) {
    if (!existsSync(path.join(DIRS[red], 'token.json')) || db.prepare("SELECT 1 FROM cuentas_red WHERE red = ? AND archivo = 'token.json'").get(red)) continue;
    const def = db.prepare('SELECT 1 FROM cuentas_red WHERE red = ? AND por_defecto = 1').get(red) ? 0 : 1;
    db.prepare("INSERT INTO cuentas_red (red, nombre, usuario_id, archivo, por_defecto) VALUES (?, ?, ?, 'token.json', ?)").run(red, red === 'youtube' ? 'StreamClipper' : 'TikTok principal', duenoId(), def);
  }
}
sembrar();

const fila = (id) => db.prepare('SELECT * FROM cuentas_red WHERE id = ?').get(Number(id));
export const lista = () => db.prepare('SELECT k.id, k.red, k.nombre, k.usuario_id, k.por_defecto, k.creado, u.nombre AS de FROM cuentas_red k LEFT JOIN usuarios u ON u.id = k.usuario_id ORDER BY k.red, k.por_defecto DESC, k.id').all()
  .map((k) => ({ ...k, por_defecto: !!k.por_defecto, conectada: existsSync(path.join(DIRS[k.red], fila(k.id).archivo)) }));
export const porDefecto = (red) => db.prepare('SELECT * FROM cuentas_red WHERE red = ? ORDER BY por_defecto DESC, id LIMIT 1').get(red) || null;
export function cuenta(red, id) {
  if (id == null || id === '') return porDefecto(red);
  const k = fila(id); if (!k || k.red !== red) throw new Error(`Esa cuenta de ${red === 'youtube' ? 'YouTube' : 'TikTok'} no existe`);
  return k;
}
// Archivo del token de una cuenta (sin cuenta: la de por defecto; sin ninguna registrada: token.json, como antes).
export const archivoToken = (red, id = null) => path.join(DIRS[red], cuenta(red, id)?.archivo || 'token.json');

// Una cuenta nueva (o la misma si ya estaba: por su id externo) → devuelve la fila y el archivo donde guardar su token.
export function registrar(red, { nombre, externo, usuarioId }) {
  const ya = externo && db.prepare('SELECT * FROM cuentas_red WHERE red = ? AND externo = ?').get(red, String(externo));
  if (ya) { db.prepare('UPDATE cuentas_red SET nombre = ? WHERE id = ?').run(String(nombre || ya.nombre).slice(0, 80), ya.id); return { ...ya, ruta: path.join(DIRS[red], ya.archivo) }; }
  const def = db.prepare('SELECT 1 FROM cuentas_red WHERE red = ?').get(red) ? 0 : 1;
  const id = Number(db.prepare("INSERT INTO cuentas_red (red, nombre, externo, usuario_id, archivo, por_defecto) VALUES (?, ?, ?, ?, '', ?)").run(red, String(nombre || red).slice(0, 80), externo ? String(externo) : null, usuarioId || null, def).lastInsertRowid);
  const archivo = `cuentas/${red}-${id}.json`;
  mkdirSync(path.join(DIRS[red], 'cuentas'), { recursive: true, mode: 0o700 });
  db.prepare('UPDATE cuentas_red SET archivo = ? WHERE id = ?').run(archivo, id);
  return { ...fila(id), ruta: path.join(DIRS[red], archivo) };
}
export function renombrar(id, nombre, externo) { db.prepare('UPDATE cuentas_red SET nombre = ?, externo = COALESCE(?, externo) WHERE id = ?').run(String(nombre).slice(0, 80), externo ? String(externo) : null, Number(id)); }

// Desconectar: la puede quitar el dueño o quien la conectó. Lo que estaba en cola para ella pasa a la de por defecto.
export function borrar(id, quien) {
  const k = fila(id); if (!k) throw new Error('Esa cuenta no existe');
  if (quien.rol !== 'dueno' && k.usuario_id !== quien.id) throw new Error('Solo el dueño o quien la conectó puede quitarla');
  rmSync(path.join(DIRS[k.red], k.archivo), { force: true });
  db.prepare('DELETE FROM cuentas_red WHERE id = ?').run(k.id);
  db.prepare(`UPDATE ${k.red === 'youtube' ? 'clip_subidas' : 'clip_tiktok'} SET cuenta_id = NULL WHERE cuenta_id = ? AND estado IN ('pendiente','error')`).run(k.id);
  if (k.por_defecto) { const otra = db.prepare('SELECT id FROM cuentas_red WHERE red = ? ORDER BY id LIMIT 1').get(k.red); if (otra) db.prepare('UPDATE cuentas_red SET por_defecto = 1 WHERE id = ?').run(otra.id); }
  return { ok: true };
}
export function defecto(id) {
  const k = fila(id); if (!k) throw new Error('Esa cuenta no existe');
  db.prepare('UPDATE cuentas_red SET por_defecto = (id = ?) WHERE red = ?').run(k.id, k.red);
  return { ok: true };
}
export const hayDe = (red) => lista().some((k) => k.red === red && k.conectada);
