// API «social» (21-nov-2026): una sola fuente de datos para la interfaz organizada como una red social (web y app Android).
// Historias = lo que pasa ahora · Feed = tarjetas de lo que necesita al editor y de lo publicado · Reels = revisión de clips a
// pantalla completa · Explorar = cuadrícula de la galería · Actividad = avisos · Perfil = el canal · Mensajes = ideas de las IA.
// Cuentas: «canal» (StreamClipper) y una por campaña («campana:<slug>»).
// Solo lee; las acciones siguen usando las rutas de siempre (/api/clips/valorar, /api/estudio/estado…).
import { tramoSinVer } from './tareas/transcripciones.mjs';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { db, ajustes, ARCHIVOS, columna } from './db.mjs';
import * as Clips from './tareas/clips.mjs';
import { motivoEspera, proximaPasada } from './gemini-vigia.mjs';
import * as Campanas from './tareas/campanas.mjs';
import * as Estudio from './estudio/estudio.mjs';

const ESTUDIO = path.join(ARCHIVOS, 'Estudio');
const iso = (s) => (!s ? null : /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s).toISOString() : new Date(String(s).replace(' ', 'T') + 'Z').toISOString());
const parse = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const clipsDe = (v) => parse(v.clips, []) || [];
const canalDe = (v) => (v.canal_id ? db.prepare('SELECT nombre FROM clip_canales WHERE id = ?').get(v.canal_id)?.nombre : null)
  || (v.tipo === 'estudio' ? 'Estudio' : v.tipo === 'recop' ? 'Recopilatorios' : 'StreamClipper');
const medioClip = (id, n) => ({ tipo: 'video', url: `/api/clips/video/${id}/${n}`, poster: `/api/clips/poster/${id}/${n}`, vertical: true });
import { oculto as ocultoPorApp, dePrefiltro } from './tareas/automatizaciones.mjs';
const valoracion = (id, n) => db.prepare('SELECT valor, etiquetas, nota FROM clip_valoraciones WHERE video_id = ? AND n = ?').get(id, n) || null;
const subida = (id, n) => db.prepare('SELECT estado, yt, no_antes, subido, error FROM clip_subidas WHERE video_id = ? AND n = ?').get(id, n) || null;
const tiktok = (id, n) => { try { return db.prepare('SELECT estado, error FROM clip_tiktok WHERE video_id = ? AND n = ?').get(id, n) || null; } catch { return null; } };
// Lo que la interfaz necesita saber de cada clip (un único sitio, para que todas las vistas digan lo mismo).
function fichaClip(v, c) {
  const sub = subida(v.id, c.n), tk = tiktok(v.id, c.n), val = valoracion(v.id, c.n);
  return { id: v.id, n: c.n, canal: canalDe(v), titulo: c.titulo || '', texto: c.tiktok || c.porque || '', gancho: c.gancho || '', medio: medioClip(v.id, c.n),
    puntos: c.puntos ?? null, emocion: c.emocion ?? null,
    encuadre: c.qa ? { ok: c.qa.ok === true, motivo: c.qa.motivo || '' } : null, logo: c.qaLogo ? { ok: c.qaLogo.ok === true, motivo: c.qaLogo.motivo || '' } : null,
    verificado: !!c.verificado, ia: c.ia ? { origen: c.ia.origen || 'ia', motivo: c.ia.motivo || '' } : null, textosDe: c.textosDe || null,
    campana: v.campana || null, original: c.original || '', dur: Math.round(((c.fin ?? 0) - (c.inicio ?? 0)) * 10) / 10, fecha: iso(v.terminado || v.creado),
    editable: !['estudio', 'recop'].includes(v.tipo) && c.inicio != null, encuadrePropio: ['juego+cara', 'juego+zoom'].includes(c.encuadre),
    valoracion: val ? { valor: val.valor, etiquetas: parse(val.etiquetas, []), nota: val.nota || '' } : null,
    prefiltro: (() => { const p = dePrefiltro(v.id, c.n); return p?.descartado ? { motivo: p.motivo, confianza: p.confianza, razon: p.razon || '', recuperado: !!p.recuperado, oculto: !p.recuperado && !val } : null; })(),
    youtube: sub ? { estado: sub.estado, yt: sub.yt || null, cuando: iso(sub.no_antes || sub.subido), error: sub.error || null } : null,
    tiktok: tk ? { estado: tk.estado, error: tk.error || null } : null };
}

