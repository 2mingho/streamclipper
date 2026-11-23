// Publicación de clips en YouTube (canal propio) con la API de datos v3.
//  · Credenciales en ~/.config/streamclipper-youtube/: client_secret.json (app de escritorio "Clips") y token.json
//    (token de refresco; se crea con autorizar-youtube.mjs desde la laptop). Permiso: youtube.upload.
//  · Cola de subidas (clip_subidas): el botón "Publicar en YouTube" del panel la llena; opcionalmente también
//    los clips que superen una puntuación. Se sube de uno en uno y con un tope diario (la cuota de la API es corta).
//  · Título, descripción con enlace al original en el minuto exacto y al canal del creador, y etiquetas.
import { readFileSync, existsSync, statSync, openAsBlob } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, ajustes } from '../db.mjs';
import { avisarSinFallo } from '../avisos.mjs';
import { perfilDeVideo, pareceEspanol } from './campanas.mjs';
import { randomBytes } from 'node:crypto';
import { writeFileSync as escribir, mkdirSync, rmSync } from 'node:fs';
import * as Cuentas from '../cuentas-red.mjs';

const DIR = path.join(os.homedir(), '.config', 'streamclipper-youtube');

db.exec(`
CREATE TABLE IF NOT EXISTS clip_subidas (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES clip_videos(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,                       -- número del clip dentro del vídeo
  origen TEXT NOT NULL DEFAULT 'manual',    -- manual | auto
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | subiendo | ok | error
  yt TEXT, privacidad TEXT, error TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')), subido TEXT,
  UNIQUE (video_id, n)
);`);
// Una subida cortada por un reinicio vuelve a la cola.
db.prepare("UPDATE clip_subidas SET estado='pendiente' WHERE estado='subiendo'").run();

