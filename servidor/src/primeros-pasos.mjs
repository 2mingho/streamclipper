// «Primeros pasos»: lista guiada para quien acaba de instalar StreamClipper, hasta su primer clip revisado.
// Cada paso se calcula con lo que ya hay en la base de datos y con las herramientas del equipo (comprobadas como mucho
// una vez por minuto, en paralelo y con tiempo límite, para que la pantalla de inicio no espere).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { db, ajustes, guardarAjustes } from './db.mjs';
import * as Youtube from './tareas/youtube.mjs';
import * as Telemetria from './telemetria.mjs';
import * as IA from './ia-nube.mjs';

const prueba = (cmd, args) => new Promise((ok) => {
  execFile(cmd, args, { timeout: 8000 }, (e, so, se) => ok(!e || (e.code !== 'ENOENT' && e.errno !== -2 && !e.killed && String(so || se).trim().length > 0)));
});
async function motor(url) {
  try { await fetch(String(url || '').replace(/\/$/, '') + '/', { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}

let cache = { t: 0, v: null };
async function herramientas(refrescar = false) {
  if (!refrescar && cache.v && Date.now() - cache.t < 60000) return cache.v;
  const cfg = ajustes();
  const conOpenShorts = cfg['clips.motor'] === 'openshorts';
  const [ffmpeg, ytdlp, whisperBin, openshorts] = await Promise.all([
    prueba('ffmpeg', ['-version']), prueba('yt-dlp', ['--version']), prueba(cfg['whisper.binario'] || 'whisper-cli', ['--help']), conOpenShorts ? motor(cfg['clips.api']) : false,
  ]);
  const whisper = whisperBin && existsSync(String(cfg['whisper.modelo'] || ''));
  cache = { t: Date.now(), v: [
    { id: 'ffmpeg', nombre: 'FFmpeg', ok: ffmpeg, obligatorio: true, para: 'Corta, encuadra y monta los clips.' },
    { id: 'yt-dlp', nombre: 'yt-dlp', ok: ytdlp, obligatorio: true, para: 'Descarga los vídeos de YouTube, Twitch y Kick.' },
    { id: 'whisper', nombre: 'Whisper', ok: whisper, obligatorio: false, para: whisperBin ? 'Está instalado, pero falta el modelo (Ajustes › IA › Transcripción).' : 'Subtítulos automáticos. Sin él, los clips salen sin subtítulos.' },
    ...(conOpenShorts ? [{ id: 'openshorts', nombre: 'OpenShorts', ok: openshorts, obligatorio: false, para: 'Elegiste OpenShorts como motor (Ajustes › Clips) y no responde en su dirección.' }] : []),
  ] };
  return cache.v;
}

const VER = "tipo NOT IN ('estudio','recop')";
// Opcional: sin IA los clips salen igual, pero sin título, texto en pantalla ni descripciones.
function ia() {
  let p = {}; try { p = IA.estadoPropio(); } catch {}
  const conectadas = [p.configurado && `tu modelo ${p.modelo}`, IA.groqConfigurado() && 'Groq', IA.geminiConfigurado() && 'Gemini'].filter(Boolean);
  return { id: 'ia', titulo: 'Conecta una IA', opcional: true, hecho: conectadas.length > 0, detalle: conectadas.join(', ') };
}
export async function estado({ refrescar = false } = {}) {
  const h = await herramientas(refrescar);
  const listo = (id) => h.find((x) => x.id === id)?.ok;
  const n = (sql, ...a) => db.prepare(sql).get(...a)?.n || 0;
  const videos = n(`SELECT COUNT(*) n FROM clip_videos WHERE ${VER}`);
  const conClips = db.prepare(`SELECT id, titulo FROM clip_videos WHERE ${VER} AND estado = 'listo' ORDER BY id LIMIT 1`).get();
  const ultimo = db.prepare(`SELECT id, titulo, estado, paso, error, creado, enviado FROM clip_videos WHERE ${VER} ORDER BY id DESC LIMIT 1`).get() || null;
  let valoradas = 0; try { valoradas = n('SELECT COUNT(*) n FROM clip_valoraciones'); } catch {}
  const streamers = n('SELECT COUNT(*) n FROM clip_canales');
  let youtube = false; try { youtube = !!Youtube.conectado(); } catch {}
  const pasos = [
    { id: 'herramientas', titulo: 'Herramientas', hecho: listo('ffmpeg') && listo('yt-dlp'), detalle: h },
    { id: 'video', titulo: 'Tu primer vídeo', hecho: videos > 0 },
    { id: 'procesando', titulo: 'Procesando', hecho: !!conClips,
      video: ultimo && { id: ultimo.id, titulo: ultimo.titulo || '', estado: ultimo.estado, paso: ultimo.paso || '', error: ultimo.error || '', creado: ultimo.creado ? `${String(ultimo.creado).replace(' ', 'T')}Z` : null } },
    { id: 'revisar', titulo: 'Revisa tu primer clip', hecho: valoradas > 0, video: conClips ? { id: conClips.id, titulo: conClips.titulo || '' } : null },
    ia(),
    { id: 'streamer', titulo: 'Añade un streamer', opcional: true, hecho: streamers > 0 },
    { id: 'youtube', titulo: 'Conecta YouTube', opcional: true, hecho: youtube },
  ];
  const completo = pasos.filter((p) => !p.opcional).every((p) => p.hecho);
  Telemetria.pasos(pasos);
  return { pasos, completo, oculto: ajustes()['primeros_pasos.oculto'] === true, plataforma: process.platform, telemetria: Telemetria.estado() };
}
// Herramientas como { ffmpeg, 'yt-dlp', whisper } (para la telemetría y el diagnóstico).
export async function herramientasMapa() { return Object.fromEntries((await herramientas()).map((x) => [x.id, !!x.ok])); }
// Diagnóstico para «Reportar un problema»: nada personal (ni títulos, ni enlaces, ni mensajes de error; solo su código).
export async function diagnostico() {
  const e = await estado(), h = await herramientasMapa();
  const i = e.pasos.findIndex((p) => !p.opcional && !p.hecho);
  const err = db.prepare("SELECT error FROM clip_videos WHERE estado = 'error' AND error IS NOT NULL ORDER BY id DESC LIMIT 1").get();
  return { version: Telemetria.VERSION, os: `${process.platform} ${String((await import('node:os')).release()).split('.')[0]}`, node: process.versions.node.split('.')[0],
    herramientas: h, paso: i < 0 ? 'completo' : `${i + 1} (${e.pasos[i].id})`, error: err ? Telemetria.tipoError(err.error) : 'ninguno' };
}
export function ocultar(oculto) { guardarAjustes({ 'primeros_pasos.oculto': !!oculto }); cache.t = 0; return { oculto: !!oculto }; }