export function cuentas() {
  const c = ajustes()['canal.cuenta'] || {};
  return [
    { id: 'canal', nombre: c.canal || 'StreamClipper', tipo: 'canal', avatar: c.avatar || null },
    ...Campanas.todas().filter((p) => p.activa).map((p) => ({ id: `campana:${p.slug}`, nombre: p.nombre, tipo: 'campana', avatar: null })),
  ];
}

// ---------- historias: lo que está pasando ahora ----------
export function historias() {
  const out = [];
  const pendientes = reelsPendientes().length;
  if (pendientes) out.push({ id: 'revisar', tipo: 'revisar', titulo: 'Por revisar', texto: `${pendientes} clips esperan tu ♥`, activo: true, destino: 'reels' });
  for (const d of Clips.directos.activos().filter((x) => x.estado === 'grabando'))
    out.push({ id: `directo-${d.id}`, tipo: 'directo', titulo: d.canal || 'Directo', texto: d.titulo, vivo: true, activo: true, extra: { tramos: d.tramos } });
  const p = Clips.enCurso(); if (p) out.push({ id: `procesando-${p.id}`, tipo: 'procesando', titulo: 'Recortando', texto: `${p.titulo} · ${p.paso || ''}`, activo: true });
  for (const e of db.prepare("SELECT slug, titulo, paso FROM estudio_proyectos WHERE estado = 'produciendo'").all())
    out.push({ id: `estudio-${e.slug}`, tipo: 'estudio', titulo: 'Estudio 3D', texto: `${e.titulo} · ${e.paso || 'produciendo'}`, activo: true, poster: `/api/estudio/archivo/${e.slug}/miniatura.png` });
  for (const r of db.prepare("SELECT id, numero, estado, paso FROM recopilatorios WHERE estado IN ('cola','montando')").all())
    out.push({ id: `recop-${r.id}`, tipo: 'recop', titulo: `Recopilatorio #${r.numero}`, texto: r.paso || 'en montaje', activo: true });
  for (const c of Campanas.todas().filter((x) => x.activa)) {
    const hoy = db.prepare("SELECT COUNT(*) n FROM campana_publicaciones WHERE campana = ? AND publicado >= datetime('now','-1 day')").get(c.slug).n;
    const prog = db.prepare(`SELECT MIN(s.no_antes) t FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id WHERE v.campana = ? AND s.estado = 'pendiente'`).get(c.slug).t;
    out.push({ id: `campana-${c.slug}`, tipo: 'campana', titulo: c.nombre, texto: `${hoy} publicados en 24 h${prog ? ' · siguiente programado' : ''}`, fecha: prog ? iso(prog) : null, activo: !!c.publicar, destino: `campana:${c.slug}` });
  }
  const sig = db.prepare(`SELECT s.video_id, s.n, s.no_antes, v.tipo, v.fuente FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id
    WHERE s.estado = 'pendiente' AND s.no_antes IS NOT NULL AND v.tipo IN ('estudio','recop') ORDER BY s.no_antes LIMIT 1`).get();
  if (sig) out.push({ id: 'proximo-largo', tipo: 'programado', titulo: 'Próximo largo', texto: `${String(Clips.datosVideo(sig.video_id, sig.n).c?.titulo || '').slice(0, 80)}`, fecha: iso(sig.no_antes), poster: `/api/clips/poster/${sig.video_id}/${sig.n}` });
  return out;
}

