// Autopiloto de publicación (pedido del editor, 21-nov-2026). Hace solo lo que el editor ya decidió como regla:
//  1. Clip aprobado («Sirve») → cola de YouTube (10/día, separados) y de TikTok. Si su canal es horizontal, su versión 16:9
//     queda aprobada para los recopilatorios.
//  2. Vídeos largos del Estudio (3D) → calendario fijo (lun/jue 11:00 RD); si el proyecto es de actualidad, en cuanto está listo.
//     Sin Shorts de los vídeos 3D (21-nov-2026); el ajuste estudio.shorts = true los vuelve a programar tras su largo.
//  3. Recopilatorios (banco.mjs): se montan solos el día antes de cada martes y viernes con los mejores clips por nota
//     (emoción y puntos) y salen a las 11:00 RD; los sobrantes compiten en la ronda siguiente o se descartan.
//  4. Limpieza: clips «No sirve» (tras 24 h, ya con su valoración guardada como lección) y clips sin revisar en 14 días se
//     borran del disco; la valoración y los metadatos se conservan para el feedback de las IA.
//  7. Campañas (campanas.mjs): clips en otro idioma con logo, franja horaria propia y registro por publicación.
//  8. Producción 3D en el servidor: los proyectos aprobados con motor3d se renderizan solos de noche (sin la laptop).
//  6. Bucle de rendimiento: cada largo se revisa a las 72 h (conservar/cambiar para el siguiente) y cada domingo se comparan
//     los largos de la semana y se fijan las reglas de la siguiente (tabla yt_revisiones + aprendizaje.md + MCP).
//  5. clips.autopiloto (banco.aprobarCanal): aprueba solos hasta 5 clips del canal al día con la revisión de encuadre superada
//     y nota mínima, de mejor a peor.
import { existsSync, rmSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import path from 'node:path';
import { db, ajustes, ARCHIVOS } from '../db.mjs';
import { subidas } from './youtube.mjs';
import * as Tiktok from './tiktok.mjs';
import * as Recop from './recopilatorios.mjs';
import * as Banco from './banco.mjs';
import * as Campanas from './campanas.mjs';
import { datosVideo, archivoClip, enVentana, minutosHastaTanda } from './clips.mjs';
import { chat } from '../llm.mjs';
import { vencidos as prefiltroVencidos } from './automatizaciones.mjs';
import { readdirSync } from 'node:fs';
import { DATOS } from '../db.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS clip_caducados (video_id INTEGER NOT NULL, n INTEGER NOT NULL, fecha TEXT DEFAULT (datetime('now')), PRIMARY KEY (video_id, n));
CREATE TABLE IF NOT EXISTS clip_borrados (video_id INTEGER NOT NULL, n INTEGER NOT NULL, motivo TEXT, fecha TEXT DEFAULT (datetime('now')), PRIMARY KEY (video_id, n));
`);
const DEF = { 'youtube.largos_dias': '1,4', 'youtube.recop_dias': '2,5', 'estudio.shorts': false, 'youtube.largos_hora_utc': '15:00', 'autopiloto.desde_id': 214,
  'clips.caducan_dias': 14, 'rendimiento.desde': '2026-11-21', 'rendimiento.horas': 72, 'estudio.auto_producir': true, 'estudio.render_desde': '22:00', 'estudio.render_hasta': '03:00', 'clips.autopiloto': false, 'clips.autopiloto_min': 85, 'tiktok.privacidad': 'SELF_ONLY' };
const cfg = () => ({ ...DEF, ...ajustes() });
const log = (...a) => console.log('Autopiloto:', ...a);

// ---------- 1. aprobado → colas ----------
function textoTiktok(v, c, canal) {
  const t = String(c.youtube?.titulo || c.titulo || '').slice(0, 120);
  const tags = ['#gaming', '#clips'];
  if (canal) tags.push('#' + canal.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());
  return `${t}\nCréditos: ${canal || 'el creador original'}\n${tags.slice(0, 5).join(' ')}`;
}
export function alAprobar(videoId, n) {
  const { v, c, canalNombre } = datosVideo(videoId, n);
  if (!v || !c) return;
  // Clip de una campaña: a su franja horaria (siguiente hueco libre), sin TikTok ni bolsa de recopilatorios.
  if (v.campana) {
    const cuando = Campanas.hueco(v.campana);
    if (cuando) { subidas.programar(videoId, n, cuando, 'campana'); log(`campaña ${v.campana}: «${c.titulo}» programado para ${cuando} UTC`); }
    else log(`campaña ${v.campana}: sin hueco libre para «${c.titulo}»`);
    return;
  }
  subidas.pedir(videoId, n, 'aprobado');
  if (Tiktok.conectado() && v.tipo !== 'estudio' && c.formato !== 'horizontal') {
    try { Tiktok.publicaciones.pedir(videoId, n, { titulo: textoTiktok(v, c, canalNombre), privacidad: cfg()['tiktok.privacidad'], comentarios: true, duo: false, stitch: false }); }
    catch (e) { log('TikTok:', e.message); }
  }
  // Su versión horizontal 16:9 se pide sola para la bolsa de recopilatorios (y queda aprobada al estar lista).
  if (!['estudio', 'recop'].includes(v.tipo) && c.inicio != null) { try { Recop.pedir(videoId, n); } catch (e) { log('recop:', e.message); } }
  db.prepare("UPDATE recop_clips SET aprobado = 1 WHERE video_id = ? AND n = ? AND estado = 'listo'").run(Number(videoId), Number(n));
}

// ---------- 2 y 3. calendario de largos y recopilatorios ----------
function siguienteHueco(dias, horaUtc, tipo) {
  const [hh, mm] = horaUtc.split(':').map(Number);
  const ocupados = new Set(db.prepare(`SELECT date(s.no_antes) d FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id
    WHERE v.tipo = ? AND s.no_antes IS NOT NULL AND s.estado IN ('pendiente','subiendo','ok')`).all(tipo).map((r) => r.d));
  const ds = String(dias).split(',').map(Number);
  for (let i = 0; i < 60; i++) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + i); d.setUTCHours(hh, mm || 0, 0, 0);
    if (d.getTime() < Date.now() + 30 * 60000 || !ds.includes(d.getUTCDay())) continue;
    const dia = d.toISOString().slice(0, 10);
    if (!ocupados.has(dia)) return `${dia} ${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00`;
  }
  return null;
}
const ahoraSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
function programarLargos() {
  const k = cfg();
  const filas = db.prepare(`SELECT id, tipo, fuente, clips FROM clip_videos WHERE tipo IN ('estudio','recop') AND estado = 'listo' AND id >= ?`).all(Number(k['autopiloto.desde_id']));
  for (const v of filas) {
    let piezas = []; try { piezas = JSON.parse(v.clips || '[]'); } catch {}
    const h = piezas.find((c) => c.formato === 'horizontal'); if (!h) continue;
    if (db.prepare('SELECT 1 FROM clip_subidas WHERE video_id = ? AND n = ?').get(v.id, h.n)) continue;
    let cuando = null;
    if (v.tipo === 'estudio') {
      const slug = String(v.fuente).replace(/^estudio:/, '');
      let p = {}; try { p = JSON.parse(db.prepare('SELECT json FROM estudio_proyectos WHERE slug = ?').get(slug)?.json || '{}'); } catch {}
      cuando = p.actualidad ? ahoraSql() : siguienteHueco(k['youtube.largos_dias'], k['youtube.largos_hora_utc'], 'estudio');
    } else cuando = siguienteHueco(k['youtube.recop_dias'], k['youtube.largos_hora_utc'], 'recop');
    if (!cuando) continue;
    subidas.programar(v.id, h.n, cuando, 'calendario');
    log(`«${h.titulo || v.fuente}» programado para ${cuando} UTC`);
  }
}
// Shorts del Estudio: salen DESPUÉS de su largo (+3 h, +1 día, +2 días) para enlazarlo en su descripción y alargar el pico del tema.
function programarShortsEstudio() {
  const k = cfg(); if (!k['estudio.shorts']) return;
  const filas = db.prepare("SELECT id, clips FROM clip_videos WHERE tipo = 'estudio' AND estado = 'listo' AND id >= ?").all(Number(k['autopiloto.desde_id']));
  for (const v of filas) {
    let piezas = []; try { piezas = JSON.parse(v.clips || '[]'); } catch {}
    const h = piezas.find((c) => c.formato === 'horizontal'); if (!h) continue;
    const base = db.prepare("SELECT COALESCE(subido, no_antes) t FROM clip_subidas WHERE video_id = ? AND n = ? AND estado IN ('pendiente','subiendo','ok')").get(v.id, h.n)?.t;
    if (!base) continue;
    const cortos = piezas.filter((c) => c.formato !== 'horizontal');
    cortos.forEach((c, i) => {
      if (db.prepare('SELECT 1 FROM clip_subidas WHERE video_id = ? AND n = ?').get(v.id, c.n)) return;
      const t = new Date(base.replace(' ', 'T') + 'Z'); t.setUTCHours(t.getUTCHours() + [3, 27, 51, 75][i] || 75);
      subidas.programar(v.id, c.n, t.toISOString().slice(0, 19).replace('T', ' '), 'calendario');
      log(`Short «${c.titulo}» programado tras su largo: ${t.toISOString().slice(0, 16)} UTC`);
    });
  }
}

// Listas de reproducción por serie (necesita permiso de gestión de YouTube: youtube.force-ssl). Sin permiso, avisa una vez.
db.exec('CREATE TABLE IF NOT EXISTS yt_en_lista (yt TEXT PRIMARY KEY, lista TEXT, fecha TEXT DEFAULT (datetime(\'now\')))');
const SERIE = { decisiones: 'El veredicto', finanzas: 'Gaming y bolsillo', actualidad: 'El dato que nadie cuenta', curiosidades: 'El dato que nadie cuenta' };
let sinPermisoAvisado = false, ultimaLista = 0;
async function listas() {
  if (Date.now() - ultimaLista < 3600000 || sinPermisoAvisado) return; ultimaLista = Date.now();
  const filas = db.prepare(`SELECT s.yt, v.tipo, v.fuente, s.n, v.clips FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id
    WHERE s.estado = 'ok' AND s.yt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM yt_en_lista l WHERE l.yt = s.yt) ORDER BY s.id DESC LIMIT 20`).all();
  if (!filas.length) return;
  const { tokenAcceso } = await import('./youtube.mjs');
  const api = async (ruta, body) => {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${ruta}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${await tokenAcceso()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403 || r.status === 401) { const e = new Error(j.error?.message || 'sin permiso'); e.permiso = true; throw e; }
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    return j;
  };
  let mapa = {}; try { mapa = JSON.parse(ajustes()['youtube.listas'] || '{}'); } catch {}
  const asegurar = async (nombre) => {
    if (mapa[nombre]) return mapa[nombre];
    const j = await api('playlists?part=snippet,status', { snippet: { title: nombre, description: `Serie de ${nombre}.`, defaultLanguage: 'es' }, status: { privacyStatus: 'public' } });
    mapa[nombre] = j.id;
    db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('youtube.listas', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(JSON.stringify(mapa)));
    return j.id;
  };
  try {
    for (const f of filas) {
      let nombre = null;
      if (f.tipo === 'recop') nombre = 'Mejores momentos de streamers';
      else if (f.tipo === 'estudio') {
        const slug = String(f.fuente).replace(/^estudio:/, '');
        let p = {}; try { p = JSON.parse(db.prepare('SELECT json FROM estudio_proyectos WHERE slug = ?').get(slug)?.json || '{}'); } catch {}
        nombre = p.serie || SERIE[p.actualidad ? 'actualidad' : p.formato] || 'El veredicto';
        const pieza = JSON.parse(f.clips || '[]').find((c) => c.n === f.n);
        if (pieza && pieza.formato !== 'horizontal') nombre = `${nombre} · Shorts`;
      } else nombre = f.tipo === 'gaming' || f.tipo === 'reaccion' ? 'Clips de streamers' : 'Clips';
      try { await api('playlistItems?part=snippet', { snippet: { playlistId: await asegurar(nombre), resourceId: { kind: 'youtube#video', videoId: f.yt } } }); }
      catch (e) {
        // Vídeo borrado o inexistente: se anota para no reintentarlo y se sigue con los demás (antes bloqueaba la lista entera).
        if (!e.permiso && /not found|notFound/i.test(e.message)) { db.prepare('INSERT OR IGNORE INTO yt_en_lista (yt, lista) VALUES (?,?)').run(f.yt, '(no existe)'); continue; }
        throw e;
      }
      db.prepare('INSERT OR IGNORE INTO yt_en_lista (yt, lista) VALUES (?,?)').run(f.yt, nombre);
    }
    log(`listas: ${filas.length} vídeos añadidos a su serie`);
  } catch (e) {
    if (e.permiso) { sinPermisoAvisado = true; log('listas: falta el permiso de gestión de YouTube (youtube.force-ssl); hay que volver a autorizar'); }
    else console.error('Autopiloto listas:', e.message);
  }
}

// Aviso de vídeo atascado: un Short con < 20 vistas a la hora, o un largo con < 10 vistas a las 24 h, avisa al móvil (una vez).
db.exec("CREATE TABLE IF NOT EXISTS yt_alertas (yt TEXT PRIMARY KEY, tipo TEXT, vistas INTEGER, fecha TEXT DEFAULT (datetime('now')))");
let ultimaAlerta = 0, ultimasStats = 0;
async function atascados() {
  if (Date.now() - ultimaAlerta < 20 * 60000) return; ultimaAlerta = Date.now();
  const E = await import('../estadisticas/estadisticas.mjs');
  if (!E.conectado() || !E.tokenLectura) return;
  const filas = db.prepare(`SELECT s.yt, s.subido, v.tipo, s.n, v.clips FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id
    WHERE s.estado = 'ok' AND s.yt IS NOT NULL AND s.subido > datetime('now','-2 days') AND NOT EXISTS (SELECT 1 FROM yt_alertas a WHERE a.yt = s.yt)`).all()
    .map((f) => { const p = JSON.parse(f.clips || '[]').find((c) => c.n === f.n) || {}; return { ...f, largo: p.formato === 'horizontal', titulo: p.titulo || '', edad: (Date.now() - Date.parse(f.subido.replace(' ', 'T') + 'Z')) / 60000 }; })
    .filter((f) => (f.largo ? f.edad >= 24 * 60 : f.edad >= 60));
  // Estadísticas del canal cada 6 h: la estrategia, el bucle de rendimiento y las IA trabajan con datos frescos.
  // (Antes iba al final de la función y no corría si no había vídeos que vigilar.)
  if (Date.now() - ultimasStats > 6 * 3600000) { ultimasStats = Date.now(); E.actualizar({ dias: 30 }).catch((e) => console.error('Autopiloto stats:', e.message)); }
  if (!filas.length) return;
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${filas.map((f) => f.yt).join(',')}`, { headers: { Authorization: `Bearer ${await E.tokenLectura()}` } });
  const j = await r.json().catch(() => ({})); if (!r.ok) { console.error('Autopiloto atascados:', j.error?.message || r.status); return; }
  const vistas = Object.fromEntries((j.items || []).map((i) => [i.id, Number(i.statistics?.viewCount || 0)]));
  const { avisarSinFallo } = await import('../avisos.mjs');
  for (const f of filas) {
    const v = vistas[f.yt] ?? 0, umbral = f.largo ? 10 : 20;
    db.prepare('INSERT OR IGNORE INTO yt_alertas (yt, tipo, vistas) VALUES (?,?,?)').run(f.yt, v < umbral ? 'atascado' : 'ok', v);
    if (v < umbral) {
      avisarSinFallo(f.largo ? 'Vídeo largo sin arrancar' : 'Short atascado', `«${f.titulo}»: ${v} vistas ${f.largo ? 'en 24 h' : 'en su primera hora'}. `
        + 'Revisa en YouTube Studio si tiene alguna restricción o aviso; si no, suele ser un bache puntual y no hace falta tocar nada.', { etiquetas: ['warning'], enlace: `https://youtu.be/${f.yt}` });
      log(`atascado: «${f.titulo}» con ${v} vistas`);
    }
  }
}

