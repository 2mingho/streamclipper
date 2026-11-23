// Servidor del panel: API + archivos estáticos + planificador.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { db, RAIZ, DATOS, ARCHIVOS, ajustes, guardarAjustes, AJUSTES_POR_DEFECTO, columnasPendientes } from './db.mjs';
import { iniciarPlanificador, suspenderAhora } from './planificador.mjs';
import { modelosDisponibles, chat } from './llm.mjs';
import { avisar } from './avisos.mjs';
import { createReadStream, statSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tokenAcelerador, esperarTrabajo, recibirResultado, archivoDeTrabajo, estadoAcelerador } from './acelerador.mjs';
import * as Clips from './tareas/clips.mjs';
import * as Youtube from './tareas/youtube.mjs';
import * as Tiktok from './tareas/tiktok.mjs';
import * as Editor from './tareas/clips-editor.mjs';
import * as Operaciones from './operaciones.mjs';
import * as Estadisticas from './estadisticas/estadisticas.mjs';
import * as Recop from './tareas/recopilatorios.mjs';
import * as Autopiloto from './tareas/autopiloto.mjs';
import * as Social from './social.mjs';
import * as Campanas from './tareas/campanas.mjs';
import * as Valoracion from './tareas/clips-valoracion.mjs';
import * as Estudio from './estudio/estudio.mjs';
import * as IA from './ia-nube.mjs';
import * as AjustesApp from './ajustes-app.mjs';
import * as GeminiVigia from './gemini-vigia.mjs';
import * as Autoprueba from './autoprueba.mjs';
import * as Prefiltro from './tareas/automatizaciones.mjs';
import * as Vigia from './vigia-servidor.mjs';
import * as Usuarios from './usuarios.mjs';
import * as Cuentas from './cuentas-red.mjs';
import * as Version from './app-version.mjs';
import * as Rol from './rol.mjs';
import * as Recursos from './recursos.mjs';
import { estadoSistema, registroServicio, reiniciarServicio } from './sistema.mjs';

columnasPendientes(); // instalación nueva: columnas que esperaban a que otro módulo creara su tabla

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(RAIZ, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// ---------- sesiones ----------
// Sesiones persistentes: se guardan en <DATOS_DIR>/sesiones.json para que un reinicio no cierre la sesión del panel.
const FICH_SESIONES = path.join(DATOS, 'sesiones.json');
// token -> { c: caduca, u: id de usuario } (las antiguas, solo con la caducidad, son del dueño)
const sesiones = (() => { try { return new Map(Object.entries(JSON.parse(readFileSync(FICH_SESIONES, 'utf8'))).map(([t, v]) => [t, typeof v === 'number' ? { c: v, u: null } : v]).filter(([, s]) => s.c > Date.now())); } catch { return new Map(); } })();
const guardarSesiones = () => { try { writeFileSync(FICH_SESIONES, JSON.stringify(Object.fromEntries(sesiones)), { mode: 0o600 }); } catch {} };
const hash = (clave, sal = randomBytes(16).toString('hex')) => `${sal}:${scryptSync(clave, sal, 32).toString('hex')}`;
function claveCorrecta(clave, guardado) {
  const [sal, h] = String(guardado).split(':');
  if (!sal || !h) return false;
  const a = Buffer.from(scryptSync(clave, sal, 32).toString('hex')), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}
function tokenDe(req) { return (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === 'sesion')?.[1]; }
function usuarioDe(req) {
  const ui = Rol.usuarioInterno(req); if (ui) return Usuarios.uno(ui); // petición reenviada por la web (ya autenticada)
  if (req.headers['x-autoprueba'] && Autoprueba.valida(req)) return Usuarios.uno(Usuarios.duenoId());
  const t = tokenDe(req), s = t && sesiones.get(t);
  if (!s || s.c <= Date.now()) return null;
  return Usuarios.uno(s.u ?? Usuarios.duenoId()); // null si el usuario se desactivó o se borró
}
const autenticado = (req) => !!usuarioDe(req);
function cerrarSesionesDe(uid) { for (const [t, s] of sesiones) if ((s.u ?? Usuarios.duenoId()) === Number(uid)) sesiones.delete(t); guardarSesiones(); }
// Intentos fallidos de entrar, por IP: 8 seguidos bloquean 10 minutos.
const fallos = new Map();
function crearSesion(res, uid) {
  const t = randomBytes(24).toString('hex');
  sesiones.set(t, { c: Date.now() + 30 * 24 * 3600000, u: uid });
  guardarSesiones();
  res.setHeader('Set-Cookie', `sesion=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}`);
}

// ---------- utilidades ----------
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function leerJson(req) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 30e6) throw new Error('Petición demasiado grande'); partes.push(c); }
  return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
}

function ajustesPublicos() {
  const a = ajustes();
  const out = { ...a, 'avisos.token': a['avisos.token'] ? '__guardada__' : '' };
  delete out['panel.clave_hash'];
  delete out['acelerador.token'];
  return out;
}

