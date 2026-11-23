// Equipo (fase 9, 22-nov-2026): varias personas entran con su usuario y su rol; todos trabajan el mismo contenido.
// Roles: dueño (todo), editor (todo menos servidor, acceso de Claude, equipo, IA de pago y cuentas de otros),
// solo ver (consulta, sin cambiar nada). La contraseña única de antes pasa a ser la del dueño (usuario «admin»).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, ajustes } from './db.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT NOT NULL,
  clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'editor',          -- dueno | editor | lector
  activo INTEGER NOT NULL DEFAULT 1,
  cambiar_clave INTEGER NOT NULL DEFAULT 0,    -- 1: al entrar debe poner una contraseña propia
  tour INTEGER NOT NULL DEFAULT 0,             -- 1: ya vio el recorrido guiado
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo TEXT
);`);

export const ROLES = { dueno: 'Dueño', editor: 'Editor', lector: 'Solo ver' };
export const hash = (clave, sal = randomBytes(16).toString('hex')) => `${sal}:${scryptSync(clave, sal, 32).toString('hex')}`;
export function claveOk(clave, guardado) {
  const [sal, h] = String(guardado || '').split(':');
  if (!sal || !h) return false;
  const a = Buffer.from(scryptSync(String(clave), sal, 32).toString('hex')), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}
const publico = (u) => u && { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, rolTexto: ROLES[u.rol] || u.rol, activo: !!u.activo, cambiarClave: !!u.cambiar_clave, tour: !!u.tour, creado: u.creado, ultimo: u.ultimo };
const fila = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id));
const duenos = () => db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'dueno' AND activo = 1").get().n;
const claveTemporal = () => randomBytes(9).toString('base64url');
const validarClave = (c) => { if (String(c || '').length < 8) throw new Error('La contraseña necesita al menos 8 caracteres'); };
const validarUsuario = (u) => { u = String(u || '').trim().toLowerCase(); if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new Error('El usuario: de 3 a 30 letras sin tildes, números, punto o guion'); return u; };

// El panel tenía una sola contraseña: se convierte en el usuario «admin» (dueño), con la misma contraseña.
export function asegurarDueno() {
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n) return;
  const h = ajustes()['panel.clave_hash'];
  if (h) db.prepare("INSERT INTO usuarios (usuario, nombre, clave_hash, rol, tour) VALUES ('admin', 'Dueño', ?, 'dueno', 0)").run(h);
}
asegurarDueno();
export const hayUsuarios = () => db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0;
export const duenoId = () => db.prepare("SELECT id FROM usuarios WHERE rol = 'dueno' AND activo = 1 ORDER BY id LIMIT 1").get()?.id || null;

// Sin usuario escrito = el dueño principal (así la entrada de siempre, solo con la contraseña, sigue sirviendo).
export function entrar(usuario, clave) {
  const u = String(usuario || '').trim()
    ? db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(String(usuario).trim())
    : fila(duenoId());
  if (!u || !claveOk(clave, u.clave_hash)) return null;
  db.prepare("UPDATE usuarios SET ultimo = datetime('now') WHERE id = ?").run(u.id);
  return publico(u);
}
export function primerDueno(clave, usuario = 'admin') { // panel recién instalado: el primero que entra crea su cuenta de dueño
  if (hayUsuarios()) throw new Error('Ya hay usuarios');
  validarClave(clave);
  const id = db.prepare("INSERT INTO usuarios (usuario, nombre, clave_hash, rol) VALUES (?, 'Dueño', ?, 'dueno')").run(validarUsuario(usuario), hash(clave)).lastInsertRowid;
  return publico(fila(id));
}
export const uno = (id) => { const u = fila(id); return u && u.activo ? publico(u) : null; };
export const lista = () => db.prepare('SELECT * FROM usuarios ORDER BY activo DESC, rol, nombre COLLATE NOCASE').all().map(publico);

export function crear({ usuario, nombre, rol }) {
  const u = validarUsuario(usuario), n = String(nombre || '').trim() || u;
  if (!ROLES[rol]) throw new Error('Elige un rol');
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(u)) throw new Error('Ese usuario ya existe');
  const clave = claveTemporal();
  const id = db.prepare('INSERT INTO usuarios (usuario, nombre, clave_hash, rol, cambiar_clave) VALUES (?, ?, ?, ?, 1)').run(u, n.slice(0, 60), hash(clave), rol).lastInsertRowid;
  return { usuario: publico(fila(id)), clave };
}
export function guardar(id, { nombre, rol, activo }, quien) {
  const u = fila(id); if (!u) throw new Error('Ese usuario no existe');
  const nuevoRol = rol ?? u.rol, nuevoActivo = activo == null ? !!u.activo : !!activo;
  if (!ROLES[nuevoRol]) throw new Error('Rol desconocido');
  if (u.rol === 'dueno' && u.activo && (nuevoRol !== 'dueno' || !nuevoActivo) && duenos() <= 1) throw new Error('Tiene que quedar al menos un dueño activo');
  if (Number(id) === quien && !nuevoActivo) throw new Error('No puedes desactivarte a ti mismo');
  db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?').run(String(nombre ?? u.nombre).trim().slice(0, 60) || u.nombre, nuevoRol, nuevoActivo ? 1 : 0, u.id);
  return publico(fila(id));
}
export function restablecer(id) {
  const u = fila(id); if (!u) throw new Error('Ese usuario no existe');
  const clave = claveTemporal();
  db.prepare('UPDATE usuarios SET clave_hash = ?, cambiar_clave = 1 WHERE id = ?').run(hash(clave), u.id);
  return { clave };
}
export function borrar(id, quien) {
  const u = fila(id); if (!u) throw new Error('Ese usuario no existe');
  if (Number(id) === quien) throw new Error('No puedes borrarte a ti mismo');
  if (u.rol === 'dueno' && u.activo && duenos() <= 1) throw new Error('Tiene que quedar al menos un dueño activo');
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  return { ok: true };
}
export function cambiarClave(id, actual, nueva) {
  const u = fila(id); if (!u) throw new Error('Ese usuario no existe');
  if (!u.cambiar_clave && !claveOk(actual, u.clave_hash)) throw new Error('La contraseña actual no es correcta');
  validarClave(nueva);
  if (claveOk(nueva, u.clave_hash)) throw new Error('Pon una contraseña distinta de la anterior');
  db.prepare('UPDATE usuarios SET clave_hash = ?, cambiar_clave = 0 WHERE id = ?').run(hash(nueva), u.id);
  return { ok: true };
}
export function cambiarUsuario(id, nuevo) {
  const u = validarUsuario(nuevo);
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ? AND id != ?').get(u, Number(id))) throw new Error('Ese usuario ya existe');
  db.prepare('UPDATE usuarios SET usuario = ? WHERE id = ?').run(u, Number(id));
  return publico(fila(id));
}
export function nombre(id, n) { const t = String(n || '').trim(); if (!t) throw new Error('Escribe tu nombre'); db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(t.slice(0, 60), Number(id)); return publico(fila(id)); }
export function tour(id, visto) { db.prepare('UPDATE usuarios SET tour = ? WHERE id = ?').run(visto ? 1 : 0, Number(id)); return { ok: true }; }

// ---------- permisos ----------
const SOLO_DUENO = /^\/api\/(sistema|usuarios|energia|ia\/groq|tiktok\/desconectar|cuentas\/defecto|probar|ajustes$|historico|acelerador|app\/compilar)/;
const AJUSTES_DUENO = /^(horario|app|avisos|acelerador|servidor|panel)\b/;
// ¿Puede este usuario hacer esta petición? (las de lectura las puede hacer todo el equipo, salvo las del dueño)
export function permitido(u, metodo, ruta, cuerpo = null) {
  if (!u) return false;
  if (u.rol === 'dueno') return true;
  if (/^\/api\/(yo|salir)/.test(ruta)) return true;
  if (metodo === 'GET') return !/^\/api\/(usuarios|sistema\/registro)/.test(ruta);
  if (u.rol === 'lector') return false;
  if (SOLO_DUENO.test(ruta)) return false;
  if (ruta === '/api/ajustes/uno' && cuerpo && AJUSTES_DUENO.test(String(cuerpo.clave || ''))) return false;
  return true;
}
export const esAjusteDeDueno = (clave) => AJUSTES_DUENO.test(String(clave || ''));