// ---------- reels: clips por revisar, de mejor a peor ----------
function reelsPendientes({ cuenta = 'canal' } = {}) {
  const camp = cuenta.startsWith('campana:') ? cuenta.slice(8) : null;
  const filas = db.prepare(`SELECT v.* FROM clip_videos v WHERE v.estado = 'listo' AND v.tipo NOT IN ('estudio','recop')
    AND COALESCE(v.terminado, v.creado) > datetime('now','-14 days') ${camp ? 'AND v.campana = ?' : ''} ORDER BY v.id DESC`).all(...(camp ? [camp] : []));
  const out = [];
  for (const v of filas) for (const c of clipsDe(v)) {
    if (c.formato === 'horizontal' || valoracion(v.id, c.n) || subida(v.id, c.n) || ocultoPorApp(v.id, c.n)) continue;
    out.push(fichaClip(v, c));
  }
  // Lo de campaña primero; dentro, por emoción y nota.
  const nota = (x) => (x.emocion ?? 0) * 0.6 + (x.puntos ?? 0) * 0.4;
  return out.sort((a, b) => Number(!!b.campana) - Number(!!a.campana) || nota(b) - nota(a));
}
export const reels = (q = {}) => ({ clips: reelsPendientes(q) });

// ---------- feed ----------
export function feed({ cuenta = 'canal', antes = null, limite = 20 } = {}) {
  const camp = cuenta.startsWith('campana:') ? cuenta.slice(8) : null;
  const tope = antes ? new Date(antes).toISOString() : new Date(Date.now() + 864e5).toISOString();
  const posts = [];
  // Clips por revisar (los 6 mejores; el resto, en Reels)
  for (const r of reelsPendientes({ cuenta }).slice(0, 6))
    posts.push({ id: `clip-${r.id}-${r.n}`, tipo: 'clip', fecha: r.fecha, autor: { nombre: r.canal }, medios: [r.medio], titulo: r.titulo, texto: r.texto,
      ref: { id: r.id, n: r.n }, clip: r, meta: { puntos: r.puntos, emocion: r.emocion, encuadre: r.encuadre, logo: r.logo, dur: r.dur }, estado: { revisar: true } });
  // Publicados (14 días) con sus métricas
  const pubs = db.prepare(`SELECT s.video_id, s.n, s.yt, s.subido, v.tipo, v.canal_id, v.campana, v.clips, y.vistas, y.megusta, y.comentarios, y.pct_visto, y.subs
    FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id LEFT JOIN yt_videos y ON y.yt = s.yt
    WHERE s.estado = 'ok' AND s.subido >= datetime('now','-14 days') ${camp ? 'AND v.campana = ?' : ''} ORDER BY s.subido DESC LIMIT 60`).all(...(camp ? [camp] : []));
  for (const p of pubs) {
    const c = clipsDe(p).find((x) => x.n === p.n) || {};
    const largo = c.formato === 'horizontal';
    posts.push({ id: `pub-${p.video_id}-${p.n}`, tipo: 'publicado', fecha: iso(p.subido), autor: { nombre: canalDe(p) },
      medios: [{ ...medioClip(p.video_id, p.n), vertical: !largo }], titulo: c.titulo || '', texto: '', ref: { id: p.video_id, n: p.n, yt: p.yt }, campana: p.campana || null,
      meta: { vistas: p.vistas, megusta: p.megusta, comentarios: p.comentarios, pct_visto: p.pct_visto, subs: p.subs, largo }, enlace: `https://youtu.be/${p.yt}` });
  }
  if (!camp) {
    // Propuestas del Estudio por revisar (carrusel: avance + miniatura + escenas)
    for (const e of db.prepare("SELECT slug, titulo, version, estado, actualizado FROM estudio_proyectos WHERE estado IN ('propuesta','cambios','aprobado','produciendo') ORDER BY actualizado DESC").all()) {
      const dir = path.join(ESTUDIO, e.slug, 'propuesta', `v${e.version || 1}`), rel = `propuesta/v${e.version || 1}`;
      const medios = [];
      if (existsSync(path.join(dir, 'avance.mp4'))) medios.push({ tipo: 'video', url: `/api/estudio/archivo/${e.slug}/${rel}/avance.mp4`, poster: existsSync(path.join(dir, 'miniatura.png')) ? `/api/estudio/archivo/${e.slug}/${rel}/miniatura.png` : null, vertical: false });
      if (existsSync(path.join(dir, 'miniatura.png'))) medios.push({ tipo: 'imagen', url: `/api/estudio/archivo/${e.slug}/${rel}/miniatura.png` });
      try { for (const f of readdirSync(path.join(dir, 'escenas')).filter((x) => /\.(png|jpg)$/.test(x)).sort().slice(0, 8)) medios.push({ tipo: 'imagen', url: `/api/estudio/archivo/${e.slug}/${rel}/escenas/${f}` }); } catch {}
      const pendientes = db.prepare('SELECT COUNT(*) n FROM estudio_comentarios c JOIN estudio_proyectos p ON p.id = c.proyecto_id WHERE p.slug = ? AND c.atendido = 0').get(e.slug)?.n ?? 0;
      posts.push({ id: `estudio-${e.slug}`, tipo: 'propuesta', fecha: iso(e.actualizado), autor: { nombre: 'Estudio' }, medios, titulo: e.titulo, texto: '',
        ref: { slug: e.slug }, estado: { estudio: e.estado, version: e.version, comentarios_pendientes: pendientes } });
    }
    // Recopilatorios montados
    for (const r of db.prepare("SELECT id, numero, titulo, estado, terminado FROM recopilatorios WHERE estado = 'listo' AND terminado >= datetime('now','-14 days')").all())
      posts.push({ id: `recop-${r.id}`, tipo: 'recop', fecha: iso(r.terminado), autor: { nombre: 'Recopilatorios' }, medios: [{ tipo: 'video', url: `/api/recop/video/${r.id}`, poster: null, vertical: false }], titulo: r.titulo, texto: '', ref: { recop: r.id } });
  }
  return { posts: posts.filter((p) => p.fecha && p.fecha < tope).sort((a, b) => (b.estado?.revisar ? 1 : 0) - (a.estado?.revisar ? 1 : 0) || b.fecha.localeCompare(a.fecha)).slice(0, limite),
    siguiente: null };
}

