// Ajustes de la app (fase 2): lectura con valores y origen, guardado de uno en uno y ajustes de campaña.
import { db, ajustes, AJUSTES_POR_DEFECTO, ARCHIVOS, columna } from './db.mjs';
import { REGISTRO, CATEGORIAS, POR_CLAVE, CAMPANA_CAMPOS, CANAL_CAMPOS, normalizar } from './ajustes-registro.mjs';

const guardados = () => new Set(db.prepare('SELECT clave FROM ajustes').all().map((r) => r.clave));
const leer = (o, ruta) => ruta.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function poner(o, ruta, v) { const ks = ruta.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] = (x[k] && typeof x[k] === 'object') ? x[k] : {}; x[ks.at(-1)] = v; }

export function registro() {
  const a = ajustes({ crudo: true }), g = guardados();
  const lista = REGISTRO.map((r) => ({
    ...r, valor: r.tipo === 'secreto' ? (a[r.clave] ? '__guardada__' : '') : a[r.clave],
    cambiado: g.has(r.clave) && JSON.stringify(a[r.clave]) !== JSON.stringify(r.defecto),
  }));
  return { categorias: CATEGORIAS, ajustes: lista, campanas: campanas(), streamers: streamers() };
}

export function guardarUno(clave, valor, { defecto = false } = {}) {
  const r = POR_CLAVE[clave]; if (!r) throw new Error('Ese ajuste no existe');
  if (defecto) { db.prepare('DELETE FROM ajustes WHERE clave = ?').run(clave); return { valor: AJUSTES_POR_DEFECTO[clave] ?? r.defecto, cambiado: false }; }
  if (r.tipo === 'secreto' && valor === '__guardada__') return { valor, cambiado: true };
  const v = normalizar(clave, valor);
  db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, JSON.stringify(v));
  return { valor: r.tipo === 'secreto' ? (v ? '__guardada__' : '') : v, cambiado: JSON.stringify(v) !== JSON.stringify(r.defecto) };
}

// ---------- campañas ----------
export function campanas() {
  return db.prepare('SELECT slug, nombre, activa, publicar, config FROM campanas ORDER BY creada').all().map((c) => {
    let cfg = {}; try { cfg = JSON.parse(c.config || '{}'); } catch {}
    return {
      slug: c.slug, nombre: c.nombre,
      campos: CAMPANA_CAMPOS.map((f) => ({
        ...f, valor: f.ruta === 'estado' ? (c.activa && c.publicar ? 'activa' : 'pausada') : f.ruta === 'nombre' ? c.nombre
          : f.tipo === 'lista' ? (leer(cfg, f.ruta) || []).join(' ') : leer(cfg, f.ruta) ?? '',
      })),
    };
  });
}

export function guardarCampana(slug, ruta, valor) {
  const c = db.prepare('SELECT * FROM campanas WHERE slug = ?').get(slug); if (!c) throw new Error('Esa campaña no existe');
  const f = CAMPANA_CAMPOS.find((x) => x.ruta === ruta); if (!f) throw new Error('Ese ajuste de campaña no existe');
  if (ruta === 'estado') { const on = valor === 'activa' ? 1 : 0; db.prepare('UPDATE campanas SET activa = ?, publicar = ? WHERE slug = ?').run(on, on, slug); return { valor }; }
  if (ruta === 'nombre') { const n = String(valor || '').trim(); if (!n) throw new Error('El nombre no puede quedar vacío'); db.prepare('UPDATE campanas SET nombre = ? WHERE slug = ?').run(n, slug); return { valor: n }; }
  let v;
  if (f.tipo === 'num') { v = Number(String(valor).replace(',', '.')); if (!Number.isFinite(v)) throw new Error(`«${f.titulo}»: tiene que ser un número`); if (f.min != null && v < f.min) throw new Error(`«${f.titulo}»: mínimo ${f.min}`); if (f.max != null && v > f.max) throw new Error(`«${f.titulo}»: máximo ${f.max}`); }
  else if (f.tipo === 'hora') { v = String(valor).trim(); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`«${f.titulo}»: hora como 18:00`); }
  else if (f.tipo === 'opcion') { v = String(valor); if (!f.opciones.some(([o]) => o === v)) throw new Error('Opción no válida'); }
  else if (f.tipo === 'lista') v = String(valor || '').split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  else if (ruta === 'juego.regex') { v = String(valor || '').trim(); try { new RegExp(v, 'i'); } catch { throw new Error('La expresión regular no es válida'); } }
  else v = String(valor ?? '').trim();
  let cfg = {}; try { cfg = JSON.parse(c.config || '{}'); } catch {}
  poner(cfg, ruta, v);
  db.prepare('UPDATE campanas SET config = ? WHERE slug = ?').run(JSON.stringify(cfg), slug);
  return { valor: f.tipo === 'lista' ? v.join(' ') : v };
}

