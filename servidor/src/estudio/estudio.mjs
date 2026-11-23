// Estudio de vídeos horizontales: proyectos (propuesta → cambios → aprobado → producción → terminado), comentarios del
// editor por escena y carpeta de cada proyecto en la carpeta compartida (<ARCHIVOS_DIR>/Estudio/<slug>/).
// Lo usan el panel (revisión) y la skill «estudio-videos» de Claude Code (por SSH, con cli.mjs).
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { db, ARCHIVOS } from '../db.mjs';
import { avisarSinFallo } from '../avisos.mjs';
import * as R from './render.mjs';

export const RAIZ = path.join(ARCHIVOS, 'Estudio');
db.exec(`
CREATE TABLE IF NOT EXISTS estudio_proyectos (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  formato TEXT NOT NULL DEFAULT 'decisiones',     -- decisiones | finanzas
  estado TEXT NOT NULL DEFAULT 'propuesta',       -- propuesta | cambios | aprobado | produciendo | terminado | descartado | error
  version INTEGER NOT NULL DEFAULT 1,
  json TEXT NOT NULL,                              -- el proyecto (guion por escenas, estilo, shorts, publicación)
  paso TEXT, error TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')), actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS estudio_comentarios (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES estudio_proyectos(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  escena TEXT,                                     -- id de escena, 'miniatura', 'titulo'… o NULL (general)
  texto TEXT NOT NULL,
  atendido INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const carpeta = (slug) => path.join(RAIZ, slug);
const dirVersion = (slug, v) => path.join(carpeta(slug), 'propuesta', `v${v}`);
const parse = (p) => p && { ...p, proyecto: JSON.parse(p.json), json: undefined };
const permisos = (f) => { try { chmodSync(f, 0o2775); } catch {} };

export const uno = (slug) => parse(db.prepare('SELECT * FROM estudio_proyectos WHERE slug = ?').get(slug));
export const lista = () => db.prepare('SELECT id, slug, titulo, formato, estado, version, paso, error, creado, actualizado FROM estudio_proyectos ORDER BY actualizado DESC').all();
export const comentarios = (id) => db.prepare('SELECT * FROM estudio_comentarios WHERE proyecto_id = ? ORDER BY id').all(id);

// Validación mínima del proyecto que escribe la skill (el resto lo comprueba el render).
const TIPOS = ['portada', 'cifra', 'lista', 'linea', 'cita', 'comparacion', 'texto', 'ilustrada', 'anime', 'pintada', 'hyperframes'];
export function validar(p) {
  const err = [];
  if (!/^[a-z0-9-]{3,60}$/.test(p.slug || '')) err.push('slug: minúsculas, números y guiones (3-60)');
  if (!p.titulo) err.push('falta titulo');
  if (!['decisiones', 'finanzas', 'actualidad'].includes(p.formato)) err.push('formato: decisiones | finanzas | actualidad');
  if (!Array.isArray(p.escenas) || !p.escenas.length) err.push('faltan escenas');
  for (const e of p.escenas || []) {
    if (!e.id || !e.narracion) err.push(`escena ${e.id || '?'}: falta id o narracion`);
    if (!TIPOS.includes(e.visual?.tipo)) err.push(`escena ${e.id}: visual.tipo debe ser ${TIPOS.join(' | ')}`);
  }
  const ids = new Set((p.reparto || []).map((r) => r.id));
  for (const e of p.escenas || []) for (const ap of e.visual?.personajes || []) if (!ids.has(ap.id)) err.push(`escena ${e.id}: el personaje «${ap.id}» no está en reparto`);
  for (const s of p.shorts || []) for (const id of s.escenas || []) if (!p.escenas.some((e) => e.id === id)) err.push(`short ${s.id}: escena ${id} no existe`);
  if (err.length) throw new Error(`Proyecto no válido:\n- ${err.join('\n- ')}`);
}

// Nueva propuesta o nueva versión (atiende los comentarios pendientes). Renderiza lo que el editor revisa:
// un fotograma por escena, la voz de las dos primeras escenas y el boceto de miniatura.
export async function proponer(p, { log = console.log } = {}) {
  validar(p);
  const previo = uno(p.slug);
  if (previo && !['propuesta', 'cambios'].includes(previo.estado)) throw new Error(`«${p.slug}» está ${previo.estado}: no admite otra versión`);
  const version = previo ? previo.version + 1 : 1;
  const dir = dirVersion(p.slug, version);
  mkdirSync(path.join(dir, 'escenas'), { recursive: true }); permisos(carpeta(p.slug));
  // Proyectos hechos con HyperFrames (p.hyperframes = carpeta del proyecto HF en el servidor): el avance y los fotogramas
  // ya están renderizados allí (avance.mp4 y claves/<escena>.png); se copian en vez de renderizarlos aquí.
  const hf = p.hyperframes;
  if (hf) {
    copyFileSync(path.join(hf, 'avance.mp4'), path.join(dir, 'avance.mp4'));
    for (const e of p.escenas) { const f = path.join(hf, 'claves', `${e.id}.png`); if (existsSync(f)) copyFileSync(f, path.join(dir, 'escenas', `${e.id}.png`)); }
    if (existsSync(path.join(hf, 'claves', 'miniatura.png'))) copyFileSync(path.join(hf, 'claves', 'miniatura.png'), path.join(dir, 'miniatura.png'));
  } else for (const e of p.escenas) { await R.fotograma(p, e, path.join(dir, 'escenas', `${e.id}.png`)); log(`fotograma ${e.id}`); }
  // Avance animado con voz: las primeras escenas hasta unos 25 s (el gancho), para juzgar movimiento, ritmo y voz.
  const muestra = { ...p, escenas: p.escenas.slice(0, 4) };
  if (!hf) {
  const a = await R.audioProyecto(muestra, path.join(dir, 'tmp'));
  let n = 0, seg = 0; for (const x of a.tiempos) { if (n && seg + x.duracion > 28) break; seg += x.duracion; n++; }
  log(`avance: ${n} escenas, ${seg.toFixed(1)} s`);
  await R.video(muestra, a, path.join(dir, 'avance.mp4'), { ids: muestra.escenas.slice(0, n).map((e) => e.id), log });
  copyFileSync(a.pista, path.join(dir, 'voz-muestra.wav')); rmSync(path.join(dir, 'tmp'), { recursive: true, force: true }); rmSync(path.join(dir, 'avance.wav'), { force: true });
  await miniatura(p, path.join(dir, 'miniatura.png'));
  }
  if (!hf && (p.reparto || []).length) await R.fotograma(p, { id: 'reparto', narracion: '', visual: { tipo: p.escenas.some((e) => e.visual?.tipo === 'anime') ? 'reparto_anime' : 'reparto' }, duracion_s: 4 }, path.join(dir, 'personajes.png'), { t: 2 });
  if (previo) {
    db.prepare("UPDATE estudio_proyectos SET titulo=?, formato=?, json=?, version=?, estado='propuesta', paso=NULL, error=NULL, actualizado=datetime('now') WHERE id=?").run(p.titulo, p.formato, JSON.stringify(p), version, previo.id);
    db.prepare('UPDATE estudio_comentarios SET atendido = 1 WHERE proyecto_id = ? AND atendido = 0').run(previo.id);
  } else db.prepare('INSERT INTO estudio_proyectos (slug, titulo, formato, json) VALUES (?,?,?,?)').run(p.slug, p.titulo, p.formato, JSON.stringify(p));
  avisarSinFallo(previo ? 'Propuesta revisada' : 'Nueva propuesta de vídeo', `«${p.titulo}»${previo ? ` (versión ${version}, con tus comentarios)` : ''}. Revísala en Estudio.`, { etiquetas: ['clapper'] });
  return { slug: p.slug, version, carpeta: dir };
}

// Miniatura 1280×720: la escena «miniatura» del proyecto (o su portada) a ese tamaño.
async function miniatura(p, png) {
  const e = p.miniatura ? { id: 'miniatura', narracion: '', visual: p.miniatura } : p.escenas.find((x) => x.visual.tipo === 'portada') || p.escenas[0];
  await R.fotograma(p, { ...e, duracion_s: 4 }, png, { ancho: 1280, alto: 720, t: 3.4 });
}

export function comentar(slug, { escena = null, texto }) {
  const p = uno(slug); if (!p) throw new Error('No existe');
  if (!String(texto || '').trim()) throw new Error('Comentario vacío');
  db.prepare('INSERT INTO estudio_comentarios (proyecto_id, version, escena, texto) VALUES (?,?,?,?)').run(p.id, p.version, escena || null, String(texto).trim().slice(0, 2000));
  return { ok: true };
}
export function cambiarEstado(slug, accion) {
  const p = uno(slug); if (!p) throw new Error('No existe');
  const nuevo = { aprobar: 'aprobado', cambios: 'cambios', descartar: 'descartado', reabrir: 'propuesta' }[accion];
  if (!nuevo) throw new Error('Acción no válida');
  if (accion === 'cambios' && !comentarios(p.id).some((c) => !c.atendido)) throw new Error('Escribe al menos un comentario con lo que quieres cambiar');
  if (accion === 'aprobar' && !['propuesta', 'cambios'].includes(p.estado)) throw new Error(`No se puede aprobar: está ${p.estado}`);
  db.prepare("UPDATE estudio_proyectos SET estado=?, actualizado=datetime('now') WHERE id=?").run(nuevo, p.id);
  return { estado: nuevo };
}

// Lo que la skill tiene que hacer: propuestas con cambios pedidos y proyectos aprobados para producir.
export function pendientes() {
  const todos = lista();
  return {
    revisar: todos.filter((p) => p.estado === 'cambios').map((p) => ({ slug: p.slug, titulo: p.titulo, version: p.version, comentarios: comentarios(p.id).filter((c) => !c.atendido).map((c) => ({ escena: c.escena, texto: c.texto })) })),
    producir: todos.filter((p) => p.estado === 'aprobado').map((p) => ({ slug: p.slug, titulo: p.titulo })),
    en_revision_del_editor: todos.filter((p) => p.estado === 'propuesta').map((p) => p.slug),
    produciendo: todos.filter((p) => p.estado === 'produciendo').map((p) => ({ slug: p.slug, paso: p.paso })),
    terminados: todos.filter((p) => p.estado === 'terminado').length,
    descartados_recientes: todos.filter((p) => p.estado === 'descartado').slice(0, 10).map((p) => p.titulo),
    ideas_pedidas: (() => { try { return db.prepare("SELECT id, origen, titulo, formato, angulo, gancho, por_que, fuentes, guion FROM ia_ideas WHERE estado = 'pedida' ORDER BY id").all(); } catch { return []; } })(),
  };
}

// Producción completa de un proyecto aprobado. Deja en su carpeta: video.mp4, shorts/, guion.txt, publicacion.txt,
// miniatura.png, subtitulos.srt (y subtitulos de cada short). `voz` permite usar la voz natural de la laptop.
export async function producir(slug, { voz, log = console.log } = {}) {
  const fila = uno(slug); if (!fila) throw new Error('No existe');
  if (!['aprobado', 'error', 'produciendo'].includes(fila.estado)) throw new Error(`«${slug}» está ${fila.estado}: hay que aprobarlo antes`);
  const p = fila.proyecto, dir = carpeta(slug), tmp = path.join(dir, '.produccion');
  const paso = (t) => { db.prepare("UPDATE estudio_proyectos SET estado='produciendo', paso=?, actualizado=datetime('now') WHERE id=?").run(t, fila.id); log(t); };
  try {
    mkdirSync(path.join(dir, 'shorts'), { recursive: true });
    paso('Generando la voz');
    const a = await R.audioProyecto(p, tmp, { voz });
    if (p.hyperframes) {
      // Proyecto HyperFrames: el vídeo ya está renderizado (completo.mp4, con la voz dentro); los Shorts salen de él en
      // vertical: franja de título arriba, el vídeo a todo el ancho en medio y su propio cierre de color.
      const hf = path.join(p.hyperframes, 'completo.mp4');
      if (!existsSync(hf)) throw new Error(`Falta el render de HyperFrames (${hf})`);
      paso('Copiando el vídeo de HyperFrames');
      copyFileSync(hf, path.join(dir, 'video.mp4'));
      for (const s of p.shorts || []) {
        paso(`Short «${s.titulo}»`);
        // Si hay un render vertical propio del Short (<proyecto HF>-<id>/completo.mp4, compuesto para 9:16), se usa ese;
        // si no, se saca del horizontal con franja de título.
        const vertical = `${p.hyperframes.replace(/\/$/, '')}-${s.id}/completo.mp4`;
        if (existsSync(vertical)) copyFileSync(vertical, path.join(dir, 'shorts', `${s.id}.mp4`));
        else {
          const ts = a.tiempos.filter((x) => s.escenas.includes(x.id)), ini = Math.min(...ts.map((x) => x.inicio)), fin = Math.max(...ts.map((x) => x.inicio + x.duracion));
          await R.shortVertical(path.join(dir, 'video.mp4'), ini, fin - ini, s.titulo, path.join(dir, 'shorts', `${s.id}.mp4`));
        }
        writeFileSync(path.join(dir, 'shorts', `${s.id}.srt`), R.srt(p, a, { ids: s.escenas }));
      }
    } else {
      paso(`Montando el vídeo (${Math.round(a.total / 60)} min)`);
      await R.video(p, a, path.join(dir, 'video.mp4'), { log: (m) => paso(`Montando el vídeo · ${m}`) });
      for (const s of p.shorts || []) {
        paso(`Short «${s.titulo}»`);
        await R.video(p, a, path.join(dir, 'shorts', `${s.id}.mp4`), { vertical: true, ids: s.escenas });
        writeFileSync(path.join(dir, 'shorts', `${s.id}.srt`), R.srt(p, a, { ids: s.escenas }));
      }
    }
    paso('Textos, subtítulos y miniatura');
    writeFileSync(path.join(dir, 'subtitulos.srt'), R.srt(p, a));
    writeFileSync(path.join(dir, 'guion.txt'), p.escenas.map((e) => `${e.capitulo ? `\n## ${e.capitulo}\n\n` : ''}${e.narracion.replace(/\*/g, '')}`).join('\n\n').trim() + '\n');
    const pub = p.publicacion || {};
    writeFileSync(path.join(dir, 'publicacion.txt'), [
      `TÍTULO\n${p.titulo}`, pub.titulos_alternativos?.length ? `\nALTERNATIVAS\n${pub.titulos_alternativos.join('\n')}` : '',
      `\nCAPÍTULOS\n${R.capitulos(p, a).join('\n')}`, `\nDESCRIPCIÓN\n${pub.descripcion || ''}`,
      pub.etiquetas?.length ? `\nETIQUETAS\n${pub.etiquetas.join(', ')}` : '', pub.fuentes?.length ? `\nFUENTES\n${pub.fuentes.join('\n')}` : '',
      (p.shorts || []).length ? `\nSHORTS\n${p.shorts.map((s) => `${s.id}.mp4 · ${s.titulo}${s.descripcion ? `\n  ${s.descripcion}` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n') + '\n');
    if (p.hyperframes && existsSync(path.join(p.hyperframes, 'claves', 'miniatura.png'))) await R.escalarImagen(path.join(p.hyperframes, 'claves', 'miniatura.png'), path.join(dir, 'miniatura.png'), 1280, 720);
    else await miniatura(p, path.join(dir, 'miniatura.png'));
    rmSync(tmp, { recursive: true, force: true });
    db.prepare("UPDATE estudio_proyectos SET estado='terminado', paso=NULL, error=NULL, actualizado=datetime('now') WHERE id=?").run(fila.id);
    try { registrarEnGaleria(slug); } catch (e) { log(`Galería: ${e.message}`); }
    avisarSinFallo('Vídeo terminado', `«${p.titulo}»: vídeo, ${(p.shorts || []).length} shorts, guion, textos y miniatura en Estudio/${slug}`, { etiquetas: ['movie_camera'] });
    return { carpeta: dir, duracion: a.total };
  } catch (e) {
    db.prepare("UPDATE estudio_proyectos SET estado='error', error=?, actualizado=datetime('now') WHERE id=?").run(String(e.message).slice(0, 500), fila.id);
    throw e;
  }
}

// ---------- galería: lo terminado entra como un «vídeo» más de la galería de clips ----------
// Así el vídeo horizontal y sus Shorts se valoran, publican en YouTube (cola, cupo diario) y gestionan igual que los clips.
// Fila en clip_videos con fuente «estudio:<slug>» y tipo «estudio»; cada pieza es un «clip» con su archivo final.
export function registrarEnGaleria(slug) {
  const fila = uno(slug); if (!fila) throw new Error('No existe');
  const p = fila.proyecto, dir = carpeta(slug), pub = p.publicacion || {};
  const dura = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()) || 0; } catch { return 0; } };
  let caps = '';
  try { caps = (readFileSync(path.join(dir, 'publicacion.txt'), 'utf8').match(/CAPÍTULOS\n([\s\S]*?)\n\n/) || [])[1] || ''; } catch {}
  const etiquetas = (pub.etiquetas || []).slice(0, 15);
  const piezas = [];
  if (existsSync(path.join(dir, 'video.mp4'))) {
    const desc = [pub.descripcion || '', caps ? `\nCAPÍTULOS\n${caps}` : '', pub.fuentes?.length ? `\nFUENTES\n${pub.fuentes.map((f) => f.split(' (')[0]).join('\n')}` : ''].filter(Boolean).join('\n');
    piezas.push({ n: 1, archivo: '', final: path.join(dir, 'video.mp4'), formato: 'horizontal', titulo: p.titulo, gancho: p.titulo, tiktok: (pub.descripcion || '').split('\n')[0],
      instagram: '', inicio: 0, fin: dura(path.join(dir, 'video.mp4')), puntos: null, porque: 'Vídeo largo del Estudio',
      youtube: { titulo: p.titulo, descripcion: desc, etiquetas, sintetico: true, short: false } });
  }
  for (const s of p.shorts || []) {
    const f = path.join(dir, 'shorts', `${s.id}.mp4`); if (!existsSync(f)) continue;
    piezas.push({ n: piezas.length + 1, archivo: '', final: f, formato: 'vertical', titulo: s.titulo, gancho: s.titulo, tiktok: s.descripcion || '', instagram: s.descripcion || '',
      inicio: 0, fin: dura(f), puntos: null, porque: `Short de «${p.titulo}»`,
      youtube: { titulo: s.titulo, descripcion: `${s.descripcion || ''}`, etiquetas, sintetico: true, short: true } });
  }
  if (p.ia) for (const x of piezas) x.ia = p.ia;
  const previa = db.prepare('SELECT id FROM clip_videos WHERE fuente = ?').get(`estudio:${slug}`);
  if (previa) db.prepare("UPDATE clip_videos SET titulo=?, clips=?, carpeta=?, estado='listo', terminado=datetime('now') WHERE id=?").run(p.titulo, JSON.stringify(piezas), dir, previa.id);
  else db.prepare("INSERT INTO clip_videos (fuente, titulo, tipo, estado, job, clips, carpeta, terminado) VALUES (?,?,?,'listo',?,?,?,datetime('now'))")
    .run(`estudio:${slug}`, p.titulo, 'estudio', `estudio-${slug}`, JSON.stringify(piezas), dir);
  return { piezas: piezas.length };
}

// Archivo de un proyecto para el panel (dentro de su carpeta, sin salir de ella).
export function archivo(slug, rel) {
  const base = carpeta(slug), f = path.normalize(path.join(base, rel));
  return f.startsWith(base + path.sep) && existsSync(f) ? f : null;
}
export function archivosFinales(slug) {
  const dir = carpeta(slug); if (!existsSync(dir)) return [];
  const out = readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'propuesta' && f !== 'shorts');
  const sh = existsSync(path.join(dir, 'shorts')) ? readdirSync(path.join(dir, 'shorts')).map((f) => `shorts/${f}`) : [];
  return [...out, ...sh];
}
