// Campañas de clipping (Fase 3, 21-nov-2026): perfiles configurables, no código a medida por campaña.
//
// Una campaña (tabla `campanas`, config JSON) define: idioma de textos y subida, juego (filtro de títulos), logo obligatorio
// (archivo, ancho), hashtags, categoría, cupo diario, franja horaria de publicación (zona horaria del público), días mínimos
// publicada, cómo trocear directos largos y nota mínima para la aprobación automática. Los canales fuente llevan
// `clip_canales.campana` = slug; sus vídeos heredan `clip_videos.campana` y pasan por el mismo motor con ese perfil:
//   · textos en el idioma de la campaña (clips-post.textosVerificados) y subtítulos de su transcripción;
//   · franja reservada y capa de logo fija como última capa del vídeo (nada la tapa) + revisión automática del logo
//     (herramientas/qa_logo.py: primer y último fotograma y uno cada 2 s; si falla, no se aprueba);
//   · metadatos de YouTube en ese idioma con sus hashtags (youtube.metadatos);
//   · horario propio: cada aprobado ocupa el siguiente hueco libre de su franja (p. ej. 18:00–22:00 hora de Nueva York);
//   · registro por publicación (campana_publicaciones) con fecha desde la que se podría retirar (≥ min_dias_publicado);
//   · ni TikTok ni bolsa de recopilatorios (son clips en otro idioma).
// `publicar` = 0 hasta que el editor apruebe el fotograma de muestra: se producen clips, pero el autopiloto no aprueba ninguno.
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { db, ajustes, ARCHIVOS } from '../db.mjs';
import { emocionClip } from './clips-emocion.mjs';
import { picosVoz, combinarPicos } from './clips-picos.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS campanas (slug TEXT PRIMARY KEY, nombre TEXT NOT NULL, activa INTEGER NOT NULL DEFAULT 1,
  publicar INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', creada TEXT DEFAULT (datetime('now')), nota TEXT);
CREATE TABLE IF NOT EXISTS campana_publicaciones (id INTEGER PRIMARY KEY, campana TEXT NOT NULL, video_id INTEGER NOT NULL, n INTEGER NOT NULL,
  streamer TEXT, fuente TEXT, original TEXT, yt TEXT, titulo TEXT, publicado TEXT, retirable_desde TEXT, enviado INTEGER NOT NULL DEFAULT 0,
  UNIQUE (video_id, n));
`);
// La columna «campana» de los clips: si sus tablas aún no existen (instalación nueva), la añade tareas/clips.mjs al crearlas.
for (const [t, c] of [['clip_canales', 'campana'], ['clip_videos', 'campana']]) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  if (cols.length && !cols.some((x) => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`);
}

// «Campaña de ejemplo»: plantilla genérica y en pausa para ver cómo se configura una campaña. Cámbiala o bórrala.
const EJEMPLO = {
  idioma: 'en', paises: ['US', 'GB', 'CA', 'AU'],
  juego: { nombre: '', regex: '' },
  logo: { archivo: '', ancho: 760, margen: 14 },
  hashtags: ['#clips', '#shorts'], categoria: '20',
  por_dia: 3, horario: { zona: 'America/New_York', desde: '18:00', hasta: '22:00' },
  min_dias_publicado: 30, nota_min: 0.45,
  tramos: { minutos: 15, cuantos: 3 },
  enfoque: 'Gameplay moments with the streamer reacting. Skip menus, loading screens, sponsor reads and long stretches with nothing happening. '
    + 'Prefer chaos, fails, funny moments and big reactions that a viewer understands without context.',
  enlace: '',
  pago: 'según las reglas de la campaña',
};
db.prepare("INSERT OR IGNORE INTO campanas (slug, nombre, activa, publicar, config, nota) VALUES ('ejemplo', 'Campaña de ejemplo', 0, 0, ?, 'Plantilla de ejemplo')")
  .run(JSON.stringify(EJEMPLO));

