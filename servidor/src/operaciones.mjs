// Operaciones: lanzar cualquier tarea del servidor cuando se quiera, en una sola cola que se puede ordenar y cancelar.
// No sustituye a los ciclos automáticos (clips, recopilatorios…): les añade un «hazlo ahora» con orden y registro.
// Una operación a la vez; las largas esperan a terminar, las que solo encolan trabajo en su módulo
// (procesar un vídeo, versiones horizontales…) terminan al dejarlo en su cola.
import { db, ajustes } from './db.mjs';
import * as Clips from './tareas/clips.mjs';
import * as Recop from './tareas/recopilatorios.mjs';
import * as Editor from './tareas/clips-editor.mjs';
import * as Estadisticas from './estadisticas/estadisticas.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS operaciones (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | hecha | error | cancelada
  orden REAL NOT NULL,
  resultado TEXT, error TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')), inicio TEXT, fin TEXT
);`);
// Una operación cortada por un reinicio no se repite sola: queda como error, y se puede volver a lanzar.
db.prepare("UPDATE operaciones SET estado='error', error='Interrumpida por un reinicio del servidor', fin=datetime('now') WHERE estado='en_curso'").run();

const hoy = () => new Date().toLocaleDateString('sv');
const videosEnCola = () => db.prepare("SELECT id, titulo FROM clip_videos WHERE estado = 'cola' ORDER BY id DESC LIMIT 40").all().map((v) => [v.id, v.titulo]);
const videosListos = () => db.prepare("SELECT id, titulo FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop') ORDER BY id DESC LIMIT 40").all().map((v) => [v.id, v.titulo]);
const recopsBorrador = () => db.prepare("SELECT id, titulo FROM recopilatorios WHERE estado IN ('borrador','error') ORDER BY id DESC LIMIT 20").all().map((r) => [r.id, r.titulo || `Recopilatorio ${r.id}`]);

// Catálogo: lo que se puede lanzar. `params`: qué pide (con sus opciones) · `ejecutar`: devuelve un texto de resultado.
export const TIPOS = {
  revisar_canales: {
    grupo: 'Canal', nombre: 'Revisar canales de clips', desc: 'Mira si los canales vigilados tienen vídeos nuevos.',
    async ejecutar() { await Clips.revisarCanales(); return 'Canales revisados'; },
  },
  procesar_video: {
    grupo: 'Canal', nombre: 'Procesar un vídeo ya', desc: 'Saca clips de un vídeo de la cola sin esperar a la ventana nocturna.',
    params: [{ k: 'id', etiqueta: 'Vídeo', opciones: videosEnCola }],
    async ejecutar(p) { if (!Number(p.id)) throw new Error('Elige un vídeo'); Clips.videos.urgente(Number(p.id)); return 'Pasa el primero de la cola de clips'; },
  },
  horizontales: {
    grupo: 'Canal', nombre: 'Versiones horizontales', desc: 'Prepara la versión 16:9 (y la emoción) de todos los clips de un vídeo que aún no la tengan.',
    params: [{ k: 'id', etiqueta: 'Vídeo', opciones: videosListos }],
    async ejecutar(p) {
      const v = Clips.videos.uno(Number(p.id)); if (!v) throw new Error('Ese vídeo no existe');
      const n = Editor.encolarHorizontales(v.id, Clips.datosCreador(v).lineas);
      return n ? `${n} versiones horizontales en cola` : 'Ya estaban todas (o falta el vídeo original)';
    },
  },
  recopilatorio: {
    grupo: 'Canal', nombre: 'Montar un recopilatorio', desc: 'Manda a montar un recopilatorio en borrador.',
    params: [{ k: 'id', etiqueta: 'Recopilatorio', opciones: recopsBorrador }],
    async ejecutar(p) { if (!Number(p.id)) throw new Error('Elige un recopilatorio'); Recop.encolar(Number(p.id)); return 'En cola para montarse'; },
  },
  estadisticas: {
    grupo: 'Canal', nombre: 'Actualizar estadísticas del canal', desc: 'Descarga de YouTube las vistas, la retención y los suscriptores de cada vídeo (solo lectura).',
    async ejecutar() { const r = await Estadisticas.actualizar(); return `${r.videos} vídeos · ${r.suscriptores} suscriptores${r.analytics ? '' : ' · sin analíticas (activa la API en Google)'}`; },
  },
};

// ---------- cola ----------
const parse = (o) => o && { ...o, params: JSON.parse(o.params || '{}') };
export function encolar(tipo, params = {}) {
  const t = TIPOS[tipo]; if (!t) throw new Error('Operación desconocida');
  const limpios = {};
  for (const p of t.params || []) if (params[p.k] != null && params[p.k] !== '') limpios[p.k] = String(params[p.k]).slice(0, 40);
  const orden = (db.prepare("SELECT MAX(orden) m FROM operaciones WHERE estado = 'pendiente'").get().m || 0) + 1;
  return Number(db.prepare('INSERT INTO operaciones (tipo, params, orden) VALUES (?, ?, ?)').run(tipo, JSON.stringify(limpios), orden).lastInsertRowid);
}
export function cancelar(id) { return db.prepare("UPDATE operaciones SET estado='cancelada', fin=datetime('now') WHERE id = ? AND estado = 'pendiente'").run(Number(id)).changes; }
// Subir o bajar una pendiente: intercambia su orden con la vecina.
export function mover(id, dir) {
  const lista = db.prepare("SELECT id, orden FROM operaciones WHERE estado = 'pendiente' ORDER BY orden").all();
  const i = lista.findIndex((x) => x.id === Number(id)), j = i + (dir === 'arriba' ? -1 : 1);
  if (i < 0 || j < 0 || j >= lista.length) return false;
  const upd = db.prepare('UPDATE operaciones SET orden = ? WHERE id = ?');
  upd.run(lista[j].orden, lista[i].id); upd.run(lista[i].orden, lista[j].id);
  return true;
}
export function estado() {
  return {
    catalogo: Object.entries(TIPOS).map(([k, t]) => ({ tipo: k, grupo: t.grupo, nombre: t.nombre, desc: t.desc,
      params: (t.params || []).map((p) => ({ k: p.k, etiqueta: p.etiqueta, tipo: p.tipo || 'select', defecto: typeof p.defecto === 'function' ? p.defecto() : p.defecto, opciones: p.opciones ? p.opciones() : null })) })),
    cola: db.prepare("SELECT * FROM operaciones WHERE estado IN ('en_curso','pendiente') ORDER BY estado = 'pendiente', orden").all().map(parse),
    historial: db.prepare("SELECT * FROM operaciones WHERE estado IN ('hecha','error','cancelada') ORDER BY id DESC LIMIT 25").all().map(parse),
  };
}

// Lo llama el planificador cada 30 s: si no hay ninguna en marcha, empieza la siguiente.
let trabajando = false;
export async function cicloOperaciones() {
  if (trabajando) return;
  const op = parse(db.prepare("SELECT * FROM operaciones WHERE estado = 'pendiente' ORDER BY orden LIMIT 1").get());
  if (!op) return;
  if (!TIPOS[op.tipo]) { db.prepare("UPDATE operaciones SET estado='error', error='Operación desconocida', fin=datetime('now') WHERE id=?").run(op.id); return; }
  trabajando = true;
  db.prepare("UPDATE operaciones SET estado='en_curso', inicio=datetime('now') WHERE id=?").run(op.id);
  try {
    const r = await TIPOS[op.tipo].ejecutar(op.params);
    db.prepare("UPDATE operaciones SET estado='hecha', resultado=?, fin=datetime('now') WHERE id=?").run(String(r || 'Hecho').slice(0, 300), op.id);
  } catch (e) {
    db.prepare("UPDATE operaciones SET estado='error', error=?, fin=datetime('now') WHERE id=?").run(String(e.message).slice(0, 300), op.id);
  } finally { trabajando = false; }
}
