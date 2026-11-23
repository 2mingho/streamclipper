// Publicación de clips en TikTok (cuenta propia) con Login Kit + Content Posting API (Direct Post).
// Independiente de YouTube: credenciales, tabla y cola propias; si TikTok falla o no está conectado, YouTube no se entera.
//  · Credenciales en ~/.config/streamclipper-tiktok/: app.json { client_key, client_secret, redirect_uri } y token.json (lo crea la conexión).
//  · redirect_uri: una página de retorno https propia (p. ej. en GitHub Pages; TikTok exige https), que reenvía
//    el código al panel; o directamente https://<servidor>.ts.net/api/tiktok/callback cuando el panel tenga https.
//  · Cada publicación la pide el editor desde el panel con las opciones que exige TikTok (privacidad elegida a mano, sin valor
//    por defecto; comentarios/dúo/stitch; contenido comercial). Mientras la app no esté auditada, TikTok solo deja publicar en privado.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { db, ajustes } from '../db.mjs';
import { avisarSinFallo } from '../avisos.mjs';
import * as Cuentas from '../cuentas-red.mjs';

const DIR = path.join(os.homedir(), '.config', 'streamclipper-tiktok');
const API = 'https://open.tiktokapis.com';
const SCOPES = 'user.info.basic,video.publish';

db.exec(`
CREATE TABLE IF NOT EXISTS clip_tiktok (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES clip_videos(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | subiendo | procesando | ok | error
  opciones TEXT NOT NULL,                   -- JSON con lo que eligió el editor (título, privacidad, interruptores, comercial)
  publish_id TEXT, post_id TEXT, privacidad TEXT, error TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')), subido TEXT,
  UNIQUE (video_id, n)
);`);
db.prepare("UPDATE clip_tiktok SET estado='pendiente' WHERE estado='subiendo'").run();

const leer = (f) => { try { return JSON.parse(readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const guardar = (f, x) => { mkdirSync(DIR, { recursive: true, mode: 0o700 }); writeFileSync(path.join(DIR, f), JSON.stringify(x, null, 1), { mode: 0o600 }); };
export const configurado = () => !!(leer('app.json')?.client_key && leer('app.json')?.client_secret && leer('app.json')?.redirect_uri);
const tokenDe = (cuenta = null) => { try { return JSON.parse(readFileSync(Cuentas.archivoToken('tiktok', cuenta), 'utf8')); } catch { return null; } };
const guardarToken = (destino, j) => { mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 }); writeFileSync(destino, JSON.stringify({ ...j, caduca: Date.now() + (j.expires_in || 86400) * 1000, renovar_antes: Date.now() + (j.refresh_expires_in || 0) * 1000 }, null, 1), { mode: 0o600 }); };
export const conectado = () => configurado() && Cuentas.lista().some((k) => k.red === 'tiktok' && tokenDe(k.id)?.refresh_token);

// ---------- conexión (OAuth) ----------
// El panel llama a urlConectar() (con sesión); la vuelta de TikTok llega sin la cookie de sesión (SameSite=Strict),
// así que se valida con el «state» de un solo uso, que caduca en 10 min.
const estados = new Map();
export function urlConectar(origen, usuarioId = null) {
  const a = leer('app.json'); if (!a) throw new Error('Falta ~/.config/streamclipper-tiktok/app.json (client_key, client_secret, redirect_uri)');
  const nonce = randomBytes(16).toString('hex');
  estados.set(nonce, { cad: Date.now() + 10 * 60000, uid: usuarioId });
  // El puente de GitHub Pages necesita saber a qué panel volver: va en el state (y el puente solo acepta orígenes conocidos).
  const state = `${nonce}.${Buffer.from(origen).toString('base64url')}`;
  return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: a.client_key, scope: SCOPES, response_type: 'code', redirect_uri: a.redirect_uri, state })}`;
}
export async function completarConexion(code, state) {
  const nonce = String(state || '').split('.')[0], est = estados.get(nonce);
  estados.delete(nonce);
  if (!est || est.cad < Date.now()) throw new Error('Enlace de conexión caducado o no válido: vuelve a pulsar «Conectar TikTok»');
  const a = leer('app.json');
  const j = await token({ client_key: a.client_key, client_secret: a.client_secret, code, grant_type: 'authorization_code', redirect_uri: a.redirect_uri });
  if (!String(j.scope || '').includes('video.publish')) throw new Error('No se concedió el permiso de publicar vídeos');
  // Cada conexión es una cuenta (la misma cuenta de TikTok se reconoce por su open_id y solo se renueva).
  const k = Cuentas.registrar('tiktok', { nombre: 'TikTok', externo: j.open_id, usuarioId: est.uid });
  guardarToken(k.ruta, j);
  try { const cr = await creador(k.id); Cuentas.renombrar(k.id, cr.usuario ? `@${cr.usuario}` : cr.nombre || 'TikTok'); } catch {}
  return j;
}
async function token(params, destino = '') {
  const r = await fetch(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`TikTok: ${j.error_description || j.error || r.status}`);
  if (destino) guardarToken(destino, j);
  return j;
}
async function tokenAcceso(cuenta = null) {
  const t = tokenDe(cuenta); if (!t?.refresh_token) throw new Error('TikTok no está conectado');
  if (t.access_token && Date.now() < t.caduca - 5 * 60000) return t.access_token;
  const a = leer('app.json');
  try { return (await token({ client_key: a.client_key, client_secret: a.client_secret, grant_type: 'refresh_token', refresh_token: t.refresh_token }, Cuentas.archivoToken('tiktok', cuenta))).access_token; }
  catch (e) { throw new Error(`La autorización de TikTok caducó o se retiró: hay que volver a conectar (${e.message})`); }
}
export function desconectar() { const k = Cuentas.porDefecto('tiktok'); if (k) rmSync(Cuentas.archivoToken('tiktok', k.id), { force: true }); }

async function post(ruta, body, cuenta = null) {
  const r = await fetch(`${API}${ruta}`, { method: 'POST', headers: { Authorization: `Bearer ${await tokenAcceso(cuenta)}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (j.error?.code && j.error.code !== 'ok') {
    // Los motivos más habituales, explicados (TikTok responde con un texto genérico).
    const EXPLICA = {
      unaudited_client_can_only_post_to_private_accounts: 'Mientras TikTok no apruebe la app, la cuenta tiene que ser privada (Ajustes y privacidad → Privacidad → Cuenta privada)',
      spam_risk_too_many_posts: 'TikTok frena por publicar demasiado seguido: se reintentará más tarde',
      spam_risk_user_banned_from_posting: 'TikTok no deja publicar a esta cuenta ahora mismo',
      privacy_level_option_mismatch: 'Esa privacidad no está disponible para esta cuenta: elige otra',
      access_token_invalid: 'La conexión con TikTok caducó: vuelve a pulsar «Conectar TikTok»',
      scope_not_authorized: 'Falta el permiso de publicar: vuelve a conectar TikTok y acepta todos los permisos',
    };
    const e = new Error(`TikTok: ${EXPLICA[j.error.code] || j.error.message || j.error.code}`); e.codigo = j.error.code; throw e;
  }
  if (!r.ok) throw new Error(`TikTok ${r.status}`);
  return j.data || {};
}

