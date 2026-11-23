// MCP de StreamClipper: puente entre las apps de IA (ChatGPT, Claude, Gemini) y la app del servidor.
// Las IA aportan tendencias, ideas y escenas; la app las usa al elegir clips y al proponer vídeos.
// Solo escribe en sus tablas (ia_*), no ejecuta comandos ni borra nada. Acceso: /mcp/<token secreto>.
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Clave secreta de la dirección del MCP: variable MCP_TOKEN o archivo mcp/.token (una cadena larga y aleatoria).
const TOKEN = (process.env.MCP_TOKEN || readFileSync(path.join(DIR, '.token'), 'utf8')).trim();
if (TOKEN.length < 16) throw new Error('La clave del MCP (MCP_TOKEN o mcp/.token) necesita al menos 16 caracteres');
const PUERTO = Number(process.env.MCP_PUERTO || process.env.PUERTO || 8792);
// Carpeta del servidor de StreamClipper (para la estrategia) y sus datos (misma DATOS_DIR que el servidor).
const APP = process.env.STREAMCLIPPER_DIR || path.resolve(DIR, '..', 'servidor');
const DATOS = process.env.DATOS_DIR || path.join(APP, 'datos');
const ARCHIVOS = process.env.ARCHIVOS_DIR || path.join(DATOS, 'archivos');
const TRANSC = path.join(DATOS, 'transcripciones');
const db = new DatabaseSync(path.join(DATOS, 'app.db'));
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS ia_tendencias (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, tema TEXT, resumen TEXT,
  por_que_ahora TEXT, nicho TEXT, palabras_clave TEXT, fuentes TEXT, caduca TEXT, usado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ia_ideas (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, titulo TEXT, angulo TEXT,
  formato TEXT, gancho TEXT, por_que TEXT, fuentes TEXT, estado TEXT DEFAULT 'nueva');
CREATE TABLE IF NOT EXISTS ia_escenas (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, video TEXT, url TEXT,
  momentos TEXT, usado INTEGER DEFAULT 0);
`);
if (!db.prepare('PRAGMA table_info(ia_ideas)').all().some((c) => c.name === 'guion')) db.exec('ALTER TABLE ia_ideas ADD COLUMN guion TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS ia_referencias (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, para TEXT,
  miniatura TEXT, imagenes TEXT, usado INTEGER DEFAULT 0)`);

// ---------- referencias visuales: descarga segura (solo https público, solo imágenes, ≤5 MB) ----------
const REFS = path.join(ARCHIVOS, 'Estudio', '_mcp', 'referencias');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const privada = (ip) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|fc|fd|fe80|::ffff:(10|127|192\.168|169\.254)\.)/i.test(ip);
function deBase64(b64, mime) {
  const m = String(b64).match(/^data:(image\/[\w+.-]+);base64,(.*)$/s); const tipo = m ? m[1] : (mime || 'image/png');
  if (!EXT[tipo]) throw new Error('tipo de imagen no admitido');
  const buf = Buffer.from(m ? m[2] : b64, 'base64'); if (buf.length < 100 || buf.length > 1.6e6) throw new Error('imagen vacía o > 1,5 MB');
  return { buf, ext: EXT[tipo] };
}
async function bajarImagen(url, saltos = 0) {
  const u = new URL(url); if (u.protocol !== 'https:') throw new Error('solo enlaces https');
  const ips = await lookup(u.hostname, { all: true }); if (!ips.length || ips.some((x) => privada(x.address))) throw new Error('dirección no permitida');
  const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (referencias)' } });
  if (r.status >= 300 && r.status < 400 && r.headers.get('location') && saltos < 3) return bajarImagen(new URL(r.headers.get('location'), u).href, saltos + 1);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tipo = (r.headers.get('content-type') || '').split(';')[0].trim(); if (!EXT[tipo]) throw new Error(`no es una imagen (${tipo || 'sin tipo'})`);
  if (Number(r.headers.get('content-length') || 0) > 5e6) throw new Error('imagen > 5 MB');
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 5e6) throw new Error('imagen > 5 MB');
  return { buf, ext: EXT[tipo] };
}
const ytId = (u) => (String(u).match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/) || [])[1] || (/^[\w-]{11}$/.test(u) ? u : null);
const txt = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const corto = (s, n) => String(s ?? '').slice(0, n);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const estrategia = () => new Promise((ok) => execFile('node', ['src/estadisticas/cli.mjs', 'estrategia'], { cwd: APP, timeout: 30000 }, (e, so) => {
  try { ok(JSON.parse(so).texto); } catch { ok('(sin estrategia calculada)'); }
}));