// Recopilatorios (Fase 2, 21-nov-2026): el banco puntúa cada clip 16:9 (emoción y puntos) y, cuando el próximo hueco de
// recopilatorio (martes o viernes 11:00 RD) está a menos de recop.antelacion_h horas, monta la ronda con los mejores.
let ultimaRonda = 0; const avisadoInsuf = new Set();
async function recopRonda() {
  for (let i = 0; i < 3; i++) if (!(await Banco.puntuar().catch((e) => { console.error('Banco puntuar:', e.message); return false; }))) break;
  if (Date.now() - ultimaRonda < 30 * 60000) return;
  ultimaRonda = Date.now();
  const enCurso = db.prepare("SELECT COUNT(*) n FROM recopilatorios WHERE estado IN ('borrador','cola','montando')").get().n;
  const esperando = db.prepare(`SELECT COUNT(*) n FROM clip_videos v WHERE v.tipo = 'recop' AND v.estado = 'listo'
    AND NOT EXISTS (SELECT 1 FROM clip_subidas s WHERE s.video_id = v.id)`).get().n;
  if (enCurso || esperando) return;
  const k = cfg(), hueco = siguienteHueco(k['youtube.recop_dias'], k['youtube.largos_hora_utc'], 'recop');
  if (!hueco) return;
  const horas = (Date.parse(hueco.replace(' ', 'T') + 'Z') - Date.now()) / 3600000;
  if (horas > Number(k['recop.antelacion_h'] ?? 30)) return;
  const r = Banco.ronda();
  if (r.insuficiente != null && !avisadoInsuf.has(hueco)) {
    avisadoInsuf.add(hueco);
    const { avisarSinFallo } = await import('../avisos.mjs');
    avisarSinFallo('Recopilatorio: faltan clips', `Para el recopilatorio de ${hueco} UTC hay ${r.insuficiente} clips en la bolsa (mínimo ${k['recop.min_clips'] ?? 6}). Aprueba clips o espera a los del autopiloto.`, { etiquetas: ['warning'] });
    log(`recopilatorio de ${hueco}: bolsa insuficiente (${r.insuficiente} clips)`);
  }
}