// ---------- explorar ----------
export function explorar({ filtro = 'todo', q = '' } = {}) {
  const t = String(q || '').toLowerCase().trim(), items = [];
  for (const v of Clips.videos.listos()) for (const c of v.clips || []) {
    // Sin su vídeo (caducado o borrado; puede quedar solo la versión 16:9, que sale en «Horizontales»): no se enseña.
    if (!(c.final && existsSync(c.final)) && !Clips.archivoClip(v.id, c.n)) continue;
    const val = valoracion(v.id, c.n), sub = subida(v.id, c.n);
    const it = { id: v.id, n: c.n, titulo: c.titulo || '', canal: canalDe(v), poster: `/api/clips/poster/${v.id}/${c.n}`, video: `/api/clips/video/${v.id}/${c.n}`,
      vertical: c.formato !== 'horizontal', estado: sub?.estado === 'ok' ? 'publicado' : sub?.estado === 'error' ? 'error' : sub?.estado === 'subiendo' ? 'subiendo' : sub ? 'en_cola' : val?.valor === 1 ? 'aprobado' : val?.valor === -1 ? 'descartado' : ocultoPorApp(v.id, c.n) ? 'descartado_app' : 'pendiente', ficha: fichaClip(v, c),
      campana: v.campana || null, tipo: v.tipo, fecha: iso(v.terminado || v.creado), yt: sub?.yt || null };
    if (filtro === 'pendientes' && it.estado !== 'pendiente') continue;
    if (filtro === 'publicados' && it.estado !== 'publicado') continue;
    if (filtro === 'descartados_app' && it.estado !== 'descartado_app') continue;
    if (it.estado === 'descartado_app') { const p = dePrefiltro(v.id, c.n); it.prefiltro = { motivo: p?.motivo, razon: p?.razon || '' }; }
    if (filtro === 'campanas' && !it.campana) continue;
    if (filtro === 'estudio' && v.tipo !== 'estudio') continue;
    if (filtro === 'recopilatorios' && v.tipo !== 'recop') continue;
    if (t && !`${it.titulo} ${it.canal}`.toLowerCase().includes(t)) continue;
    items.push(it);
  }
  return { items: items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 300), filtros: ['todo', 'pendientes', 'descartados_app', 'publicados', 'campanas', 'estudio', 'recopilatorios'] };
}