// ---------- retroalimentación: lo que el editor opinó y cómo rindió en YouTube (sin canal ni ids de YouTube) ----------
const ETIQ = { encuadre: 'mal encuadre (cara/webcam)', aburrido: 'aburrido', repetido: 'repetido', corte_malo: 'corte malo', gancho_flojo: 'gancho flojo', sin_contexto: 'no se entiende solo', sensible: 'tema sensible' };
const clipsConIA = (limite = 300) => {
  const out = [];
  for (const v of db.prepare("SELECT id, titulo, tipo, clips FROM clip_videos WHERE clips LIKE '%\"ia\":%' ORDER BY id DESC LIMIT ?").all(limite)) {
    let cl = []; try { cl = JSON.parse(v.clips); } catch {}
    for (const c of cl) if (c.ia) out.push({ v, c });
  }
  return out;
};
function feedback(dias = 14) {
  const d = `-${dias} days`;
  const vals = db.prepare("SELECT r.video_id, r.n, r.valor, r.etiquetas, r.nota, r.fecha, v.clips, v.tipo FROM clip_valoraciones r JOIN clip_videos v ON v.id = r.video_id WHERE r.fecha > datetime('now', ?) ORDER BY r.id DESC").all(d);
  const cuenta = {}; let buenos = 0, malos = 0;
  const notas = [];
  for (const r of vals) {
    if (r.valor === 1) buenos++; else if (r.valor === -1) malos++;
    let et = []; try { et = JSON.parse(r.etiquetas || '[]'); } catch {}
    for (const e of et) cuenta[ETIQ[e] || e] = (cuenta[ETIQ[e] || e] || 0) + 1;
    if (r.nota && notas.length < 20) {
      let c = {}; try { c = JSON.parse(r.clips || '[]').find((x) => x.n === r.n) || {}; } catch {}
      notas.push({ clip: corto(c.titulo, 90), valor: r.valor === 1 ? 'bueno' : r.valor === -1 ? 'descartado' : 'neutro', motivos: et.map((e) => ETIQ[e] || e), nota: corto(r.nota, 240), idea_de: c.ia?.origen || null });
    }
  }
  const ia = clipsConIA().slice(0, 40).map(({ v, c }) => {
    const val = db.prepare('SELECT valor, etiquetas, nota FROM clip_valoraciones WHERE video_id = ? AND n = ? ORDER BY id DESC LIMIT 1').get(v.id, c.n);
    const sub = db.prepare('SELECT estado FROM clip_subidas WHERE video_id = ? AND n = ? ORDER BY id DESC LIMIT 1').get(v.id, c.n);
    let et = []; try { et = JSON.parse(val?.etiquetas || '[]'); } catch {}
    return { clip: corto(c.titulo, 90), idea_de: c.ia.origen, tu_motivo: c.ia.motivo, valoracion_editor: val ? (val.valor === 1 ? 'bueno' : val.valor === -1 ? 'descartado' : 'neutro') : 'sin valorar',
      motivos_editor: et.map((e) => ETIQ[e] || e), nota_editor: corto(val?.nota, 200) || null, publicado: sub?.estado === 'ok' };
  });
  let comentarios = [];
  try { comentarios = db.prepare("SELECT p.titulo, c.escena, c.texto, c.creado FROM estudio_comentarios c JOIN estudio_proyectos p ON p.id = c.proyecto_id WHERE c.creado > datetime('now', ?) ORDER BY c.id DESC LIMIT 15").all(d).map((x) => ({ video: x.titulo, escena: x.escena, comentario: corto(x.texto, 300) })); } catch {}
  const ideas = db.prepare("SELECT origen, titulo, estado FROM ia_ideas WHERE estado != 'nueva' ORDER BY id DESC LIMIT 20").all();
  return { periodo_dias: dias, valoraciones: { buenos, descartados: malos, motivos_de_descarte: cuenta, notas_del_editor: notas },
    tus_clips_aportados: ia, comentarios_del_editor_en_videos_largos: comentarios, ideas_revisadas: ideas };
}
const mediana = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function resultados(diasMin = 7) {
  const vids = db.prepare("SELECT titulo, publicado, es_short, vistas, megusta, comentarios, pct_visto, media_s, subs, compartidos, origen FROM yt_videos WHERE publicado < datetime('now', ?) AND publicado > datetime('now', '-90 days')").all(`-${diasMin} days`)
    .map((v) => ({ ...v, origen: (() => { try { return JSON.parse(v.origen || '{}'); } catch { return {}; } })() }));
  const fila = (v) => ({ titulo: corto(v.titulo, 90), formato: v.es_short ? 'short' : 'largo', dias_publicado: Math.round((Date.now() - Date.parse(v.publicado)) / 864e5),
    vistas: v.vistas, me_gusta: v.megusta, comentarios: v.comentarios, pct_visto: v.pct_visto, media_s: v.media_s, suscriptores_ganados: v.subs, compartidos: v.compartidos, idea_de: v.origen.ia || null });
  const conIA = vids.filter((v) => v.origen.ia), resto = vids.filter((v) => !v.origen.ia);
  const base = (lista) => ({ n: lista.length, vistas_mediana: mediana(lista.map((v) => v.vistas)), pct_visto_mediana: mediana(lista.map((v) => v.pct_visto)), me_gusta_mediana: mediana(lista.map((v) => v.megusta)) });
  return {
    nota: `Solo vídeos con ${diasMin}+ días publicados (últimos 90 días). Compara tus aportes con la referencia del resto del canal.`,
    tus_aportes: conIA.map(fila),
    referencia_resto: { shorts: base(resto.filter((v) => v.es_short)), largos: base(resto.filter((v) => !v.es_short)) },
    mejores_del_canal: resto.sort((a, b) => b.vistas - a.vistas).slice(0, 5).map(fila),
  };
}