// ---------- streamers ----------
columna('clip_canales', 'esperar_ia', 'INTEGER'); // NULL = como la app · 1 sí · 0 no
const opcCampanas = () => [['', 'Ninguna (StreamClipper)'], ...db.prepare('SELECT slug, nombre FROM campanas ORDER BY nombre').all().map((c) => [c.slug, c.nombre])];
const BOOL_CANAL = new Set(['activo', 'sin_cara', 'aprobar', 'vivo', 'horizontal']);

export function streamers() {
  const opc = opcCampanas();
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM clip_videos v WHERE v.canal_id = c.id AND v.estado = 'listo') listos FROM clip_canales c ORDER BY c.activo DESC, c.nombre COLLATE NOCASE`).all().map((c) => ({
    id: c.id, nombre: c.nombre, activo: !!c.activo, campana: c.campana, twitch: /twitch\.tv\//i.test(c.url), listos: c.listos,
    campos: CANAL_CAMPOS.map((f) => ({ ...f, ...(f.ruta === 'campana' ? { opciones: opc } : {}),
      valor: BOOL_CANAL.has(f.ruta) ? !!c[f.ruta] : f.ruta === 'esperar_ia' ? (c.esperar_ia == null ? '' : String(c.esperar_ia)) : f.ruta === 'prioridad' ? String(Math.min(5, c.prioridad || 3)) : (c[f.ruta] ?? '') })),
  }));
}

const urlValida = (u) => /^https:\/\/(www\.)?(youtube\.com\/(@[\w.-]+|channel\/[\w-]+)(\/(videos|streams))?|twitch\.tv\/[\w]+)\/?$/i.test(u);
function normalizarUrl(u) {
  u = String(u || '').trim().replace(/\/$/, '');
  if (/^@[\w.-]+$/.test(u)) u = `https://www.youtube.com/${u}`;
  if (/youtube\.com\/(@[\w.-]+|channel\/[\w-]+)$/i.test(u)) u += '/videos';
  if (!/^https:/.test(u)) u = `https://${u.replace(/^http:\/\//, '')}`;
  return u;
}

export function guardarCanal(id, ruta, valor) {
  const c = db.prepare('SELECT * FROM clip_canales WHERE id = ?').get(Number(id)); if (!c) throw new Error('Ese streamer no existe');
  const f = CANAL_CAMPOS.find((x) => x.ruta === ruta); if (!f) throw new Error('Ese ajuste no existe');
  let v;
  if (BOOL_CANAL.has(ruta)) v = valor === true || valor === 'true' ? 1 : 0;
  else if (ruta === 'esperar_ia') v = valor === '' || valor == null ? null : Number(valor) ? 1 : 0;
  else if (ruta === 'campana') { v = valor || null; if (v && !db.prepare('SELECT 1 FROM campanas WHERE slug = ?').get(v)) throw new Error('Esa campaña no existe'); }
  else if (ruta === 'prioridad') v = Math.min(5, Math.max(1, Number(valor) || 3));
  else if (f.tipo === 'num') { v = Number(valor); if (!Number.isFinite(v) || v < f.min || v > f.max) throw new Error(`«${f.titulo}»: entre ${f.min} y ${f.max}`); }
  else if (ruta === 'url') { v = normalizarUrl(valor); if (!urlValida(v)) throw new Error('Pon la dirección del canal de YouTube (@nombre) o de Twitch'); }
  else if (ruta === 'tipo') { if (!f.opciones.some(([o]) => o === valor)) throw new Error('Tipo no válido'); v = valor; }
  else { v = String(valor ?? '').trim().slice(0, ruta === 'enfoque' ? 600 : 120); if (ruta === 'nombre' && !v) throw new Error('Falta el nombre'); }
  db.prepare(`UPDATE clip_canales SET ${ruta} = ? WHERE id = ?`).run(v, c.id);
  if (['url', 'activo', 'vivo'].includes(ruta)) db.prepare('UPDATE clip_canales SET revisado = NULL WHERE id = ? AND ? = 1').run(c.id, ruta === 'url' ? 1 : 0);
  return { valor: BOOL_CANAL.has(ruta) ? !!v : v == null ? '' : ruta === 'prioridad' || ruta === 'esperar_ia' ? String(v) : v };
}

