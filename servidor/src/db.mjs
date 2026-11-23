// Base de datos SQLite integrada en Node (node:sqlite), sin dependencias.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATOS = process.env.DATOS_DIR || path.join(RAIZ, 'datos');
// Carpeta de archivos grandes (clips terminados, Estudio, campañas). Por defecto, dentro de los datos.
export const ARCHIVOS = process.env.ARCHIVOS_DIR || path.join(DATOS, 'archivos');
mkdirSync(DATOS, { recursive: true });

export const db = new DatabaseSync(path.join(DATOS, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 15000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
`);
// Aportes de las IA por MCP (las crea también mcp/server.mjs): el panel las lee aunque el MCP no haya arrancado nunca.
db.exec(`
CREATE TABLE IF NOT EXISTS ia_tendencias (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, tema TEXT, resumen TEXT,
  por_que_ahora TEXT, nicho TEXT, palabras_clave TEXT, fuentes TEXT, caduca TEXT, usado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ia_ideas (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, titulo TEXT, angulo TEXT,
  formato TEXT, gancho TEXT, por_que TEXT, fuentes TEXT, estado TEXT DEFAULT 'nueva', guion TEXT);
CREATE TABLE IF NOT EXISTS ia_escenas (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, video TEXT, url TEXT,
  momentos TEXT, usado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ia_referencias (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, para TEXT,
  miniatura TEXT, imagenes TEXT, usado INTEGER DEFAULT 0);
`);

export const AJUSTES_POR_DEFECTO = {
  // Horario: días 1=lunes … 7=domingo
  'horario.dias': [1, 2, 3, 4, 5, 6, 7],
  'horario.despertar': '00:00',
  'horario.dormir': '23:59',
  'horario.suspender': false,             // suspender el equipo fuera de horario (solo en Linux)
  'llm.url': process.env.LLM_URL || 'http://127.0.0.1:1234',
  'acelerador.activo': false,             // usar un equipo con GPU (agente en acelerador/) cuando esté encendido
  'acelerador.token': '',                 // lo genera el servidor; el agente lo lleva en su config
  'whisper.binario': process.env.WHISPER_BIN || 'whisper-cli', // whisper.cpp para transcribir
  'whisper.modelo': process.env.WHISPER_MODELO || path.join(DATOS, 'modelos', 'ggml-small-q5_1.bin'),
  'whisper.hilos': 4,
  'clips.horizontal_auto': true,          // versión horizontal de cada clip nuevo, en segundo plano
  'tiktok.max_dia': 10,                   // publicaciones en TikTok al día como máximo
  'canal.estrategia': '',                 // reglas que salen del análisis de las estadísticas del canal
  'canal.estrategia_fecha': null,
  'clips.activo': true,                   // Clips con OpenShorts (cola, canales y ventana nocturna)
  'clips.desde': '21:00',                 // ventana para procesar la cola (los urgentes van a cualquier hora)
  'clips.hasta': '03:00',
  'clips.revisar_min': 60,                // cada cuánto se miran los canales
  'clips.api': process.env.OPENSHORTS_URL || 'http://127.0.0.1:8000', // API de OpenShorts
  'clips.salida': process.env.OPENSHORTS_SALIDA || path.join(DATOS, 'openshorts', 'output'),
  'clips.carpeta': path.join(ARCHIVOS, 'Clips'), // carpeta donde se copian los clips terminados
  'clips.entrada': path.join(DATOS, 'clips-entrada'), // grabaciones y archivos para procesar
  'clips.gancho': true,                   // anteponer la frase más fuerte de cada clip ("cold open")
  'clips.zoom_pausa': true,               // reacciones: cara a pantalla completa cuando el contenido se pausa
  'clips.tramo_min': 30,                  // directos: cada cuántos minutos se corta un tramo para clipear
  'youtube.privacidad': 'public',         // public | unlisted | private (sin auditoría, YouTube los deja privados)
  'youtube.auto_min': 0,                  // publicar solos los clips con esta puntuación o más (0 = solo a mano)
  'ia.gemini_max_dia': 30,                // tope de llamadas a Gemini al día desde el panel (Groq va primero)
  'youtube.max_dia': 6,                   // tope de subidas al día (la cuota de la API es corta)
  'avisos.activo': false,                 // avisos al móvil con ntfy
  'avisos.url': '',                       // tema ntfy, p. ej. https://ntfy.sh/mi-tema-secreto
  'avisos.token': '',
  'avisos.panel': '',                     // al tocar el aviso se abre esta dirección (el panel)
  'panel.clave_hash': '',
  'primeros_pasos.oculto': false,        // la lista «Primeros pasos» de Inicio, plegada por el dueño
  // Telemetría opcional (src/telemetria.mjs, TELEMETRY.md): id aleatorio de la instalación y qué se contó ya.
  'telemetria.preguntado': false,
  'telemetria.id': '',
  'telemetria.pasos': [],
  'telemetria.clips': 0,
  'telemetria.dia': '',
};

// Los ajustes del registro único (src/ajustes-registro.mjs) también se pueden guardar.
import { DEFECTOS_REGISTRO, APAGA } from './ajustes-registro.mjs';
for (const [k, v] of Object.entries(DEFECTOS_REGISTRO)) if (!(k in AJUSTES_POR_DEFECTO)) AJUSTES_POR_DEFECTO[k] = v;

// Columnas añadidas después. En una instalación nueva, un módulo puede querer añadir una columna a una tabla que otro módulo
// crea más tarde (según el orden de importación): entonces queda pendiente y se añade al terminar de cargar (server.mjs).
const columnasEnEspera = [];
export function columna(tabla, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all();
  if (!cols.length) { columnasEnEspera.push([tabla, col, def]); return; }
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`);
}
export function columnasPendientes() { for (const [t, c, d] of columnasEnEspera.splice(0)) columna(t, c, d); }

export function ajustes({ crudo = false } = {}) {
  const out = { ...AJUSTES_POR_DEFECTO };
  for (const { clave, valor } of db.prepare('SELECT clave, valor FROM ajustes').all()) {
    try { out[clave] = JSON.parse(valor); } catch { out[clave] = valor; }
  }
  // Interruptores generales apagados: sus ajustes dependientes se leen como apagados (lo guardado no cambia).
  if (!crudo) for (const [m, deps] of Object.entries(APAGA)) if (out[m] === false) Object.assign(out, deps);
  return out;
}
export function guardarAjustes(obj) {
  const st = db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in AJUSTES_POR_DEFECTO)) continue;
    st.run(k, JSON.stringify(v));
  }
}