// ---------- actividad ----------
export function actividad() {
  const ev = [];
  const titulo = (id, n) => { try { return Clips.datosVideo(id, n).c?.titulo || `Clip ${n}`; } catch { return `Clip ${n}`; } };
  for (const s of db.prepare("SELECT video_id, n, estado, yt, error, subido, creado FROM clip_subidas WHERE (estado = 'ok' AND subido >= datetime('now','-7 days')) OR (estado = 'error' AND creado >= datetime('now','-7 days'))").all())
    ev.push(s.estado === 'ok' ? { tipo: 'publicado', fecha: iso(s.subido), texto: `Publicado en YouTube: «${titulo(s.video_id, s.n)}»`, enlace: `https://youtu.be/${s.yt}`, ref: { id: s.video_id, n: s.n } }
      : { tipo: 'error', fecha: iso(s.creado), texto: `Falló la subida de «${titulo(s.video_id, s.n)}»: ${String(s.error || '').slice(0, 120)}`, ref: { id: s.video_id, n: s.n } });
  for (const v of db.prepare("SELECT video_id, n, fecha FROM clip_valoraciones WHERE nota = 'autopiloto' AND fecha >= datetime('now','-7 days')").all())
    ev.push({ tipo: 'autopiloto', fecha: iso(v.fecha), texto: `El autopiloto aprobó «${titulo(v.video_id, v.n)}»`, ref: { id: v.video_id, n: v.n } });
  for (const a of db.prepare("SELECT yt, tipo, vistas, fecha FROM yt_alertas WHERE tipo = 'atascado' AND fecha >= datetime('now','-7 days')").all())
    ev.push({ tipo: 'alerta', fecha: iso(a.fecha), texto: `Vídeo atascado: ${a.vistas} vistas`, enlace: `https://youtu.be/${a.yt}` });
  for (const c of db.prepare("SELECT id, campana, yt, titulo, publicado, enviado FROM campana_publicaciones WHERE publicado >= datetime('now','-7 days')").all())
    ev.push({ tipo: 'campana', fecha: iso(c.publicado), texto: `${c.enviado ? 'Enviado' : 'Pendiente de enviar'} a la campaña: «${c.titulo}»`, enlace: `https://youtube.com/shorts/${c.yt}`, accion: c.enviado ? null : { tipo: 'enviado', id: c.id } });
  for (const p of db.prepare("SELECT slug, titulo, estado, actualizado FROM estudio_proyectos WHERE actualizado >= datetime('now','-7 days')").all())
    ev.push({ tipo: 'estudio', fecha: iso(p.actualizado), texto: `Estudio: «${p.titulo}» está ${p.estado}`, ref: { slug: p.slug } });
  try { for (const r of db.prepare("SELECT clave, tipo, fecha FROM yt_revisiones WHERE fecha >= datetime('now','-14 days')").all())
    ev.push({ tipo: 'rendimiento', fecha: iso(r.fecha), texto: r.tipo === 'semana' ? 'Nuevas reglas para la semana' : 'Revisión de rendimiento a las 72 h', ref: { revision: r.clave } }); } catch {}
  return { eventos: ev.filter((e) => e.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 80) };
}

