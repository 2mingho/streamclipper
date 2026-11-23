// Clips: vídeos largos → clips verticales con OpenShorts (Docker en este servidor, API en :8000).
//  1. Entran vídeos a una cola: a mano desde el panel (enlace o archivo del servidor) o de los canales
//     de YouTube que se vigilan (cada hora se miran sus vídeos nuevos).
//  2. Dentro de la ventana nocturna (o ya, si se marcó "procesar ahora") se manda UNO cada vez a OpenShorts
//     con el preset de su tipo: encuadre, duración de los clips y enfoque para Gemini (campo clip_focus,
//     parche local de OpenShorts).
//  3. Al terminar, los clips se copian a la carpeta compartida (Clips/<fecha> <título>/) con un textos.txt
//     y llega un aviso al móvil.
import { execFile, spawn } from 'node:child_process';
import { openAsBlob, readFileSync, existsSync, statSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, chmodSync, rmSync, constants as FS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, ajustes } from '../db.mjs';
import { avisarSinFallo } from '../avisos.mjs';
import { postprocesar, juegoDeTitulo, textosVerificados, repasarTextos, cambiarGancho } from './clips-post.mjs';
import { encolarHorizontales, aplicarEncuadreAprendido } from './clips-editor.mjs';
import { tramoSinVer } from './transcripciones.mjs';
import { cicloYoutube, pedirAutomaticas } from './youtube.mjs';
import { cicloTiktok } from './tiktok.mjs';
import { lecciones } from './clips-valoracion.mjs';
import { aceleradorDisponible, encargar } from '../acelerador.mjs';
import { leerChat, picosChat, enfoquePicos, picosVoz, combinarPicos, enfoqueReacciones } from './clips-picos.mjs';
import { perfil as perfilCampana, perfilDeVideo, esDelJuego, pareceEspanol, conTagsCampana } from './campanas.mjs';
import * as Twitch from './twitch.mjs';

const LINUX = process.platform === 'linux';

db.exec(`
CREATE TABLE IF NOT EXISTS clip_canales (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  url TEXT NOT NULL,                        -- canal de YouTube (pestaña Vídeos o Directos)
  tipo TEXT NOT NULL DEFAULT 'general',     -- preset: reaccion | conversacion | formativo | general
  enfoque TEXT NOT NULL DEFAULT '',         -- indicaciones extra para Gemini
  min_min INTEGER NOT NULL DEFAULT 3,       -- duración de los vídeos que se procesan (minutos)
  max_min INTEGER NOT NULL DEFAULT 180,
  ultimos INTEGER NOT NULL DEFAULT 0,       -- al añadir el canal: cuántos de los vídeos ya publicados procesar
  activo INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  revisado TEXT                             -- última revisión (NULL = nunca: la primera marca lo publicado como visto)
);
CREATE TABLE IF NOT EXISTS clip_videos (
  id INTEGER PRIMARY KEY,
  canal_id INTEGER REFERENCES clip_canales(id) ON DELETE SET NULL,
  fuente TEXT NOT NULL,                     -- URL o ruta de un archivo del servidor
  video TEXT,                               -- id de YouTube (para no repetir los de un canal)
  titulo TEXT, duracion_s INTEGER,
  tipo TEXT NOT NULL DEFAULT 'general',
  enfoque TEXT NOT NULL DEFAULT '',
  urgente INTEGER NOT NULL DEFAULT 0,       -- 1 = no esperar a la ventana nocturna
  estado TEXT NOT NULL DEFAULT 'cola',      -- cola | procesando | listo | error | descartado
  job TEXT, paso TEXT, error TEXT,
  clips TEXT,                               -- JSON con los clips (título, puntuación, gancho, textos, archivo)
  carpeta TEXT,                             -- carpeta compartida donde se copiaron
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  enviado TEXT, terminado TEXT
);
CREATE INDEX IF NOT EXISTS clip_videos_estado ON clip_videos(estado);
-- Directos que se están grabando y clipeando por tramos mientras emiten
CREATE TABLE IF NOT EXISTS clip_directos (
  id INTEGER PRIMARY KEY,
  canal_id INTEGER REFERENCES clip_canales(id) ON DELETE SET NULL,
  video TEXT NOT NULL, titulo TEXT,
  archivo TEXT NOT NULL,                    -- grabación .ts (se puede leer mientras crece)
  inicio TEXT NOT NULL DEFAULT (datetime('now')),
  cortado_s INTEGER NOT NULL DEFAULT 0,     -- segundos ya enviados como tramos
  tramos INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'grabando',  -- grabando | terminado | error
  fin TEXT, error TEXT
);
`);
// Columna de campaña (también la añade tareas/campanas.mjs si las tablas ya existían).
for (const [t, c] of [['clip_canales', 'campana'], ['clip_videos', 'campana']])
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`);
// Canales: clipear sus directos mientras emiten (columna añadida después).
try { db.exec('ALTER TABLE clip_canales ADD COLUMN vivo INTEGER NOT NULL DEFAULT 0'); } catch {}
// Canal «horizontal»: sus clips también salen en 16:9 (para los recopilatorios).
try { db.exec('ALTER TABLE clip_canales ADD COLUMN horizontal INTEGER NOT NULL DEFAULT 0'); } catch {}
// Prioridad del canal en la cola (1 = primero).
try { db.exec('ALTER TABLE clip_canales ADD COLUMN prioridad INTEGER NOT NULL DEFAULT 3'); } catch {}
// Cierre de cada clip: invitación al canal del creador (vacío = se deduce del @ del canal; "-" = sin cierre).
try { db.exec("ALTER TABLE clip_canales ADD COLUMN cierre TEXT NOT NULL DEFAULT ''"); } catch {}
// Canal sin cámara (streamer con avatar): la revisión de encuadre no exige cara.
try { db.exec('ALTER TABLE clip_canales ADD COLUMN sin_cara INTEGER NOT NULL DEFAULT 0'); } catch {}
// Tramos de directos: segundo del directo en que empieza el tramo (para enlazar al minuto exacto del original).
try { db.exec('ALTER TABLE clip_videos ADD COLUMN offset_s INTEGER NOT NULL DEFAULT 0'); } catch {}
// Picos del chat (directos) o de «lo más visto» (vídeos) del tramo: [{t, intensidad, muestra}] en segundos del tramo.
try { db.exec('ALTER TABLE clip_videos ADD COLUMN picos TEXT'); } catch {}
// Directo detenido a mano: 0 = no · 1 = parar y clipear lo grabado · 2 = parar y descartar lo pendiente. Mientras no sea 0, ese directo no se vuelve a grabar.
try { db.exec('ALTER TABLE clip_directos ADD COLUMN detenido INTEGER NOT NULL DEFAULT 0'); } catch {}

// Canal del creador: "youtube.com/@nombre" a partir de su URL.
export const handleCanal = (url) => { const m = String(url || '').match(/youtube\.com\/(@[\w.-]+)/); return m ? `youtube.com/${m[1]}` : ''; };
export function datosCreador(v) {
  const c = v.canal_id ? db.prepare('SELECT * FROM clip_canales WHERE id = ?').get(v.canal_id) : null;
  const canalUrl = c ? (handleCanal(c.url) || c.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/(videos|streams|featured)$/, '')) : '';
  const lineas = !c || c.cierre === '-' ? null : c.cierre ? c.cierre.split('|').map((x) => x.trim()).filter(Boolean)
    : [c.vivo ? 'Mira sus directos en' : 'Mira el vídeo completo en', canalUrl];
  return { canal: c, canalUrl, lineas };
}
// Nombre corto del creador para títulos y textos: «Kai Cenat · Twitch (EN)» → «Kai Cenat».
export const nombreCreador = (nombre = '') => String(nombre).replace(/\s*\((EN|ES)\)\s*$/i, '').replace(/\s*·.*$/, '').trim();

// Momentos que una IA externa (Gemini vía MCP) marcó tras ver el vídeo entero, en segundos DE ESTE vídeo de la cola:
// los tramos (vídeos troceados o directos) empiezan en offset_s del original, y Gemini da tiempos del original.
// Solo los que caen dentro del tramo; si dos marcas se solapan, queda la de más puntuación.
export function momentosIA(v) {
  let filas = [];
  try {
    filas = db.prepare('SELECT momentos FROM ia_escenas WHERE video = ? OR video = ? ORDER BY id DESC LIMIT 3').all(String(v.video || ''), String(v.id))
      .flatMap((r) => { try { return JSON.parse(r.momentos); } catch { return []; } });
  } catch { return []; }
  const off = Number(v.offset_s) || 0, dur = Number(v.duracion_s) || Infinity;
  const dentro = filas.map((m) => ({ ...m, inicio_s: +(m.inicio_s - off).toFixed(2), fin_s: +(m.fin_s - off).toFixed(2) }))
    .filter((m) => m.inicio_s >= -3 && m.fin_s <= dur + 3 && m.fin_s > m.inicio_s)
    .map((m) => ({ ...m, inicio_s: Math.max(0, m.inicio_s), fin_s: Math.min(dur, m.fin_s) }))
    .sort((a, b) => (b.puntuacion ?? 0) - (a.puntuacion ?? 0));
  const out = [];
  for (const m of dentro) if (!out.some((o) => Math.min(o.fin_s, m.fin_s) - Math.max(o.inicio_s, m.inicio_s) > 0.5 * (m.fin_s - m.inicio_s))) out.push(m);
  return out.sort((a, b) => a.inicio_s - b.inicio_s);
}
// ¿Gemini ya analizó el vídeo original (aunque no marcara nada en este tramo)?
const analizadoPorIA = (v) => !!db.prepare('SELECT 1 FROM ia_escenas WHERE video = ? OR video = ? LIMIT 1').get(String(v.video || ''), String(v.id));
// Clip de Twitch: su propia URL (no hay vídeo de YouTube al que enlazar).
const enlaceOriginal = (v, seg) => (/twitch\.tv\//i.test(v.fuente || '') ? v.fuente : v.video ? `https://youtu.be/${v.video}?t=${Math.max(0, Math.floor((v.offset_s || 0) + seg))}` : (esUrl(v.fuente) ? v.fuente : ''));

