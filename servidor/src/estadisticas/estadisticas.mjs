// Estadísticas del canal de YouTube (SOLO LECTURA) para analizar qué funciona y que la IA replique la estrategia.
//  · Credenciales aparte de las subidas: ~/.config/streamclipper-youtube-estadisticas/{client_secret.json, token.json}
//    (permisos yt-analytics.readonly + youtube.readonly).
//  · Data API: lista de vídeos y sus contadores públicos (vistas, me gusta, comentarios, duración, fecha).
//  · Analytics API: minutos vistos, duración media vista, % visto, suscriptores ganados, compartidos, fuentes de tráfico.
//  · Cada vídeo se cruza con su origen en el servidor (clip de un streamer, Short o vídeo del Estudio, recopilatorio):
//    canal del creador, tipo, puntos de la IA, emoción, si se editó el encuadre…
//  · La «estrategia» (texto que escribe Claude con la skill estadisticas-canal) se guarda en ajustes y la usan la
//    elección de clips (clip_focus de OpenShorts) y el Estudio.
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, ajustes, guardarAjustes } from '../db.mjs';

const DIR = path.join(os.homedir(), '.config', 'streamclipper-youtube-estadisticas');
db.exec(`
CREATE TABLE IF NOT EXISTS yt_videos (
  yt TEXT PRIMARY KEY,
  titulo TEXT, publicado TEXT, duracion_s INTEGER, es_short INTEGER,
  vistas INTEGER, megusta INTEGER, comentarios INTEGER,
  minutos REAL, media_s REAL, pct_visto REAL, subs INTEGER, compartidos INTEGER,
  origen TEXT,                      -- JSON: { tipo: clip|estudio|recop|otro, … }
  actualizado TEXT
);
CREATE TABLE IF NOT EXISTS yt_canal (dia TEXT PRIMARY KEY, vistas INTEGER, minutos REAL, subs_ganados INTEGER, subs_perdidos INTEGER);
CREATE TABLE IF NOT EXISTS yt_trafico (yt TEXT, fuente TEXT, vistas INTEGER, PRIMARY KEY (yt, fuente));
`);

