// Valoración de clips por el editor: "Sirve" / "No sirve" con motivos. Sirve para tres cosas:
//  1. Aprender: las lecciones (motivos más repetidos y ejemplos) se añaden al enfoque que recibe Gemini en los
//     siguientes vídeos del mismo tipo y canal.
//  2. Proteger: un clip descartado no se publica en YouTube (ni a mano ni automático).
//  3. Ordenar: su copia en la carpeta compartida pasa a la subcarpeta "Descartados".
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { db, ajustes } from '../db.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS clip_valoraciones (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES clip_videos(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  valor INTEGER NOT NULL,                  -- 1 sirve · -1 no sirve
  etiquetas TEXT NOT NULL DEFAULT '[]',    -- motivos (claves de MOTIVOS)
  nota TEXT NOT NULL DEFAULT '',
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (video_id, n)
);`);

// clave → [texto en el panel, instrucción para Gemini (null = problema técnico, no de selección)]
export const MOTIVOS = {
  sin_contexto: ['No se entiende sin contexto', 'Cada clip debe entenderse solo, sin haber visto el resto: nada que empiece a mitad de una historia o que dependa de algo dicho antes.'],
  gancho_flojo: ['El gancho es flojo o empieza tarde', 'Los dos primeros segundos deben ser lo más fuerte del clip; si el momento tarda en llegar, empieza más tarde o descártalo.'],
  corte_malo: ['Corta a mitad de una frase o idea', 'Empieza donde arranca la idea y termina cuando se cierra (el remate o la conclusión), nunca a mitad de frase.'],
  aburrido: ['Aburrido, no pasa nada', 'Solo momentos con un pico claro (risa, polémica, sorpresa, una revelación o un consejo concreto); descarta los tramos tibios aunque el tema sea interesante.'],
  repetido: ['Repetido o muy parecido a otro', 'No elijas dos clips del mismo momento, chiste o tema; cada clip debe aportar algo distinto.'],
  largo: ['Demasiado largo', 'Prefiere clips más cortos: quita la introducción y lo que sobra después del remate.'],
  corto: ['Demasiado corto', 'Deja algo más de contexto antes del momento fuerte para que se entienda.'],
  sensible: ['Tema sensible o inapropiado', 'Evita temas sensibles, insultos graves o contenido que pueda ofender o meter al canal en problemas.'],
  encuadre: ['Encuadre malo (cara o contenido cortado)', null],
  subtitulos: ['Subtítulos mal', null],
};

export const valoraciones = {
  deVideo: (videoId) => db.prepare('SELECT n, valor, etiquetas, nota FROM clip_valoraciones WHERE video_id = ?').all(Number(videoId))
    .map((v) => ({ ...v, etiquetas: JSON.parse(v.etiquetas) })),
  uno: (videoId, n) => db.prepare('SELECT valor FROM clip_valoraciones WHERE video_id = ? AND n = ?').get(Number(videoId), Number(n)),
  guardar({ id, n, valor, etiquetas = [], nota = '' }, { carpeta, copia } = {}) {
    valor = Number(valor) === 1 ? 1 : Number(valor) === -1 ? -1 : 0;
    if (!valor) { // quitar la valoración
      db.prepare('DELETE FROM clip_valoraciones WHERE video_id = ? AND n = ?').run(Number(id), Number(n));
      moverCopia(carpeta, copia, false);
      return null;
    }
    const tags = valor === -1 ? [...new Set(etiquetas.filter((e) => MOTIVOS[e]))] : [];
    db.prepare(`INSERT INTO clip_valoraciones (video_id, n, valor, etiquetas, nota) VALUES (?,?,?,?,?)
      ON CONFLICT(video_id, n) DO UPDATE SET valor = excluded.valor, etiquetas = excluded.etiquetas, nota = excluded.nota, fecha = datetime('now')`)
      .run(Number(id), Number(n), valor, JSON.stringify(tags), String(nota || '').trim().slice(0, 300));
    moverCopia(carpeta, copia, valor === -1);
    // Un clip descartado sale de la cola de YouTube si aún no se subió.
    if (valor === -1) db.prepare("UPDATE clip_subidas SET estado = 'error', error = 'Descartado por el editor' WHERE video_id = ? AND n = ? AND estado IN ('pendiente')").run(Number(id), Number(n));
    return { valor, etiquetas: tags };
  },
};

// La copia de la carpeta compartida entra o sale de "Descartados".
function moverCopia(carpeta, copia, descartar) {
  if (!carpeta || !copia) return;
  const normal = path.join(carpeta, copia), desc = path.join(carpeta, 'Descartados', copia);
  try {
    if (descartar && existsSync(normal)) { mkdirSync(path.dirname(desc), { recursive: true }); renameSync(normal, desc); }
    if (!descartar && existsSync(desc)) renameSync(desc, normal);
  } catch (e) { console.error('Clips: no se pudo mover la copia:', e.message); }
}

// Lecciones para Gemini a partir de las valoraciones del mismo tipo (y, si las hay, del mismo canal).
export function lecciones({ tipo, canalId }) {
  const filas = db.prepare(`SELECT cv.valor, cv.etiquetas, cv.nota, cv.n, v.clips, v.canal_id FROM clip_valoraciones cv
    JOIN clip_videos v ON v.id = cv.video_id WHERE v.tipo = ? ORDER BY cv.fecha DESC LIMIT 200`).all(tipo);
  if (!filas.length) return '';
  const prioridad = (f) => (canalId && f.canal_id === canalId ? 0 : 1);
  filas.sort((a, b) => prioridad(a) - prioridad(b));
  const cuenta = {};
  for (const f of filas.filter((x) => x.valor === -1)) for (const e of JSON.parse(f.etiquetas)) cuenta[e] = (cuenta[e] || 0) + 1;
  const reglas = Object.entries(cuenta).filter(([e]) => MOTIVOS[e]?.[1]).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([e, n]) => `- ${MOTIVOS[e][1]} (descartados por esto: ${n})`);
  const ejemplo = (f) => {
    const c = JSON.parse(f.clips || '[]').find((x) => x.n === f.n);
    if (!c) return null;
    const motivos = JSON.parse(f.etiquetas).map((e) => MOTIVOS[e]?.[0]).filter(Boolean).join(', ');
    return `- «${c.titulo}»${c.gancho ? ` (gancho: «${c.gancho}»)` : ''}${motivos ? ` → ${motivos}` : ''}${f.nota ? `; nota del editor: ${f.nota}` : ''}`;
  };
  const malos = filas.filter((f) => f.valor === -1).map(ejemplo).filter(Boolean).slice(0, 5);
  const buenos = filas.filter((f) => f.valor === 1).map(ejemplo).filter(Boolean).slice(0, 4);
  const partes = ['LECCIONES DEL EDITOR (sus valoraciones de clips anteriores de este tipo de vídeo; tenlas muy en cuenta):'];
  if (reglas.length) partes.push(...reglas);
  if (malos.length) partes.push('Clips que el editor DESCARTÓ (no elijas momentos parecidos):', ...malos);
  if (buenos.length) partes.push('Clips que SÍ le sirvieron (busca momentos de este estilo):', ...buenos);
  // Lo que dicen las estadísticas del canal (qué clips retienen y traen suscriptores): la escribe Claude tras analizarlas.
  const estrategia = String(ajustes()['canal.estrategia'] || '').trim();
  if (estrategia) partes.push('ESTRATEGIA DEL CANAL (según sus estadísticas reales; prioriza momentos que encajen):', estrategia.slice(0, 1500));
  return partes.length > 1 ? partes.join('\n') : '';
}

// Resumen para el panel: cuántos sirven / no sirven y los motivos más repetidos, por tipo.
export function resumen() {
  const filas = db.prepare('SELECT cv.valor, cv.etiquetas, v.tipo FROM clip_valoraciones cv JOIN clip_videos v ON v.id = cv.video_id').all();
  const out = {};
  for (const f of filas) {
    const t = (out[f.tipo] ||= { sirven: 0, noSirven: 0, motivos: {} });
    if (f.valor === 1) t.sirven++; else { t.noSirven++; for (const e of JSON.parse(f.etiquetas)) t.motivos[e] = (t.motivos[e] || 0) + 1; }
  }
  return out;
}