// ---------- perfil ----------
export function perfil({ cuenta = 'canal' } = {}) {
  const c = ajustes()['canal.cuenta'] || {};
  const yt = db.prepare('SELECT yt, titulo, publicado, es_short, vistas, megusta, pct_visto, origen FROM yt_videos ORDER BY publicado DESC').all();
  const posterDe = (y) => { const s = db.prepare("SELECT video_id, n FROM clip_subidas WHERE yt = ? AND estado = 'ok'").get(y); return s ? `/api/clips/poster/${s.video_id}/${s.n}` : null; };
  const ficha = (v) => ({ yt: v.yt, titulo: v.titulo, fecha: v.publicado, vistas: v.vistas, megusta: v.megusta, pct_visto: v.pct_visto, poster: posterDe(v.yt), enlace: `https://youtu.be/${v.yt}` });
  const slugCamp = cuenta.startsWith('campana:') ? cuenta.slice(8) : null;
  const programados = db.prepare(`SELECT s.video_id, s.n, s.no_antes, v.campana FROM clip_subidas s JOIN clip_videos v ON v.id = s.video_id WHERE s.estado = 'pendiente' ${slugCamp ? 'AND v.campana = ?' : ''} ORDER BY COALESCE(s.no_antes, s.creado) LIMIT 60`).all(...(slugCamp ? [slugCamp] : []))
    .map((s) => ({ id: s.video_id, n: s.n, fecha: iso(s.no_antes), video: `/api/clips/video/${s.video_id}/${s.n}`, campana: s.campana, titulo: (() => { try { return Clips.datosVideo(s.video_id, s.n).c?.titulo || ''; } catch { return ''; } })(), poster: `/api/clips/poster/${s.video_id}/${s.n}` }));
  const camp = cuenta.startsWith('campana:') ? Campanas.perfil(cuenta.slice(8)) : null;
  return {
    cuenta: camp ? { id: cuenta, nombre: camp.nombre, bio: `${camp.pago || ''}` } : { id: 'canal', nombre: c.canal || 'StreamClipper', bio: (c.descripcion || '').slice(0, 300), avatar: c.avatar || null },
    contadores: { publicaciones: c.videos ?? yt.length, suscriptores: c.suscriptores ?? null, vistas: c.vistas ?? yt.reduce((a, v) => a + (v.vistas || 0), 0) },
    pestañas: {
      shorts: yt.filter((v) => v.es_short && parse(v.origen, {})?.tipo !== 'otro').slice(0, 90).map(ficha),
      largos: yt.filter((v) => !v.es_short).slice(0, 60).map(ficha),
      campanas: db.prepare(`SELECT id, yt, titulo, publicado, campana, enviado, retirable_desde, video_id, n FROM campana_publicaciones ${slugCamp ? 'WHERE campana = ?' : ''} ORDER BY id DESC LIMIT 60`).all(...(slugCamp ? [slugCamp] : [])).map((p) => ({ ...p, enlace: `https://youtube.com/shorts/${p.yt}`, poster: `/api/clips/poster/${p.video_id}/${p.n}` })),
      programados,
    },
  };
}

// ---------- mensajes: lo que proponen las IA y los comentarios del Estudio ----------
export function mensajes() {
  const hilos = {};
  try { for (const i of db.prepare('SELECT id, origen, titulo, estado, creado FROM ia_ideas ORDER BY id DESC LIMIT 100').all()) {
    const k = i.origen || 'ia'; (hilos[k] ||= { id: `ia-${k}`, nombre: k, mensajes: [] }).mensajes.push({ id: i.id, texto: i.titulo, estado: i.estado, fecha: iso(i.creado) });
  } } catch {}
  const est = db.prepare(`SELECT c.id, c.texto, c.escena, c.atendido, c.creado, p.slug, p.titulo FROM estudio_comentarios c JOIN estudio_proyectos p ON p.id = c.proyecto_id ORDER BY c.id DESC LIMIT 60`).all();
  if (est.length) hilos.estudio = { id: 'estudio', nombre: 'Estudio', mensajes: est.map((c) => ({ id: c.id, texto: c.texto, proyecto: c.titulo, slug: c.slug, atendido: !!c.atendido, fecha: iso(c.creado) })) };
  return { hilos: Object.values(hilos).map((h) => ({ ...h, ultimo: h.mensajes[0]?.fecha || null })).sort((a, b) => (b.ultimo || '').localeCompare(a.ultimo || '')) };
}