// ---------- rutas ----------
const rutas = {
  // Interfaz «social» (web y app): historias, feed, reels, explorar, actividad, perfil y mensajes (src/social.mjs).
  'GET /api/social/cuentas': () => ({ cuentas: Social.cuentas() }),
  'GET /api/social/historias': () => ({ historias: Social.historias() }),
  'GET /api/social/feed': (req, url) => Social.feed({ cuenta: url.searchParams.get('cuenta') || 'canal', antes: url.searchParams.get('antes'), limite: Math.min(50, Number(url.searchParams.get('limite')) || 20) }),
  'GET /api/social/reels': (req, url) => Social.reels({ cuenta: url.searchParams.get('cuenta') || 'canal' }),
  'GET /api/social/explorar': (req, url) => Social.explorarTodo({ filtro: url.searchParams.get('filtro') || 'todo', q: url.searchParams.get('q') || '' }),
  'GET /api/social/actividad': () => Social.actividad(),
  'GET /api/social/perfil': (req, url) => Social.perfil({ cuenta: url.searchParams.get('cuenta') || 'canal' }),
  'GET /api/social/mensajes': () => Social.mensajes(),
  'GET /api/social/cola': () => Social.cola(),
  // Texto fijo de arriba de un clip ya montado (se repinta su franja) y publicaciones de campaña enviadas a la plataforma.
  'POST /api/clips/gancho': async (req) => { const b = await leerJson(req); const c = await Clips.cambiarTextoPantalla(b.id, b.n, b.gancho); return { ok: true, gancho: c.gancho }; },
  // Ajustes de la app (registro único, fase 2)
  'GET /api/ajustes/registro': () => ({ ...AjustesApp.registro(), gemini: GeminiVigia.ultimas(8), cuentas: { youtube: Youtube.conectado(), tiktok: Tiktok.conectado() }, groq: IA.groqConfigurado(), cuentasRed: Cuentas.lista() }),
  'POST /api/ia/groq': async (req) => IA.guardarClaveGroq(await leerJson(req)),
  'GET /api/ia/groq/modelos': () => IA.modelosGroq(),
  'POST /api/ia/groq/probar': async (req) => { const b = await leerJson(req); return IA.probarGroq(String(b.modelo), b.tipo === 'vision' ? 'vision' : 'texto'); },
  'POST /api/campanas/logo': async (req) => { const b = await leerJson(req); return AjustesApp.subirLogo(String(b.slug), b.nombre, b.datos); },
  'POST /api/ajustes/uno': async (req) => { const b = await leerJson(req); if (req.usuario?.rol !== 'dueno' && Usuarios.esAjusteDeDueno(b.clave)) throw new Error('Ese ajuste solo lo puede cambiar el dueño'); return AjustesApp.guardarUno(String(b.clave), b.valor, { defecto: !!b.defecto }); },
  'POST /api/campanas/ajuste': async (req) => { const b = await leerJson(req); return AjustesApp.guardarCampana(String(b.slug), String(b.ruta), b.valor); },
  'POST /api/clips/recuperar': async (req) => { const id = Number((await leerJson(req)).id); const r = db.prepare("UPDATE clip_videos SET estado = 'cola', sin_ia = 1, error = NULL, paso = NULL WHERE id = ? AND estado IN ('descartado','error')").run(id); if (!r.changes) throw new Error('Ese vídeo ya no está descartado'); return { ok: true }; },
  'GET /api/subidas': () => Social.colaSubida(),
  'GET /api/estadisticas/resumen': (req, url) => ({ ...Estadisticas.resumen({ dias: Math.min(365, Math.max(1, Number(url.searchParams.get('dias')) || 28)) }), estrategia_fecha: Estadisticas.estrategia().fecha }),
  'POST /api/estadisticas/estrategia': async (req) => Estadisticas.guardarEstrategia((await leerJson(req)).texto),
  'POST /api/estadisticas/actualizar': async () => { await Estadisticas.actualizar({ dias: 90 }); return { ok: true }; },
  'POST /api/subidas/orden': async (req) => { const b = await leerJson(req); return Social.ordenarSubida(String(b.red), b.sids); },
  'POST /api/streamers/ajuste': async (req) => { const b = await leerJson(req); return AjustesApp.guardarCanal(b.id, String(b.ruta), b.valor); },
  'POST /api/streamers/crear': async (req) => AjustesApp.crearCanal(await leerJson(req)),
  'POST /api/campanas/crear': async (req) => AjustesApp.crearCampana(await leerJson(req)),
  'POST /api/gemini/decidir': async (req) => { const b = await leerJson(req); return GeminiVigia.aplicar(String(b.clave), String(b.op), 'app'); },
  'POST /api/campanas/enviado': async (req) => { const b = await leerJson(req); return { ok: Campanas.marcarEnviada(b.id, b.si !== false) > 0 }; },
  // Estudio de vídeos: revisión de propuestas (las crea y produce la skill «estudio-videos» de Claude Code)
  'GET /api/estudio': () => Estudio.lista().map((p) => ({ ...p, pendientes: Estudio.comentarios(p.id).filter((c) => !c.atendido).length })),
  'GET /api/estudio/proyecto': (req, url) => {
    const p = Estudio.uno(url.searchParams.get('slug')); if (!p) throw new Error('No existe ese proyecto');
    return { ...p, comentarios: Estudio.comentarios(p.id), archivos: Estudio.archivosFinales(p.slug) };
  },
  // Ideas y guiones aportados por las IA (MCP): se ven en el Estudio y se piden como propuesta o se descartan.
  'GET /api/estudio/ideas': () => {
    let ideas = [], refs = [];
    try { ideas = db.prepare("SELECT id, creado, origen, titulo, formato, angulo, gancho, por_que, fuentes, guion, estado FROM ia_ideas WHERE estado IN ('nueva','pedida') ORDER BY id DESC LIMIT 40").all(); } catch { return []; }
    try { refs = db.prepare("SELECT id, origen, para, miniatura, imagenes FROM ia_referencias WHERE creado > datetime('now','-60 days') ORDER BY id DESC").all(); } catch {}
    const n = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
    return ideas.map((i) => ({ ...i, referencias: refs.filter((r) => r.para === String(i.id) || (n(r.para).length > 8 && (n(i.titulo).includes(n(r.para)) || n(r.para).includes(n(i.titulo).slice(0, 40)))))
      .map((r) => ({ id: r.id, origen: r.origen, miniatura: JSON.parse(r.miniatura || 'null'), imagenes: JSON.parse(r.imagenes || '[]') })) }));
  },
  'POST /api/estudio/idea': async (req) => {
    const b = await leerJson(req); const estado = { pedir: 'pedida', descartar: 'descartada', recuperar: 'nueva' }[b.accion];
    if (!estado) throw new Error('Acción no válida');
    db.prepare('UPDATE ia_ideas SET estado = ? WHERE id = ?').run(estado, Number(b.id)); return { estado };
  },
  'POST /api/estudio/encargo': async (req) => { const b = await leerJson(req); const t = String(b.titulo || '').trim(); if (t.length < 4) throw new Error('Escribe el tema'); const id = db.prepare("INSERT INTO ia_ideas (origen, titulo, angulo, estado) VALUES ('usuario', ?, ?, 'pedida')").run(t.slice(0, 140), String(b.detalle || '').trim().slice(0, 1500)).lastInsertRowid; return { id: Number(id) }; },
  'POST /api/estudio/comentar': async (req) => { const b = await leerJson(req); return Estudio.comentar(b.slug, b); },
  'POST /api/estudio/estado': async (req) => { const b = await leerJson(req); return Estudio.cambiarEstado(b.slug, b.accion); },
  'GET /api/ajustes': () => ({ ...ajustesPublicos(), _ia: IA.usoHoy() }),
  'POST /api/ajustes': async (req) => {
    const body = await leerJson(req);
    delete body['panel.clave_hash'];
    delete body['acelerador.token'];
    if (body['avisos.token'] === '__guardada__') delete body['avisos.token'];
    for (const k of ['clips.tramo_min', 'youtube.auto_min', 'youtube.max_dia', 'ia.gemini_max_dia', 'tiktok.max_dia', 'whisper.hilos']) if (k in body) body[k] = Number(body[k]);
    guardarAjustes(body);
    return ajustesPublicos();
  },
  'GET /api/modelos': async () => ({ url: ajustes()['llm.url'], modelos: await modelosDisponibles(ajustes()['llm.url']) }),
  'POST /api/probar/modelo': async (req) => {
    const { modelo } = await leerJson(req);
    const t0 = Date.now();
    const r = await chat(ajustes()['llm.url'], { model: modelo, max_tokens: 30, messages: [{ role: 'user', content: 'Responde solo: "funciono".' }] });
    return { respuesta: r, ms: Date.now() - t0 };
  },
  'POST /api/probar/aviso': async () => avisar('Prueba del servidor', 'Si lees esto, los avisos llegan a tu móvil.', { etiquetas: ['white_check_mark'], forzar: true }),
  'POST /api/energia/suspender': async () => suspenderAhora(),
  // Clips (OpenShorts)
  'GET /api/clips': () => {
    const cfg = ajustes();
    return {
      tipos: Object.fromEntries(Object.entries(Clips.TIPOS).map(([k, t]) => [k, { nombre: t.nombre, desc: t.desc, enfoque: t.enfoque, min: t.min, max: t.max }])),
      canales: Clips.canales.todos(), archivos: Clips.archivosEntrada(), directos: Clips.directos.activos(), propuestos: Clips.videos.propuestos(),
      videos: Clips.videos.recientes().map((v) => ({ ...v, subidas: v.estado === 'listo' ? Youtube.subidas.deVideo(v.id) : [], valoraciones: v.estado === 'listo' ? Valoracion.valoraciones.deVideo(v.id) : [] })),
      motivos: Object.fromEntries(Object.entries(Valoracion.MOTIVOS).map(([k, [t, regla]]) => [k, { texto: t, tecnico: !regla }])),
      aprendizaje: Valoracion.resumen(),
      youtube: { conectado: Youtube.conectado(), hoy: Youtube.subidas.hoy(), pendientes: Youtube.subidas.pendientes(),
        auto_min: cfg['youtube.auto_min'], max_dia: cfg['youtube.max_dia'], privacidad: cfg['youtube.privacidad'] },
      activo: cfg['clips.activo'], desde: cfg['clips.desde'], hasta: cfg['clips.hasta'], enVentana: Clips.enVentana(cfg),
      gancho: cfg['clips.gancho'], zoom: cfg['clips.zoom_pausa'], tramo: cfg['clips.tramo_min'],
    };
  },
  'POST /api/clips/videos': async (req) => ({ id: await Clips.videos.añadir(await leerJson(req)) }),
  'POST /api/clips/rehacer': async (req) => { const b = await leerJson(req); return { id: Clips.videos.rehacer(b.id, b) }; },
  'POST /api/clips/quitar': async (req) => { Clips.videos.quitar((await leerJson(req)).id); return { ok: true }; },
  'POST /api/clips/reintentar': async (req) => { Clips.videos.reintentar((await leerJson(req)).id); return { ok: true }; },
  'POST /api/clips/urgente': async (req) => { Clips.videos.urgente((await leerJson(req)).id); return { ok: true }; },
  'POST /api/clips/canales': async (req) => ({ id: Clips.canales.guardar(await leerJson(req)) }),
  'POST /api/clips/canales/borrar': async (req) => { Clips.canales.borrar((await leerJson(req)).id); return { ok: true }; },
  'POST /api/clips/revisar': () => { Clips.revisarAhora(); return { ok: true }; },
  'POST /api/clips/aprobar': async (req) => { const b = await leerJson(req); return { ok: Clips.videos.aprobar(b.id, !!b.urgente) }; },
  'POST /api/clips/descartar-propuesto': async (req) => ({ ok: Clips.videos.descartarPropuesto((await leerJson(req)).id) }),
  'POST /api/clips/proponer': async (req) => ({ nuevos: await Clips.proponerUltimos((await leerJson(req)).canal) }),
  'POST /api/clips/directos/detener': async (req) => { const b = await leerJson(req); Clips.directos.detener(b.id, { descartar: !!b.descartar }); return { ok: true }; },
  'POST /api/clips/directos/reanudar': async (req) => { Clips.directos.reanudar((await leerJson(req)).id); return { ok: true }; },
  // Valoración de un clip: { id, n, valor: 1 | -1 | 0 (quitar), etiquetas: [...], nota }
  'POST /api/clips/valorar': async (req) => {
    const b = await leerJson(req);
    const { v, c } = Clips.datosVideo(b.id, b.n);
    if (!c) throw new Error('Ese clip no existe');
    const val = Valoracion.valoraciones.guardar(b, { carpeta: v.carpeta, copia: c.copia });
    if (Number(b.valor) === 1) { try { Autopiloto.alAprobar(b.id, b.n); } catch (e) { console.error('Autopiloto:', e.message); } }
    else { try { Youtube.subidas.quitar(b.id, b.n); Tiktok.publicaciones.quitar(b.id, b.n); } catch (e) { console.error('Quitar de las colas:', e.message); } }
    return { ok: true, valoracion: val };
  },
  // Galería: todos los clips de todos los vídeos listos, con su valoración y su estado en YouTube.
  'GET /api/clips/galeria': () => {
    const cfg = ajustes();
    return {
      videos: Clips.videos.listos().map((v) => ({ id: v.id, titulo: v.titulo, canal: v.canal || '', tipo: v.tipo, terminado: v.terminado, carpeta: v.carpeta,
        clips: v.clips.map((c) => ({ ...c, reaccion: Recop.reaccion(v.picos, c) })), subidas: Youtube.subidas.deVideo(v.id), tiktok: Tiktok.publicaciones.deVideo(v.id), valoraciones: Valoracion.valoraciones.deVideo(v.id) })),
      motivos: Object.fromEntries(Object.entries(Valoracion.MOTIVOS).map(([k, [t, regla]]) => [k, { texto: t, tecnico: !regla }])),
      youtube: { conectado: Youtube.conectado(), hoy: Youtube.subidas.hoy(), pendientes: Youtube.subidas.pendientes(), max_dia: cfg['youtube.max_dia'] },
      tiktok: { configurado: Tiktok.configurado(), conectado: Tiktok.conectado(), hoy: Tiktok.publicaciones.hoy(), pendientes: Tiktok.publicaciones.pendientes(), max_dia: Number(cfg['tiktok.max_dia']) || 10 },
      tipos: Object.fromEntries(Object.entries(Clips.TIPOS).map(([k, t]) => [k, { nombre: t.nombre }])),
      horizontales: Recop.porClip(),
      estrategia: Estadisticas.estrategia(),
    };
  },
  // Pie del clip (título + texto que se publica).
  'POST /api/clips/texto': async (req) => {
    const b = await leerJson(req);
    if (!Clips.datosVideo(b.id, b.n).c) throw new Error('Ese clip no existe');
    return { ok: true, clip: Editor.guardarTextos(b.id, b.n, b) };
  },
  // Lista compacta de clips (cuadrícula y visor; también la usan los clientes nativos).
  'GET /api/movil/galeria': () => {
    const cfg = ajustes(), H = Recop.porClip(), clips = [], canales = new Set();
    const est = (s) => s?.estado || null;
    for (const v of Clips.videos.listos()) {
      const canal = v.canal || (v.tipo === 'estudio' ? 'Estudio' : v.tipo === 'recop' ? 'Recopilatorios' : '');
      if (canal) canales.add(canal);
      const subidas = Youtube.subidas.deVideo(v.id), tks = Tiktok.publicaciones.deVideo(v.id), vals = Valoracion.valoraciones.deVideo(v.id);
      for (const c of v.clips || []) {
        const val = vals.find((x) => x.n === c.n), h = H[`${v.id}-${c.n}`];
        clips.push({ id: v.id, n: c.n, titulo: c.titulo || '', texto: c.tiktok || '', gancho: c.gancho || '', original: c.original || '', canal, tipo: v.tipo,
          formato: c.formato || null, dur: Math.round(((c.fin ?? 0) - (c.inicio ?? 0)) * 10) / 10, puntos: c.puntos ?? null, emocion: c.emocion ?? null,
          val: val?.valor || 0, etiquetas: val?.etiquetas || [], nota: val?.nota || '',
          yt: est(subidas.find((x) => x.n === c.n)), tk: est(tks.find((x) => x.n === c.n)),
          ytId: subidas.find((x) => x.n === c.n)?.yt || null, tkPostId: tks.find((x) => x.n === c.n)?.post_id || null, canalUrl: c.canalUrl || '',
          h: h ? { rc: h.id, estado: h.estado, aprobado: !!h.aprobado } : null, horizontal: !!(c.horizontalEditado || c.horizontal),
          editado: c.editado || null, editable: !['estudio', 'recop'].includes(v.tipo) && c.inicio != null, terminado: v.terminado });
      }
    }
    return { clips, canales: [...canales].sort(), motivos: Object.fromEntries(Object.entries(Valoracion.MOTIVOS).map(([k, [t]]) => [k, { texto: t }])),
      youtube: { conectado: Youtube.conectado(), hoy: Youtube.subidas.hoy(), max_dia: cfg['youtube.max_dia'] },
      tiktok: { configurado: Tiktok.configurado(), conectado: Tiktok.conectado(), hoy: Tiktok.publicaciones.hoy(), max_dia: Number(cfg['tiktok.max_dia']) || 10 } };
  },
  // Recopilatorios horizontales
  'GET /api/recop': () => Recop.estado(),
  // { id, n, aprobar }: con «aprobar», el clip entra en la bolsa del recopilatorio en cuanto su versión 16:9 esté lista.
  'POST /api/recop/horizontal': async (req) => {
    const b = await leerJson(req), r = Recop.pedir(b.id, b.n);
    if (b.aprobar) { db.prepare('UPDATE recop_clips SET aprobado = 1 WHERE id = ?').run(r.id); r.aprobado = 1; }
    return r;
  },
  'POST /api/recop/reintentar': async (req) => { Recop.reintentar((await leerJson(req)).rc); return { ok: true }; },
  'POST /api/recop/aprobar': async (req) => { const b = await leerJson(req); Recop.aprobar(b.rc, !!b.si); return { ok: true }; },
  'POST /api/recop/crear': () => ({ id: Recop.crear() }),
  'POST /api/recop/guardar': async (req) => { const b = await leerJson(req); Recop.guardar(b.id, b); return { ok: true }; },
  'POST /api/recop/montar': async (req) => { const b = await leerJson(req); if (b.items) Recop.guardar(b.id, b); Recop.encolar(b.id); return { ok: true }; },
  'POST /api/recop/editar': async (req) => { Recop.editar((await leerJson(req)).id); return { ok: true }; },
  'POST /api/recop/borrar': async (req) => { Recop.borrar((await leerJson(req)).id); return { ok: true }; },
  'POST /api/clips/youtube/quitar': async (req) => { const b = await leerJson(req); return { quitados: Youtube.subidas.quitar(b.id, b.n) }; },
  'POST /api/clips/youtube': async (req) => {
    if (!Youtube.conectado()) throw new Error('YouTube no está conectado');
    const { id, n, cuenta } = await leerJson(req);
    if (cuenta) Cuentas.cuenta('youtube', cuenta);
    if (!Clips.datosVideo(id, n).c) throw new Error('Ese clip no existe');
    if (Valoracion.valoraciones.uno(id, n)?.valor === -1) throw new Error('Lo marcaste como «No sirve»: quita la valoración para publicarlo');
    // Clip de campaña: nunca al momento; al siguiente hueco de su franja (las vistas fuera de franja no cuentan para el pago).
    const vv = Clips.datosVideo(id, n).v;
    if (vv?.campana) {
      const cuando = Campanas.hueco(vv.campana);
      if (!cuando) throw new Error('La campaña no tiene huecos libres en su franja');
      Youtube.subidas.programar(id, n, cuando, 'campana');
      return { ok: true, programado: cuando };
    }
    Youtube.subidas.pedir(id, n, 'manual', cuenta || null);
    return { ok: true, hoy: Youtube.subidas.hoy() };
  },
  // Publicación: YouTube y TikTok (estado y colas), lo que aprende la IA y la estrategia del canal.
  'GET /api/publicacion': () => {
    const cfg = ajustes();
    const titulo = (id, n) => { try { return Clips.datosVideo(id, n).c?.titulo || `Clip ${n}`; } catch { return `Clip ${n}`; } };
    const yt = db.prepare("SELECT video_id, n, estado, yt, privacidad, error, origen, creado, subido FROM clip_subidas WHERE estado IN ('pendiente','subiendo','error') OR subido >= datetime('now','-3 days') ORDER BY CASE estado WHEN 'subiendo' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, COALESCE(subido, creado) DESC LIMIT 40").all().map((s) => ({ ...s, titulo: titulo(s.video_id, s.n) }));
    const tk = db.prepare("SELECT video_id, n, estado, post_id, privacidad, error, creado, subido FROM clip_tiktok WHERE estado IN ('pendiente','subiendo','procesando','error') OR subido >= datetime('now','-3 days') ORDER BY CASE estado WHEN 'subiendo' THEN 0 WHEN 'procesando' THEN 1 WHEN 'pendiente' THEN 2 WHEN 'error' THEN 3 ELSE 4 END, COALESCE(subido, creado) DESC LIMIT 40").all().map((s) => ({ ...s, titulo: titulo(s.video_id, s.n) }));
    const st = db.prepare('SELECT COUNT(*) videos, SUM(vistas) vistas, MAX(actualizado) actualizado FROM yt_videos').get();
    return {
      youtube: { conectado: Youtube.conectado(), hoy: Youtube.subidas.hoy(), max_dia: cfg['youtube.max_dia'], auto_min: cfg['youtube.auto_min'], privacidad: cfg['youtube.privacidad'], lista: yt },
      tiktok: { configurado: Tiktok.configurado(), conectado: Tiktok.conectado(), hoy: Tiktok.publicaciones.hoy(), max_dia: Number(cfg['tiktok.max_dia']) || 10, lista: tk },
      aprendizaje: Valoracion.resumen(), motivos: Object.fromEntries(Object.entries(Valoracion.MOTIVOS).map(([k, [t]]) => [k, { texto: t }])),
      tipos: Object.fromEntries(Object.entries(Clips.TIPOS).map(([k, t]) => [k, { nombre: t.nombre }])),
      estrategia: Estadisticas.estrategia(), estadisticas: { ...st, conectado: Estadisticas.conectado() },
    };
  },
  // Lo pendiente de todo el servidor (la franja de arriba de «Hoy»).
  'GET /api/pendientes': () => {
    const listos = db.prepare("SELECT id, clips FROM clip_videos WHERE estado = 'listo' AND tipo NOT IN ('estudio','recop') AND terminado >= datetime('now','-14 days')").all();
    const valorados = new Set(db.prepare('SELECT video_id, n FROM clip_valoraciones').all().map((x) => `${x.video_id}-${x.n}`));
    let sinValorar = 0; for (const v of listos) for (const c of JSON.parse(v.clips || '[]')) if (!valorados.has(`${v.id}-${c.n}`)) sinValorar++;
    return {
      clipsSinValorar: sinValorar,
      propuestos: db.prepare("SELECT COUNT(*) n FROM clip_videos WHERE estado = 'propuesto'").get().n,
      estudio: db.prepare("SELECT COUNT(*) n FROM estudio_proyectos WHERE estado IN ('propuesta','cambios')").get().n,
      errores: {
        clips: db.prepare("SELECT COUNT(*) n FROM clip_videos WHERE estado = 'error' AND COALESCE(terminado, creado) >= datetime('now','-2 days')").get().n,
        subidas: db.prepare("SELECT COUNT(*) n FROM clip_subidas WHERE estado = 'error'").get().n + db.prepare("SELECT COUNT(*) n FROM clip_tiktok WHERE estado = 'error'").get().n,
        operaciones: db.prepare("SELECT COUNT(*) n FROM operaciones WHERE estado = 'error' AND fin >= datetime('now','-1 day')").get().n,
      },
    };
  },
  // Operaciones: lanzar tareas a mano, en una cola ordenable
  'GET /api/operaciones': () => {
    const v = Clips.enCurso(), r = Editor.pendientesRender();
    return { ...Operaciones.estado(), enMarcha: {
      clip: v ? { titulo: v.titulo, paso: v.paso } : null,
      colaClips: db.prepare("SELECT COUNT(*) n FROM clip_videos WHERE estado='cola'").get().n,
      editor: r,
      subidas: { youtube: Youtube.subidas.pendientes(), tiktok: Tiktok.publicaciones.pendientes() },
    } };
  },
  'POST /api/operaciones': async (req) => { const b = await leerJson(req); return { id: Operaciones.encolar(b.tipo, b.params || {}) }; },
  'POST /api/operaciones/cancelar': async (req) => ({ cancelada: Operaciones.cancelar((await leerJson(req)).id) }),
  'POST /api/operaciones/mover': async (req) => { const b = await leerJson(req); return { ok: Operaciones.mover(b.id, b.dir) }; },
  // Editor de clips: receta (encuadre, inicio/fin, textos) → render vertical y horizontal desde el original
  'GET /api/editor': async (req, url) => {
    const id = Number(url.searchParams.get('id')), n = Number(url.searchParams.get('n'));
    const v = Clips.videos.uno(id); if (!v) throw new Error('Ese vídeo no existe');
    return Editor.abrir(id, n, { cierre: Clips.datosCreador(v).lineas });
  },
  'GET /api/editor/recursos': () => Editor.recursos(),
  'POST /api/editor/recurso': async (req) => { const b = await leerJson(req); return Editor.subirRecurso(b.nombre, b.datos); },
  'POST /api/editor/recurso/borrar': async (req) => Editor.borrarRecurso((await leerJson(req)).id),
  'GET /api/editor/estado': (req, url) => Editor.estadoRender(url.searchParams.get('id'), url.searchParams.get('n')),
  'POST /api/editor/render': async (req) => { const b = await leerJson(req); return Editor.encolarRender(b.id, b.n, b.receta, { publicarCopia: Clips.copiaEditada }); },
  'POST /api/editor/detectar': async (req) => { const b = await leerJson(req); return Editor.detectar(b.id, b.n, b.t); },
  'POST /api/editor/deshacer': async (req) => { const b = await leerJson(req); Editor.deshacer(b.id, b.n); return { ok: true }; },
  // TikTok (independiente de YouTube)
  'GET /api/tiktok/conectar': (req, url) => {
    // A dónde vuelve el navegador tras autorizar: el origen desde el que se abrió el panel (si es uno de los conocidos).
    // Lista en la variable de entorno PANELES (separadas por comas), p. ej. «http://192.0.2.10:8790,https://clips.example.com».
    const PANELES = String(process.env.PANELES || '').split(',').map((x) => x.trim()).filter(Boolean);
    const pedido = url.searchParams.get('origen');
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const origen = PANELES.includes(pedido) ? pedido : `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    return { url: Tiktok.urlConectar(origen, req.usuario?.id) };
  },
  'POST /api/tiktok/desconectar': () => { Tiktok.desconectar(); return { ok: true }; },
  'GET /api/tiktok/creador': (req, url) => Tiktok.creador(url.searchParams.get('cuenta') || null),
  // Cuentas de publicación por persona (fase 9b)
  'GET /api/cuentas': () => Cuentas.lista(),
  'POST /api/cuentas/youtube/url': async (req) => { const b = await leerJson(req).catch(() => ({})); return { url: Youtube.urlConectar(req.usuario.id, !!b.propio) }; },
  'GET /api/cuentas/youtube/cliente': (req) => ({ propio: Youtube.tieneClientePropio(req.usuario.id) }),
  'POST /api/cuentas/youtube/cliente': async (req) => Youtube.guardarClientePropio(req.usuario.id, (await leerJson(req)).json),
  'POST /api/cuentas/youtube/cliente/quitar': (req) => Youtube.quitarClientePropio(req.usuario.id),
  'POST /api/cuentas/youtube/completar': async (req) => Youtube.completarConexion((await leerJson(req)).pegado, req.usuario.id),
  'POST /api/cuentas/borrar': async (req) => Cuentas.borrar((await leerJson(req)).id, req.usuario),
  'POST /api/cuentas/defecto': async (req) => Cuentas.defecto((await leerJson(req)).id),
  'POST /api/clips/tiktok/quitar': async (req) => { const b = await leerJson(req); return { quitados: Tiktok.publicaciones.quitar(b.id, b.n) }; },
  'POST /api/clips/tiktok': async (req) => {
    if (!Tiktok.conectado()) throw new Error('TikTok no está conectado');
    const b = await leerJson(req);
    if (!Clips.datosVideo(b.id, b.n).c) throw new Error('Ese clip no existe');
    if (Valoracion.valoraciones.uno(b.id, b.n)?.valor === -1) throw new Error('Lo marcaste como «No sirve»: quita la valoración para publicarlo');
    if (!b.consiente) throw new Error('Falta aceptar la confirmación de uso de música de TikTok');
    if (b.cuenta) Cuentas.cuenta('tiktok', b.cuenta);
    Tiktok.publicaciones.pedir(b.id, b.n, b);
    return { ok: true };
  },
  // Sistema: estado y mantenimiento del servidor
  'GET /api/sistema': () => estadoSistema(),
  'GET /api/sistema/alertas': () => Vigia.revisar(),
  'GET /api/sistema/recursos': () => Recursos.recursos(),
  'GET /api/sistema/proceso': (req, url) => Recursos.detalleProceso(url.searchParams.get('pid')),
  'POST /api/sistema/proceso': async (req) => { if (req.usuario?.rol !== 'dueno') throw new Error('Eso solo lo puede hacer el dueño'); const b = await leerJson(req); return Recursos.accionProceso(b.pid, String(b.accion)); },
  'GET /api/sistema/autoprueba': () => Autoprueba.resultado() || { fecha: null, fallos: [] },
  'POST /api/sistema/autoprueba': () => Autoprueba.autoprueba(PORT),
  'POST /api/clips/recuperar': async (req) => { const b = await leerJson(req); return Prefiltro.recuperar(b.id, b.n); },
  'GET /api/clips/prefiltro': () => Prefiltro.resumen(),
  // Equipo y mi cuenta (fase 9)
  'GET /api/yo': (req) => req.usuario,
  'POST /api/yo/clave': async (req) => { const b = await leerJson(req); return Usuarios.cambiarClave(req.usuario.id, b.actual, b.nueva); },
  'POST /api/yo/nombre': async (req) => Usuarios.nombre(req.usuario.id, (await leerJson(req)).nombre),
  'POST /api/yo/usuario': async (req) => Usuarios.cambiarUsuario(req.usuario.id, (await leerJson(req)).usuario),
  'POST /api/yo/tour': async (req) => Usuarios.tour(req.usuario.id, !!(await leerJson(req)).visto),
  'GET /api/usuarios': () => ({ usuarios: Usuarios.lista(), roles: Usuarios.ROLES }),
  'POST /api/usuarios/crear': async (req) => Usuarios.crear(await leerJson(req)),
  'POST /api/usuarios/guardar': async (req) => { const b = await leerJson(req); const u = Usuarios.guardar(b.id, b, req.usuario.id); if (!u.activo) cerrarSesionesDe(u.id); return u; },
  'POST /api/usuarios/restablecer': async (req) => { const b = await leerJson(req); const r = Usuarios.restablecer(b.id); cerrarSesionesDe(b.id); return r; },
  'POST /api/usuarios/borrar': async (req) => { const b = await leerJson(req); const r = Usuarios.borrar(b.id, req.usuario.id); cerrarSesionesDe(b.id); return r; },
  'GET /api/sistema/registro': (req, url) => registroServicio(url.searchParams.get('id')),
  'POST /api/sistema/servicio': async (req) => reiniciarServicio((await leerJson(req)).id),
  'GET /api/acelerador': () => estadoAcelerador(),
  'POST /api/acelerador': async (req) => { guardarAjustes({ 'acelerador.activo': !!(await leerJson(req)).activo }); return estadoAcelerador(); },
};

// Medición: peticiones que tardan más de 300 ms (ruta y milisegundos) al registro del servicio.
const LENTAS = 300;
// Miniaturas: como mucho 2 ffmpeg a la vez (antes, abrir la galería lanzaba decenas en paralelo).
let posterActivos = 0; const colaPoster = [];
function generarPoster(ruta, dest, h16) {
  return new Promise((ok) => {
    const correr = () => { posterActivos++; execFile('nice', ['-n', '15', 'ffmpeg', '-v', 'error', '-y', '-ss', '1.5', '-i', ruta, '-frames:v', '1', '-vf', h16 ? 'scale=480:-2' : 'scale=360:-2', '-q:v', '6', dest], { timeout: 30000 }, () => { posterActivos--; ok(); const sig = colaPoster.shift(); if (sig) sig(); }); };
    if (posterActivos < 2) correr(); else colaPoster.push(correr);
  });
}
// Precalentado: cada hora, las miniaturas que falten de los clips listos se generan de una en una con prioridad baja.
async function precalentarPosters() {
  try {
    const dir = path.join(DATOS, 'posters'); mkdirSync(dir, { recursive: true });
    for (const v of Clips.videos.listos()) for (const c of v.clips || []) {
      const fc = Clips.archivoClip(v.id, c.n); if (!fc || !existsSync(fc.ruta)) continue;
      const dest = path.join(dir, `${v.id}-${c.n}-${Math.round(statSync(fc.ruta).mtimeMs)}.jpg`);
      if (!existsSync(dest)) await generarPoster(fc.ruta, dest, false);
    }
  } catch (e) { console.error('Miniaturas:', e.message); }
}
// Tareas de fondo: solo en el proceso de trabajos (o en el todo-en-uno).
if (Rol.conTrabajos && process.env.SIN_PLANIFICADOR !== '1') {
  Autopiloto.iniciar();
  setTimeout(precalentarPosters, 60000).unref(); setInterval(precalentarPosters, 3600000).unref();
}
const server = http.createServer(async (req, res) => {
  // Internet (p. ej. Tailscale Funnel): desde fuera solo se atiende el MCP (dirección secreta), reenviado al servidor MCP
  // (MCP_PUERTO, 8792 por defecto); todo lo demás, «no encontrado». Tailscale marca esas visitas con esta cabecera.
  if (req.headers['tailscale-funnel-request']) {
    const ruta = String(req.url || '').split('?')[0];
    if (!/^\/(?:mcp\/[\w-]{16,}|[\w-]{16,}\/mcp)\/?$/.test(ruta)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('No encontrado'); return; }
    const r = http.request({ host: '127.0.0.1', port: Number(process.env.MCP_PUERTO || 8792), method: req.method, path: req.url, headers: req.headers }, (rr) => { res.writeHead(rr.statusCode, rr.headers); rr.pipe(res); });
    r.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
    req.pipe(r); return;
  }
  const t0 = process.hrtime.bigint();
  res.on('finish', () => { const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms > LENTAS && !String(req.url).startsWith('/api/acelerador/trabajo')) console.log(`LENTA ${Math.round(ms)} ms ${req.method} ${String(req.url).split('?')[0]} ${res.statusCode}`); });
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    // Web separada: el agente de la laptop y la vuelta de TikTok van directos al proceso de trabajos (se autentican allí).
    if (Rol.ROL === 'web' && (p.startsWith('/api/acelerador/') || p === '/api/tiktok/callback')) return Rol.reenviar(req, res);

    // Acelerador (agente de la laptop): se identifica con su token, no con la sesión del panel.
    if (p.startsWith('/api/acelerador/')) {
      const dado = Buffer.from(String(req.headers['x-acelerador'] || ''));
      const bueno = Buffer.from(tokenAcelerador());
      if (dado.length !== bueno.length || !timingSafeEqual(dado, bueno)) { await new Promise((r) => setTimeout(r, 500)); return send(res, 401, { error: 'Token del acelerador incorrecto' }); }
      if (p === '/api/acelerador/trabajo' && req.method === 'POST') return send(res, 200, { trabajo: await esperarTrabajo(await leerJson(req)) });
      if (p === '/api/acelerador/resultado' && req.method === 'POST') return send(res, 200, recibirResultado(await leerJson(req)));
      const au = p.match(/^\/api\/acelerador\/audio\/([\w-]+)$/);
      if (au && req.method === 'GET') {
        const f = archivoDeTrabajo(au[1]);
        if (!f) return send(res, 404, { error: 'No existe' });
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': statSync(f).size });
        return createReadStream(f).pipe(res);
      }
      return send(res, 404, { error: 'No encontrado' });
    }

    // Autenticación
    // Clientes nativos: qué nivel de API hace falta (sin sesión) y bloqueo de los demasiado antiguos.
    if (p === '/api/app/version' && req.method === 'GET') return send(res, 200, Version.version());
    if (p.startsWith('/api/') && Version.appAntigua(req)) return send(res, 426, { error: 'Actualiza la app: hay una versión nueva necesaria', actualizar: true, ...Version.version() });
    if (p === '/api/sesion' && req.method === 'GET') { const yo = usuarioDe(req); return send(res, 200, { tieneClave: Usuarios.hayUsuarios() || !!ajustes()['panel.clave_hash'], autenticado: !!yo, usuario: yo }); }
    if (p === '/api/sesion' && req.method === 'POST') {
      const ip = req.socket.remoteAddress, f = fallos.get(ip);
      if (f && f.hasta > Date.now()) return send(res, 429, { error: 'Demasiados intentos: espera unos minutos' });
      const { usuario = '', clave = '' } = await leerJson(req);
      if (!Usuarios.hayUsuarios()) { // panel recién instalado: el primero que entra crea la cuenta del dueño
        try { const u = Usuarios.primerDueno(String(clave), String(usuario || 'admin')); crearSesion(res, u.id); return send(res, 200, { ok: true }); }
        catch (e) { return send(res, 400, { error: e.message }); }
      }
      const u = Usuarios.entrar(String(usuario), String(clave));
      if (!u) {
        const n = (f?.n || 0) + 1; fallos.set(ip, { n, hasta: n >= 8 ? Date.now() + 10 * 60000 : 0 });
        await new Promise((r) => setTimeout(r, 800)); return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
      }
      fallos.delete(ip); crearSesion(res, u.id); return send(res, 200, { ok: true });
    }
    // Vuelta de la conexión con TikTok: llega sin la cookie de sesión (SameSite=Strict en una navegación desde otro sitio);
    // la protege el «state» de un solo uso que creó /api/tiktok/conectar con sesión.
    if (p === '/api/tiktok/callback' && req.method === 'GET') {
      let msg = 'TikTok conectado';
      try { if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error')); await Tiktok.completarConexion(url.searchParams.get('code'), url.searchParams.get('state')); }
      catch (e) { msg = `No se pudo conectar TikTok: ${e.message}`; }
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TikTok</title><body style="font:16px system-ui;padding:40px"><p>${esc(msg)}</p><p><a href="/#/clips">Volver al panel</a></p></body>`, 'text/html; charset=utf-8');
    }
    // Botones del aviso de Gemini (ntfy): sin sesión, con token de un solo uso.
    if (p === '/api/gemini/aviso' && req.method === 'POST') {
      try { return send(res, 200, GeminiVigia.desdeAviso(url.searchParams.get('t'), url.searchParams.get('op'))); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === '/api/salir' && req.method === 'POST') { sesiones.delete(tokenDe(req)); return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'sesion=; Path=/; Max-Age=0' }); }

    if (p.startsWith('/api/')) {
      const yo = usuarioDe(req); if (!yo) return send(res, 401, { error: 'Inicia sesión' });
      req.usuario = yo;
      if (!Usuarios.permitido(yo, req.method, p)) return send(res, 403, { error: yo.rol === 'lector' ? 'Tu usuario es de «solo ver»: no puede cambiar nada' : 'Eso solo lo puede hacer el dueño' });
      if (Rol.deTrabajos(req.method, p)) return Rol.reenviar(req, res, yo.id);
      if (p === '/api/campanas/logo' && req.method === 'GET') { const b = AjustesApp.logoDe(url.searchParams.get('slug')); if (!b) return send(res, 404, { error: 'Sin logo' }); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(b); }
      // Referencias visuales que mandan las IA por MCP (solo imágenes, dentro de su carpeta).
      const rf = p.match(/^\/api\/estudio\/ref\/(\d+)\/([\w.-]+\.(?:jpg|png|webp|gif))$/);
      if (rf && req.method === 'GET') {
        const f = path.join(ARCHIVOS, 'Estudio', '_mcp', 'referencias', rf[1], rf[2]);
        if (!existsSync(f)) return send(res, 404, { error: 'No existe' });
        res.writeHead(200, { 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[rf[2].split('.').pop()], 'Cache-Control': 'max-age=86400' });
        return createReadStream(f).pipe(res);
      }
      // Archivos de un proyecto del Estudio (fotogramas, voz, miniatura, vídeos con avance/retroceso).
      const ea = p.match(/^\/api\/estudio\/archivo\/([a-z0-9-]+)\/(.+)$/);
      if (ea && req.method === 'GET') {
        const f = Estudio.archivo(ea[1], decodeURIComponent(ea[2]));
        if (!f) return send(res, 404, { error: 'No existe' });
        const tipo = { '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }[path.extname(f)] || 'application/octet-stream';
        const total = statSync(f).size, rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (rango && (tipo.startsWith('video') || tipo.startsWith('audio'))) {
          const ini = rango[1] ? Number(rango[1]) : Math.max(0, total - Number(rango[2])), fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), total - 1) : total - 1;
          res.writeHead(206, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${ini}-${fin}/${total}`, 'Content-Length': fin - ini + 1 });
          return createReadStream(f, { start: ini, end: fin }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': total, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...(url.searchParams.get('descargar') ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` } : {}) });
        return createReadStream(f).pipe(res);
      }
      // Vídeo de un clip (con Range para poder avanzar en el reproductor); ?descargar=1 lo baja con su nombre.
      const cv = p.match(/^\/api\/clips\/video\/(\d+)\/(\d+)$/);
      const rcv = p.match(/^\/api\/recop\/(clip|video)\/(\d+)$/);
      const chv = p.match(/^\/api\/clips\/horizontal\/(\d+)\/(\d+)$/);
      const epx = p.match(/^\/api\/editor\/proxy\/(\d+)\/(\d+)$/);
      if (p === '/api/editor/fuente.ttf' && req.method === 'GET') {
        const fuente = path.join(path.dirname(ajustes()['clips.salida']), 'fonts', 'Montserrat-ExtraBold.ttf');
        return send(res, 200, await readFile(fuente), 'font/ttf', { 'Cache-Control': 'public, max-age=31536000, immutable' });
      }
      // Miniatura de un clip (un fotograma a 1,5 s), generada una vez y guardada: la galería no muestra cuadros negros.
      // Recurso del editor (imagen o audio subido): se sirve tal cual.
      const rec = p.match(/^\/api\/editor\/recurso\/([a-f0-9]{24}\.(png|jpg|webp|mp3|m4a|wav|ogg|mp4|webm|mov))$/);
      if (rec && req.method === 'GET') { const f = Editor.rutaRecurso(rec[1]); if (!f) return send(res, 404, { error: 'No existe' });
        if (/^(mp4|webm|mov)$/.test(rec[2])) {
          const total = statSync(f).size, tipo = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[rec[2]], m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
          if (m) { const ini = Number(m[1]), fin = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1; res.writeHead(206, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${ini}-${fin}/${total}`, 'Content-Length': fin - ini + 1 }); return createReadStream(f, { start: ini, end: fin }).pipe(res); }
          res.writeHead(200, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Length': total }); return createReadStream(f).pipe(res);
        }
        return send(res, 200, await readFile(f), { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[rec[2]], { 'Cache-Control': 'public, max-age=31536000, immutable' }); }
      const cpo = p.match(/^\/api\/clips\/poster\/(\d+)\/(\d+)$/);
      if (cpo && req.method === 'GET') {
        const fc = Clips.archivoClip(cpo[1], cpo[2]); if (!fc) return send(res, 404, { error: 'No existe' });
        // ?h=1: miniatura de la versión 16:9 (la del recopilatorio, la del editor o el propio clip si ya es horizontal).
        const h16 = /[?&]h=1\b/.test(req.url);
        let ruta = fc.ruta;
        if (h16) { const r = Recop.porClip()[`${cpo[1]}-${cpo[2]}`]; let eh = null; try { eh = Editor.archivoHorizontal(cpo[1], cpo[2]); } catch {} ruta = (r?.estado === 'listo' && Recop.archivoClip(r.id)) || eh || ruta; }
        const dir = path.join(DATOS, 'posters'); mkdirSync(dir, { recursive: true });
        if (!existsSync(ruta)) { let eh = null; try { eh = Editor.archivoHorizontal(cpo[1], cpo[2]); } catch {} if (eh && existsSync(eh)) ruta = eh; } // sin vertical: la del 16:9
        const pref = `${cpo[1]}-${cpo[2]}${h16 ? '-h' : ''}-`;
        let dest = existsSync(ruta) ? path.join(dir, `${pref}${Math.round(statSync(ruta).mtimeMs)}.jpg`) : null;
        if (dest && !existsSync(dest)) await generarPoster(ruta, dest, h16);
        // Si no se pudo (vídeo re-renderizado con el servidor muy cargado, o sin archivo): la última miniatura que haya.
        if (!dest || !existsSync(dest)) { const vieja = readdirSync(dir).filter((x) => x.startsWith(pref)).sort().pop(); dest = vieja ? path.join(dir, vieja) : null; }
        if (!dest) return send(res, 404, { error: 'Sin miniatura' });
        // ?w=160–480: miniatura comprimida (WebP de ese ancho) para las cuadrículas de los clientes nativos; se guarda junto al póster.
        const ancho = Number(url.searchParams.get('w'));
        if (ancho >= 120 && ancho <= 640) {
          const w = Math.round(ancho / 40) * 40, mini = dest.replace(/.jpg$/, `-w${w}.webp`);
          if (!existsSync(mini)) await new Promise((ok) => execFile('nice', ['-n', '15', 'ffmpeg', '-v', 'error', '-y', '-i', dest, '-vf', `scale=${w}:-2`, '-c:v', 'libwebp', '-quality', '62', mini], { timeout: 20000 }, () => ok()));
          if (existsSync(mini)) return send(res, 200, await readFile(mini), 'image/webp', { 'Cache-Control': 'public, max-age=604800' });
        }
        return send(res, 200, await readFile(dest), 'image/jpeg', { 'Cache-Control': 'public, max-age=604800' });
      }
      if ((cv || rcv || chv || epx) && req.method === 'GET') {
        let f = cv ? Clips.archivoClip(cv[1], cv[2]) : null;
        if (chv) { const ruta = Editor.archivoHorizontal(chv[1], chv[2]); f = ruta ? { ruta, nombre: path.basename(ruta) } : null; }
        if (epx) { const ruta = await Editor.proxy(epx[1], epx[2], url.searchParams.get('desde'), url.searchParams.get('hasta')); f = { ruta, nombre: path.basename(ruta) }; }
        if (rcv) { const ruta = rcv[1] === 'clip' ? Recop.archivoClip(rcv[2]) : Recop.archivoRecop(rcv[2]); f = ruta ? { ruta, nombre: path.basename(ruta) } : null; }
        if (!f) return send(res, 404, { error: 'No existe' });
        const total = statSync(f.ruta).size;
        const extra = url.searchParams.get('descargar') ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.nombre)}` } : {};
        const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (rango) {
          const ini = rango[1] ? Number(rango[1]) : Math.max(0, total - Number(rango[2]));
          const fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), total - 1) : total - 1;
          if (ini >= total || ini > fin) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
          res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${ini}-${fin}/${total}`, 'Content-Length': fin - ini + 1, ...extra });
          return createReadStream(f.ruta, { start: ini, end: fin }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': total, ...extra });
        return createReadStream(f.ruta).pipe(res);
      }
      const h = rutas[`${req.method} ${p}`];
      if (!h) return send(res, 404, { error: 'No encontrado' });
      return send(res, 200, await h(req, url));
    }

    // Archivos estáticos del panel
    // Carpetas (p. ej. /v2/, la interfaz social): su index.html.
    if (p === '/v2') return send(res, 301, '', 'text/plain', { Location: '/v2/' });
    // Interfaz web (v2) en «/».
    const archivo = path.normalize(path.join(PUBLIC, p === '/' ? 'v2/index.html' : p.endsWith('/') ? `${p}index.html` : p));
    if (!archivo.startsWith(PUBLIC)) return send(res, 403, 'Prohibido', 'text/plain');
    // Las fuentes no cambian: caché de un año (el resto del panel, sin caché, para ver siempre la última versión).
    const fuente = path.extname(archivo) === '.woff2';
    try { return send(res, 200, await readFile(archivo), TIPOS[path.extname(archivo)] || 'application/octet-stream', fuente ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}); }
    catch { return send(res, 200, await readFile(path.join(PUBLIC, 'v2', 'index.html')), TIPOS['.html']); }
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// Al arrancar: aviso amable (sin parar el servidor) si faltan las herramientas externas que usan los recortes.
function comprobarHerramientas() {
  for (const [cmd, arg, para] of [['ffmpeg', '-version', 'recortar, montar y hacer miniaturas'], ['yt-dlp', '--version', 'descargar vídeos de YouTube y Twitch']]) {
    execFile(cmd, [arg], { timeout: 10000 }, (e) => {
      if (e && (e.code === 'ENOENT' || e.errno === -2)) console.warn(`Aviso: no encuentro «${cmd}» en el PATH. El panel funciona, pero hace falta para ${para}. Instálalo y reinicia StreamClipper.`);
    });
  }
}
server.listen(PORT, HOST, () => {
  console.log(`StreamClipper en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  ·  modelos: ${ajustes()['llm.url']}`);
  console.log(`Papel del proceso: ${Rol.ROL}`);
  comprobarHerramientas();
  if (Rol.conTrabajos && process.env.SIN_PLANIFICADOR !== '1') iniciarPlanificador();
  if (Rol.ROL !== 'trabajos' && process.env.SIN_PLANIFICADOR !== '1') Autoprueba.alArrancar(PORT); // a los 2 min: API y pantallas, en ordenador y móvil
});
export { AJUSTES_POR_DEFECTO };