export const conectado = () => existsSync(path.join(DIR, 'token.json')) && existsSync(path.join(DIR, 'client_secret.json'));
let acceso = { token: '', caduca: 0 };
async function token() {
  if (acceso.token && Date.now() < acceso.caduca - 60000) return acceso.token;
  const c = JSON.parse(readFileSync(path.join(DIR, 'client_secret.json'), 'utf8')).installed, t = JSON.parse(readFileSync(path.join(DIR, 'token.json'), 'utf8'));
  const r = await fetch(c.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google: ${j.error_description || j.error} (hay que volver a autorizar las estadísticas)`);
  acceso = { token: j.access_token, caduca: Date.now() + (j.expires_in || 3600) * 1000 };
  return acceso.token;
}
async function g(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `Google ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const iso8601 = (d) => { const m = String(d || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : 0; };
const fecha = (d) => d.toISOString().slice(0, 10);

// De dónde salió cada vídeo subido: las subidas del panel (clip_subidas) apuntan al clip y a su vídeo de origen.
function origenes() {
  const out = new Map();
  for (const s of db.prepare(`SELECT s.yt, s.video_id, s.n, v.tipo, v.fuente, v.titulo AS vtitulo, v.clips, c.nombre AS canal FROM clip_subidas s
    JOIN clip_videos v ON v.id = s.video_id LEFT JOIN clip_canales c ON c.id = v.canal_id WHERE s.yt IS NOT NULL`).all()) {
    const c = JSON.parse(s.clips || '[]').find((x) => x.n === s.n) || {};
    const val = db.prepare('SELECT valor FROM clip_valoraciones WHERE video_id = ? AND n = ?').get(s.video_id, s.n);
    out.set(s.yt, s.tipo === 'estudio'
      ? { tipo: 'estudio', proyecto: String(s.fuente).replace(/^estudio:/, ''), pieza: c.formato === 'horizontal' ? 'video' : 'short', titulo: c.titulo, ia: c.ia?.origen ?? null }
      : s.tipo === 'recop' ? { tipo: 'recopilatorio', titulo: c.titulo }
      : { tipo: 'clip', creador: s.canal || null, tipoVideo: s.tipo, puntos: c.puntos ?? null, emocion: c.emocion ?? null, editado: !!c.editado,
          encuadre: c.encuadre || null, duracion: c.fin != null && c.inicio != null ? Math.round(c.fin - c.inicio) : null, gancho: c.gancho || null, valoracion: val?.valor ?? null, ia: c.ia?.origen ?? null, titulo: c.titulo || null });
  }
  return out;
}

// Descarga todo (lista de vídeos, contadores y analíticas de los últimos `dias`) y lo guarda. Devuelve un resumen corto.
export async function actualizar({ dias = 90, log = () => {} } = {}) {
  const canal = (await g('https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics,snippet&mine=true')).items?.[0];
  if (!canal) throw new Error('No encuentro el canal');
  const lista = canal.contentDetails.relatedPlaylists.uploads, ids = [];
  for (let pag = ''; ;) {
    const j = await g(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${lista}${pag ? `&pageToken=${pag}` : ''}`);
    ids.push(...j.items.map((i) => i.contentDetails.videoId));
    if (!j.nextPageToken || ids.length >= 500) break; pag = j.nextPageToken;
  }
  const org = origenes(), ahora = new Date().toISOString();
  const up = db.prepare(`INSERT INTO yt_videos (yt, titulo, publicado, duracion_s, es_short, vistas, megusta, comentarios, origen, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(yt) DO UPDATE SET titulo=excluded.titulo, publicado=excluded.publicado, duracion_s=excluded.duracion_s, es_short=excluded.es_short,
    vistas=excluded.vistas, megusta=excluded.megusta, comentarios=excluded.comentarios, origen=excluded.origen, actualizado=excluded.actualizado`);
  for (let i = 0; i < ids.length; i += 50) {
    const j = await g(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.slice(i, i + 50).join(',')}`);
    for (const v of j.items) {
      const dur = iso8601(v.contentDetails.duration);
      up.run(v.id, v.snippet.title, v.snippet.publishedAt, dur, dur <= 180 ? 1 : 0, +v.statistics.viewCount || 0, +v.statistics.likeCount || 0, +v.statistics.commentCount || 0,
        JSON.stringify(org.get(v.id) || { tipo: 'otro' }), ahora);
    }
  }
  log(`${ids.length} vídeos del canal «${canal.snippet.title}»`);
  // Analíticas (si la API está activada en el proyecto de Google)
  const fin = fecha(new Date()), ini = fecha(new Date(Date.now() - dias * 864e5));
  let analytics = true;
  try {
    const porVideo = await g(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${ini}&endDate=${fin}&dimensions=video&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,shares&sort=-views&maxResults=200`);
    const m = db.prepare('UPDATE yt_videos SET minutos=?, media_s=?, pct_visto=?, subs=?, compartidos=? WHERE yt=?');
    for (const [yt, , minutos, media, pct, subs, comp] of porVideo.rows || []) m.run(minutos, media, pct, subs, comp, yt);
    const dia = await g(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${ini}&endDate=${fin}&dimensions=day&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost&sort=day`);
    const d = db.prepare('INSERT OR REPLACE INTO yt_canal (dia, vistas, minutos, subs_ganados, subs_perdidos) VALUES (?,?,?,?,?)');
    for (const r of dia.rows || []) d.run(...r);
    const tr = await g(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${ini}&endDate=${fin}&dimensions=insightTrafficSourceType&metrics=views&sort=-views`);
    db.prepare("DELETE FROM yt_trafico WHERE yt = 'canal'").run();
    const t = db.prepare("INSERT OR REPLACE INTO yt_trafico (yt, fuente, vistas) VALUES ('canal', ?, ?)");
    for (const [f, v] of tr.rows || []) t.run(f, v);
  } catch (e) {
    analytics = false;
    log(`Analíticas no disponibles: ${e.message.slice(0, 160)}`);
  }
  // Resumen de la cuenta para el perfil de la app (lo lee src/social.mjs sin llamar a YouTube).
  const cuenta = { canal: canal.snippet.title, suscriptores: +canal.statistics.subscriberCount || 0, vistas: +canal.statistics.viewCount || 0, videos: ids.length,
    descripcion: canal.snippet.description || '', avatar: canal.snippet.thumbnails?.high?.url || canal.snippet.thumbnails?.default?.url || '', actualizado: new Date().toISOString() };
  try { guardarAjustes({ 'canal.cuenta': cuenta }); } catch {}
  return { canal: canal.snippet.title, suscriptores: +canal.statistics.subscriberCount || 0, vistas: +canal.statistics.viewCount || 0, videos: ids.length, analytics };
}

// Resumen para analizar (lo lee Claude con la skill): totales, por origen/creador/formato, mejores y peores, y evolución.
export function resumen({ dias = 28 } = {}) {
  const vids = db.prepare('SELECT * FROM yt_videos ORDER BY publicado DESC').all().map((v) => ({ ...v, origen: JSON.parse(v.origen || '{}') }));
  const recientes = vids.filter((v) => Date.now() - new Date(v.publicado) < dias * 864e5);
  const agrupar = (lista, clave) => {
    const g = {};
    for (const v of lista) { const k = clave(v) ?? '—'; (g[k] ||= []).push(v); }
    return Object.fromEntries(Object.entries(g).map(([k, l]) => [k, { videos: l.length, vistas_media: Math.round(l.reduce((a, x) => a + x.vistas, 0) / l.length),
      pct_visto_medio: l.some((x) => x.pct_visto != null) ? +(l.filter((x) => x.pct_visto != null).reduce((a, x) => a + x.pct_visto, 0) / l.filter((x) => x.pct_visto != null).length).toFixed(1) : null,
      subs: l.reduce((a, x) => a + (x.subs || 0), 0) }]).sort((a, b) => b[1].vistas_media - a[1].vistas_media));
  };
  const ficha = (v) => ({ yt: v.yt, titulo: v.titulo, publicado: v.publicado?.slice(0, 10), formato: v.es_short ? 'short' : 'largo', duracion_s: v.duracion_s, vistas: v.vistas, megusta: v.megusta, comentarios: v.comentarios,
    pct_visto: v.pct_visto, media_s: v.media_s, subs: v.subs, compartidos: v.compartidos, origen: v.origen });
  const orden = [...vids].sort((a, b) => b.vistas - a.vistas);
  return {
    periodo_dias: dias, total_videos: vids.length, publicados_en_periodo: recientes.length,
    canal_por_dia: db.prepare('SELECT * FROM yt_canal ORDER BY dia DESC LIMIT ?').all(dias),
    trafico: db.prepare("SELECT fuente, vistas FROM yt_trafico WHERE yt = 'canal' ORDER BY vistas DESC").all(),
    por_origen: agrupar(vids, (v) => v.origen.tipo), por_creador: agrupar(vids.filter((v) => v.origen.tipo === 'clip'), (v) => v.origen.creador),
    por_formato: agrupar(vids, (v) => (v.es_short ? 'short' : 'largo')), por_editado: agrupar(vids.filter((v) => v.origen.tipo === 'clip'), (v) => (v.origen.editado ? 'editado' : 'sin editar')),
    por_hora_publicacion: agrupar(vids, (v) => (v.publicado ? `${String(new Date(v.publicado).getHours()).padStart(2, '0')}h` : null)),
    mejores: orden.slice(0, 12).map(ficha), peores: orden.slice(-8).map(ficha),
    estrategia_actual: ajustes()['canal.estrategia'] || '',
  };
}

// La estrategia (reglas concretas que escribe Claude tras analizar) — la usan la elección de clips y el Estudio.
export function guardarEstrategia(texto) {
  const t = String(texto || '').trim();
  if (t.length < 40) throw new Error('La estrategia es demasiado corta');
  guardarAjustes({ 'canal.estrategia': t.slice(0, 4000), 'canal.estrategia_fecha': new Date().toISOString() });
  return { guardada: true, caracteres: Math.min(4000, t.length) };
}
export const estrategia = () => ({ texto: ajustes()['canal.estrategia'] || '', fecha: ajustes()['canal.estrategia_fecha'] || null });
export const tokenLectura = () => token();