// ---------- presets por tipo de vídeo ----------
export const TIPOS = {
  reaccion: {
    nombre: 'Reacción', desc: 'Una persona reacciona en cámara a otro vídeo: contenido arriba y su cara debajo.',
    layouts: 'screencast', min: 20, max: 50,
    enfoque: 'Vídeo de reacción: una persona reacciona en cámara a otro contenido. Elige los momentos con reacciones fuertes o graciosas, '
      + 'comentarios polémicos, sarcásticos o exagerados, sorpresa, indignación o risa, en los que lo que se ve y lo que dice quien reacciona '
      + 'se entienden sin contexto. Descarta silencios, explicaciones largas y tramos del contenido sin reacción.',
  },
  conversacion: {
    nombre: 'Podcast / entrevista', desc: 'Conversación entre personas: apila a dos personas cuando salen juntas.',
    layouts: 'auto,split', min: 25, max: 60,
    enfoque: 'Conversación entre personas. Prioriza opiniones polémicas o contundentes, desacuerdos, confesiones, anécdotas con remate, '
      + 'frases citables y momentos graciosos. Cada clip debe contener una idea completa: gancho al principio y remate al final.',
  },
  formativo: {
    nombre: 'Formativo / consejos', desc: 'Clases, directos de finanzas, tutoriales: diapositiva arriba y cara debajo; consejos puntuales.',
    layouts: 'auto,split,screencast', min: 30, max: 75,
    enfoque: 'Contenido formativo. Elige consejos puntuales y aplicables, cifras concretas, errores comunes, mitos desmentidos y pasos claros '
      + 'que se entiendan solos, sin el resto del vídeo. Prefiere frases que prometan un beneficio o adviertan de un error. '
      + 'Evita saludos, promociones de cursos o productos, lectura de preguntas del chat y transiciones.',
  },
  gaming: {
    nombre: 'Directo de videojuegos', desc: 'Streamer jugando con su cámara en un recuadro: juego arriba y su cara debajo. 5 clips por tramo.',
    layouts: 'screencast', min: 20, max: 45, n: 5,
    enfoque: 'Directo de videojuegos con la cámara del streamer. Busca momentos virales: reacciones exageradas o graciosas del streamer, '
      + 'fails, caos, choques, persecuciones, sustos, rabia, jugadas épicas, frases memorables, bromas con el chat y descubrimientos '
      + 'sorprendentes del juego. Prioriza lo que alguien mandaría a un amigo («bro, este eres tú»): karma instantáneo (presume y le sale mal en segundos), NPC o policía que se defienden, momentos con los protagonistas del juego, «lo dije» y fallos graciosos; con la reacción real visible y el remate dentro del clip. Evita menús, pantallas de carga, silencios y tramos de conducir o caminar sin que pase nada.',
  },
  general: { nombre: 'General', desc: 'Sin indicaciones: OpenShorts decide el encuadre y busca lo más viral.', layouts: 'auto', min: 0, max: 0, enfoque: '' },
};
const tipoValido = (t) => (TIPOS[t] ? t : 'general');