function crear() {
  const s = new McpServer({ name: 'streamclipper', version: '0.1.0' }, {
    instructions: 'StreamClipper: servidor de clips de un canal de YouTube (clips verticales de streamers, recopilatorios y vídeos del Estudio). '
      + 'Empieza con resumen_canal. Aporta tendencias con fuentes reales (guardar_tendencias), ideas de vídeo con ángulo propio '
      + '(proponer_ideas o proponer_guion, y después enviar_referencias con el concepto de miniatura y referencias visuales) y los mejores momentos de los vídeos en cola (videos_para_analizar → marcar_escenas). Después, titula los clips ya montados (clips_por_titular → titular_clips): títulos y textos llamativos, con el creador, lo que hace y el juego. '
      + 'Antes de aportar, mira ver_feedback (opinión del editor) y ver_aportes (para no repetir); cada semana, resultados_aportes '
      + '(cómo rindieron en YouTube los clips con tu idea). Nunca inventes datos: cada tendencia o idea lleva fuentes.',
  });
  const origen = z.string().max(40).optional().describe('Quién aporta: chatgpt, claude, gemini…');

  // Revisiones automáticas del autopiloto (72 h por largo y resumen semanal) + reglas vigentes de la semana.
  const rendimiento = () => { try {
    const filas = db.prepare("SELECT clave, tipo, texto, fecha FROM yt_revisiones ORDER BY fecha DESC LIMIT 6").all().map((r) => ({ ...r, texto: r.texto ? JSON.parse(r.texto) : null }));
    let reglas = null; try { reglas = JSON.parse(db.prepare("SELECT valor FROM ajustes WHERE clave = 'canal.reglas_semana'").get()?.valor || 'null'); } catch {}
    return { reglas_de_la_semana: reglas, revisiones: filas };
  } catch { return null; } };

  s.registerTool('resumen_canal', {
    title: 'Resumen del canal',
    description: 'Estrategia vigente (calculada con las vistas reales), vídeos y propuestas recientes del Estudio y cola de clips. Úsalo primero.',
    inputSchema: {},
  }, async () => {
    const estudio = db.prepare("SELECT slug, titulo, estado, actualizado FROM estudio_proyectos ORDER BY id DESC LIMIT 12").all();
    const cola = db.prepare("SELECT v.id, v.titulo, v.estado, v.tipo, c.nombre canal FROM clip_videos v LEFT JOIN clip_canales c ON c.id=v.canal_id WHERE v.estado IN ('propuesto','cola','procesando') ORDER BY v.id DESC LIMIT 15").all();
    const canales = db.prepare('SELECT nombre, tipo FROM clip_canales WHERE activo = 1').all();
    const f = feedback(14);
    let identidad = ''; try { identidad = readFileSync(path.join(ARCHIVOS, 'Estudio', '_marca', 'identidad.md'), 'utf8').slice(0, 3500); } catch {}
    return txt({ identidad_del_canal: identidad, estrategia: await estrategia(), feedback_del_editor: { buenos: f.valoraciones.buenos, descartados: f.valoraciones.descartados,
      motivos_de_descarte: f.valoraciones.motivos_de_descarte, ultimas_notas: f.valoraciones.notas_del_editor.slice(0, 6) },
      estudio, cola_de_clips: cola, canales_vigilados: canales, rendimiento_reciente: rendimiento(),
      siguiente_paso: 'Lee ver_feedback antes de aportar y, una vez por semana, resultados_aportes para ver cómo rindieron tus aportes en YouTube.' });
  });

  s.registerTool('ver_feedback', {
    title: 'Ver la opinión del editor',
    description: 'Qué opinó el editor de los clips y vídeos: motivos de descarte, sus notas, cómo valoró los clips nacidos de momentos que marcaron las IA (idea_de) y qué ideas usó o descartó. Léelo ANTES de aportar y evita repetir los errores.',
    inputSchema: { dias: z.number().int().min(1).max(90).default(14) },
  }, async ({ dias }) => txt(feedback(dias)));

  s.registerTool('resultados_aportes', {
    title: 'Resultados en YouTube de tus aportes',
    description: 'Estadísticas de YouTube (vistas, % visto, me gusta, suscriptores) de los vídeos y Shorts que nacieron de aportes de las IA, comparados con la referencia del resto del canal. Úsalo una vez por semana para aprender qué funciona.',
    inputSchema: { dias_minimos: z.number().int().min(1).max(60).default(7) },
  }, async ({ dias_minimos }) => txt(resultados(dias_minimos)));

  s.registerTool('videos_para_analizar', {
    title: 'Vídeos para analizar',
    description: 'Vídeos de streamers que esperan a que los analices (los que llevan «campana» son prioritarios: analízalos primero): la app SOLO recorta los momentos que marques con marcar_escenas '
      + '(sin tus marcas no salen clips). Primero los no analizados. Si un vídeo trae «tramos_pendientes», busca los momentos dentro de esos '
      + 'minutos del vídeo original (los tiempos que devuelvas son siempre del vídeo original completo). '
      + 'Si un vídeo trae «transcripcion_ids» (o no puedes ver su transcripción en YouTube), lee el texto con leer_transcripcion(id) de TODOS sus transcripcion_ids y marca todos los momentos de ese vídeo en un solo marcar_escenas.',
    inputSchema: { limite: z.number().int().min(1).max(100).default(60) },
  }, async ({ limite }) => {
    const filas = db.prepare(`SELECT v.id, v.video, v.fuente, v.titulo, v.tipo, v.duracion_s, v.offset_s, v.estado, c.nombre canal, COALESCE(v.campana, c.campana) campana FROM clip_videos v
      LEFT JOIN clip_canales c ON c.id=v.canal_id WHERE v.estado IN ('propuesto','cola','troceando') AND v.tipo != 'estudio' AND COALESCE(v.sin_ia,0) = 0 ORDER BY v.urgente DESC, v.id DESC`).all();
    const hechos = new Set(db.prepare("SELECT video FROM ia_escenas WHERE creado > datetime('now','-7 days')").all().map((r) => r.video));
    // Un vídeo original por fila (los tramos del mismo vídeo se agrupan).
    const por = new Map();
    for (const x of filas) {
      const k = x.video || String(x.id);
      if (!por.has(k)) por.set(k, { id: x.id, url: x.video && /^[\w-]{11}$/.test(x.video) ? `https://www.youtube.com/watch?v=${x.video}` : (/^https?:/.test(x.fuente) ? x.fuente : null),
        titulo: String(x.titulo || '').replace(/ · tramo.*$/, ''), canal: x.canal, campana: x.campana || undefined, tipo: x.tipo, duracion: null, tramos_pendientes: [], ya_analizado: hechos.has(k) });
      const o = por.get(k);
      if (existsSync(`${TRANSC}/${x.id}.json`)) {
        (o.transcripcion_ids ||= []).push(x.id);
        // Transcripción más nueva que la última marca del vídeo: Gemini aún no la ha leído.
        try { const f = Date.parse(JSON.parse(readFileSync(`${TRANSC}/${x.id}.json`, 'utf8')).fecha), u = db.prepare('SELECT MAX(creado) m FROM ia_escenas WHERE video = ? OR video = ?').get(String(x.video || ''), String(x.id))?.m; if (!u || Date.parse(`${u.replace(' ', 'T')}Z`) < f) o.ya_analizado = false; } catch {}
      }
      if (x.offset_s > 0) o.tramos_pendientes.push(`${mmss(x.offset_s)}–${mmss(x.offset_s + (x.duracion_s || 900))}`);
      else if (x.duracion_s) o.duracion = mmss(x.duracion_s);
    }
    const lista = [...por.values()].map((o) => (o.tramos_pendientes.length ? o : (({ tramos_pendientes, ...r }) => r)(o)))
      .sort((a, b) => Number(a.ya_analizado) - Number(b.ya_analizado) || Number(!a.campana) - Number(!b.campana)).slice(0, limite);
    return txt({ nota: 'En marcar_escenas, titulo_sugerido = «<creador> <qué hace> en <juego>» y juego = el del título del vídeo original (GTA VI si lo dice, aunque se parezca a GTA V).', videos: lista });
  });

  s.registerTool('leer_transcripcion', {
    title: 'Leer transcripción',
    description: 'Transcripción hecha por el servidor de un vídeo o tramo de videos_para_analizar (para los que no tienen subtítulos en YouTube). '
      + 'Cada línea: segundo del vídeo ORIGINAL completo + texto. Usa esos segundos tal cual en marcar_escenas (video = el id de videos_para_analizar).',
    inputSchema: { id: z.number().int().min(1) },
  }, async ({ id }) => {
    const f = `${TRANSC}/${id}.json`;
    if (!existsSync(f)) return txt('Ese vídeo aún no tiene transcripción del servidor (se hace en segundo plano; vuelve a mirar en la próxima pasada).');
    const d = JSON.parse(readFileSync(f, 'utf8'));
    return txt(`${d.titulo} (idioma ${d.idioma}; tiempos del vídeo original)` + String.fromCharCode(10) + d.frases.map((x) => `[${Math.round(x.s)}s ${mmss(x.s)}] ${x.t}`).join(String.fromCharCode(10)));
  });

  s.registerTool('marcar_escenas', {
    title: 'Marcar escenas',
    description: 'Guarda los mejores momentos de un vídeo para clips verticales (20–55 s, autoconclusivos). La app los prioriza al recortar. '
      + 'Tiempos en segundos del vídeo original completo. titulo_sugerido: nombre del creador + qué hace + juego. '
      + 'juego: el que nombra el título original (si dice GTA 6/VI es GTA VI, NUNCA GTA V ni GTA Online). '
      + 'Prefiere momentos en los que se vea la cara del creador reaccionando y que se entiendan sin contexto.',
    inputSchema: {
      video: z.string().max(200).describe('URL de YouTube, id de 11 caracteres o id numérico de videos_para_analizar'),
      momentos: z.array(z.object({
        inicio_s: z.number().min(0), fin_s: z.number().min(1),
        motivo: z.string().max(300).describe('Qué pasa y por qué engancha'),
        titulo_sugerido: z.string().max(100).optional(), juego: z.string().max(60).optional(),
        puntuacion: z.number().min(0).max(100).optional(),
      })).min(1).max(15),
      origen,
    },
  }, async ({ video, momentos, origen: o }) => {
    let id = ytId(video), url = id ? `https://www.youtube.com/watch?v=${id}` : null;
    if (!id && /^\d+$/.test(video)) { const r = db.prepare('SELECT video, fuente FROM clip_videos WHERE id=?').get(Number(video)); id = r?.video || video; url = r?.video ? `https://www.youtube.com/watch?v=${r.video}` : r?.fuente; }
    if (!id) return txt('No reconozco el vídeo: pasa una URL de YouTube o el id de videos_para_analizar.');
    const m = momentos.filter((x) => x.fin_s > x.inicio_s && x.fin_s - x.inicio_s <= 180).map((x) => ({ ...x, motivo: corto(x.motivo, 300), titulo_sugerido: corto(x.titulo_sugerido, 100) }));
    db.prepare('INSERT INTO ia_escenas (origen, video, url, momentos) VALUES (?,?,?,?)').run(corto(o, 40), id, url, JSON.stringify(m));
    return txt(`Guardados ${m.length} momentos para ${id}. La app los usará al recortar ese vídeo.`);
  });

  // Clips ya montados (sin publicar) para que la IA los vea en el original y les escriba título, texto en pantalla y descripción.
  db.exec(`CREATE TABLE IF NOT EXISTS ia_titulos (id INTEGER PRIMARY KEY, creado TEXT DEFAULT (datetime('now')), origen TEXT, video_id INTEGER,
    n INTEGER, titulo TEXT, gancho TEXT, descripcion TEXT, hashtags TEXT, aplicado INTEGER DEFAULT 0)`);
  s.registerTool('clips_por_titular', {
    title: 'Clips por titular',
    description: 'Clips verticales ya montados y sin publicar. Abre «original» (enlace al minuto exacto del vídeo del streamer), mira el tramo '
      + '(inicio_s–fin_s, ~20–60 s) y escribe con titular_clips un título, un texto en pantalla y una descripción que den ganas de verlo. '
      + 'Los de campaña (idioma en) van en inglés; el resto en español. Prioriza los que tienen verificado=false.',
    inputSchema: { limite: z.number().int().min(1).max(30).default(15) },
  }, async ({ limite }) => {
    const desde = new Date(Date.now() - 3 * 864e5).toISOString();
    const vids = db.prepare(`SELECT v.id, v.titulo, v.clips, v.campana, c.nombre canal FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
      WHERE v.estado = 'listo' AND v.tipo NOT IN ('estudio','recop') AND v.terminado > ? ORDER BY (v.campana IS NOT NULL) DESC, v.id DESC`).all(desde);
    const hecho = db.prepare('SELECT 1 FROM ia_titulos WHERE video_id = ? AND n = ?'), pub = db.prepare("SELECT 1 FROM clip_subidas WHERE video_id = ? AND n = ? AND estado IN ('ok','subiendo')");
    const out = [];
    for (const v of vids) {
      let cl = []; try { cl = JSON.parse(v.clips || '[]'); } catch {}
      for (const c of cl) {
        if (c.formato === 'horizontal' || hecho.get(v.id, c.n) || pub.get(v.id, c.n)) continue;
        out.push({ id: v.id, n: c.n, creador: String(v.canal || '').replace(/\s*\((EN|ES)\)\s*$/i, '').replace(/\s*·.*$/, ''), campana: v.campana || null,
          idioma: v.campana ? 'en' : 'es', video_original: String(v.titulo || '').replace(/ · tramo.*$/, ''), original: c.original || null,
          inicio_s: Math.round(c.inicio), fin_s: Math.round(c.fin), titulo_actual: c.titulo || '', texto_en_pantalla_actual: c.gancho || '',
          lo_que_se_dice: corto(c.dicho, 600) || null, verificado: !!c.verificado });
      }
    }
    out.sort((a, b) => Number(!!b.campana) - Number(!!a.campana) || Number(a.verificado) - Number(b.verificado));
    return txt({ nota: 'Título: «<creador> + qué hace/le pasa + en <juego>», con emoción o giro, máx. 70 caracteres. Texto en pantalla: máx. 40 caracteres, '
      + 'nombre del creador + lo que hace, deja una pregunta abierta sin destripar el final. Descripción: 1–2 frases (quién, qué, qué juego). '
      + 'Nada inventado: solo lo que pasa en ese tramo. Si el vídeo original dice GTA 6/VI, es GTA VI (nunca GTA V ni GTA Online).', clips: out.slice(0, limite) });
  });

  s.registerTool('titular_clips', {
    title: 'Titular clips',
    description: 'Guarda título, texto en pantalla, descripción y hashtags de clips de clips_por_titular. La app los aplica sola (también repinta el texto en pantalla) si el clip aún no se publicó.',
    inputSchema: {
      clips: z.array(z.object({
        id: z.number().int(), n: z.number().int(),
        titulo: z.string().min(8).max(90), texto_en_pantalla: z.string().min(4).max(45),
        descripcion: z.string().min(10).max(400), hashtags: z.array(z.string().max(40)).max(6).optional(),
      })).min(1).max(30),
      origen,
    },
  }, async ({ clips, origen: o }) => {
    const existe = db.prepare("SELECT 1 FROM clip_videos WHERE id = ? AND estado = 'listo'");
    const ins = db.prepare('INSERT INTO ia_titulos (origen, video_id, n, titulo, gancho, descripcion, hashtags) VALUES (?,?,?,?,?,?,?)');
    let n = 0;
    for (const c of clips) { if (!existe.get(c.id)) continue; ins.run(corto(o || 'gemini', 40), c.id, c.n, corto(c.titulo, 90), corto(c.texto_en_pantalla, 45), corto(c.descripcion, 400), JSON.stringify(c.hashtags || [])); n++; }
    return txt(`Guardados ${n} de ${clips.length}. La app los aplica en los próximos 20 minutos.`);
  });

  s.registerTool('guardar_tendencias', {
    title: 'Guardar tendencias',
    description: 'Aporta tendencias y actualidad útiles para el canal (gaming, GTA VI, streamers hispanos, tecnología, curiosidades), con fuentes reales y por qué importan HOY.',
    inputSchema: {
      items: z.array(z.object({
        tema: z.string().max(150), resumen: z.string().max(800), por_que_ahora: z.string().max(300).optional(),
        nicho: z.string().max(60).optional(), palabras_clave: z.array(z.string().max(40)).max(12).optional(),
        fuentes: z.array(z.string().max(300)).min(1).max(8), caduca_horas: z.number().min(1).max(24 * 30).default(72),
      })).min(1).max(20),
      origen,
    },
  }, async ({ items, origen: o }) => {
    const ins = db.prepare("INSERT INTO ia_tendencias (origen, tema, resumen, por_que_ahora, nicho, palabras_clave, fuentes, caduca) VALUES (?,?,?,?,?,?,?, datetime('now', ?))");
    for (const i of items) ins.run(corto(o, 40), i.tema, i.resumen, i.por_que_ahora || '', i.nicho || '', JSON.stringify(i.palabras_clave || []), JSON.stringify(i.fuentes), `+${Math.round(i.caduca_horas)} hours`);
    return txt(`Guardadas ${items.length} tendencias.`);
  });

  s.registerTool('proponer_ideas', {
    title: 'Proponer ideas de vídeo',
    description: 'Ideas para vídeos largos (8–10 min) del Estudio: título concreto con tensión, ángulo propio, gancho de los primeros 20 s y fuentes. Formatos: decisiones (micro-documental), finanzas, actualidad gaming, curiosidades.',
    inputSchema: {
      ideas: z.array(z.object({
        titulo: z.string().max(120), angulo: z.string().max(600), formato: z.string().max(40),
        gancho: z.string().max(300), por_que: z.string().max(400).describe('Por qué funcionará ahora (tendencia, datos, búsquedas)'),
        fuentes: z.array(z.string().max(300)).min(1).max(8),
      })).min(1).max(10),
      origen,
    },
  }, async ({ ideas, origen: o }) => {
    const ins = db.prepare('INSERT INTO ia_ideas (origen, titulo, angulo, formato, gancho, por_que, fuentes) VALUES (?,?,?,?,?,?,?)');
    for (const i of ideas) ins.run(corto(o, 40), i.titulo, i.angulo, i.formato, i.gancho, i.por_que, JSON.stringify(i.fuentes));
    return txt(`Guardadas ${ideas.length} ideas. Para cada una, manda con enviar_referencias el concepto de miniatura y referencias visuales (miniaturas exitosas del nicho, personajes, escenarios). Claude las revisará al preparar las próximas propuestas del Estudio.`);
  });

  s.registerTool('proponer_guion', {
    title: 'Proponer un guion completo',
    description: 'Envía un guion completo para un vídeo largo del Estudio (8–10 min, ~1.400 palabras de narración, por escenas). '
      + 'Aparece en el panel del editor en «Ideas de las IA»; si lo aprueba, Claude verifica los datos y lo produce. '
      + 'Escribe la narración en español, frases cortas para el oído, gancho en los primeros 20 s, un dato o giro cada 45–60 s y fuentes reales.',
    inputSchema: {
      titulo: z.string().max(120), formato: z.string().max(40), gancho: z.string().max(400),
      angulo: z.string().max(800).describe('De qué va y por qué engancha'),
      guion: z.string().min(200).max(30000).describe('Guion por escenas: «Escena N — [visual] narración…»'),
      fuentes: z.array(z.string().max(300)).min(1).max(15),
      origen,
    },
  }, async ({ titulo, formato, gancho, angulo, guion, fuentes, origen: o }) => {
    db.prepare('INSERT INTO ia_ideas (origen, titulo, angulo, formato, gancho, por_que, fuentes, guion) VALUES (?,?,?,?,?,?,?,?)')
      .run(corto(o, 40), titulo, angulo, formato, gancho, '', JSON.stringify(fuentes), guion);
    return txt(`Guion «${titulo}» guardado (${guion.split(/\s+/).length} palabras). El editor lo verá en el Estudio, en «Ideas de las IA». Ahora manda con enviar_referencias el concepto de miniatura y referencias visuales.`);
  });

  s.registerTool('enviar_referencias', {
    title: 'Enviar miniatura y referencias visuales',
    description: 'Para una idea, guion o vídeo del Estudio: el concepto de MINIATURA (2–4 palabras enormes, emoción de la cara, objeto de curiosidad, '
      + 'dos colores en contraste, composición) y hasta 8 imágenes de referencia (miniaturas exitosas del nicho, personajes, escenarios, elementos, estilo). '
      + 'Cada imagen: enlace https DIRECTO a la imagen (p. ej. https://i.ytimg.com/vi/<id>/maxresdefault.jpg para la miniatura de un vídeo de YouTube) '
      + 'o, si tu cliente puede, base64 de una imagen pequeña (≤1,5 MB). Explica qué tomar de cada una. Sin logotipos de marcas en las propuestas.',
    inputSchema: {
      para: z.string().max(160).describe('Título de la idea/guion que enviaste, slug del proyecto o id de ver_aportes'),
      miniatura: z.object({
        texto: z.string().max(40).describe('2–4 palabras o una cifra'), emocion: z.string().max(120).optional(),
        objeto: z.string().max(160).optional().describe('El objeto de curiosidad'), colores: z.array(z.string().max(30)).max(4).optional(),
        composicion: z.string().max(400).optional(), por_que: z.string().max(400).optional().describe('Qué miniaturas exitosas imita y por qué'),
      }).optional(),
      imagenes: z.array(z.object({
        tipo: z.enum(['miniatura', 'personaje', 'escenario', 'elemento', 'estilo']),
        descripcion: z.string().max(300).describe('Qué tomar de esta imagen'),
        url: z.string().max(600).optional(), base64: z.string().max(2_100_000).optional(), mime: z.string().max(40).optional(),
      })).max(8).default([]),
      origen,
    },
  }, async ({ para, miniatura, imagenes, origen: o }) => {
    const id = db.prepare('INSERT INTO ia_referencias (origen, para, miniatura) VALUES (?,?,?)').run(corto(o, 40), corto(para, 160), JSON.stringify(miniatura || null)).lastInsertRowid;
    const dir = `${REFS}/${id}`; mkdirSync(dir, { recursive: true });
    const hechas = [], fallos = [];
    for (const [i, im] of imagenes.entries()) {
      try {
        const { buf, ext } = im.base64 ? deBase64(im.base64, im.mime) : await bajarImagen(im.url);
        const nombre = `${String(i + 1).padStart(2, '0')}-${im.tipo}.${ext}`;
        writeFileSync(`${dir}/${nombre}`, buf); hechas.push({ archivo: nombre, tipo: im.tipo, descripcion: corto(im.descripcion, 300), url: im.url ? corto(im.url, 600) : null });
      } catch (e) { fallos.push(`${i + 1}: ${e.message}`); }
    }
    db.prepare('UPDATE ia_referencias SET imagenes = ? WHERE id = ?').run(JSON.stringify(hechas), id);
    return txt(`Referencias guardadas (#${id}): ${hechas.length} imágenes${miniatura ? ' + concepto de miniatura' : ''}.${fallos.length ? ' No pude guardar: ' + fallos.join('; ') + '. Usa un enlace directo a la imagen (que termine en .jpg/.png/.webp o i.ytimg.com).' : ''}`);
  });

  s.registerTool('encargos_miniatura', {
    title: 'Miniaturas que hacen falta',
    description: 'Vídeos del Estudio que necesitan miniatura (en revisión, con cambios o aprobados), con su concepto, paleta y un prompt listo. '
      + 'Si puedes generar imágenes, crea una por vídeo EN EL CHAT (16:9, alta resolución) para que el editor la guarde en la carpeta indicada; '
      + 'el conector no puede recibir imágenes generadas. Después llama a enviar_referencias con el concepto (para = slug).',
    inputSchema: {},
  }, async () => {
    const filas = db.prepare("SELECT slug, titulo, estado, json FROM estudio_proyectos WHERE estado IN ('propuesta','cambios','aprobado') ORDER BY id DESC LIMIT 8").all();
    return txt(filas.map((f) => {
      let p = {}; try { p = JSON.parse(f.json || '{}'); } catch {}
      const pal = p.estilo?.paleta || {}, mi = p.miniatura || {};
      return { slug: f.slug, titulo: f.titulo, estado: f.estado, idea: corto(p.idea, 400), look: corto(p.look, 400), concepto: mi, colores: [pal.fondo, pal.acento, pal.malo].filter(Boolean),
        guardar_en: `\\\\servidor\\archivos\\Estudio\\${f.slug}\\miniatura-ia.png`,
        prompt: `Miniatura de YouTube 16:9 para «${f.titulo}». Estilo 3D low-poly con sombreado plano, iluminación de estudio dramática y fondo limpio `
          + `(colores ${[pal.fondo, pal.acento, pal.malo].filter(Boolean).join(', ')}). UN objeto protagonista que cuente la historia de un vistazo, `
          + `contraste alto, legible en móvil. Sin logotipos ni marcas, sin caras de personas reales. Deja espacio para 2–3 palabras grandes; `
          + `si escribes texto, que sea en español y como mucho «${mi.valor || ''}» (formato de cifras español: 115.800 M$, no $115.8B).` };
    }));
  });

  s.registerTool('ver_aportes', {
    title: 'Ver aportes recientes',
    description: 'Lo que ya se aportó (para no repetir): tendencias vigentes, ideas o escenas de los últimos días.',
    inputSchema: { tipo: z.enum(['tendencias', 'ideas', 'escenas', 'referencias']), dias: z.number().int().min(1).max(60).default(7) },
  }, async ({ tipo, dias }) => {
    const d = `-${dias} days`;
    if (tipo === 'tendencias') return txt(db.prepare("SELECT creado, origen, tema, por_que_ahora, nicho FROM ia_tendencias WHERE creado > datetime('now', ?) AND caduca > datetime('now') ORDER BY id DESC LIMIT 60").all(d));
    if (tipo === 'ideas') return txt(db.prepare("SELECT creado, origen, titulo, formato, estado FROM ia_ideas WHERE creado > datetime('now', ?) ORDER BY id DESC LIMIT 60").all(d));
    if (tipo === 'referencias') return txt(db.prepare("SELECT id, creado, origen, para, json_extract(miniatura, '$.texto') miniatura, json_array_length(imagenes) imagenes FROM ia_referencias WHERE creado > datetime('now', ?) ORDER BY id DESC LIMIT 60").all(d));
    return txt(db.prepare("SELECT creado, origen, video, url, json_array_length(momentos) n FROM ia_escenas WHERE creado > datetime('now', ?) ORDER BY id DESC LIMIT 60").all(d));
  });
  return s;
}