// ---------- 4. limpieza ----------
const sudoRm = (f) => new Promise((ok) => execFile('sudo', ['-n', 'rm', '-f', f], () => ok()));
async function borrarArchivos(videoId, n, motivo) {
  const { v, c } = datosVideo(videoId, n);
  if (!v || !c) return;
  const fs = new Set();
  const a = archivoClip(videoId, n); if (a) fs.add(a.ruta);
  if (c.final) fs.add(c.final);
  if (v.job && c.archivo) fs.add(path.join(ajustes()['clips.salida'] || '', v.job, path.basename(c.archivo)));
  if (v.carpeta && c.copia) { fs.add(path.join(v.carpeta, c.copia)); fs.add(path.join(v.carpeta, 'Descartados', c.copia)); }
  const rc = db.prepare('SELECT archivo FROM recop_clips WHERE video_id = ? AND n = ? AND recop_id IS NULL').get(videoId, n); if (rc?.archivo) fs.add(rc.archivo);
  for (const f of fs) { if (!f || !existsSync(f)) continue; try { rmSync(f, { force: true }); } catch { await sudoRm(f); } }
  db.prepare('INSERT OR IGNORE INTO clip_borrados (video_id, n, motivo) VALUES (?,?,?)').run(videoId, n, motivo);
  // Sin ningún clip vivo de ese vídeo, sus proxies del editor sobran.
  try {
    const vivos = JSON.parse(v.clips || '[]').filter((x) => !db.prepare('SELECT 1 FROM clip_borrados WHERE video_id = ? AND n = ?').get(videoId, x.n)).length;
    if (!vivos) { const dir = path.join(DATOS, 'editor'); for (const f of readdirSync(dir)) if (f.startsWith(`proxy-${videoId}-`)) rmSync(path.join(dir, f), { force: true }); }
  } catch {}
}
async function limpiar() {
  const dias = Number(cfg()['clips.caducan_dias']) || 14;
  // Sin revisar en N días (ni valorados, ni en cola, ni publicados): caducan.
  const viejos = db.prepare(`SELECT id, clips FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop')
    AND COALESCE(terminado, creado) < datetime('now', ?)`).all(`-${dias} days`);
  for (const v of viejos) for (const c of JSON.parse(v.clips || '[]')) {
    const tocado = db.prepare(`SELECT 1 FROM clip_valoraciones WHERE video_id = ?1 AND n = ?2 UNION SELECT 1 FROM clip_subidas WHERE video_id = ?1 AND n = ?2
      UNION SELECT 1 FROM clip_tiktok WHERE video_id = ?1 AND n = ?2 UNION SELECT 1 FROM clip_caducados WHERE video_id = ?1 AND n = ?2`).get(v.id, c.n);
    if (!tocado) db.prepare('INSERT OR IGNORE INTO clip_caducados (video_id, n) VALUES (?,?)').run(v.id, c.n);
  }
  const borrar = db.prepare(`SELECT video_id, n, 'no sirve' m FROM clip_valoraciones WHERE valor = -1 AND fecha < datetime('now', '-' || ${Math.max(1, Number(cfg()['clips.borrar_descartes_h']) || 24)} || ' hours')
      UNION SELECT video_id, n, 'sin revisar' m FROM clip_caducados`).all().concat(prefiltroVencidos())
    .filter((r) => !db.prepare('SELECT 1 FROM clip_borrados WHERE video_id = ? AND n = ?').get(r.video_id, r.n)
      && !db.prepare("SELECT 1 FROM clip_subidas WHERE video_id = ? AND n = ? AND estado IN ('pendiente','subiendo','ok')").get(r.video_id, r.n));
  for (const r of borrar) await borrarArchivos(r.video_id, r.n, r.m);
  if (borrar.length) log(`limpieza: ${borrar.length} clips borrados del disco (sus valoraciones siguen como lección para las IA)`);
}