// ---------- utilidades ----------
const ejecutar = (cmd, args, { timeout = 120000 } = {}) => new Promise((ok, mal) => {
  execFile(cmd, args, { timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => (err ? mal(new Error(String(stderr || err.message).split('\n').filter((l) => l && !/^WARNING/.test(l)).join(' ').slice(0, 300) || err.message)) : ok(String(stdout))));
});
const ahoraIso = () => new Date().toISOString();
const aMin = (h) => { const [a, b] = String(h || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
export function enVentana(cfg = ajustes(), d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes(), ini = aMin(cfg['clips.desde']), fin = aMin(cfg['clips.hasta']);
  return ini <= fin ? m >= ini && m < fin : m >= ini || m < fin;
}
const api = () => String(ajustes()['clips.api'] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const esUrl = (s) => /^https?:\/\//i.test(String(s));
const idYoutube = (u) => (String(u).match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/) || [])[1] || null;
// Canal sin pestaña → pestaña Vídeos (la raíz del canal lista pestañas, no vídeos).
const urlCanal = (u) => (/youtube\.com\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)\/?$/.test(u) ? `${u.replace(/\/$/, '')}/videos` : u);
const limpio = (t, n = 90) => String(t || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, n).trim() || 'sin título';
const parseVideo = (v) => v && { ...v, urgente: !!v.urgente, clips: v.clips ? JSON.parse(v.clips) : [] };

// ---------- archivos del servidor (grabaciones de directos, etc.) ----------
export function archivosEntrada() {
  const dir = ajustes()['clips.entrada'];
  try {
    return readdirSync(dir).filter((f) => /\.(mp4|mkv|mov|webm)$/i.test(f) && !/\.f\d+\.\w+$/.test(f))
      .map((f) => { const s = statSync(path.join(dir, f)); return { nombre: f, ruta: path.join(dir, f), bytes: s.size, fecha: s.mtime.toISOString() }; })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  } catch { return []; }
}

// Aprobación: con `aprobar` = 1 (por defecto) los vídeos nuevos de un canal quedan «propuestos» hasta que los apruebes.
if (!db.prepare('PRAGMA table_info(clip_canales)').all().some((c) => c.name === 'aprobar')) db.exec('ALTER TABLE clip_canales ADD COLUMN aprobar INTEGER NOT NULL DEFAULT 1');

// ---------- cola ----------
export const videos = {
  recientes: () => db.prepare(`SELECT v.*, c.nombre AS canal FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
    WHERE v.estado NOT IN ('descartado', 'propuesto') ORDER BY CASE v.estado WHEN 'procesando' THEN 0 WHEN 'cola' THEN 1 ELSE 2 END, COALESCE(v.terminado, v.creado) DESC LIMIT 80`).all().map(parseVideo),
  // Vídeos de los canales que esperan tu aprobación (los más nuevos primero).
  propuestos: () => db.prepare(`SELECT v.id, v.video, v.titulo, v.duracion_s, v.tipo, v.creado, v.canal_id, c.nombre AS canal FROM clip_videos v
    LEFT JOIN clip_canales c ON c.id = v.canal_id WHERE v.estado = 'propuesto' ORDER BY v.id DESC LIMIT 60`).all(),
  aprobar(id, urgente = false) { return db.prepare("UPDATE clip_videos SET estado='cola', urgente=? WHERE id = ? AND estado = 'propuesto'").run(urgente ? 1 : 0, Number(id)).changes; },
  descartarPropuesto(id) { return db.prepare("UPDATE clip_videos SET estado='descartado' WHERE id = ? AND estado = 'propuesto'").run(Number(id)).changes; },
  uno: (id) => parseVideo(db.prepare('SELECT * FROM clip_videos WHERE id = ?').get(Number(id))),
  // Para la galería: todos los vídeos con clips listos, del más reciente al más antiguo.
  listos: () => db.prepare(`SELECT v.*, c.nombre AS canal FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
    WHERE v.estado = 'listo' ORDER BY COALESCE(v.terminado, v.creado) DESC LIMIT 400`).all().map(parseVideo),
  async añadir({ fuente, tipo, enfoque = '', urgente = false, titulo = '' }) {
    fuente = String(fuente || '').trim();
    if (!fuente) throw new Error('Falta el enlace o el archivo');
    if (esUrl(fuente)) { if (!/^https?:\/\/([\w-]+\.)*(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)\//i.test(fuente)) throw new Error('Por ahora: enlaces de YouTube, Vimeo o Twitch'); }
    else {
      const dir = path.resolve(ajustes()['clips.entrada']);
      const r = path.resolve(fuente);
      if (!r.startsWith(dir + path.sep) || !existsSync(r)) throw new Error('El archivo debe estar en la carpeta de entrada del servidor');
      fuente = r;
    }
    let dur = null;
    if (esUrl(fuente) && !titulo) {
      try {
        const [t, d, vivo] = (await ejecutar('yt-dlp', ['--skip-download', '--no-playlist', '--print', '%(title)s\t%(duration)s\t%(live_status)s', fuente], { timeout: 60000 })).trim().split('\t');
        if (/is_live|is_upcoming/.test(vivo)) throw new Error('Ese vídeo está en directo o aún no ha empezado: añádelo cuando termine');
        titulo = t; dur = Number(d) || null;
      } catch (e) { if (/directo/.test(e.message)) throw e; }
    }
    if (!esUrl(fuente) && !titulo) titulo = path.basename(fuente).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ');
    return Number(db.prepare('INSERT INTO clip_videos (fuente, video, titulo, duracion_s, tipo, enfoque, urgente) VALUES (?,?,?,?,?,?,?)')
      .run(fuente, idYoutube(fuente), String(titulo || fuente).slice(0, 300), dur, tipoValido(tipo), String(enfoque).trim().slice(0, 600), urgente ? 1 : 0).lastInsertRowid);
  },
  // Rehacer: copia el vídeo con otro tipo o enfoque (los clips anteriores se conservan).
  rehacer(id, { tipo, enfoque, urgente }) {
    const v = videos.uno(id); if (!v) throw new Error('No existe');
    return Number(db.prepare('INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, urgente) VALUES (?,?,?,?,?,?,?,?)')
      .run(v.canal_id, v.fuente, v.video, v.titulo, v.duracion_s, tipoValido(tipo ?? v.tipo), String(enfoque ?? v.enfoque).trim().slice(0, 600), urgente ? 1 : 0).lastInsertRowid);
  },
  quitar(id) { db.prepare("UPDATE clip_videos SET estado='descartado' WHERE id = ? AND estado IN ('cola','error')").run(Number(id)); },
  reintentar(id) { db.prepare("UPDATE clip_videos SET estado=CASE WHEN error LIKE 'Trocear:%' THEN 'troceando' ELSE 'cola' END, error=NULL, job=NULL, paso=NULL WHERE id = ? AND estado = 'error'").run(Number(id)); },
  urgente(id) { db.prepare("UPDATE clip_videos SET urgente=1 WHERE id = ? AND estado = 'cola'").run(Number(id)); },
};

// ---------- canales ----------
export const canales = {
  todos: () => db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM clip_videos v WHERE v.canal_id = c.id AND v.estado = 'listo') AS listos,
    (SELECT COUNT(*) FROM clip_videos v WHERE v.canal_id = c.id AND v.estado = 'cola') AS en_cola,
    (SELECT COUNT(*) FROM clip_videos v WHERE v.canal_id = c.id AND v.estado = 'propuesto') AS propuestos FROM clip_canales c ORDER BY c.nombre COLLATE NOCASE`).all().map((c) => ({ ...c, activo: !!c.activo, vivo: !!c.vivo, horizontal: !!c.horizontal, aprobar: c.aprobar !== 0 })),
  guardar(c) {
    const url = urlCanal(String(c.url || '').trim());
    const v = [String(c.nombre || '').trim().slice(0, 120), url, tipoValido(c.tipo), String(c.enfoque || '').trim().slice(0, 600),
      Math.max(1, Number(c.min_min) || 3), Math.max(1, Number(c.max_min) || 180), Math.min(5, Math.max(0, Number(c.ultimos) || 0)), c.activo === false ? 0 : 1, c.vivo ? 1 : 0,
      Math.min(9, Math.max(1, Number(c.prioridad) || 3)), String(c.cierre || '').trim().slice(0, 120), c.horizontal ? 1 : 0, c.aprobar === false ? 0 : 1];
    if (!v[0]) throw new Error('Falta el nombre');
    if (!/^https:\/\/(www\.)?youtube\.com\//.test(url)) throw new Error('El canal debe ser una dirección de YouTube');
    ultimaRevision = 0; ultimaRevisionVivo = 0; // revisar el canal en la próxima vuelta
    if (c.id) { db.prepare('UPDATE clip_canales SET nombre=?, url=?, tipo=?, enfoque=?, min_min=?, max_min=?, ultimos=?, activo=?, vivo=?, prioridad=?, cierre=?, horizontal=?, aprobar=? WHERE id=?').run(...v, Number(c.id)); return Number(c.id); }
    return Number(db.prepare('INSERT INTO clip_canales (nombre, url, tipo, enfoque, min_min, max_min, ultimos, activo, vivo, prioridad, cierre, horizontal, aprobar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...v).lastInsertRowid);
  },
  borrar: (id) => db.prepare('DELETE FROM clip_canales WHERE id = ?').run(Number(id)),
};

export async function revisarCanales({ log = console.log } = {}) {
  let nuevos = 0;
  for (const c of canales.todos().filter((x) => x.activo)) {
    // Canal de una campaña: solo si la campaña está activa, solo vídeos de su juego y los directos largos se trocean.
    const camp = c.campana ? perfilCampana(c.campana) : null;
    if (c.campana && !camp?.activa) continue;
    let lineas;
    // Canal de Twitch: los clips más vistos de las últimas horas (API Helix), filtrados por la categoría del juego si es de
    // una campaña (los títulos los ponen los espectadores y no siempre nombran el juego). Mismo formato que yt-dlp.
    const twitch = /twitch\.tv\//i.test(c.url);
    const urlDe = new Map();
    try {
      if (twitch) {
        if (!Twitch.conectado()) continue;
        const tw = { horas: 24, min_vistas: 200, max_por_canal: 3, ...(camp?.twitch || {}) };
        const clips = (await Twitch.clipsFrescos(Twitch.loginDe(c.url), { horas: tw.horas, juego: camp?.juego?.twitch || null, max: 20 }))
          .filter((x) => x.vistas >= tw.min_vistas && x.duracion >= (tw.min_seg ?? 20)).slice(0, tw.max_por_canal);
        for (const x of clips) urlDe.set(x.id, x.url);
        lineas = clips.map((x) => `${x.id}\tclip\t${x.duracion}\t${String(x.titulo || '').replace(/\t/g, ' ')} (${x.vistas} vistas en Twitch)`);
      } else {
        lineas = (await ejecutar('yt-dlp', ['--flat-playlist', '--playlist-end', '15', '--print', '%(id)s\t%(live_status)s\t%(duration)s\t%(title)s', c.url], { timeout: 120000 })).trim().split('\n').filter(Boolean);
      }
    } catch (e) { log(`Clips · ${c.nombre}: no se pudo leer el canal (${e.message})`); continue; }
    const conocidos = new Set(db.prepare('SELECT video FROM clip_videos WHERE canal_id = ? AND video IS NOT NULL').all(c.id).map((r) => r.video));
    const primera = !c.revisado;
    // Con aprobación: la primera vez se proponen los 5 más recientes; después, todo lo nuevo. Sin ella, como siempre.
    let aProcesar = primera ? (c.aprobar ? 5 : c.ultimos) : Infinity;
    for (const l of lineas) {
      const [id, vivo, dur, ...t] = l.split('\t');
      const seg = Number(dur);
      if (!id || conocidos.has(id) || /is_live|is_upcoming|post_live/.test(vivo)) continue; // en directo: se recoge cuando termine
      if (camp && !twitch && !esDelJuego(camp, t.join(' '))) continue;
      const trocear = !!camp && seg > c.max_min * 60;  // directo largo de campaña: solo sus tramos más re-vistos
      if (!seg || seg < c.min_min * 60 || (seg > c.max_min * 60 && !trocear)) continue;
      const entra = aProcesar > 0;
      if (entra) aProcesar--;
      db.prepare('INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, estado, campana) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(c.id, urlDe.get(id) || `https://www.youtube.com/watch?v=${id}`, id, t.join('\t').slice(0, 300), seg, c.tipo, c.enfoque, entra ? (trocear ? 'troceando' : c.aprobar ? 'propuesto' : 'cola') : 'descartado', c.campana || null);
      if (entra) { nuevos++; log(`Clips · ${c.nombre}: ${c.aprobar ? 'propuesto' : 'a la cola'} «${t.join(' ')}» (${Math.round(seg / 60)} min)`); }
    }
    db.prepare('UPDATE clip_canales SET revisado = ? WHERE id = ?').run(ahoraIso(), c.id);
  }
  return nuevos;
}

// «Últimos 5» de un canal: sus 5 vídeos más recientes que encajan en su duración, como propuestos para elegir.
// Los ya procesados o en cola no se tocan; los que se descartaron sin procesar vuelven a proponerse.
export async function proponerUltimos(canalId, cuantos = 5) {
  const c = canales.todos().find((x) => x.id === Number(canalId)); if (!c) throw new Error('Ese canal no existe');
  const lineas = (await ejecutar('yt-dlp', ['--flat-playlist', '--playlist-end', '20', '--print', '%(id)s\t%(live_status)s\t%(duration)s\t%(title)s', c.url], { timeout: 120000 })).trim().split('\n').filter(Boolean);
  let n = 0, vistos = 0;
  for (const l of lineas) {
    if (vistos >= cuantos) break;
    const [id, vivo, dur, ...t] = l.split('\t');
    const seg = Number(dur);
    if (!id || /is_live|is_upcoming|post_live/.test(vivo) || !seg || seg < c.min_min * 60 || seg > c.max_min * 60) continue;
    vistos++;
    const previo = db.prepare('SELECT id, estado, job FROM clip_videos WHERE canal_id = ? AND video = ? ORDER BY id DESC LIMIT 1').get(c.id, id);
    if (!previo) {
      db.prepare("INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, estado) VALUES (?,?,?,?,?,?,?,'propuesto')")
        .run(c.id, `https://www.youtube.com/watch?v=${id}`, id, t.join('\t').slice(0, 300), seg, c.tipo, c.enfoque); n++;
    } else if (previo.estado === 'descartado' && !previo.job) { db.prepare("UPDATE clip_videos SET estado='propuesto' WHERE id = ?").run(previo.id); n++; }
  }
  db.prepare('UPDATE clip_canales SET revisado = COALESCE(revisado, ?) WHERE id = ?').run(ahoraIso(), c.id);
  return n;
}

// ---------- directos: grabar y clipear por tramos mientras emiten ----------
// La grabación va a un .ts (MPEG-TS se puede leer mientras crece). Cada `clips.tramo_min` minutos se corta el
// tramo nuevo sin recodificar y entra en la cola como urgente; al acabar el directo se corta lo que quede.
const grabaciones = new Map(); // id de clip_directos -> proceso yt-dlp
const pestañaDirectos = (u) => `${String(u).replace(/\/(videos|streams|featured|shorts)\/?$/, '').replace(/\/$/, '')}/streams`;
const hhmm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const duracionArchivo = (f) => ejecutar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { timeout: 60000 }).then((s) => Number(s.trim()) || 0).catch(() => 0);

export const directos = {
  activos: () => db.prepare(`SELECT d.*, c.nombre AS canal FROM clip_directos d LEFT JOIN clip_canales c ON c.id = d.canal_id
    WHERE d.estado = 'grabando' OR d.fin > datetime('now', '-12 hours') ORDER BY d.id DESC LIMIT 5`).all(),
  // Para la grabación desde el panel. descartar = false: lo ya grabado se corta y va a la cola como siempre.
  // descartar = true: no se corta nada más y salen de la cola los tramos de este directo que aún no empezaron.
  detener(id, { descartar = false } = {}) {
    const d = db.prepare('SELECT * FROM clip_directos WHERE id = ?').get(Number(id));
    if (!d || d.estado !== 'grabando') throw new Error('Ese directo ya no se está grabando');
    if (d.detenido) return; // ya se está parando
    db.prepare('UPDATE clip_directos SET detenido = ? WHERE id = ?').run(descartar ? 2 : 1, d.id);
    if (descartar) {
      const base = d.archivo.replace(/\.ts$/, '-tramo');
      db.prepare("UPDATE clip_videos SET estado = 'descartado' WHERE video = ? AND estado = 'cola' AND substr(fuente, 1, ?) = ?").run(d.video, base.length, base);
    }
    const p = grabaciones.get(d.id);
    if (!p) { terminarGrabacion(d.id, null).catch((e) => console.error('Clips: fin de directo:', e.message)); return; }
    p.kill('SIGTERM'); // al salir, su evento «exit» cierra la grabación
    setTimeout(() => { if (grabaciones.get(d.id) === p) p.kill('SIGKILL'); }, 10000).unref();
  },
  // Deshace la parada: si el directo sigue en emisión, la próxima revisión abre una grabación nueva.
  reanudar(id) {
    const d = db.prepare('SELECT * FROM clip_directos WHERE id = ?').get(Number(id));
    if (!d || d.estado === 'grabando') throw new Error('Ese directo no está detenido');
    db.prepare('UPDATE clip_directos SET detenido = 0 WHERE video = ?').run(d.video);
    ultimaRevisionVivo = 0;
  },
};