const log = (...a) => console.log('Campañas:', ...a);
export function perfil(slug) {
  if (!slug) return null;
  const r = db.prepare('SELECT * FROM campanas WHERE slug = ?').get(slug);
  if (!r) return null;
  let cfg = {}; try { cfg = JSON.parse(r.config || '{}'); } catch {}
  const todasOn = ajustes()['campanas.activo'] !== false; // interruptor general de Campañas
  return { ...cfg, slug: r.slug, nombre: r.nombre, activa: !!r.activa && todasOn, publicar: !!r.publicar && todasOn };
}
export const perfilDeVideo = (v) => (v?.campana ? perfil(v.campana) : null);
// ¿Texto en español? (tildes, ñ, ¿¡ o dos o más palabras típicas). Sirve para no publicar en español en una campaña en inglés.
export function pareceEspanol(t) {
  t = String(t || '').replace(/#[\p{L}\p{N}_]+/gu, '');
  if (/[áéíóúñ¿¡]/i.test(t)) return true;
  return (t.toLowerCase().match(/\b(en|con|las|los|una|unos|del|por|para|que|se|y|el|la|al|su|sus|cuando|como|muy|pero)\b/g) || []).length >= 2;
}
// Los hashtags obligatorios de la campaña, guardados en la descripción del clip (así la app enseña lo que se publica).
export function conTagsCampana(c, camp) {
  const tags = (camp?.hashtags || []).filter((t) => t.toLowerCase() !== '#shorts');
  if (!c || !tags.length) return c;
  for (const k of ['tiktok', 'instagram']) {
    const base = String(c[k] || c.tiktok || c.gancho || '').trim();
    const hay = new Set((base.match(/#[\p{L}\p{N}_]+/gu) || []).map((x) => x.toLowerCase()));
    const faltan = tags.filter((t) => !hay.has(t.toLowerCase()));
    if (faltan.length || !c[k]) c[k] = `${base}${faltan.length ? ` ${faltan.join(' ')}` : ''}`.trim();
  }
  return c;
}
export const todas = () => db.prepare('SELECT slug FROM campanas ORDER BY slug').all().map((r) => perfil(r.slug));
export const esDelJuego = (p, titulo) => !p?.juego?.regex || new RegExp(p.juego.regex, 'i').test(String(titulo || ''));

// ---------- horario en la zona del público ----------
const partes = (t, zona) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  .formatToParts(new Date(t)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
// Instante UTC (ms) de las hh:mm del día local `dia` (AAAA-MM-DD) en `zona` (con cambio de hora incluido).
function utcDe(dia, hhmm, zona) {
  const [y, m, d] = dia.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) { const p = partes(t, zona); t -= Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Date.UTC(y, m - 1, d, hh, mm); }
  return t;
}
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const aMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
// Siguiente hueco libre de la franja: por_dia huecos repartidos entre desde y hasta (hora local de la campaña).
export function hueco(slug, ahora = Date.now()) {
  const p = perfil(slug); if (!p?.horario) return null;
  const { zona, desde, hasta } = p.horario, n = Math.max(1, Number(p.por_dia) || 5), paso = (aMin(hasta) - aMin(desde)) / n;
  const ocupados = db.prepare(`SELECT s.no_antes FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id
    WHERE v.campana = ? AND s.no_antes IS NOT NULL AND s.estado IN ('pendiente','subiendo','ok')`).all(slug).map((r) => Date.parse(r.no_antes.replace(' ', 'T') + 'Z'));
  for (let i = 0; i < 21; i++) {
    const p0 = partes(ahora + i * 864e5, zona), dia = `${p0.year}-${String(p0.month).padStart(2, '0')}-${String(p0.day).padStart(2, '0')}`;
    for (let k = 0; k < n; k++) {
      const m = Math.round(aMin(desde) + k * paso), t = utcDe(dia, `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, zona);
      if (t < ahora + 10 * 60000) continue;
      if (ocupados.some((o) => Math.abs(o - t) < (paso / 2) * 60000)) continue;
      return sql(t);
    }
  }
  return null;
}

// ---------- nota y aprobación automática ----------
const puntosDe = (c) => (c?.ia?.puntos ?? c?.puntos ?? null);
function nota(emocion, puntos) {
  const a = ajustes(), pe = Number(a['banco.peso_emocion'] ?? 0.6), pp = Number(a['banco.peso_puntos'] ?? 0.4);
  return +(pe * (emocion ?? 0) / 100 + pp * (puntos ?? 0) / 100).toFixed(4);
}
function guardarEnClip(videoId, n, cambios) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = db.prepare('SELECT clips FROM clip_videos WHERE id = ?').get(videoId);
    const clips = JSON.parse(v?.clips || '[]'), i = clips.findIndex((x) => x.n === Number(n));
    if (i >= 0) { clips[i] = { ...clips[i], ...cambios }; db.prepare('UPDATE clip_videos SET clips = ? WHERE id = ?').run(JSON.stringify(clips), videoId); }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
let aprobando = false;
export async function aprobar(alAprobar) {
  if (aprobando) return; aprobando = true;
  try {
    for (const p of todas().filter((x) => x.activa && x.publicar)) {
      const hoy = partes(Date.now(), p.horario?.zona || 'UTC');
      const ini = utcDe(`${hoy.year}-${String(hoy.month).padStart(2, '0')}-${String(hoy.day).padStart(2, '0')}`, '00:00', p.horario?.zona || 'UTC');
      const hechos = db.prepare(`SELECT COUNT(*) n FROM clip_valoraciones l JOIN clip_videos v ON v.id = l.video_id WHERE v.campana = ? AND l.valor = 1 AND l.fecha >= ?`).get(p.slug, sql(ini)).n;
      let cupo = Number(p.por_dia || 5) - hechos; if (cupo <= 0) continue;
      const filas = db.prepare(`SELECT id, clips FROM clip_videos WHERE campana = ? AND estado = 'listo' AND COALESCE(terminado, creado) < datetime('now','-1 hour')
        AND COALESCE(terminado, creado) > datetime('now','-5 days')`).all(p.slug);
      const cand = [];
      for (const v of filas) for (const c of JSON.parse(v.clips || '[]')) {
        if (!c.qa?.ok || !c.qaLogo?.ok || !c.final || !existsSync(c.final)) continue;
        if (db.prepare('SELECT 1 FROM clip_valoraciones WHERE video_id = ? AND n = ?').get(v.id, c.n)) continue;
        if (c.emocion == null) { const e = await emocionClip(c.final).catch(() => null); if (e) { c.emocion = e.emocion; guardarEnClip(v.id, c.n, { emocion: e.emocion, emocionDetalle: e.detalle }); } }
        const nt = nota(c.emocion, puntosDe(c)); if (nt >= Number(p.nota_min ?? 0.45)) cand.push({ v, c, nt });
      }
      cand.sort((a, b) => b.nt - a.nt);
      for (const x of cand) {
        if (cupo-- <= 0) break;
        db.prepare("INSERT OR IGNORE INTO clip_valoraciones (video_id, n, valor, etiquetas, nota) VALUES (?,?,1,'[]','autopiloto')").run(x.v.id, x.c.n);
        alAprobar(x.v.id, x.c.n);
        log(`${p.slug}: aprobado solo vídeo ${x.v.id} clip ${x.c.n} (nota ${x.nt.toFixed(2)})`);
      }
    }
  } finally { aprobando = false; }
}

// ---------- registro de publicaciones (para enviarlas a la plataforma de la campaña y respetar los días mínimos) ----------
export async function registrar() {
  const filas = db.prepare(`SELECT s.video_id, s.n, s.yt, s.subido, v.campana, v.fuente, v.clips, c.nombre streamer FROM clip_subidas s
    JOIN clip_videos v ON v.id = s.video_id LEFT JOIN clip_canales c ON c.id = v.canal_id
    WHERE v.campana IS NOT NULL AND s.estado = 'ok' AND s.yt IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM campana_publicaciones p WHERE p.video_id = s.video_id AND p.n = s.n)`).all();
  for (const f of filas) {
    const p = perfil(f.campana), c = JSON.parse(f.clips || '[]').find((x) => x.n === f.n) || {};
    const dias = Number(p?.min_dias_publicado || 60);
    db.prepare(`INSERT OR IGNORE INTO campana_publicaciones (campana, video_id, n, streamer, fuente, original, yt, titulo, publicado, retirable_desde)
      VALUES (?,?,?,?,?,?,?,?,?, datetime(?, '+${dias + 1} days'))`).run(f.campana, f.video_id, f.n, f.streamer, f.fuente, c.original || '', f.yt, c.titulo || '', f.subido, f.subido);
    const { avisarSinFallo } = await import('../avisos.mjs');
    avisarSinFallo(`Campaña ${p?.nombre || f.campana}: envíalo`, `«${c.titulo || ''}» ya está publicado. Envía https://youtube.com/shorts/${f.yt} en la campaña (no lo borres ni lo hagas privado antes de ${dias} días).`,
      { etiquetas: ['moneybag'], enlace: p?.enlace || '' });
    log(`${f.campana}: registrado https://youtube.com/shorts/${f.yt}`);
  }
}
export const publicaciones = (slug) => db.prepare('SELECT * FROM campana_publicaciones WHERE campana = ? ORDER BY id DESC').all(slug);
export const marcarEnviada = (id, si = true) => db.prepare('UPDATE campana_publicaciones SET enviado = ? WHERE id = ?').run(si ? 1 : 0, Number(id)).changes;
// ¿Se puede retirar/borrar este vídeo de YouTube? (nadie lo hace hoy, pero cualquier herramienta futura debe preguntarlo).
export function retirable(yt) {
  const r = db.prepare('SELECT retirable_desde FROM campana_publicaciones WHERE yt = ?').get(yt);
  return !r || Date.parse(r.retirable_desde.replace(' ', 'T') + 'Z') <= Date.now();
}

// ---------- directos largos: solo los tramos más re-vistos ----------
// Un VOD de 4–10 h no se puede procesar entero en este servidor (≈ 2× su duración). Se baja solo un tramo de N minutos
// alrededor de cada uno de los picos de «lo más reproducido» de YouTube, y cada tramo entra en la cola como archivo local.
const correr = (cmd, args, timeout) => new Promise((ok, mal) => execFile(cmd, args, { timeout, maxBuffer: 64 << 20 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-300))) : ok(String(so)))));
const hhmm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
// Reacciones de voz en un audio de horas sin bloquear el panel (picosVoz, pensada para tramos de 20 min, genera una línea por
// trozo decodificado y calcula los picos de forma síncrona: con 6 h de audio dejaba el panel sin responder minutos).
// Aquí: bloques exactos de 0,5 s a 8 kHz (asetnsamples), una pasada de ffmpeg, y el cálculo cede el turno cada 2.000 puntos.
// Un pico = volumen ≥ 8 dB sobre la mediana de su entorno (±30 s), como en picosVoz.
async function reaccionesLargas(archivo) {
  const out = await new Promise((ok, mal) => execFile('nice', ['-n', '10', 'ffmpeg', '-hide_banner', '-nostdin', '-i', archivo, '-vn', '-ac', '1', '-ar', '8000',
    '-af', 'asetnsamples=n=4000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'],
    { timeout: 1800000, maxBuffer: 128 << 20 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-200))) : ok(String(so)))));
  const serie = []; let t = null;
  for (const l of out.split('\n')) {
    let m;
    if ((m = l.match(/pts_time:([\d.]+)/))) t = Number(m[1]);
    else if ((m = l.match(/RMS_level=(-?[\d.]+|-inf)/)) && t != null) serie.push({ t, v: m[1] === '-inf' ? -90 : Math.max(-90, Number(m[1])) });
  }
  const picos = [], W = 60; // ±30 s en bloques de 0,5 s
  for (let i = 0; i < serie.length; i++) {
    if (i % 2000 === 0) await new Promise((ok) => setImmediate(ok));
    const vec = serie.slice(Math.max(0, i - W), i + W).map((x) => x.v).sort((a, b) => a - b);
    const d = serie[i].v - vec[Math.floor(vec.length / 2)];
    if (d >= 8) picos.push({ t: Math.round(serie[i].t), intensidad: +(1 + (d - 8) / 8).toFixed(1), tipo: 'voz' });
  }
  const porSegundo = new Map(); // un punto por segundo (el más fuerte)
  for (const p of picos) if (!porSegundo.has(p.t) || porSegundo.get(p.t).intensidad < p.intensidad) porSegundo.set(p.t, p);
  return [...porSegundo.values()];
}
let troceando = false;
// YouTube a veces responde 403 a una descarga (bloqueo temporal; la misma descarga funciona minutos después): hasta 3
// intentos con 1 y 3 minutos de espera, borrando los restos del intento fallido.
async function bajarTramo(args, base, entrada) {
  for (let i = 0; ; i++) {
    try { return await correr('yt-dlp', ['--retries', '5', '--fragment-retries', '10', ...args], 3 * 3600000); }
    catch (e) {
      for (const x of readdirSync(entrada)) if (x.startsWith(path.basename(base) + '.')) rmSync(path.join(entrada, x), { force: true });
      if (i >= 2 || !/403|Forbidden|HTTP Error 429|timed out|reset by peer/i.test(e.message)) throw e;
      log(`descarga con error (${String(e.message).slice(0, 80)}); reintento ${i + 2} de 3`);
      await new Promise((ok) => setTimeout(ok, (i ? 180 : 60) * 1000));
    }
  }
}
// Ventanas a descargar alrededor de los momentos que marcó Gemini (segundos del vídeo original): los momentos cercanos
// (menos de 2 min entre sí) van en la misma ventana, de 10 min como mucho, con 20 s de margen a cada lado.
function ventanasDeGemini(v) {
  const ms = db.prepare('SELECT momentos FROM ia_escenas WHERE video = ? ORDER BY id DESC LIMIT 3').all(String(v.video || ''))
    .flatMap((r) => { try { return JSON.parse(r.momentos); } catch { return []; } })
    .filter((m) => m.fin_s > m.inicio_s).sort((a, b) => a.inicio_s - b.inicio_s);
  const out = [];
  for (const m of ms) {
    const w = out.at(-1);
    if (w && m.inicio_s - w.b < 120 && m.fin_s + 20 - w.a <= 600) w.b = Math.max(w.b, m.fin_s + 20);
    else out.push({ a: Math.max(0, m.inicio_s - 20), b: m.fin_s + 20 });
  }
  return out.map((w) => ({ a: Math.round(w.a), b: Math.round(Math.min(w.b, v.duracion_s || w.b)) })).filter((w) => w.b - w.a >= 20);
}
export async function trocear() {
  if (troceando) return; troceando = true;
  const soloIA = ajustes()['clips.solo_ia'] !== false;
  // Con «solo Gemini», el directo espera (sin descargar nada) hasta que Gemini marque sus momentos.
  const v = db.prepare(`SELECT * FROM clip_videos WHERE estado = 'troceando' ${soloIA ? 'AND (COALESCE(sin_ia,0) = 1 OR canal_id IN (SELECT id FROM clip_canales WHERE esperar_ia = 0) OR EXISTS (SELECT 1 FROM ia_escenas e WHERE e.video = clip_videos.video))' : ''} ORDER BY (campana IS NOT NULL) DESC, id LIMIT 1`).get();
  try {
    if (!v) return;
    const p = perfil(v.campana), t = p?.tramos || { minutos: 15, cuantos: 3 }, largo = t.minutos * 60;
    if (soloIA && !v.sin_ia && !(db.prepare('SELECT esperar_ia FROM clip_canales WHERE id = ?').get(v.canal_id)?.esperar_ia === 0)) {
      const entrada = ajustes()['clips.entrada']; mkdirSync(entrada, { recursive: true });
      const ventanas = ventanasDeGemini(v);
      let n = 0;
      for (const w of ventanas) {
        const base = path.join(entrada, `camp-${v.video}-${w.a}`);
        for (const x of readdirSync(entrada)) if (x.startsWith(path.basename(base) + '.')) rmSync(path.join(entrada, x), { force: true });
        db.prepare('UPDATE clip_videos SET paso = ? WHERE id = ?').run(`Descargando el tramo ${n + 1} de ${ventanas.length} (momentos de Gemini)`, v.id);
        await bajarTramo(['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--download-sections', `*${w.a}-${w.b}`,
          '--merge-output-format', 'mp4', '--no-part', '--no-playlist', '--no-warnings', '-o', `${base}.%(ext)s`, v.fuente], base, entrada);
        const f = readdirSync(entrada).map((x) => path.join(entrada, x)).find((x) => x.startsWith(base + '.') && x.endsWith('.mp4'));
        if (!f || statSync(f).size < 2e5) { if (f) rmSync(f, { force: true }); continue; }
        let picos = []; try { picos = combinarPicos(await picosVoz(f)); } catch {}
        db.prepare(`INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, offset_s, picos, campana, estado) VALUES (?,?,?,?,?,?,?,?,?,?,'cola')`)
          .run(v.canal_id, f, v.video, `${String(v.titulo).slice(0, 200)} · tramo ${hhmm(w.a)}–${hhmm(w.b)}`, w.b - w.a, v.tipo, v.enfoque || '', w.a, JSON.stringify(picos), v.campana);
        n++;
      }
      db.prepare("UPDATE clip_videos SET estado = 'descartado', paso = ? WHERE id = ?").run(n ? `Troceado en ${n} tramo(s) con los momentos de Gemini` : 'Gemini no marcó momentos descargables', v.id);
      log(`«${v.titulo}»: ${n} tramo(s) con los momentos de Gemini a la cola`);
      return;
    }
    let h = []; try { h = JSON.parse((await correr('yt-dlp', ['--skip-download', '--no-warnings', '--print', '%(heatmap)j', v.fuente], 180000)).trim()); } catch {}
    const ventanas = [];
    if (Array.isArray(h) && h.length >= 10) {
      // Ventanas de `largo` segundos centradas en los picos más altos de «lo más reproducido», sin solaparse.
      const picos = [...h].filter((x) => x.start_time > 120).sort((a, b) => b.value - a.value);
      for (const x of picos) {
        const a = Math.max(0, Math.min((v.duracion_s || 0) - largo, Math.round(x.start_time - largo / 2)));
        if (ventanas.every((w) => Math.abs(w.a - a) >= largo)) ventanas.push({ a, b: a + largo, valor: x.value });
        if (ventanas.length >= t.cuantos) break;
      }
    } else {
      // YouTube no da el mapa en directos muy largos: se baja solo el audio y se buscan las ventanas con más reacciones
      // del streamer (gritos, risas, subidones de voz: picosVoz). Luego se borra el audio.
      db.prepare('UPDATE clip_videos SET paso = ? WHERE id = ?').run('Buscando reacciones en el audio del directo', v.id);
      const tmp = path.join(ajustes()['clips.entrada'], `camp-audio-${v.video}`);
      // Restos de un intento anterior: yt-dlp intentaría reanudarlos y falla con HTTP 416.
      for (const x of readdirSync(path.dirname(tmp))) if (x.startsWith(path.basename(tmp) + '.')) rmSync(path.join(path.dirname(tmp), x), { force: true });
      try {
        await correr('yt-dlp', ['-f', 'bestaudio', '--no-playlist', '--no-warnings', '--no-part', '-o', `${tmp}.%(ext)s`, v.fuente], 3 * 3600000);
        const f = readdirSync(path.dirname(tmp)).map((x) => path.join(path.dirname(tmp), x)).find((x) => x.startsWith(tmp + '.'));
        const voz = f ? await reaccionesLargas(f) : [];
        const fin = Math.max(largo, (v.duracion_s || 0) - largo);
        const puntua = (a) => voz.filter((p) => p.t >= a && p.t < a + largo).reduce((s, p) => s + (Number(p.intensidad) || 1), 0);
        const cand = [];
        for (let a = 120; a <= fin; a += 60) cand.push({ a, b: a + largo, valor: puntua(a) });
        cand.sort((x, y) => y.valor - x.valor);
        for (const c of cand) { if (c.valor <= 0) break; if (ventanas.every((w) => Math.abs(w.a - c.a) >= largo)) ventanas.push(c); if (ventanas.length >= t.cuantos) break; }
      } finally {
        for (const x of readdirSync(path.dirname(tmp))) if (x.startsWith(path.basename(tmp) + '.')) rmSync(path.join(path.dirname(tmp), x), { force: true });
      }
      if (!ventanas.length) { db.prepare("UPDATE clip_videos SET estado = 'descartado', paso = 'Sin mapa ni reacciones en el audio: no se trocea' WHERE id = ?").run(v.id); return; }
      log(`«${v.titulo}»: sin mapa de YouTube; ${ventanas.length} ventana(s) por reacciones de voz`);
    }
    const entrada = ajustes()['clips.entrada']; mkdirSync(entrada, { recursive: true });
    let n = 0;
    for (const w of ventanas.sort((x, y) => x.a - y.a)) {
      const base = path.join(entrada, `camp-${v.video}-${w.a}`);
      // Restos de un intento cortado (reinicio a mitad): fuera, para no dar por bueno un archivo incompleto.
      for (const x of readdirSync(entrada)) if (x.startsWith(path.basename(base) + '.')) rmSync(path.join(entrada, x), { force: true });
      // Sin --force-keyframes-at-cuts: recodificaría 15 min de vídeo por afinar el corte unos segundos.
      await bajarTramo(['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--download-sections', `*${w.a}-${w.b}`,
        '--merge-output-format', 'mp4', '--no-part', '--no-playlist', '--no-warnings', '-o', `${base}.%(ext)s`, v.fuente], base, entrada);
      const f = readdirSync(entrada).map((x) => path.join(entrada, x)).find((x) => x.startsWith(base + '.') && x.endsWith('.mp4'));
      if (!f || statSync(f).size < 1e6) { if (f) rmSync(f, { force: true }); continue; }
      // Picos del mapa dentro del tramo (segundos del tramo), para el enfoque de OpenShorts y la ventana de cada clip.
      const rep = h.filter((x) => x.start_time >= w.a && x.end_time <= w.b && x.value >= 0.5).map((x) => ({ t: Math.round(x.start_time - w.a), intensidad: +(x.value * 3).toFixed(1), tipos: ['repeticiones'] }));
      let dentro = rep; try { dentro = combinarPicos(rep, await picosVoz(f)); } catch {}
      db.prepare(`INSERT INTO clip_videos (canal_id, fuente, video, titulo, duracion_s, tipo, enfoque, offset_s, picos, campana, estado) VALUES (?,?,?,?,?,?,?,?,?,?,'cola')`)
        .run(v.canal_id, f, v.video, `${String(v.titulo).slice(0, 200)} · tramo ${hhmm(w.a)}–${hhmm(w.b)}`, largo, v.tipo, v.enfoque || '', w.a, JSON.stringify(dentro), v.campana);
      n++;
    }
    db.prepare("UPDATE clip_videos SET estado = 'descartado', paso = ? WHERE id = ?").run(`Troceado en ${n} tramo(s) de lo más reproducido`, v.id);
    log(`«${v.titulo}»: ${n} tramo(s) de ${t.minutos} min a la cola`);
  } catch (e) {
    if (v) db.prepare("UPDATE clip_videos SET estado = 'error', error = ? WHERE id = ?").run(`Trocear: ${e.message}`.slice(0, 400), v.id);
    console.error('Campañas trocear:', e.message);
  } finally { troceando = false; }
}