// ---------- 6. bucle de rendimiento ----------
// Cada largo (Estudio 3D o recopilatorio) se revisa a las 72 h con sus métricas frente a la mediana de los largos anteriores;
// el LLM local redacta qué conservar y qué cambiar para el siguiente. Cada domingo (desde las 20:00 RD) se comparan los largos
// de la semana y se fijan las reglas de la siguiente. Sin LLM, se guarda igual la parte numérica. La retención (% visto,
// duración media, suscriptores) llega solo si la YouTube Analytics API está activada en el proyecto de Google.
db.exec(`CREATE TABLE IF NOT EXISTS yt_revisiones (clave TEXT PRIMARY KEY, tipo TEXT NOT NULL, yt TEXT, datos TEXT, texto TEXT,
  fecha TEXT DEFAULT (datetime('now')))`);
const APRENDIZAJE = path.join(ARCHIVOS, 'Estudio', '_marca', 'aprendizaje.md');
const mediana = (xs) => { const a = xs.filter((x) => x != null && !Number.isNaN(x)).sort((p, q) => p - q); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
const ratio = (a, b) => (b ? +(a / b * 100).toFixed(2) : null);
function largosCanal() {
  return db.prepare('SELECT * FROM yt_videos WHERE es_short = 0 AND publicado IS NOT NULL ORDER BY publicado').all()
    .map((v) => ({ ...v, origen: JSON.parse(v.origen || '{}') })).filter((v) => ['estudio', 'recop'].includes(v.origen.tipo));
}
function fichaLargo(v) {
  let p = {};
  if (v.origen.proyecto) try { p = JSON.parse(db.prepare('SELECT json FROM estudio_proyectos WHERE slug = ?').get(v.origen.proyecto)?.json || '{}'); } catch {}
  const trafico = db.prepare('SELECT fuente, vistas FROM yt_trafico WHERE yt = ? ORDER BY vistas DESC LIMIT 5').all(v.yt);
  return { yt: v.yt, titulo: v.titulo, tipo: v.origen.tipo, serie: p.serie || p.formato || null, proyecto: v.origen.proyecto || null,
    publicado: v.publicado, duracion_s: v.duracion_s, vistas: v.vistas, megusta: v.megusta, comentarios: v.comentarios,
    interaccion_pct: ratio((v.megusta || 0) + (v.comentarios || 0), v.vistas), pct_visto: v.pct_visto, media_s: v.media_s,
    subs: v.subs, subs_por_1000: v.subs != null ? ratio(v.subs * 10, v.vistas) : null, compartidos: v.compartidos,
    miniatura: p.miniatura?.tipo || null, gancho: p.escenas?.[0]?.narracion?.slice(0, 220) || null, trafico };
}
function referencia(lista) {
  return { videos: lista.length, vistas: mediana(lista.map((v) => v.vistas)), interaccion_pct: mediana(lista.map((v) => ratio((v.megusta || 0) + (v.comentarios || 0), v.vistas))),
    pct_visto: mediana(lista.map((v) => v.pct_visto)), media_s: mediana(lista.map((v) => v.media_s)) };
}
const numeros = (f, ref) => `vistas ${f.vistas} (mediana ${ref.vistas ?? '—'}) · interacción ${f.interaccion_pct ?? '—'} % (mediana ${ref.interaccion_pct ?? '—'} %)`
  + (f.pct_visto != null ? ` · % visto ${f.pct_visto.toFixed(1)} (mediana ${ref.pct_visto != null ? ref.pct_visto.toFixed(1) : '—'})` : ' · retención: sin datos (Analytics API desactivada)')
  + (f.subs != null ? ` · ${f.subs} subs` : '');
async function redactar(tarea, datos) {
  const k = cfg();
  const model = k['llm.modelo_resumen'] || k['llm.modelo_sentimiento'] || undefined;
  const schema = { type: 'object', additionalProperties: false, required: ['conservar', 'cambiar'],
    properties: { conservar: { type: 'array', items: { type: 'string' }, maxItems: 3 }, cambiar: { type: 'array', items: { type: 'string' }, maxItems: 4 } } };
  const txt = await chat(k['llm.url'], { model, schema, max_tokens: 700, timeoutMs: 300000, messages: [
    { role: 'system', content: 'Eres el analista de un canal pequeño de YouTube en español (vídeos largos 3D de 8-10 min y recopilatorios de clips de streamers). '
      + 'Respondes solo con lo que los datos permiten afirmar: si la muestra es pequeña o falta la retención, dilo. Frases cortas, concretas y accionables '
      + '(título, miniatura, tema, duración, gancho, día). Nada de consejos genéricos. No repitas los números: interprétalos (mejor o peor que la referencia y por qué puede ser). '
      + 'Cada frase empieza por el elemento al que se refiere (Título:, Miniatura:, Tema:, Gancho:, Duración:, Día:, Datos:) y dice qué hacer. JSON.' },
    { role: 'user', content: `${tarea}\n\nDatos:\n${JSON.stringify(datos)}` }] });
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  return JSON.parse(txt.slice(a, b + 1));
}
function anotar(md) {
  try {
    const actual = readFileSync(APRENDIZAJE, 'utf8');
    appendFileSync(APRENDIZAJE, (actual.includes('## Revisiones de rendimiento') ? '' : '\n## Revisiones de rendimiento (automáticas, autopiloto)\n') + md);
  } catch (e) { console.error('Autopiloto rendimiento (aprendizaje.md):', e.message); }
}
const vinetas = (xs, sangria) => (xs || []).map((x) => `${sangria}- ${x}`).join('\n');
let ultimaRevisionRend = 0;
export async function rendimiento({ forzar = false } = {}) {
  if (!forzar && Date.now() - ultimaRevisionRend < 3600000) return;
  const k = cfg();
  // El LLM local se comparte: solo en la ventana de clips.
  if (!forzar && (!enVentana(k) || minutosHastaTanda(k) < 60)) return;
  ultimaRevisionRend = Date.now();
  const todos = largosCanal(), horas = Number(k['rendimiento.horas']) || 72;
  const debidos = todos.filter((v) => v.publicado >= k['rendimiento.desde'] && Date.parse(v.publicado) <= Date.now() - horas * 3600000
    && Date.parse(v.actualizado || 0) >= Date.parse(v.publicado) + horas * 3600000 - 6 * 3600000
    && !db.prepare('SELECT 1 FROM yt_revisiones WHERE clave = ?').get(`largo:${v.yt}`));
  for (const v of debidos.slice(0, 2)) {
    const f = fichaLargo(v), ref = referencia(todos.filter((x) => x.yt !== v.yt && x.publicado < v.publicado));
    let texto = null;
    try { texto = await redactar(`Revisión a las ${horas} h del vídeo «${f.titulo}». Compáralo con la mediana de los largos anteriores del canal y di qué conservar y qué cambiar en el SIGUIENTE vídeo.`, { video: f, referencia: ref }); }
    catch (e) { console.error('Autopiloto rendimiento (LLM):', e.message); }
    db.prepare('INSERT OR REPLACE INTO yt_revisiones (clave, tipo, yt, datos, texto) VALUES (?,?,?,?,?)').run(`largo:${v.yt}`, 'largo', v.yt, JSON.stringify({ video: f, referencia: ref }), texto ? JSON.stringify(texto) : null);
    anotar(`- ${new Date().toISOString().slice(0, 10)} · **${horas} h** · «${f.titulo}» (${f.tipo}${f.serie ? `, ${f.serie}` : ''}): ${numeros(f, ref)}.\n`
      + (texto ? `  - Conservar:\n${vinetas(texto.conservar, '    ')}\n  - Cambiar en el siguiente:\n${vinetas(texto.cambiar, '    ')}\n` : '  - (Sin redacción del LLM: solo números.)\n'));
    log(`rendimiento: revisado «${f.titulo}» a las ${horas} h`);
  }
  // Domingo (hora RD = UTC−4) desde las 20:00: semana de lunes a domingo.
  const rd = new Date(Date.now() - 4 * 3600000);
  if (rd.getUTCDay() !== 0 || rd.getUTCHours() < 20) return;
  const lunes = new Date(rd); lunes.setUTCDate(rd.getUTCDate() - 6); const desde = lunes.toISOString().slice(0, 10);
  const clave = `semana:${desde}`;
  if (db.prepare('SELECT 1 FROM yt_revisiones WHERE clave = ?').get(clave)) return;
  const semana = todos.filter((v) => v.publicado.slice(0, 10) >= desde);
  if (!semana.length) return;
  const fichas = semana.map(fichaLargo), ref = referencia(todos.filter((x) => x.publicado.slice(0, 10) < desde));
  const revisiones = db.prepare(`SELECT yt, texto FROM yt_revisiones WHERE tipo = 'largo' AND yt IN (${semana.map(() => '?').join(',')})`).all(...semana.map((v) => v.yt));
  let texto = null;
  try { texto = await redactar('Resumen semanal: compara los largos de esta semana entre sí (los 3D de lunes y jueves y los recopilatorios de martes y viernes) y frente a la referencia. '
    + '«conservar» = lo que repetir la semana que viene; «cambiar» = reglas para la semana siguiente sobre título, miniatura, tema, duración y gancho.', { semana: fichas, referencia: ref, revisiones_72h: revisiones }); }
  catch (e) { console.error('Autopiloto rendimiento semanal (LLM):', e.message); }
  db.prepare('INSERT OR REPLACE INTO yt_revisiones (clave, tipo, yt, datos, texto) VALUES (?,?,?,?,?)').run(clave, 'semana', null, JSON.stringify({ semana: fichas, referencia: ref }), texto ? JSON.stringify(texto) : null);
  if (texto) db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('canal.reglas_semana', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor")
    .run(JSON.stringify({ semana: desde, ...texto }));
  anotar(`- ${rd.toISOString().slice(0, 10)} · **Semana del ${desde}** (${semana.length} largos): ${fichas.map((f) => `«${f.titulo.slice(0, 40)}» ${f.vistas} vistas`).join(' · ')}.\n`
    + (texto ? `  - Conservar:\n${vinetas(texto.conservar, '    ')}\n  - Reglas para la semana siguiente:\n${vinetas(texto.cambiar, '    ')}\n` : '  - (Sin redacción del LLM: solo números.)\n'));
  log(`rendimiento: resumen de la semana del ${desde}`);
}

// ---------- 8. producción 3D en el servidor (Fase 4) ----------
// Un proyecto del Estudio aprobado con `motor3d` ({ cfg, acento }) y `hyperframes` (carpeta HF) se produce entero aquí, de noche
// y de uno en uno: voz + build + render WebGL en la Iris Xe (~2,3 h para 8,5 min) + final + `producir` (~/apps/estudio/producir3d.sh,
// en trabajo.slice, fuera del proceso del panel: sobrevive a sus reinicios). Luego programarLargos lo coloca en su hueco.
function enFranja(desde, hasta, d = new Date()) {
  const rd = new Date(d.getTime() - 4 * 3600000), m = rd.getUTCHours() * 60 + rd.getUTCMinutes();
  const a = (x) => { const [h, mm] = String(x).split(':').map(Number); return h * 60 + mm; };
  return a(desde) <= a(hasta) ? m >= a(desde) && m < a(hasta) : m >= a(desde) || m < a(hasta);
}
function producir3d() {
  const k = cfg(); if (!k['estudio.auto_producir']) return;
  if (db.prepare("SELECT 1 FROM estudio_proyectos WHERE estado = 'produciendo'").get()) return;
  if (!enFranja(k['estudio.render_desde'], k['estudio.render_hasta'])) return;
  for (const f of db.prepare("SELECT slug, json FROM estudio_proyectos WHERE estado = 'aprobado' ORDER BY actualizado").all()) {
    let p = {}; try { p = JSON.parse(f.json || '{}'); } catch {}
    if (!p.motor3d?.cfg || !p.hyperframes) continue;
    const hf = path.basename(String(p.hyperframes).replace(/\/$/, ''));
    db.prepare("UPDATE estudio_proyectos SET estado = 'produciendo', paso = 'Render 3D en el servidor (≈ 2–3 h)', actualizado = datetime('now') WHERE slug = ?").run(f.slug);
    const ESTUDIO_APP = process.env.ESTUDIO_APP || path.join(DATOS, 'estudio-app'); mkdirSync(path.join(ESTUDIO_APP, 'logs'), { recursive: true });
    const salida = openSync(path.join(ESTUDIO_APP, 'logs', `${f.slug}-3d.log`), 'a');
    spawn('setsid', ['systemd-run', '--user', '--scope', '--quiet', '--slice=trabajo.slice', 'bash', path.join(ESTUDIO_APP, 'producir3d.sh'), f.slug, hf, p.motor3d.cfg, p.motor3d.acento || '#ffd23f'],
      { detached: true, stdio: ['ignore', salida, salida] }).unref();
    log(`producción 3D de «${f.slug}» lanzada en el servidor (${hf}, ${p.motor3d.cfg})`);
    return;
  }
}

let corriendo = false, ultimaLimpieza = 0;
export async function ciclo() {
  if (corriendo) return; corriendo = true;
  try {
    db.prepare(`UPDATE recop_clips SET aprobado = 1 WHERE estado = 'listo' AND aprobado = 0 AND recop_id IS NULL
      AND EXISTS (SELECT 1 FROM clip_valoraciones c WHERE c.video_id = recop_clips.video_id AND c.n = recop_clips.n AND c.valor = 1)`).run();
    await Banco.aprobarCanal(alAprobar).catch((e) => console.error('Autopiloto aprobar:', e.message));
    // Campañas: directos largos en tramos, aprobación automática (si la campaña ya publica) y registro de lo publicado.
    Campanas.trocear().catch((e) => console.error('Autopiloto trocear:', e.message));
    await Campanas.aprobar(alAprobar).catch((e) => console.error('Autopiloto campañas:', e.message));
    await Campanas.registrar().catch((e) => console.error('Autopiloto registro campañas:', e.message));
    try { producir3d(); } catch (e) { console.error('Autopiloto 3D:', e.message); }
    programarLargos(); programarShortsEstudio(); await recopRonda(); await listas(); await atascados();
    await rendimiento().catch((e) => console.error('Autopiloto rendimiento:', e.message));
    if (Date.now() - ultimaLimpieza > 3600000) { ultimaLimpieza = Date.now(); await limpiar(); }
  } catch (e) { console.error('Autopiloto:', e.message); } finally { corriendo = false; }
}
export function iniciar() { setTimeout(ciclo, 90000).unref(); setInterval(ciclo, 10 * 60000).unref(); }