const leer = (f) => { try { return JSON.parse(readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const tokenDe = (cuenta = null) => { try { return JSON.parse(readFileSync(Cuentas.archivoToken('youtube', cuenta), 'utf8')); } catch { return null; } };
export function conectado() { return Cuentas.lista().some((k) => k.red === 'youtube' && tokenDe(k.id)?.refresh_token); }

// Token de acceso de una cuenta (null = la de por defecto). Cada subida pasa su cuenta: no hay estado compartido.
const accesos = new Map();
export async function tokenAcceso(cuenta = null) {
  const k = String(cuenta ?? 'def'), a = accesos.get(k);
  if (a && Date.now() < a.caduca - 60000) return a.token;
  const t = tokenDe(cuenta), c = clienteDe(t?.cliente);
  if (!c || !t?.refresh_token) throw new Error('YouTube no está conectado');
  const r = await fetch(c.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error === 'invalid_grant' ? 'La autorización de YouTube caducó o se retiró: hay que volver a conectar' : `Google: ${j.error_description || j.error}`);
  accesos.set(k, { token: j.access_token, caduca: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}
// Conectar un canal desde la app (app de escritorio de Google): se abre el permiso, Google vuelve a http://localhost
// (no carga: es lo esperado) y la persona pega esa dirección; el «state» de un solo uso la ata a quien lo pidió.
const estadosYt = new Map();
// App de Google propia de cada persona (opcional): ~/.config/streamclipper-youtube/clientes/u<id>.json (0600). Sin ella, la del dueño.
const rutaCliente = (uid) => path.join(DIR, 'clientes', `u${Number(uid)}.json`);
function clienteDe(nombre) {
  if (!nombre) return leer('client_secret.json')?.installed || null;
  try { return JSON.parse(readFileSync(path.join(DIR, 'clientes', `${nombre}.json`), 'utf8')).installed; } catch { return null; }
}
export const tieneClientePropio = (uid) => existsSync(rutaCliente(uid));
export function guardarClientePropio(uid, texto) {
  let j; try { j = JSON.parse(String(texto || '').trim()); } catch { throw new Error('Eso no es el archivo JSON que descarga Google: ábrelo y pega todo su contenido'); }
  const c = j.installed;
  if (!c) throw new Error(j.web ? 'Ese cliente es de tipo «Aplicación web»: crea uno de tipo «App de escritorio»' : 'Falta la parte «installed»: crea el cliente como «App de escritorio»');
  if (!/\.apps\.googleusercontent\.com$/.test(c.client_id || '') || !c.client_secret) throw new Error('Al JSON le falta el client_id o el client_secret');
  mkdirSync(path.join(DIR, 'clientes'), { recursive: true, mode: 0o700 });
  escribir(rutaCliente(uid), JSON.stringify({ installed: { client_id: c.client_id, client_secret: c.client_secret, auth_uri: c.auth_uri || 'https://accounts.google.com/o/oauth2/auth',
    token_uri: c.token_uri || 'https://oauth2.googleapis.com/token', redirect_uris: c.redirect_uris?.length ? c.redirect_uris : ['http://localhost'] } }), { mode: 0o600 });
  return { ok: true, proyecto: c.project_id || '' };
}
export function quitarClientePropio(uid) { rmSync(rutaCliente(uid), { force: true }); return { ok: true }; }
export function urlConectar(usuarioId, propio = false) {
  const cli = propio ? `u${Number(usuarioId)}` : null, c = clienteDe(cli);
  if (!c) throw new Error(propio ? 'Primero guarda el JSON de tu app de Google' : 'Falta la app de Google (client_secret.json) en el servidor');
  const state = randomBytes(12).toString('hex'); estadosYt.set(state, { uid: usuarioId, cad: Date.now() + 20 * 60000, cli });
  return `${c.auth_uri}?${new URLSearchParams({ client_id: c.client_id, redirect_uri: c.redirect_uris?.[0] || 'http://localhost', response_type: 'code', access_type: 'offline', prompt: 'consent select_account',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', state })}`;
}
export async function completarConexion(pegado, usuarioId) {
  let u; try { u = new URL(String(pegado || '').trim()); } catch { throw new Error('Pega la dirección completa a la que te llevó Google (empieza por http://localhost)'); }
  if (u.searchParams.get('error')) throw new Error(`Google: ${u.searchParams.get('error')} (¿cancelaste el permiso?)`);
  const code = u.searchParams.get('code'), est = estadosYt.get(u.searchParams.get('state') || '');
  if (!code || !est || est.cad < Date.now() || est.uid !== usuarioId) throw new Error('Esa dirección no vale o caducó: vuelve a pulsar «Conectar un canal de YouTube»');
  estadosYt.delete(u.searchParams.get('state'));
  const c = clienteDe(est.cli); if (!c) throw new Error('No encuentro la app de Google con la que empezaste: vuelve a empezar');
  const r = await fetch(c.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: c.redirect_uris?.[0] || 'http://localhost', grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`Google: ${j.error_description || j.error || r.status}`);
  if (!j.refresh_token) throw new Error('Google no dio permiso permanente: en tu cuenta de Google quita el acceso de «Clips» y vuelve a conectar');
  const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${j.access_token}` } }).then((x) => x.json()).catch(() => ({}));
  const canal = ch.items?.[0]; if (!canal) throw new Error('Esa cuenta de Google no tiene canal de YouTube');
  const k = Cuentas.registrar('youtube', { nombre: canal.snippet?.title || 'Canal de YouTube', externo: canal.id, usuarioId });
  escribir(k.ruta, JSON.stringify({ refresh_token: j.refresh_token, scope: j.scope, canal: canal.id, cliente: est.cli || null, conectado: new Date().toISOString() }, null, 1), { mode: 0o600 });
  accesos.delete(String(k.id));
  return { id: k.id, nombre: k.nombre };
}

// ---------- textos ----------
const hashtags = (...txt) => [...new Set(txt.join(' ').match(/#[\p{L}\p{N}_]+/gu) || [])];
const sinHashtags = (t) => String(t || '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s{2,}/g, ' ').trim();
export function metadatos(v, c, canalNombre) {
  // Vídeos y Shorts del Estudio: traen su título, descripción (con capítulos) y etiquetas, y se declaran como contenido
  // sintético (la voz es generada), que es lo que YouTube pide.
  if (c.youtube) {
    const y = c.youtube;
    // Short del Estudio: primera línea, el enlace a su vídeo largo (ya publicado: el calendario los saca después).
    let enlaceLargo = '';
    if (y.short) { const h = (v.clips || []).find((x) => x.formato === 'horizontal'); const sub = h && db.prepare("SELECT yt FROM clip_subidas WHERE video_id = ? AND n = ? AND estado = 'ok'").get(v.id, h.n);
      if (sub?.yt) enlaceLargo = `▶ Vídeo completo: https://youtu.be/${sub.yt}\n\n`; }
    return {
      snippet: { title: String(y.titulo || c.titulo).replace(/[<>]/g, '').slice(0, 95).trim(), description: `${enlaceLargo}${y.descripcion || ''}${y.short ? '\n\n#shorts' : ''}`.slice(0, 4900),
        tags: (y.etiquetas || []).slice(0, 15), categoryId: y.categoria || '24', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
      status: { privacyStatus: ajustes()['youtube.privacidad'] || 'public', selfDeclaredMadeForKids: false, embeddable: true, containsSyntheticMedia: !!y.sintetico },
    };
  }
  // Clip de una campaña: textos en su idioma y sus hashtags obligatorios en el título (lo que YouTube enseña como texto
  // del Short) y en la descripción.
  const camp = perfilDeVideo(v);
  if (camp) {
    const tagsCamp = camp.hashtags || [];
    const sinTags = sinHashtags(c.titulo || v.titulo).replace(/[<>]/g, '');
    const cola = ' ' + tagsCamp.filter((t) => t.toLowerCase() !== '#shorts').join(' ');
    const titulo = `${sinTags.slice(0, Math.max(20, 99 - cola.length)).trim()}${cola}`.slice(0, 100);
    const en = camp.idioma === 'en';
    const desc = [
      sinHashtags(c.tiktok) || c.gancho || '',
      '',
      c.original ? `▶ ${en ? 'Full stream' : 'Directo completo'}: ${c.original}` : '',
      c.canalUrl ? `📺 ${en ? 'Follow' : 'Sigue a'} ${canalNombre || (en ? 'the streamer' : 'su creador')}: ${c.canalUrl}` : '',
      '',
      tagsCamp.join(' '),
    ].filter((x, i, a) => x || (a[i - 1] && a[i - 1] !== '')).join('\n').slice(0, 4900);
    return {
      snippet: { title: titulo, description: desc, tags: [...tagsCamp.map((t) => t.slice(1)), canalNombre, camp.juego?.nombre].filter(Boolean).slice(0, 15),
        categoryId: camp.categoria || '20', defaultLanguage: camp.idioma || 'en', defaultAudioLanguage: camp.idioma || 'en' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
    };
  }
  const tags = hashtags(c.tiktok, c.instagram);
  const titulo = String(c.titulo || v.titulo).replace(/[<>]/g, '').slice(0, 95).trim();
  const desc = [
    sinHashtags(c.tiktok) || c.gancho || '',
    '',
    c.original ? `▶ ${v.tipo === 'gaming' || /directo|tramo/i.test(v.titulo) ? 'Directo' : 'Vídeo'} completo: ${c.original}` : '',
    c.canalUrl ? `📺 Sigue a ${canalNombre || 'su creador'}: ${c.canalUrl}` : '',
    '',
    [...tags.slice(0, 8), '#shorts'].join(' '),
  ].filter((x, i, a) => x || (a[i - 1] && a[i - 1] !== '')).join('\n').slice(0, 4900);
  return {
    snippet: { title: titulo, description: desc, tags: [...tags.map((t) => t.slice(1)), canalNombre].filter(Boolean).slice(0, 15),
      categoryId: v.tipo === 'gaming' ? '20' : '24', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
    status: { privacyStatus: ajustes()['youtube.privacidad'] || 'public', selfDeclaredMadeForKids: false, embeddable: true },
  };
}

// Subida reanudable (un solo PUT con el archivo entero).
async function subir(ruta, meta, cuenta = null) {
  const tam = statSync(ruta).size;
  const ini = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${await tokenAcceso(cuenta)}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(tam) }, body: JSON.stringify(meta) });
  if (!ini.ok) throw errorApi(await ini.json().catch(() => ({})), ini.status);
  const destino = ini.headers.get('location');
  const r = await fetch(destino, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(tam) }, body: await openAsBlob(ruta) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw errorApi(j, r.status);
  return j;
}
// Miniatura personalizada (PNG/JPG < 2 MB). YouTube solo la acepta si el canal está verificado por teléfono.
async function ponerMiniatura(videoId, archivo, cuenta = null) {
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tokenAcceso(cuenta)}`, 'Content-Type': archivo.endsWith('.png') ? 'image/png' : 'image/jpeg' }, body: await openAsBlob(archivo) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`miniatura: ${j.error?.message || r.status}`); }
}
function errorApi(j, status) {
  const razon = j.error?.errors?.[0]?.reason || '';
  const e = new Error(/quota|uploadLimit|rateLimit/i.test(razon) ? 'Cuota diaria de YouTube agotada: se reintenta mañana'
    : `YouTube ${status}: ${j.error?.message || razon || 'error'}`.slice(0, 300));
  e.cuota = /quota|uploadLimit|rateLimit/i.test(razon);
  return e;
}

// ---------- cola ----------
// no_antes: hora UTC mínima para subirla (programar los vídeos largos escalonados).
if (!db.prepare('PRAGMA table_info(clip_subidas)').all().some((c) => c.name === 'no_antes')) db.exec('ALTER TABLE clip_subidas ADD COLUMN no_antes TEXT');
export const subidas = {
  deVideo: (videoId) => db.prepare('SELECT n, estado, yt, privacidad, error, origen FROM clip_subidas WHERE video_id = ?').all(Number(videoId)),
  programar(videoId, n, noAntesIso, origen = 'programado') {
    db.prepare(`INSERT INTO clip_subidas (video_id, n, origen, no_antes) VALUES (?,?,?,?)
      ON CONFLICT(video_id, n) DO UPDATE SET no_antes = excluded.no_antes, estado = CASE WHEN estado = 'error' THEN 'pendiente' ELSE estado END, error = NULL`)
      .run(Number(videoId), Number(n), origen, noAntesIso);
  },
  pedir(videoId, n, origen = 'manual', cuenta = null) {
    db.prepare(`INSERT INTO clip_subidas (video_id, n, origen, cuenta_id) VALUES (?,?,?,?)
      ON CONFLICT(video_id, n) DO UPDATE SET estado = CASE WHEN estado = 'error' THEN 'pendiente' ELSE estado END, error = NULL, cuenta_id = COALESCE(excluded.cuenta_id, cuenta_id)`).run(Number(videoId), Number(n), origen, cuenta ? Number(cuenta) : null);
  },
  // El cupo de la API de YouTube (≈6 subidas) se renueva a medianoche de California (UTC−8 en invierno; 03:00 en RD).
  hoy: () => db.prepare("SELECT COUNT(*) AS n FROM clip_subidas WHERE estado = 'ok' AND subido >= datetime('now', '-8 hours', 'start of day', '+8 hours')").get().n,
  quitar: (videoId, n) => db.prepare("DELETE FROM clip_subidas WHERE video_id = ? AND n = ? AND estado IN ('pendiente','error')").run(Number(videoId), Number(n)).changes,
  pendientes: () => db.prepare("SELECT COUNT(*) AS n FROM clip_subidas WHERE estado IN ('pendiente','subiendo')").get().n,
};

// Al terminar un vídeo: si está activada la publicación automática, se piden los clips por encima del umbral.
export function pedirAutomaticas(videoId, clips) {
  const min = Number(ajustes()['youtube.auto_min']) || 0;
  if (!min || !conectado()) return 0;
  const descartado = (n) => !!db.prepare('SELECT 1 FROM clip_valoraciones WHERE video_id = ? AND n = ? AND valor = -1').get(Number(videoId), n)
    || !!db.prepare('SELECT 1 FROM clip_prefiltro WHERE video_id = ? AND n = ? AND descartado = 1 AND recuperado IS NULL').get(Number(videoId), n);
  const elegidos = clips.filter((c) => (c.puntos || 0) >= min && !descartado(c.n));
  for (const c of elegidos) subidas.pedir(videoId, c.n, 'auto');
  return elegidos.length;
}

// Clip de campaña retenido por idioma más de 3 h desde su hora: un aviso (una vez por clip) para que no pase en silencio.
const retenidosAvisados = new Set();
function avisarRetenido(s, d) {
  const k = `${s.video_id}-${s.n}`; if (retenidosAvisados.has(k)) return;
  const desde = s.no_antes ? new Date(s.no_antes.replace(' ', 'T') + 'Z').getTime() : new Date(String(s.creado).replace(' ', 'T') + 'Z').getTime();
  if (Date.now() - desde < 3 * 3600e3) return;
  retenidosAvisados.add(k);
  import('../avisos.mjs').then(({ avisarSinFallo }) => avisarSinFallo('Clip de campaña retenido', `«${String(d?.c?.titulo || '').slice(0, 80)}» sigue con textos en español; el servidor los rehace solo. Si no se arregla, edítalo en la app.`, { prioridad: 3, etiquetas: ['warning'] })).catch(() => {});
}

let parado = 0; // hasta cuándo esperar tras agotar la cuota
let proxima = 0; // entre una subida y la siguiente, 2–5 min al azar (que YouTube no vea ráfagas)
let subiendo = false;
export async function cicloYoutube({ archivoClip, datosVideo }) {
  if (subiendo || Date.now() < parado || !conectado()) return;
  const enEspera = Date.now() < proxima; // separación entre cortos: los largos programados (no_antes) pasan igual
  const cfg = ajustes();
  if (cfg['publicacion.activa'] === false || subidas.hoy() >= (Number(cfg['youtube.max_dia']) || 6)) return;
  // Con más clips en cola que cupo, sale primero el de más puntos (a igualdad, el más antiguo).
  const cola = db.prepare("SELECT * FROM clip_subidas WHERE estado = 'pendiente' AND (no_antes IS NULL OR no_antes <= datetime('now')) ORDER BY id").all().filter((x) => !enEspera || x.no_antes);
  // Campaña en inglés con título en español: espera a que se rehagan sus textos.
  for (let i = cola.length - 1; i >= 0; i--) { try { const d = datosVideo(cola[i].video_id, cola[i].n); if (perfilDeVideo(d?.v)?.idioma === 'en' && (pareceEspanol(d?.c?.titulo) || pareceEspanol(d?.c?.youtube?.titulo) || pareceEspanol(String(d?.c?.tiktok || '').replace(/#[\p{L}\p{N}_]+/gu, '')))) { avisarRetenido(cola[i], d); cola.splice(i, 1); } } catch {} }
  // Cantidad al día por tipo (Ajustes › Publicación): lo que no tiene hora fija y ya llegó a su tope de hoy, espera a mañana.
  const tipoDe = (x) => { try { const d = datosVideo(x.video_id, x.n); return d?.v?.tipo === 'recop' ? 'recop' : d?.v?.tipo === 'estudio' ? (d?.c?.formato === 'horizontal' ? 'largo' : 'estudio') : (d?.v?.campana || d?.campana) ? 'campana' : 'clip'; } catch { return 'clip'; } };
  const hechos = {};
  for (const x of db.prepare("SELECT video_id, n FROM clip_subidas WHERE estado IN ('ok','subiendo') AND date(subido, 'localtime') = date('now', 'localtime')").all()) { const t = tipoDe(x); hechos[t] = (hechos[t] || 0) + 1; }
  const tope = { clip: Number(cfg['youtube.max_clip']) || 0, estudio: Number(cfg['youtube.max_estudio']) || 0, recop: Number(cfg['youtube.max_recop']) || 0 };
  for (let i = cola.length - 1; i >= 0; i--) { if (cola[i].no_antes) continue; const t = tipoDe(cola[i]); if (tope[t] && (hechos[t] || 0) >= tope[t]) cola.splice(i, 1); }
  if (!cola.length) return;
  // Primero los vídeos largos del Estudio (pieza horizontal), luego por puntos.
  const puntos = (x) => { try { const d = datosVideo(x.video_id, x.n); return (d?.v?.tipo === 'estudio' && d?.c?.formato === 'horizontal' ? 1000 : 0) + (d?.c?.puntos || 0); } catch { return 0; } };
  // Orden puesto a mano en la Cola de subida primero; el resto, por puntos.
  const s = cola.map((x) => ({ x, p: puntos(x) })).sort((a, b) => (a.x.orden ?? 1e9) - (b.x.orden ?? 1e9) || b.p - a.p)[0].x;
  subiendo = true;
  try {
    const { v, c, canalNombre } = datosVideo(s.video_id, s.n);
    const f = archivoClip(s.video_id, s.n);
    if (!v || !c || !f) throw new Error('El clip ya no existe');
    if (db.prepare('SELECT 1 FROM clip_valoraciones WHERE video_id = ? AND n = ? AND valor = -1').get(s.video_id, s.n)) throw new Error('Descartado por el editor');
    db.prepare("UPDATE clip_subidas SET estado='subiendo' WHERE id=?").run(s.id);
    const r = await subir(f.ruta, metadatos(v, c, canalNombre), s.cuenta_id ?? null);
    db.prepare("UPDATE clip_subidas SET estado='ok', yt=?, privacidad=?, subido=datetime('now'), error=NULL WHERE id=?").run(r.id, r.status?.privacyStatus || '', s.id);
    if (v.tipo === 'estudio' && c.formato === 'horizontal' && v.carpeta) {
      const mini = ['miniatura.png', 'miniatura.jpg'].map((x) => `${v.carpeta}/${x}`).find((x) => existsSync(x));
      if (mini) {
        try { await ponerMiniatura(r.id, mini, s.cuenta_id ?? null); console.log(`YouTube: miniatura puesta a «${c.titulo}»`); }
        catch (e) { console.error('YouTube:', e.message); avisarSinFallo('Miniatura no aplicada', `«${c.titulo}»: ${e.message}. Si el canal no está verificado por teléfono, verifícalo en youtube.com/verify y súbela a mano.`, { etiquetas: ['warning'] }); }
      }
    }
    if (!s.no_antes) { const m = Number(cfg['youtube.espacio_min'] ?? 120); proxima = Date.now() + Math.round(m * (0.9 + Math.random() * 0.2) * 60000); }
    console.log(`YouTube: subido «${c.titulo}» → https://youtu.be/${r.id} (${r.status?.privacyStatus}); la siguiente, en ${Math.round((proxima - Date.now()) / 60000)} min como pronto`);
    avisarSinFallo('Clip publicado en YouTube', `«${c.titulo}»${r.status?.privacyStatus === 'private' ? ' (privado: hazlo público en YouTube Studio)' : ''}`, { etiquetas: ['arrow_up'], enlace: `https://youtu.be/${r.id}` });
  } catch (e) {
    if (e.cuota) { parado = Date.now() + 3 * 3600000; db.prepare("UPDATE clip_subidas SET estado='pendiente', error=? WHERE id=?").run(e.message, s.id); }
    else db.prepare("UPDATE clip_subidas SET estado='error', error=? WHERE id=?").run(e.message.slice(0, 400), s.id);
    console.error('YouTube:', e.message);
  } finally { subiendo = false; }
}