export function crearCanal({ nombre, url, campana, tipo }) {
  const n = String(nombre || '').trim().slice(0, 120); if (!n) throw new Error('Falta el nombre');
  const u = normalizarUrl(url); if (!urlValida(u)) throw new Error('Pon la dirección del canal de YouTube (@nombre) o de Twitch');
  const sinPestana = (x) => x.replace(/\/(videos|streams)\/?$/i, '').replace(/\/$/, '').toLowerCase();
  const base = sinPestana(u);
  const ya = db.prepare('SELECT nombre, url FROM clip_canales').all().find((c) => sinPestana(c.url) === base);
  if (ya) throw new Error(`Ese canal ya está en la lista (${ya.nombre})`);
  const camp = campana && db.prepare('SELECT 1 FROM campanas WHERE slug = ?').get(campana) ? campana : null;
  const t = ['gaming', 'reaccion', 'conversacion', 'formativo', 'general'].includes(tipo) ? tipo : 'gaming';
  return { id: Number(db.prepare('INSERT INTO clip_canales (nombre, url, tipo, campana, aprobar) VALUES (?, ?, ?, ?, 1)').run(n, u, t, camp).lastInsertRowid) };
}
export function borrarCanal(id) { db.prepare('UPDATE clip_canales SET activo = 0 WHERE id = ?').run(Number(id)); return { ok: true }; }

// ---------- crear campaña ----------
export function crearCampana({ nombre, idioma }) {
  const n = String(nombre || '').trim().slice(0, 80); if (!n) throw new Error('Falta el nombre de la campaña');
  let slug = n.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'campana';
  for (let i = 2; db.prepare('SELECT 1 FROM campanas WHERE slug = ?').get(slug); i++) slug = `${slug.replace(/-\d+$/, '')}-${i}`;
  const cfg = { idioma: ['en', 'es', 'pt', 'fr', 'de', 'it'].includes(idioma) ? idioma : 'en', juego: { nombre: '', regex: '' }, hashtags: [], categoria: '20', por_dia: 3,
    horario: { zona: 'America/New_York', desde: '18:00', hasta: '22:00' }, min_dias_publicado: 30, nota_min: 0.45, tramos: { minutos: 15, cuantos: 3 }, enfoque: '', enlace: '', pago: '',
    logo: { archivo: '', ancho: 760, margen: 14 }, twitch: { horas: 24, min_vistas: 200, min_seg: 20, max_por_canal: 3 } };
  db.prepare('INSERT INTO campanas (slug, nombre, activa, publicar, config) VALUES (?, ?, 0, 0, ?)').run(slug, n, JSON.stringify(cfg));
  return { slug };
}

// ---------- logo de campaña (subirlo desde la app) ----------
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const RAIZ_CAMPANAS = path.join(ARCHIVOS, 'Clips', 'Campanas');
export function subirLogo(slug, nombre, base64) {
  const c = db.prepare('SELECT config FROM campanas WHERE slug = ?').get(slug); if (!c) throw new Error('Esa campaña no existe');
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!png) throw new Error('El logo tiene que ser un PNG (mejor con fondo transparente)');
  if (buf.length > 15e6) throw new Error('El logo pesa demasiado (máximo 15 MB)');
  const dir = path.join(RAIZ_CAMPANAS, slug, 'logo'); mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `logo-${Date.now()}.png`); writeFileSync(f, buf);
  let cfg = {}; try { cfg = JSON.parse(c.config || '{}'); } catch {}
  cfg.logo = { ancho: 760, margen: 14, ...(cfg.logo || {}), archivo: f };
  db.prepare('UPDATE campanas SET config = ? WHERE slug = ?').run(JSON.stringify(cfg), slug);
  return { ok: true, archivo: path.basename(String(nombre || f)) };
}
export function logoDe(slug) {
  const c = db.prepare('SELECT config FROM campanas WHERE slug = ?').get(String(slug)); if (!c) return null;
  try { const f = JSON.parse(c.config).logo?.archivo; return f && existsSync(f) ? readFileSync(f) : null; } catch { return null; }
}