// Datos del creador para la pantalla de publicación (TikTok exige mostrarlos y usar sus opciones de privacidad).
export async function creador(cuenta = null) {
  const d = await post('/v2/post/publish/creator_info/query/', {}, cuenta);
  return { nombre: d.creator_nickname, usuario: d.creator_username, avatar: d.creator_avatar_url, privacidades: d.privacy_level_options || [],
    sinComentarios: !!d.comment_disabled, sinDuo: !!d.duet_disabled, sinStitch: !!d.stitch_disabled, maxSegundos: d.max_video_post_duration_sec || 0 };
}

// ---------- cola ----------
export const publicaciones = {
  deVideo: (videoId) => db.prepare('SELECT n, estado, post_id, privacidad, error FROM clip_tiktok WHERE video_id = ?').all(Number(videoId)),
  pedir(videoId, n, o) {
    const PRIV = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
    if (!PRIV.includes(o.privacidad)) throw new Error('Elige la privacidad');
    if (o.marca && o.privacidad === 'SELF_ONLY') throw new Error('El contenido de marca no puede ser privado');
    if (o.comercial && !o.propia && !o.marca) throw new Error('Si es contenido comercial, indica si es de tu marca o de una marca');
    const op = { titulo: String(o.titulo || '').slice(0, 2200), privacidad: o.privacidad, comentarios: !!o.comentarios, duo: !!o.duo, stitch: !!o.stitch,
      propia: !!(o.comercial && o.propia), marca: !!(o.comercial && o.marca), ia: !!o.ia };
    db.prepare(`INSERT INTO clip_tiktok (video_id, n, opciones, cuenta_id) VALUES (?,?,?,?)
      ON CONFLICT(video_id, n) DO UPDATE SET opciones = excluded.opciones, cuenta_id = excluded.cuenta_id, estado = CASE WHEN estado IN ('error','pendiente') THEN 'pendiente' ELSE estado END, error = NULL`)
      .run(Number(videoId), Number(n), JSON.stringify(op), o.cuenta ? Number(o.cuenta) : null);
  },
  quitar: (videoId, n) => db.prepare("DELETE FROM clip_tiktok WHERE video_id = ? AND n = ? AND estado IN ('pendiente','error')").run(Number(videoId), Number(n)).changes,
  hoy: () => db.prepare("SELECT COUNT(*) AS n FROM clip_tiktok WHERE estado IN ('ok','procesando') AND subido >= datetime('now', 'start of day')").get().n,
  pendientes: () => db.prepare("SELECT COUNT(*) AS n FROM clip_tiktok WHERE estado IN ('pendiente','subiendo','procesando')").get().n,
};