// ---------- cola: vídeos que esperan, se recortan o fallaron (3 días) ----------
export function cola() {
  const filas = db.prepare(`SELECT v.id, v.titulo, v.estado, v.tipo, v.paso, v.error, v.urgente, v.duracion_s, v.offset_s, v.video, v.fuente, v.creado, v.terminado,
      COALESCE(v.campana, c.campana) campana, c.nombre canal, v.canal_id, v.sin_ia, c.esperar_ia
    FROM clip_videos v LEFT JOIN clip_canales c ON c.id = v.canal_id
    WHERE v.tipo NOT IN ('estudio','recop') AND (v.estado IN ('propuesto','cola','troceando','procesando')
      OR (v.estado IN ('error','descartado') AND COALESCE(v.terminado, v.creado) > datetime('now','-3 days') AND COALESCE(v.paso,'') NOT LIKE 'Troceado%'))
    ORDER BY CASE v.estado WHEN 'procesando' THEN 0 WHEN 'error' THEN 1 WHEN 'propuesto' THEN 2 WHEN 'cola' THEN 3 WHEN 'troceando' THEN 4 ELSE 5 END,
      (COALESCE(v.campana, c.campana) IS NOT NULL) DESC, v.urgente DESC, CASE WHEN v.estado = 'descartado' THEN -v.id ELSE v.id END`).all();
  const analizado = db.prepare('SELECT 1 FROM ia_escenas WHERE video = ? OR video = ? LIMIT 1');
  const soloIA = ajustes()['clips.solo_ia'] !== false;
  let descartados = 0;
  const videos = filas.filter((v) => v.estado !== 'descartado' || ++descartados <= 20).map((v) => {
    const twitch = /twitch\.tv\/[^/]+\/clip\//i.test(v.fuente || '');
    let momentos = 0; try { momentos = Clips.momentosIA(v).length; } catch {}
    const visto = !!analizado.get(String(v.video || ''), String(v.id)) && !tramoSinVer(v);
    const espera = motivoEspera(v, { momentos, visto });
    return { id: v.id, titulo: v.titulo || '', canal: v.canal || 'A mano', estado: v.estado, paso: v.paso || null, error: v.error || null, urgente: !!v.urgente,
      campana: v.campana || null, duracion: v.duracion_s || null, tramo: v.offset_s > 0, twitch, gemini: momentos, espera, fecha: iso(v.terminado || v.creado),
      original: v.video && /^[\w-]{11}$/.test(v.video) ? `https://www.youtube.com/watch?v=${v.video}${v.offset_s ? `&t=${v.offset_s}` : ''}` : (/^https?:/.test(v.fuente || '') ? v.fuente : null) };
  });
  const directos = Clips.directos.activos().map((d) => ({ id: d.id, canal: d.canal || '', titulo: d.titulo || d.video, estado: d.estado, detenido: !!d.detenido, inicio: iso(d.inicio || d.creado), fin: d.fin ? iso(d.fin) : null }));
  return { videos, soloIA, directos, proximaPasada: proximaPasada() };
}