http.createServer(async (req, res) => {
  const ruta = new URL(req.url, 'http://x').pathname;
  const r = ruta.replace(/\/+$/, '');
  const oculta = ruta.replaceAll(TOKEN, '<clave>');
  res.on('finish', () => console.log(new Date().toISOString(), req.method, oculta, res.statusCode, '·', req.headers['user-agent'] || '', '·', req.headers.accept || ''));
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': '*' }).end(); return; }
  if (r !== `/mcp/${TOKEN}` && r !== `/${TOKEN}/mcp`) { res.writeHead(404).end(); return; }
  if (req.method === 'GET' || req.method === 'DELETE') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
  // Algunos clientes no mandan exactamente «application/json, text/event-stream»: el SDK los rechazaría con 406.
  req.headers.accept = 'application/json, text/event-stream';
  if (!/json/.test(req.headers['content-type'] || '')) req.headers['content-type'] = 'application/json';
  let cuerpo = '';
  for await (const t of req) { cuerpo += t; if (cuerpo.length > 18 << 20) { res.writeHead(413).end(); return; } }
  let json; try { json = JSON.parse(cuerpo || '{}'); } catch { res.writeHead(400).end(); return; }
  const server = crear();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, json); }
  catch (e) { console.error('mcp:', e.message); if (!res.headersSent) res.writeHead(500).end(); }
}).listen(PUERTO, '127.0.0.1', () => console.log(`MCP de StreamClipper en 127.0.0.1:${PUERTO}`));