// Subida del archivo: un trozo si cabe en 64 MB; si no, trozos de 10 MB y el último se queda con el resto.
async function subirArchivo(ruta, o, cuenta = null) {
  const tam = statSync(ruta).size, MB = 1024 * 1024;
  const trozo = tam <= 64 * MB ? tam : 10 * MB, total = tam <= 64 * MB ? 1 : Math.floor(tam / trozo);
  const d = await post('/v2/post/publish/video/init/', {
    post_info: { title: o.titulo, privacy_level: o.privacidad, disable_comment: !o.comentarios, disable_duet: !o.duo, disable_stitch: !o.stitch,
      video_cover_timestamp_ms: 1000, brand_organic_toggle: o.propia, brand_content_toggle: o.marca, is_aigc: o.ia },
    source_info: { source: 'FILE_UPLOAD', video_size: tam, chunk_size: trozo, total_chunk_count: total },
  }, cuenta);
  const fd = openSync(ruta, 'r');
  try {
    for (let i = 0; i < total; i++) {
      const ini = i * trozo, fin = i === total - 1 ? tam - 1 : ini + trozo - 1, buf = Buffer.alloc(fin - ini + 1);
      readSync(fd, buf, 0, buf.length, ini);
      const r = await fetch(d.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${ini}-${fin}/${tam}` }, body: buf });
      if (![200, 201, 206].includes(r.status)) throw new Error(`TikTok: fallo al subir el trozo ${i + 1}/${total} (${r.status})`);
    }
  } finally { closeSync(fd); }
  return d.publish_id;
}

let ocupado = false, proxima = 0;
export async function cicloTiktok({ archivoClip, datosVideo }) {
  if (ocupado || !conectado()) return;
  ocupado = true;
  try {
    // 1. Seguir las que TikTok aún está procesando.
    for (const s of db.prepare("SELECT * FROM clip_tiktok WHERE estado = 'procesando'").all()) {
      try {
        const d = await post('/v2/post/publish/status/fetch/', { publish_id: s.publish_id }, s.cuenta_id ?? null);
        if (d.status === 'PUBLISH_COMPLETE') {
          const pid = (d.publicaly_available_post_id || [])[0] || null;
          db.prepare("UPDATE clip_tiktok SET estado='ok', post_id=?, error=NULL WHERE id=?").run(pid ? String(pid) : null, s.id);
          const { c } = datosVideo(s.video_id, s.n);
          avisarSinFallo('Clip publicado en TikTok', `«${c?.titulo || ''}»${s.privacidad === 'SELF_ONLY' ? ' (privado)' : ''}`, { etiquetas: ['arrow_up'] });
        } else if (d.status === 'FAILED') db.prepare("UPDATE clip_tiktok SET estado='error', error=? WHERE id=?").run(`TikTok: ${d.fail_reason || 'falló'}`, s.id);
      } catch (e) { console.error('TikTok:', e.message); }
    }
    // 2. Publicar la siguiente de la cola (de una en una, con 2–5 min entre publicaciones y un tope diario).
    if (ajustes()['publicacion.activa'] === false || Date.now() < proxima || publicaciones.hoy() >= (Number(ajustes()['tiktok.max_dia']) || 10)) return;
    const s = db.prepare("SELECT * FROM clip_tiktok WHERE estado = 'pendiente' ORDER BY COALESCE(orden, 1e9), id LIMIT 1").get();
    if (!s) return;
    try {
      const { c } = datosVideo(s.video_id, s.n), f = archivoClip(s.video_id, s.n);
      if (!c || !f) throw new Error('El clip ya no existe');
      if (db.prepare('SELECT 1 FROM clip_valoraciones WHERE video_id = ? AND n = ? AND valor = -1').get(s.video_id, s.n)) throw new Error('Descartado por el editor');
      const o = JSON.parse(s.opciones);
      db.prepare("UPDATE clip_tiktok SET estado='subiendo' WHERE id=?").run(s.id);
      const pid = await subirArchivo(f.ruta, o, s.cuenta_id ?? null);
      db.prepare("UPDATE clip_tiktok SET estado='procesando', publish_id=?, privacidad=?, subido=datetime('now') WHERE id=?").run(pid, o.privacidad, s.id);
      { const m = Number(ajustes()['tiktok.espacio_min'] ?? 120); proxima = Date.now() + Math.round(m * (0.9 + Math.random() * 0.2) * 60000); }
      console.log(`TikTok: enviado «${c.titulo}» (${o.privacidad}), publish_id ${pid}`);
    } catch (e) {
      db.prepare("UPDATE clip_tiktok SET estado='error', error=? WHERE id=?").run(e.message.slice(0, 400), s.id);
      console.error('TikTok:', e.message);
    }
  } finally { ocupado = false; }
}