// ---------- cola de subida (fase 4): lo que espera para YouTube y TikTok, con su orden ----------
columna('clip_subidas', 'orden', 'REAL');
columna('clip_tiktok', 'orden', 'REAL');
export function colaSubida() {
  const filas = [
    ...db.prepare("SELECT 'youtube' red, id sid, video_id, n, estado, no_antes, error, orden FROM clip_subidas WHERE estado IN ('pendiente','error','subiendo')").all(),
    ...db.prepare("SELECT 'tiktok' red, id sid, video_id, n, estado, NULL no_antes, error, orden FROM clip_tiktok WHERE estado IN ('pendiente','error','subiendo','procesando')").all(),
  ];
  const vids = new Map(), camp = new Map();
  const items = filas.map((f) => {
    if (!vids.has(f.video_id)) vids.set(f.video_id, db.prepare('SELECT * FROM clip_videos WHERE id = ?').get(f.video_id));
    const v = vids.get(f.video_id); if (!v) return null;
    const c = clipsDe(v).find((x) => x.n === f.n); if (!c) return null;
    const slug = v.campana || (v.canal_id ? db.prepare('SELECT campana FROM clip_canales WHERE id = ?').get(v.canal_id)?.campana : null) || null;
    if (slug && !camp.has(slug)) camp.set(slug, Campanas.perfil(slug));
    const p = slug ? camp.get(slug) : null;
    const tipo = v.tipo === 'estudio' ? (c.formato === 'horizontal' ? 'largo' : 'estudio') : v.tipo === 'recop' ? 'recop' : slug ? 'campana' : 'clip';
    const fuente = /twitch\.tv/i.test(v.fuente || '') ? 'Twitch' : /kick\.com/i.test(v.fuente || '') ? 'Kick' : ['estudio', 'recop'].includes(v.tipo) ? 'Estudio' : v.video ? 'YouTube' : 'Archivo';
    const prioridad = (v.tipo === 'estudio' && c.formato === 'horizontal' ? 1000 : 0) + (c.puntos || 0); // la que usa el servidor sin orden manual
    return { red: f.red, sid: f.sid, id: v.id, n: f.n, estado: f.estado, error: f.error || null, programado: iso(f.no_antes), orden: f.orden,
      titulo: c.titulo || v.titulo || '', creador: canalDe(v), puntos: c.puntos ?? null, prioridad, fecha: iso(v.terminado || v.creado), tipo,
      campana: p?.nombre || null, idioma: p?.idioma || (tipo === 'clip' && /\(EN\)/.test(canalDe(v)) ? 'en' : 'es'), fuente, poster: `/api/clips/poster/${v.id}/${f.n}`, ficha: fichaClip(v, c) };
  }).filter(Boolean);
  return { items };
}
export function ordenarSubida(red, sids) {
  const t = red === 'tiktok' ? 'clip_tiktok' : 'clip_subidas';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE ${t} SET orden = NULL WHERE estado IN ('pendiente','error')`).run();
    const st = db.prepare(`UPDATE ${t} SET orden = ? WHERE id = ?`);
    (sids || []).forEach((id, i) => st.run(i + 1, Number(id)));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true };
}

// ---------- espacio único de contenido (fase 6): clips, campañas, propuestas del Estudio, largos y horizontales ----------
export function explorarTodo({ filtro = 'todo', q = '' } = {}) {
  const base = filtro === 'propuestas' || filtro === 'horizontales' || filtro === 'largos' ? { items: [] } : explorar({ filtro: filtro === 'clips' ? 'todo' : filtro, q });
  let items = base.items;
  if (filtro === 'clips') items = items.filter((x) => !x.campana && !['estudio', 'recop'].includes(x.tipo));
  const t = String(q || '').toLowerCase().trim(), extra = [];
  if (['todo', 'propuestas', 'largos'].includes(filtro)) {
    for (const p of Estudio.lista()) {
      if (filtro === 'largos' && p.estado !== 'terminado') continue;
      if (filtro === 'propuestas' && ['terminado', 'descartado'].includes(p.estado)) continue;
      if (filtro === 'todo' && p.estado === 'descartado') continue;
      if (t && !String(p.titulo).toLowerCase().includes(t)) continue;
      const dir = path.join(ESTUDIO, p.slug), fin = existsSync(path.join(dir, 'video.mp4'));
      const mini = [path.join(dir, 'miniatura.png'), path.join(dir, 'propuesta', `v${p.version}`, 'miniatura.png')].find((f) => existsSync(f));
      extra.push({ tipo: fin ? 'largo' : 'propuesta', slug: p.slug, titulo: p.titulo, canal: 'Estudio', estado: p.estado, vertical: false, fecha: iso(p.actualizado),
        poster: mini ? `/api/estudio/archivo/${p.slug}/${path.relative(dir, mini).split(path.sep).join('/')}` : null,
        video: `/api/estudio/archivo/${p.slug}/${fin ? 'video.mp4' : `propuesta/v${p.version}/avance.mp4`}` });
    }
  }
  if (['todo', 'horizontales'].includes(filtro)) {
    const filas = db.prepare("SELECT r.id, r.video_id, r.n, r.creado FROM recop_clips r WHERE r.estado = 'listo' ORDER BY r.id DESC LIMIT ?").all(filtro === 'todo' ? 6 : 60);
    for (const r of filas) {
      let tit = '', canal = '';
      try { const d = Clips.datosVideo(r.video_id, r.n); tit = d.c?.titulo || ''; canal = d.canalNombre || canalDe(d.v); } catch {}
      if (t && !`${tit} ${canal}`.toLowerCase().includes(t)) continue;
      extra.push({ tipo: 'horizontal', id: r.video_id, n: r.n, titulo: tit, canal, vertical: false, fecha: iso(r.creado), poster: `/api/clips/poster/${r.video_id}/${r.n}?h=1`, video: `/api/recop/clip/${r.id}`, estado: '' });
    }
  }
  items = [...items, ...extra].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 300);
  return { items, filtros: ['todo', 'pendientes', 'clips', 'campanas', 'propuestas', 'largos', 'horizontales', 'recopilatorios', 'publicados'] };
}