// YouTube da los directos con vídeo y audio por separado (HLS): yt-dlp saca las dos direcciones y ffmpeg las graba
// juntas en un .ts que se puede leer mientras crece. Las direcciones caducan a las ~6 h: si ffmpeg se corta y el
// directo sigue, la próxima revisión abre otra grabación.
async function empezarGrabacion(canal, video, titulo) {
  const dir = ajustes()['clips.entrada'];
  mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `directo-${video}-${Date.now()}.ts`);
  const id = Number(db.prepare('INSERT INTO clip_directos (canal_id, video, titulo, archivo) VALUES (?,?,?,?)').run(canal.id, video, titulo, archivo).lastInsertRowid);
  let urls;
  // 1080p (el juego se ve tal cual en el clip, así que se nota la resolución); si no hay, lo mejor por debajo.
  try { urls = (await ejecutar('yt-dlp', ['-g', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', `https://www.youtube.com/watch?v=${video}`], { timeout: 90000 })).trim().split('\n').filter((u) => /^https?:/.test(u)); }
  catch (e) { urls = []; console.error('Clips: no se pudo abrir el directo:', e.message); }
  if (!urls.length) { db.prepare("UPDATE clip_directos SET estado='error', fin=datetime('now'), error=? WHERE id=?").run('No se pudieron obtener las direcciones del directo', id); return; }
  const entradas = urls.slice(0, 2).flatMap((u) => ['-i', u]);
  const mapas = urls.length > 1 ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0', '-map', '0:a:0?'];
  const p = spawn('ffmpeg', ['-v', 'error', '-y', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '15', ...entradas, ...mapas, '-c', 'copy', '-f', 'mpegts', archivo], { stdio: ['ignore', 'ignore', 'pipe'] });
  // El chat se graba a la vez (para encontrar los picos de comentarios): <grabación>.live_chat.json.
  const chat = spawn('yt-dlp', ['--skip-download', '--write-subs', '--sub-langs', 'live_chat', '--no-part', '-o', archivo.replace(/\.ts$/, ''), `https://www.youtube.com/watch?v=${video}`], { stdio: 'ignore' });
  chat.on('error', () => {});
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  p.on('exit', (code) => {
    try { chat.kill(); } catch {}
    grabaciones.delete(id);
    terminarGrabacion(id, code === 0 ? null : err.trim().split('\n').pop()).catch((e) => console.error('Clips: fin de directo:', e.message));
  });
  grabaciones.set(id, p);
  console.log(`Clips: grabando el directo «${titulo}» de ${canal.nombre}`);
  avisarSinFallo('Directo detectado', `${canal.nombre}: «${titulo}». Grabando; cada ${ajustes()['clips.tramo_min']} min salen clips.`, { etiquetas: ['red_circle'] });
}

// Corta [desde, hasta) de la grabación y lo mete en la cola como urgente.
async function encolarTramo(d, desde, hasta, ultimo = false) {
  const canal = db.prepare('SELECT * FROM clip_canales WHERE id = ?').get(d.canal_id) || {};
  const n = d.tramos + 1;
  const salida = d.archivo.replace(/\.ts$/, `-tramo${n}.mp4`);
  await ejecutar('nice', ['-n', '5', 'ffmpeg', '-v', 'error', '-y', '-ss', String(desde), '-i', d.archivo, ...(hasta ? ['-t', String(hasta - desde)] : []),
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', salida], { timeout: 600000 });
  const dur = await duracionArchivo(salida);
  db.prepare('UPDATE clip_directos SET cortado_s = ?, tramos = ? WHERE id = ?').run(Math.round(desde + dur), n, d.id);
  if (dur < 120) return; // un resto de menos de 2 min no da para clips
  if (db.prepare('SELECT detenido FROM clip_directos WHERE id = ?').get(d.id)?.detenido === 2) return; // descartado mientras se cortaba
  // Picos del chat en este tramo (la grabación empezó en clip_directos.inicio, hora UTC del servidor).
  let picos = [];
  try { picos = picosChat(leerChat(d.archivo.replace(/\.ts$/, '.live_chat.json'), Date.parse(`${d.inicio.replace(' ', 'T')}Z`) / 1000), desde, desde + dur); }
  catch (e) { console.error('Clips: picos del chat:', e.message); }
  // Reacciones del streamer en el audio (gritos, carcajadas): sin API, con ffmpeg sobre el tramo.
  try { picos = combinarPicos(picos, await picosVoz(salida)); } catch (e) { console.error('Clips: picos de voz:', e.message); }
  db.prepare('INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, urgente, offset_s, picos) VALUES (?,?,?,?,?,?,?,1,?,?)')
    .run(d.canal_id, salida, d.video, `${d.titulo} · tramo ${n} (${hhmm(desde)}–${hhmm(desde + dur)})${ultimo ? ' · final' : ''}`, Math.round(dur), tipoValido(canal.tipo), canal.enfoque || '', Math.round(desde), JSON.stringify(picos));
  if (picos.length) console.log(`Clips: tramo ${n}: ${picos.length} pico(s) (${picos.map((p) => `${hhmm(p.t)} ×${p.intensidad} ${p.tipos.join('+')}`).join(', ')})`);
  console.log(`Clips: tramo ${n} del directo «${d.titulo}» a la cola (${Math.round(dur / 60)} min)`);
}

async function terminarGrabacion(id, error) {
  const d = db.prepare('SELECT * FROM clip_directos WHERE id = ?').get(id);
  if (!d || d.estado !== 'grabando') return;
  if (d.detenido) error = null; // lo paró el usuario: el código de salida de ffmpeg no es un fallo
  if (d.detenido !== 2 && existsSync(d.archivo)) { try { await encolarTramo(d, d.cortado_s, null, true); } catch (e) { error = error || e.message; } }
  db.prepare("UPDATE clip_directos SET estado = ?, fin = datetime('now'), error = ? WHERE id = ?").run(error && !existsSync(d.archivo) ? 'error' : 'terminado', error || null, id);
  if (d.detenido) { console.log(`Clips: directo «${d.titulo}» detenido desde el panel`); return; }
  const fin = db.prepare('SELECT tramos FROM clip_directos WHERE id = ?').get(id);
  avisarSinFallo('Directo terminado', `«${d.titulo}»: ${fin.tramos} tramo(s) enviados a la cola de clips.${error ? ` Aviso: ${String(error).slice(0, 120)}` : ''}`, { etiquetas: ['checkered_flag'] });
}

// Al arrancar el panel: una grabación sin proceso (reinicio) se cierra cortando lo que quedaba.
for (const d of db.prepare("SELECT id FROM clip_directos WHERE estado = 'grabando'").all()) terminarGrabacion(d.id, 'La grabación se cortó por un reinicio del panel').catch(() => {});

let ultimaRevisionVivo = 0;
async function revisarDirectos() {
  for (const c of canales.todos().filter((x) => x.activo && x.vivo)) {
    let lineas = [];
    try { lineas = (await ejecutar('yt-dlp', ['--flat-playlist', '--playlist-end', '4', '--print', '%(id)s\t%(live_status)s\t%(title)s', pestañaDirectos(c.url)], { timeout: 90000 })).trim().split('\n').filter(Boolean); }
    catch (e) { console.error(`Clips · ${c.nombre}: no se pudo mirar si está en directo (${e.message})`); continue; }
    for (const l of lineas) {
      const [id, vivo, ...t] = l.split('\t');
      if (vivo !== 'is_live') continue;
      if (db.prepare("SELECT 1 FROM clip_directos WHERE video = ? AND (estado = 'grabando' OR detenido > 0)").get(id)) continue;
      await empezarGrabacion(c, id, t.join(' ').replace(/^[🔴\s]+/u, '').slice(0, 200));
    }
  }
}

async function cortarTramos() {
  const tramo = Math.max(10, Number(ajustes()['clips.tramo_min']) || 30) * 60;
  for (const d of db.prepare("SELECT * FROM clip_directos WHERE estado = 'grabando'").all()) {
    if (!grabaciones.has(d.id) || !existsSync(d.archivo)) continue;
    const dur = await duracionArchivo(d.archivo);
    if (dur - d.cortado_s >= tramo + 10) await encolarTramo(d, d.cortado_s, d.cortado_s + tramo).catch((e) => console.error('Clips: corte de tramo:', e.message));
  }
}

// ---------- OpenShorts ----------
// ---------- análisis completo de un vídeo de YouTube (no directo) antes de mandarlo a OpenShorts ----------
const mmssA = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
// «Lo más reproducido»: YouTube da ~100 tramos con un valor 0–1 de cuánto se re-vio cada uno.
async function mapaRepeticiones(url) {
  const out = (await ejecutar('yt-dlp', ['--skip-download', '--no-warnings', '--print', '%(heatmap)j', url], { timeout: 180000 })).trim();
  let h; try { h = JSON.parse(out); } catch { return []; }
  if (!Array.isArray(h) || h.length < 10) return [];
  const vals = h.map((x) => x.value).sort((a, b) => a - b), med = vals[Math.floor(vals.length / 2)];
  const cand = h.filter((x, i) => x.start_time > 15 && x.value >= Math.max(0.35, med * 1.6) && x.value >= (h[i - 1]?.value ?? 0) && x.value >= (h[i + 1]?.value ?? 0))
    .sort((a, b) => b.value - a.value);
  const res = [];
  for (const c of cand) { if (res.every((r) => Math.abs(r.ini - c.start_time) >= 40)) res.push({ ini: c.start_time, fin: c.end_time, v: +c.value.toFixed(2) }); if (res.length >= 8) break; }
  return res.sort((a, b) => a.ini - b.ini);
}
function enfoqueRepeticiones(rep) {
  if (!rep?.length) return '';
  return 'LO MÁS REPRODUCIDO según YouTube (los espectadores volvieron a ver estos tramos; es la señal más fiable de interés): '
    + rep.map((r) => `${mmssA(r.ini)}–${mmssA(r.fin)} (${Math.round(r.v * 100)} %)`).join(', ')
    + '. Prioriza clips que contengan estos tramos completos, con unos segundos de contexto antes.';
}
async function analisisCompleto(v, audioLocal = null) {
  let rep = [], voz = [];
  try { rep = await mapaRepeticiones(v.fuente); } catch (e) { console.error('Clips: mapa de repeticiones:', e.message); }
  if (audioLocal && existsSync(audioLocal)) { try { voz = await picosVoz(audioLocal); } catch {} return { rep, voz }; }
  const tmp = path.join(os.tmpdir(), `clips-audio-${v.id}`);
  try {
    await ejecutar('yt-dlp', ['-f', 'bestaudio', '--no-warnings', '--no-playlist', '-o', `${tmp}.%(ext)s`, v.fuente], { timeout: 1800000 });
    const f = readdirSync(os.tmpdir()).map((x) => path.join(os.tmpdir(), x)).find((x) => x.startsWith(tmp + '.'));
    if (f) { voz = await picosVoz(f); rmSync(f, { force: true }); }
  } catch (e) { console.error('Clips: audio completo:', e.message); }
  return { rep, voz };
}

// ---------- laptop: descarga aquí, transcripción allí (GPU), OpenShorts sin transcribir ----------
// Palabras de whisper (-ml 1 -sow) → transcripción con la forma de OpenShorts: frases + palabras con espacio inicial.
function transcripcionOpenShorts(palabras, idioma = 'es') {
  const ws = palabras.map((p) => ({ word: (/^\s/.test(p.w) ? p.w : ` ${p.w}`).replace(/\s+/g, ' '), start: +Number(p.s).toFixed(2), end: +Number(p.e).toFixed(2) }))
    .filter((w) => w.word.trim() && w.end >= w.start);
  const segs = []; let cur = [];
  const cerrar = () => { if (cur.length) segs.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map((w) => w.word).join('').trim(), words: cur }); cur = []; };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], sig = ws[i + 1];
    cur.push(w);
    if (/[.!?…]$/.test(w.word.trim()) || cur.length >= 18 || (sig && sig.start - w.end > 0.8)) cerrar();
  }
  cerrar();
  return { text: segs.map((x) => x.text).join(' '), language: idioma, segments: segs };
}
// Vídeo de YouTube descargado aquí para la laptop (vod-<id>.*): se conserva hasta terminar el postproceso, porque
// OpenShorts no guarda las subidas y sin grabación no hay encuadre propio ni clips en los momentos exactos de Gemini.
function vodLocal(v) {
  const entrada = ajustes()['clips.entrada'], base = path.join(entrada, `vod-${v.id}`);
  try { return readdirSync(entrada).map((f) => path.join(entrada, f)).find((f) => f.startsWith(base + '.') && /.(mp4|mkv|webm)$/i.test(f)) || null; } catch { return null; }
}

async function prepararConLaptop(v) {
  if (!aceleradorDisponible('transcribir_palabras') || !esUrl(v.fuente) || !/youtu\.?be/.test(v.fuente)) return null;
  const entrada = ajustes()['clips.entrada'], base = path.join(entrada, `vod-${v.id}`);
  const buscar = () => readdirSync(entrada).map((f) => path.join(entrada, f)).find((f) => f.startsWith(base + '.') && /\.(mp4|mkv|webm)$/i.test(f));
  let video = buscar();
  if (!video) {
    db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run('Descargando el vídeo (para la laptop)', v.id);
    await ejecutar('yt-dlp', ['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '--no-playlist', '--no-warnings', '-o', `${base}.%(ext)s`, v.fuente], { timeout: 3 * 3600000 });
    video = buscar();
  }
  if (!video) throw new Error('no se descargó el vídeo');
  if (statSync(video).size > 1.9 * 1024 ** 3) { rmSync(video, { force: true }); throw new Error('vídeo de más de 1,9 GB: va por enlace'); }
  const audio = `${base}.mp3`;
  await ejecutar('ffmpeg', ['-v', 'error', '-y', '-nostdin', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio], { timeout: 1800000 });
  db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run('Transcribiendo en la laptop (GPU)', v.id);
  const dur = Number(v.duracion_s) || 3600, t0 = Date.now();
  const idioma = perfilDeVideo(v)?.idioma || 'es';
  const r = await encargar('transcribir_palabras', { idioma }, { archivo: audio, timeoutMs: 600000 + dur * 600 });
  if (!r?.palabras?.length) throw new Error('la laptop no devolvió palabras');
  const tr = transcripcionOpenShorts(r.palabras, idioma);
  const dir = path.join(ajustes()['clips.salida'], 'pretrans'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${v.id}.json`), JSON.stringify(tr));
  console.log(`Clips: «${v.titulo}» transcrito en la laptop en ${Math.round((Date.now() - t0) / 1000)} s (${tr.segments.length} frases, ${r.modelo || 'whisper'})`);
  return { video, audio, transcript: `/app/output/pretrans/${v.id}.json` };
}

async function enviar(v) {
  const t = TIPOS[v.tipo] || TIPOS.general;
  // Con la laptop disponible: descarga aquí + transcripción en su GPU; si falla, se manda el enlace como siempre.
  let pre = null;
  try { pre = await prepararConLaptop(v); } catch (e) { console.error(`Clips: laptop no usada para «${v.titulo}» (${String(e.message).slice(0, 160)})`); }
  const f = new FormData();
  if (pre) { f.append('file', await openAsBlob(pre.video), `${limpio(v.titulo, 60)}.mp4`); f.append('transcript_file', pre.transcript); }
  else if (esUrl(v.fuente)) f.append('url', v.fuente);
  else f.append('file', await openAsBlob(v.fuente), path.basename(v.fuente));
  f.append('acknowledged', 'true');
  f.append('layouts', t.layouts);
  // En juegos y reacciones el gancho y los textos los rehace el postproceso (encuadre propio): sin el de OpenShorts
  // se ahorra una llamada a Gemini por clip.
  f.append('auto_hook', ['gaming', 'reaccion'].includes(v.tipo) ? 'false' : 'true');
  if (t.min) f.append('clip_min_seconds', String(t.min));
  if (t.max) f.append('clip_max_seconds', String(t.max));
  if (t.n) f.append('target_clips', String(t.n));
  // Enfoque = el del tipo + las indicaciones del vídeo + lo aprendido de las valoraciones anteriores.
  let picos = (() => { try { return JSON.parse(v.picos || '[]'); } catch { return []; } })();
  // Vídeos de juegos o reacciones que no son directos (archivo del servidor): sus reacciones en el audio también cuentan.
  if (!v.picos && ['gaming', 'reaccion'].includes(v.tipo) && !esUrl(v.fuente)) {
    try { picos = combinarPicos(await picosVoz(v.fuente)); db.prepare('UPDATE clip_videos SET picos=? WHERE id=?').run(JSON.stringify(picos), v.id); } catch {}
  }
  // Vídeos de YouTube que no son directos: se analizan enteros antes (lo más reproducido + reacciones en todo el audio).
  let rep = [];
  if (!v.picos && esUrl(v.fuente) && /youtu\.?be/.test(v.fuente) && !/tramo/.test(v.titulo || '')) {
    db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run('Analizando el vídeo completo', v.id);
    const a = await analisisCompleto(v, pre?.audio); rep = a.rep;
    if (['gaming', 'reaccion', 'conversacion', 'formativo'].includes(v.tipo) && a.voz.length) picos = combinarPicos(a.voz);
    try { db.prepare('UPDATE clip_videos SET picos=? WHERE id=?').run(JSON.stringify(picos), v.id); } catch {}
  }
  // Momentos que una IA externa (ChatGPT/Claude/Gemini vía MCP) marcó tras ver el vídeo entero.
  let enfoqueExt = '';
  try {
    const ext = momentosIA(v);
    if (ext.length) enfoqueExt = 'MOMENTOS SEÑALADOS POR UNA IA QUE VIO EL VÍDEO ENTERO (alta prioridad): '
      + ext.slice(0, 12).map((m) => `${mmssA(m.inicio_s)}–${mmssA(m.fin_s)}: ${String(m.motivo || '').slice(0, 160)}${m.juego ? ` [juego: ${m.juego}]` : ''}`).join('; ')
      + '. El editor confía en este analista: convierte ESTOS tramos en clips con sus mismos inicio y fin (ajusta solo unos segundos para no cortar frases) antes de buscar otros.';
  } catch {}
  const camp = perfilDeVideo(v);
  const enfoque = [camp?.enfoque && `CAMPAIGN (${camp.nombre}): ${camp.enfoque}`, enfoqueExt, enfoqueRepeticiones(rep), enfoquePicos(picos.filter((p) => (p.tipos || ['chat']).includes('chat'))), enfoqueReacciones(picos), t.enfoque, v.enfoque && `Indicaciones del editor: ${v.enfoque}`, lecciones({ tipo: v.tipo, canalId: v.canal_id })].filter(Boolean).join('\n\n').slice(0, 3500);
  if (enfoque) f.append('clip_focus', enfoque);
  const r = await fetch(`${api()}/api/process`, { method: 'POST', body: f });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.job_id) throw new Error(`OpenShorts rechazó el vídeo: ${typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail || j).slice(0, 200)}`);
  db.prepare("UPDATE clip_videos SET estado='procesando', job=?, enviado=?, paso='En cola en OpenShorts', error=NULL WHERE id=?").run(j.job_id, ahoraIso(), v.id);
  if (pre) rmSync(pre.audio, { force: true }); // el vídeo se queda para el postproceso (vodLocal)
}

// Último paso legible del registro de OpenShorts.
function pasoDe(logs = []) {
  for (let i = logs.length - 1; i >= 0; i--) {
    const l = String(logs[i]);
    let m;
    if (/Downloading video|Download attempt/.test(l)) return 'Descargando el vídeo';
    if ((m = l.match(/Transcribing… (\d+)%/))) return `Transcribiendo ${m[1]} %`;
    if (/Transcribing video/.test(l)) return 'Transcribiendo';
    if (/Model: gemini|Shortlisted|detail:/.test(l)) return 'Gemini elige los momentos';
    if ((m = l.match(/Processing Clip (\d+)/))) {
      const listos = logs.filter((x) => /✅ Clip \d+ ready/.test(String(x))).length;
      return `Montando clips (${listos} listos, ahora el ${m[1]})`;
    }
    if (/Clip \d+ ready/.test(l)) return `Montando clips (${logs.filter((x) => /✅ Clip \d+ ready/.test(String(x))).length} listos)`;
  }
  return 'Empezando';
}

async function seguir(v) {
  const r = await fetch(`${api()}/api/status/${encodeURIComponent(v.job)}`);
  if (r.status === 404) throw new Error('OpenShorts ya no tiene este trabajo (¿se reinició a mitad?). Pulsa Reintentar.');
  const d = await r.json();
  if (d.status === 'completed') {
    const clips = (d.result?.clips || []).map((c, i) => ({
      n: i + 1, archivo: String(c.video_url || '').split('/').pop(),
      titulo: c.video_title_for_youtube_short || `Clip ${i + 1}`, puntos: Number(c.predicted_score) || null,
      gancho: c.viral_hook_text || '', tiktok: c.video_description_for_tiktok || '', instagram: c.video_description_for_instagram || '',
      inicio: Number(c.start) || 0, fin: Number(c.end) || 0, porque: c.why || '',
    }));
    if (!clips.length) throw new Error('OpenShorts terminó sin clips (puede que el vídeo no tenga voz o momentos claros)');
    return terminar(v, clips, { logs: d.logs || [] });
  }
  if (d.status === 'failed') {
    const err = (d.logs || []).filter((l) => /error|❌|failed|Traceback/i.test(String(l))).slice(-2).join(' · ') || 'falló sin detalle';
    throw new Error(`OpenShorts: ${String(err).slice(0, 300)}`);
  }
  db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run(d.status === 'queued' ? 'En cola en OpenShorts' : pasoDe(d.logs), v.id);
}

// Cierre común (OpenShorts o clip corto): postproceso, créditos, carpeta compartida, horizontales, YouTube y aviso.
async function terminar(v, clips, { logs = [], segmentos = null, fuenteLocal = null } = {}) {
  // Créditos: enlace al original en el minuto exacto y canal del creador (van en los textos de cada clip).
  const cr = datosCreador(v);
  for (const c of clips) { c.original = enlaceOriginal(v, c.inicio); c.canalUrl = cr.canalUrl ? `https://${cr.canalUrl.replace(/^https?:\/\//, '')}` : ''; }
  // Gancho al principio, cara de cerca en las pausas y cierre con el canal (si fallan, se publican tal cual).
  db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run('Añadiendo gancho y cierre', v.id);
  const picos = (() => { try { return JSON.parse(v.picos || '[]'); } catch { return []; } })();
  const t = TIPOS[v.tipo] || TIPOS.general;
  try {
    await postprocesar({ videoId: v.id, tipo: v.tipo, job: v.job, clips, logs, cierre: cr.lineas, segmentos, picos,
      fuenteLocal: fuenteLocal || (esUrl(v.fuente) ? vodLocal(v) : v.fuente), contexto: [cr.canal?.nombre ? `Streamer: ${cr.canal.nombre}` : '', v.titulo ? `Título del vídeo original: «${String(v.titulo).replace(/ · tramo.*$/, '')}»` : '', v.enfoque || cr.canal?.enfoque].filter(Boolean).join(' · '), maxClip: Math.max(30, (t.max || 45) + 5), campana: perfilDeVideo(v),
      momentosIA: ajustes()['clips.solo_ia'] !== false && !v.sin_ia ? momentosIA(v) : [], creador: nombreCreador(cr.canal?.nombre),
      juego: juegoDeTitulo(v.titulo) || (/gta/i.test(perfilDeVideo(v)?.slug || '') ? 'GTA VI' : '') || momentosIA(v).map((m) => m.juego).find((j) => j) || '', sinCara: !!cr.canal?.sin_cara });
  } catch (e) {
    // Sin postproceso los clips saldrían con el encuadre y los textos crudos de OpenShorts: mejor error y Reintentar.
    console.error('Clips: postproceso:', e.message); throw new Error(`Postproceso: ${e.message}`.slice(0, 300));
  }
  if (!clips.length) throw new Error('Ningún clip coincide con los momentos que marcó Gemini');
  // La ventana puede haberse movido (picos del chat) y pueden haber entrado clips nuevos: enlaces y créditos al día.
  for (const c of clips) { c.original = enlaceOriginal(v, c.inicio); c.canalUrl = c.canalUrl || (cr.canalUrl ? `https://${cr.canalUrl.replace(/^https?:\/\//, '')}` : ''); }
  const carpeta = publicar(v, clips);
  { const vod = vodLocal(v); if (vod) rmSync(vod, { force: true }); }
  db.prepare("UPDATE clip_videos SET estado='listo', clips=?, carpeta=?, terminado=?, paso=NULL WHERE id=?").run(JSON.stringify(clips), carpeta, ahoraIso(), v.id);
  // Versión horizontal de cada clip (y su emoción), en segundo plano: el vídeo ya está listo y publicable en vertical.
  aplicarEncuadreAprendido(v.id, cr.lineas).then((k) => { if (k) console.log(`Clips: ${k} clips re-renderizados con el encuadre aprendido del canal`); }).catch((e) => console.error('Clips (encuadre aprendido):', e.message));
  if (ajustes()['clips.horizontal_auto'] !== false) { try { const nh = encolarHorizontales(v.id, cr.lineas); if (nh) console.log(`Clips: ${nh} versiones horizontales en cola`); } catch (e) { console.error('Clips: horizontales:', e.message); } }
  const auto = pedirAutomaticas(v.id, clips);
  if (auto) console.log(`Clips: ${auto} clip(s) de «${v.titulo}» a la cola de YouTube`);
  const panel = ajustes()['avisos.panel'];
  avisarSinFallo('Clips listos', `${clips.length} clips de «${v.titulo}»`, { etiquetas: ['movie_camera'], enlace: panel ? `${panel.replace(/\/$/, '')}/#/clips` : '' });
}

// ---------- clips ya cortos (Twitch): sin OpenShorts ----------
// OpenShorts pide ≥ 45 s de material para buscar momentos, y un clip de Twitch (30–60 s) ya ES el momento. Se descarga,
// se transcribe (laptop o whisper.cpp del servidor, palabra a palabra) y se monta entero con el encuadre propio.
export const esCorto = (v) => /twitch\.tv\/[^/]+\/clip\//i.test(v.fuente || '') || (Number(v.duracion_s) > 0 && Number(v.duracion_s) < 60);

async function palabrasCorto(video, idioma) {
  const dir = path.dirname(video), base = path.join(dir, path.basename(video).replace(/\.[^.]+$/, ''));
  if (aceleradorDisponible('transcribir_palabras')) {
    try {
      const mp3 = `${base}.mp3`;
      await ejecutar('ffmpeg', ['-v', 'error', '-y', '-nostdin', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3], { timeout: 300000 });
      const r = await encargar('transcribir_palabras', { idioma }, { archivo: mp3, timeoutMs: 300000 });
      rmSync(mp3, { force: true });
      if (r?.palabras?.length) return r.palabras;
    } catch (e) { console.error(`Clips: la laptop no transcribió el clip corto (${String(e.message).slice(0, 120)}); se hace aquí`); }
  }
  const cfg = ajustes(), wav = `${base}.wav`;
  await ejecutar('ffmpeg', ['-v', 'error', '-y', '-nostdin', '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav], { timeout: 300000 });
  try {
    await ejecutar(cfg['whisper.binario'], ['-m', cfg['whisper.modelo'], '-l', idioma, '-t', String(cfg['whisper.hilos'] || 4), '-np', '-ml', '1', '-sow', '-oj', '-of', base, '-f', wav], { timeout: 900000 });
    const j = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    return (j.transcription || []).map((x) => ({ w: x.text, s: x.offsets.from / 1000, e: x.offsets.to / 1000 })).filter((p) => String(p.w).trim());
  } finally { rmSync(wav, { force: true }); rmSync(`${base}.json`, { force: true }); }
}

export async function procesarCorto(v) {
  const entrada = ajustes()['clips.entrada']; mkdirSync(entrada, { recursive: true });
  const base = path.join(entrada, `corto-${v.id}`);
  const restos = () => readdirSync(entrada).filter((f) => f.startsWith(path.basename(base) + '.')).map((f) => path.join(entrada, f));
  for (const f of restos()) rmSync(f, { force: true });
  db.prepare("UPDATE clip_videos SET estado='procesando', job=?, enviado=?, paso=?, error=NULL WHERE id=?").run(`corto-${v.id}`, ahoraIso(), esUrl(v.fuente) ? 'Descargando el clip' : 'Preparando el tramo', v.id);
  try {
    if (esUrl(v.fuente)) await ejecutar('yt-dlp', ['-f', 'b[height<=1080]/b', '--no-part', '--no-playlist', '--no-warnings', '-o', `${base}.%(ext)s`, v.fuente], { timeout: 900000 });
    const video = esUrl(v.fuente) ? restos().find((f) => /\.(mp4|mkv|webm|mov|ts)$/i.test(f)) : v.fuente;
    if (!video || !existsSync(video)) throw new Error('no se descargó el clip');
    const dur = Number(String(await ejecutar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video])).trim()) || Number(v.duracion_s) || 30;
    const idioma = perfilDeVideo(v)?.idioma || 'es';
    db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run('Transcribiendo el clip', v.id);
    const segmentos = transcripcionOpenShorts(await palabrasCorto(video, idioma), idioma).segments;
    const clips = [{ n: 1, archivo: '', titulo: String(v.titulo || '').replace(/\s*\(\d+ vistas en Twitch\)$/, ''), puntos: null, gancho: '', tiktok: '', instagram: '', inicio: 0, fin: +dur.toFixed(2), porque: 'Clip de Twitch entero' }];
    await terminar({ ...v, job: `corto-${v.id}` }, clips, { segmentos, fuenteLocal: video });
  } finally { for (const f of restos()) rmSync(f, { force: true }); }
}

// ---------- repaso de textos de clips ya montados ----------
// 1) Títulos que Gemini escribe por MCP (titular_clips → ia_titulos) tras ver el clip en el original.
// 2) Clips cuyos textos no se pudieron verificar al montarlos (IA saturada o sin cupo): se reintenta con el clip final.
// En ambos casos se reescriben título y descripciones y, si cambia, el texto fijo de arriba (se repinta su franja).
// Nunca se tocan clips ya publicados o subiéndose. Cada 20 min, pocos por vuelta.
db.exec(`CREATE TABLE IF NOT EXISTS ia_titulos (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, video_id INTEGER,
  n INTEGER, titulo TEXT, gancho TEXT, descripcion TEXT, hashtags TEXT, aplicado INTEGER DEFAULT 0)`);
let ultimoRepaso = 0, repasando = false;
const yaPublicado = (id, n) => !!db.prepare("SELECT 1 FROM clip_subidas WHERE video_id = ? AND n = ? AND estado IN ('ok','subiendo')").get(id, n);
const sinMotivoTextos = (c) => {
  if (!c.qa?.motivo || !/textos sin verificar/.test(c.qa.motivo)) return;
  const resto = c.qa.motivo.split('; ').filter((m) => !/textos sin verificar/.test(m)).join('; ');
  c.qa = { ...c.qa, motivo: resto, ok: !resto };
};
function segmentosDeJob(job) {
  try {
    const dir = path.join(ajustes()['clips.salida'], job);
    const f = readdirSync(dir).find((x) => x.endsWith('_metadata.json'));
    return JSON.parse(readFileSync(path.join(dir, f), 'utf8')).transcript?.segments || null;
  } catch { return null; }
}
function guardarClip(v, c) {
  // Relee la fila y cambia solo este clip (otro proceso pudo guardar otros clips mientras se repintaba).
  db.exec('BEGIN IMMEDIATE');
  try {
    const l = JSON.parse(db.prepare('SELECT clips FROM clip_videos WHERE id = ?').get(v.id)?.clips || '[]');
    const i = l.findIndex((x) => x.n === c.n); if (i >= 0) l[i] = c; else l.push(c);
    db.prepare('UPDATE clip_videos SET clips = ? WHERE id = ?').run(JSON.stringify(l), v.id);
    db.exec('COMMIT'); v.clips = l;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  try { copiaEditada(v, c); } catch {}
}
// Texto fijo de arriba cambiado desde la interfaz: se repinta la franja del clip ya montado (no se puede si ya se publicó).
export async function cambiarTextoPantalla(id, n, texto) {
  const v = parseVideo(db.prepare('SELECT * FROM clip_videos WHERE id = ?').get(Number(id))), c = v?.clips.find((x) => x.n === Number(n));
  if (!c) throw new Error('Ese clip no existe');
  if (yaPublicado(v.id, c.n)) throw new Error('Ya está publicado: el vídeo no se puede cambiar');
  const t = String(texto || '').trim().slice(0, 45);
  if (!t) throw new Error('Escribe el texto');
  if (!(await cambiarGancho(c, t))) throw new Error('Este clip no tiene la franja de texto propia (encuadre de OpenShorts)');
  guardarClip(v, c);
  return c;
}
export async function repasarTextosClips({ forzar = false } = {}) {
  if (repasando || (!forzar && Date.now() - ultimoRepaso < 20 * 60000)) return; repasando = true; ultimoRepaso = Date.now();
  try {
    const datos = (v) => { const cr = datosCreador(v), camp = perfilDeVideo(v); return { cr, camp, creador: nombreCreador(cr.canal?.nombre), idioma: camp?.idioma || 'es',
      juego: juegoDeTitulo(v.titulo) || (/gta/i.test(camp?.slug || '') ? 'GTA VI' : '') || '' }; };
    // 1. Lo que tituló Gemini.
    for (const t of db.prepare('SELECT * FROM ia_titulos WHERE aplicado = 0 ORDER BY id LIMIT 20').all()) {
      const v = parseVideo(db.prepare('SELECT * FROM clip_videos WHERE id = ?').get(t.video_id)), c = v?.clips.find((x) => x.n === t.n);
      if (!c || yaPublicado(v.id, c.n)) { db.prepare('UPDATE ia_titulos SET aplicado = 2 WHERE id = ?').run(t.id); continue; }
      const { creador, idioma, juego } = datos(v);
      const tags = (() => { try { return JSON.parse(t.hashtags || '[]'); } catch { return []; } })().map((h) => `#${String(h).replace(/^#/, '')}`).join(' ');
      const malIdioma = (x) => idioma === 'en' && pareceEspanol(x);
      if (malIdioma(t.titulo) || malIdioma(t.descripcion)) { console.log(`Clips: textos de ${t.origen || 'Gemini'} para ${v.id}/${c.n} en español en una campaña en inglés: no se aplican`); db.prepare('UPDATE ia_titulos SET aplicado = 2 WHERE id = ?').run(t.id); c.verificado = false; guardarClip(v, c); continue; }
      if (t.titulo) c.titulo = t.titulo;
      if (t.descripcion) { c.tiktok = `${t.descripcion}${tags ? ` ${tags}` : ''}`; c.instagram = c.tiktok; }
      const nuevo = { gancho: t.gancho || c.gancho };
      repasarTextos(c, { creador, juego, idioma }); repasarTextos(nuevo, { creador, juego, idioma });
      if (t.gancho && nuevo.gancho !== c.gancho) { try { await cambiarGancho(c, nuevo.gancho); } catch (e) { console.error(`Clips: gancho de Gemini en ${v.id}/${c.n}:`, String(e.message).slice(0, 120)); } }
      conTagsCampana(c, datos(v).camp);
      c.verificado = true; c.textosDe = t.origen || 'gemini'; sinMotivoTextos(c);
      guardarClip(v, c);
      db.prepare('UPDATE ia_titulos SET aplicado = 1 WHERE id = ?').run(t.id);
      console.log(`Clips: textos de ${t.origen || 'Gemini'} aplicados a ${v.id}/${c.n}: «${c.titulo}»`);
    }
    // 1 bis. Hashtags obligatorios de la campaña que falten en clips aún sin publicar: se ponen sin gastar IA.
    for (const v of db.prepare("SELECT * FROM clip_videos WHERE estado = 'listo' AND campana IS NOT NULL").all().map(parseVideo)) {
      const d = datos(v); if (!d.camp?.hashtags?.length) continue;
      for (const c of v.clips) {
        if (c.formato === 'horizontal' || yaPublicado(v.id, c.n)) continue;
        const antes = `${c.tiktok}|${c.instagram}`; conTagsCampana(c, d.camp);
        if (`${c.tiktok}|${c.instagram}` !== antes) { guardarClip(v, c); console.log(`Clips: hashtags de campaña añadidos a ${v.id}/${c.n}`); }
      }
    }
    // 2. Clips sin textos verificados (últimos 3 días), hasta 4 por vuelta.
    let hechos = 0;
    const vids = db.prepare("SELECT * FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop') AND terminado > ? ORDER BY id DESC")
      .all(new Date(Date.now() - 3 * 864e5).toISOString()).map(parseVideo);
    // Primero, los de campaña en inglés que tienen un título en español (aunque sean de hace más de 3 días).
    const malos = db.prepare("SELECT * FROM clip_videos WHERE estado = 'listo' AND campana IS NOT NULL").all().map(parseVideo).filter((v) => perfilDeVideo(v)?.idioma === 'en' && v.clips.some((c) => pareceEspanol(c.titulo) && !yaPublicado(v.id, c.n)));
    vids.splice(0, vids.length, ...malos, ...vids.filter((v) => !malos.some((m) => m.id === v.id)));
    fuera: for (const v of vids) {
      const d = datos(v); let segs;
      for (const c of v.clips) {
        const malIdioma = d.idioma === 'en' && pareceEspanol(c.titulo);
        if ((c.verificado && !malIdioma) || c.formato === 'horizontal' || !c.final || !existsSync(c.final) || yaPublicado(v.id, c.n)) continue;
        if (hechos >= 4) break fuera;
        hechos++;
        if (segs === undefined) segs = segmentosDeJob(v.job);
        const viejo = c.gancho;
        try {
          await textosVerificados(c, segs, c.final, [d.cr.canal?.nombre ? `Streamer: ${d.cr.canal.nombre}` : '', v.titulo ? `Título del vídeo original: «${String(v.titulo).replace(/ · tramo.*$/, '')}»` : ''].filter(Boolean).join(' · '),
            d.idioma, d.camp?.enfoque || '', { creador: d.creador, juego: d.juego, relativo: true });
        } catch (e) {
          console.error(`Clips: repaso de textos ${v.id}/${c.n}: ${String(e.message).slice(0, 120)}`);
          if (/tope diario|sin clave/i.test(e.message)) break fuera; // sin cupo: en la próxima vuelta
          continue;
        }
        repasarTextos(c, { creador: d.creador, juego: d.juego, idioma: d.idioma }); conTagsCampana(c, d.camp);
        if (c.gancho && c.gancho !== viejo) { try { await cambiarGancho(c, c.gancho); } catch (e) { console.error(`Clips: gancho ${v.id}/${c.n}:`, String(e.message).slice(0, 120)); } }
        sinMotivoTextos(c);
        guardarClip(v, c);
        console.log(`Clips: textos repasados ${v.id}/${c.n}: «${c.titulo}»`);
      }
    }
  } finally { repasando = false; }
}

// Copia los clips a la carpeta compartida con nombres legibles y un textos.txt.
// Atribución: si un clip se solapa (≥40 % de su duración) con un momento que una IA externa marcó vía MCP, se etiqueta.
function atribuirIA(v, clips) {
  let marcas = [];
  try {
    const off = Number(v.offset_s) || 0;
    marcas = db.prepare('SELECT origen, momentos FROM ia_escenas WHERE video = ? OR video = ? ORDER BY id DESC').all(String(v.video || ''), String(v.id))
      .flatMap((r) => { try { return JSON.parse(r.momentos).map((m) => ({ ...m, inicio_s: m.inicio_s - off, fin_s: m.fin_s - off, origen: r.origen || 'ia' })); } catch { return []; } });
  } catch { return; }
  if (!marcas.length) return;
  for (const c of clips) {
    if (c.inicio == null || c.fin == null) continue;
    const dur = Math.max(1, c.fin - c.inicio);
    let mejor = null;
    for (const m of marcas) {
      const sol = Math.min(c.fin, m.fin_s) - Math.max(c.inicio, m.inicio_s);
      if (sol / dur >= 0.4 && (!mejor || sol > mejor.sol)) mejor = { sol, m };
    }
    if (mejor) c.ia = { origen: mejor.m.origen, motivo: String(mejor.m.motivo || '').slice(0, 200), puntos: mejor.m.puntuacion ?? null };
  }
}

function publicar(v, clips) {
  atribuirIA(v, clips);
  const cfg = ajustes();
  const origen = path.join(cfg['clips.salida'], v.job);
  const fecha = new Date().toLocaleDateString('sv'); // AAAA-MM-DD
  const t = TIPOS[v.tipo] || TIPOS.general;
  let dest = path.join(cfg['clips.carpeta'], `${fecha} ${limpio(v.titulo, 70)}`);
  if (existsSync(dest)) dest += ` (${t.nombre.split(' ')[0].toLowerCase()} #${v.id})`;
  mkdirSync(dest, { recursive: true });
  try { chmodSync(dest, 0o2775); } catch {}
  const lineas = [`Vídeo original: ${v.titulo}`, `Fuente: ${v.fuente}`, `Tipo: ${t.nombre}${v.enfoque ? ` · Indicaciones: ${v.enfoque}` : ''}`, `Clips: ${clips.length}`, ''];
  for (const c of clips) {
    const nombre = `${String(c.n).padStart(2, '0')} · ${c.puntos ?? '--'} · ${limpio(c.titulo)}.mp4`;
    const src = c.final && existsSync(c.final) ? c.final : path.join(origen, c.archivo);
    if (!existsSync(src)) continue;
    copyFileSync(src, path.join(dest, nombre), FS.COPYFILE_FICLONE);
    try { chmodSync(path.join(dest, nombre), 0o664); } catch {}
    c.copia = nombre;
    const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    lineas.push(`── ${nombre}`, `Puntuación: ${c.puntos ?? '-'}   Tramo del original: ${mm(c.inicio)} – ${mm(c.fin)}`,
      `Gancho: ${c.gancho}`, ...(c.ia ? [`Idea de: ${c.ia.origen} (${c.ia.motivo})`] : []), `TikTok: ${c.tiktok}`, `Instagram: ${c.instagram}`,
      ...(c.original ? [`Vídeo original (en este momento): ${c.original}`] : []), ...(c.canalUrl ? [`Canal del creador: ${c.canalUrl}`] : []), '');
  }
  writeFileSync(path.join(dest, 'textos.txt'), lineas.join('\n'));
  return dest;
}

// Tras editar un clip: su copia en la carpeta compartida (si sigue ahí, no en Descartados) pasa a ser la editada,
// y la versión horizontal se deja al lado con « (horizontal)» en el nombre.
export function copiaEditada(v, c) {
  if (!v.carpeta || !c.copia || !existsSync(v.carpeta)) return;
  const dest = path.join(v.carpeta, c.copia);
  if (existsSync(dest) && c.final && existsSync(c.final)) copyFileSync(c.final, dest);
  const h = [c.horizontalEditado, c.horizontal].find((x) => x && existsSync(x));
  if (existsSync(dest) && h) copyFileSync(h, dest.replace(/\.mp4$/, ' (horizontal).mp4'));
}

// Archivo de un clip para verlo en el panel (validado: solo los de un vídeo listo).
export function archivoClip(id, n) {
  const v = videos.uno(id);
  const c = v?.clips?.find((x) => x.n === Number(n));
  if (!v || !c || !/^[\w-]+$/.test(v.job || '')) return null;
  const f = c.final && existsSync(c.final) ? c.final : path.join(ajustes()['clips.salida'], v.job, path.basename(c.archivo));
  return existsSync(f) ? { ruta: f, nombre: c.copia || `clip-${n}.mp4` } : null;
}

// ---------- ciclo (lo llama el planificador cada 30 s) ----------
let ultimaRevision = 0;
let ocupado = false;
export function revisarAhora() { ultimaRevision = 0; }
export function enCurso() { return parseVideo(db.prepare("SELECT * FROM clip_videos WHERE estado='procesando' ORDER BY id LIMIT 1").get()); }

// Para la subida a YouTube: el vídeo, el clip y el nombre del canal del creador.
export function datosVideo(videoId, n) {
  const v = videos.uno(videoId);
  const c = v?.clips?.find((x) => x.n === Number(n));
  const canal = v?.canal_id ? db.prepare('SELECT nombre FROM clip_canales WHERE id = ?').get(v.canal_id) : null;
  return { v, c, canalNombre: canal?.nombre || '' };
}

// Directos, con su propio cerrojo: nunca esperan al postproceso de clips (que puede tardar varios minutos por vídeo).
let vigilandoDirectos = false;
async function cicloDirectos() {
  if (vigilandoDirectos || !ajustes()['clips.activo']) return;
  vigilandoDirectos = true;
  try {
    await cortarTramos().catch((e) => console.error('Clips:', e.message));
    if (Date.now() - ultimaRevisionVivo > 3 * 60000) { ultimaRevisionVivo = Date.now(); await revisarDirectos().catch((e) => console.error('Clips:', e.message)); }
  } finally { vigilandoDirectos = false; }
}

// Minutos hasta el próximo trabajo pesado programado que no debe coincidir con los recortes. En StreamClipper no hay ninguno:
// se conserva la función (la usa el autopiloto) y siempre devuelve «nunca».
export function minutosHastaTanda() { return Infinity; }

export async function cicloClips({ ocupadoFuera = false } = {}) {
  if (!LINUX) return;
  cicloYoutube({ archivoClip, datosVideo }).catch((e) => console.error('YouTube:', e.message)); // tiene su propio cerrojo
  cicloTiktok({ archivoClip, datosVideo }).catch((e) => console.error('TikTok:', e.message));    // independiente de YouTube
  cicloDirectos().catch((e) => console.error('Clips:', e.message)); // también
  repasarTextosClips().catch((e) => console.error('Clips: repaso de textos:', e.message)); // su propio cerrojo
  if (ocupado) return;
  ocupado = true;
  const cfg = ajustes();
  try {
    // 1. seguir lo que está en OpenShorts
    for (const v of db.prepare("SELECT * FROM clip_videos WHERE estado='procesando'").all().map(parseVideo)) {
      try { await seguir(v); }
      catch (e) {
        if (/fetch failed|ECONNREFUSED/.test(e.message)) { db.prepare('UPDATE clip_videos SET paso=? WHERE id=?').run('OpenShorts no responde; se reintenta', v.id); continue; }
        db.prepare("UPDATE clip_videos SET estado='error', error=?, terminado=?, paso=NULL WHERE id=?").run(e.message.slice(0, 500), ahoraIso(), v.id);
        avisarSinFallo('Clips: falló un vídeo', `«${v.titulo}»: ${e.message.slice(0, 200)}`, { prioridad: 4, etiquetas: ['warning'] });
      }
    }
    if (!cfg['clips.activo']) return;
    // 2. directos: van aparte (cicloDirectos), cada 3 min, sin esperar a este bucle.
    // 3. canales (vídeos subidos)
    if (!ocupadoFuera && Date.now() - ultimaRevision > (Number(cfg['clips.revisar_min']) || 60) * 60000) {
      ultimaRevision = Date.now();
      await revisarCanales().catch((e) => console.error('Clips:', e.message));
    }
    // 4. mandar el siguiente: de uno en uno; los urgentes a cualquier hora, el resto en la ventana nocturna.
    //    Orden: urgentes, luego la prioridad del canal (1 = primero), luego el más antiguo.
    // Propuestos (canales con aprobación a mano) en los que Gemini ya marcó momentos: se aprueban solos (lo pidió el editor, 22-nov).
    for (const v of db.prepare("SELECT * FROM clip_videos WHERE estado = 'propuesto'").all()) if (cfg['clips.solo_ia'] !== false && momentosIA(v).length) { db.prepare("UPDATE clip_videos SET estado = 'cola' WHERE id = ? AND estado = 'propuesto'").run(v.id); console.log(`Clips: «${v.titulo}» aprobado solo (momentos de Gemini)`); }
    if (ocupadoFuera || enCurso()) return;
    const cercaTanda = false;
    let sig;
    if (cfg['clips.solo_ia'] !== false) {
      // Solo se recortan los vídeos con momentos marcados por Gemini (tarea suya a las 2:00, 8:00, 14:00 y 20:00): esos
      // salen a cualquier hora, sin esperar a la ventana nocturna. Los urgentes y los añadidos a mano pasan siempre.
      // Un tramo cuyo vídeo Gemini ya analizó sin marcar nada dentro de él se descarta (no tiene momentos buenos).
      const cands = db.prepare(`SELECT v.* FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
        WHERE v.estado='cola' ORDER BY (COALESCE(v.campana, c.campana) IS NOT NULL) DESC, v.urgente DESC, COALESCE(c.prioridad, 2), v.id`).all().map(parseVideo);
      for (const v of cands) {
        // Los tramos de directos entran solos como urgentes: esos también esperan a Gemini (analiza el directo ya subido).
        // Los clips de Twitch ya son un momento elegido por el público: pasan sin esperar a Gemini (decisión del editor, 22-nov).
        const aMano = !!v.sin_ia || (v.canal_id && db.prepare('SELECT esperar_ia FROM clip_canales WHERE id = ?').get(v.canal_id)?.esperar_ia === 0) || !v.canal_id || (v.urgente && !/-tramo\d+\.mp4$/.test(v.fuente || '')) || /twitch\.tv\/[^/]+\/clip\//i.test(v.fuente || '');
        if (aMano) { if (v.urgente || !cercaTanda) { sig = v; break; } continue; }
        if (momentosIA(v).length) { if (!cercaTanda) { sig = v; break; } continue; }
        if (analizadoPorIA(v) && v.offset_s > 0 && !v.sin_ia && !tramoSinVer(v)) db.prepare("UPDATE clip_videos SET estado='descartado', error=? WHERE id=?").run('Gemini analizó el vídeo y no marcó momentos en este tramo', v.id);
      }
    } else {
      const soloUrgentes = !enVentana(cfg) || cercaTanda;
      sig = parseVideo(db.prepare(`SELECT v.* FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
        WHERE v.estado='cola' ${soloUrgentes ? 'AND v.urgente=1' : ''} ORDER BY (COALESCE(v.campana, c.campana) IS NOT NULL) DESC, v.urgente DESC, COALESCE(c.prioridad, 2), v.id LIMIT 1`).get());
    }
    if (sig) {
      // Con momentos de Gemini y encuadre propio (juegos y reacciones) no se usa OpenShorts: un vídeo entero de YouTube se trocea
      // en las ventanas de Gemini (solo se bajan esas) y cada tramo se monta aquí, como un clip corto.
      const propioIA = ['gaming', 'reaccion'].includes(sig.tipo) && cfg['clips.solo_ia'] !== false && !sig.sin_ia && momentosIA(sig).length > 0;
      if (propioIA && esUrl(sig.fuente) && /^[w-]{11}$/.test(sig.video || '') && !(Number(sig.offset_s) > 0)) {
        db.prepare("UPDATE clip_videos SET estado = 'troceando', paso = 'Bajando solo los momentos de Gemini' WHERE id = ?").run(sig.id);
        console.log(`Clips: «${sig.titulo}» se trocea en los momentos de Gemini (sin OpenShorts)`); return;
      }
      try { if (esCorto(sig) || (propioIA && !esUrl(sig.fuente))) { await procesarCorto(sig); console.log(`Clips: clip corto «${sig.titulo}» montado sin OpenShorts`); } else { await enviar(sig); console.log(`Clips: enviado «${sig.titulo}» (${sig.tipo})`); } }
      catch (e) {
        if (/fetch failed|ECONNREFUSED/.test(e.message)) return; // OpenShorts apagado: se reintenta en la próxima vuelta
        db.prepare("UPDATE clip_videos SET estado='error', error=?, terminado=? WHERE id=?").run(e.message.slice(0, 500), ahoraIso(), sig.id);
      }
    }
  } finally { ocupado = false; }
}
