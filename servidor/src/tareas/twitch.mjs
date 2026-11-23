// Twitch como fuente de clips (21-nov-2026): clips frescos y más vistos de un streamer vía la API Helix.
// Credenciales de la app de desarrollador en ~/.config/streamclipper-twitch/credenciales.json ({client_id, client_secret}, permisos 600);
// token de aplicación (client credentials), sin iniciar sesión de ningún usuario. Nunca se imprime el secreto.
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FICH = path.join(os.homedir(), '.config', 'streamclipper-twitch', 'credenciales.json');
export const conectado = () => existsSync(FICH);
let token = { valor: '', caduca: 0 };
const juegos = new Map(), usuarios = new Map();

async function tokenApp() {
  if (token.valor && Date.now() < token.caduca - 3600000) return token.valor;
  const c = JSON.parse(readFileSync(FICH, 'utf8'));
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, grant_type: 'client_credentials' }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`Twitch: no da token (${j.message || r.status})`);
  token = { valor: j.access_token, caduca: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.valor;
}
async function helix(ruta) {
  const c = JSON.parse(readFileSync(FICH, 'utf8'));
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`https://api.twitch.tv/helix/${ruta}`, { headers: { 'Client-Id': c.client_id, Authorization: `Bearer ${await tokenApp()}` }, signal: AbortSignal.timeout(20000) });
    if (r.status === 401) { token = { valor: '', caduca: 0 }; continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twitch ${r.status}: ${j.message || 'error'}`);
    return j;
  }
  throw new Error('Twitch: token rechazado');
}
async function idUsuario(login) {
  if (!usuarios.has(login)) usuarios.set(login, (await helix(`users?login=${encodeURIComponent(login)}`)).data?.[0]?.id || null);
  return usuarios.get(login);
}
async function idJuego(nombre) {
  if (!nombre) return null;
  if (!juegos.has(nombre)) juegos.set(nombre, (await helix(`games?name=${encodeURIComponent(nombre)}`)).data?.[0]?.id || null);
  return juegos.get(nombre);
}
export const loginDe = (url) => (String(url).match(/twitch\.tv\/([A-Za-z0-9_]{3,25})/) || [])[1]?.toLowerCase() || null;

// Clips más vistos de las últimas `horas` (opcionalmente solo de un juego), de más a menos vistas.
// Devuelve [{ id, url, titulo, duracion, vistas, creado, juego_id }].
export async function clipsFrescos(login, { horas = 24, juego = null, max = 20 } = {}) {
  const uid = await idUsuario(login); if (!uid) throw new Error(`Twitch: no existe el usuario «${login}»`);
  const gid = juego ? await idJuego(juego) : null;
  const desde = new Date(Date.now() - horas * 3600000).toISOString();
  const j = await helix(`clips?broadcaster_id=${uid}&started_at=${encodeURIComponent(desde)}&first=${Math.min(100, max * 3)}`);
  return (j.data || []).filter((c) => !gid || c.game_id === gid).sort((a, b) => b.view_count - a.view_count).slice(0, max)
    .map((c) => ({ id: c.id, url: c.url, titulo: c.title, duracion: Math.round(c.duration), vistas: c.view_count, creado: c.created_at, juego_id: c.game_id }));
}
