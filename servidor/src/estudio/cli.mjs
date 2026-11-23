// Órdenes del Estudio para la skill «estudio-videos» (se ejecutan en el servidor por SSH):
//   node src/estudio/cli.mjs pendientes                  → qué hay que revisar y producir (JSON)
//   node src/estudio/cli.mjs ver <slug>                  → proyecto actual + comentarios (JSON)
//   node src/estudio/cli.mjs proponer <proyecto.json>    → nueva propuesta o nueva versión (renderiza lo que se revisa)
//   node src/estudio/cli.mjs producir <slug>             → vídeo, shorts, textos y miniatura en su carpeta (largo: usar nohup)
//   node src/estudio/cli.mjs estado <slug>               → estado y paso actual
//   node src/estudio/cli.mjs muestra <proyecto.json> <escena> [vertical] → un fotograma suelto para comprobar un diseño
import { readFileSync } from 'node:fs';
import * as E from './estudio.mjs';
import * as R from './render.mjs';

const [orden, a1, a2] = process.argv.slice(2);
const json = (x) => console.log(JSON.stringify(x, null, 2));
try {
  if (orden === 'pendientes') json(E.pendientes());
  else if (orden === 'ver') { const p = E.uno(a1); if (!p) throw new Error('No existe'); json({ ...p, comentarios: E.comentarios(p.id), archivos: E.archivosFinales(a1) }); }
  else if (orden === 'proponer') json(await E.proponer(JSON.parse(readFileSync(a1, 'utf8'))));
  else if (orden === 'producir') json(await E.producir(a1));
  else if (orden === 'galeria') json(E.registrarEnGaleria(a1));
  else if (orden === 'estado') { const p = E.uno(a1); json(p ? { estado: p.estado, paso: p.paso, error: p.error, version: p.version } : null); }
  else if (orden === 'muestra') { const p = JSON.parse(readFileSync(a1, 'utf8')); const e = p.escenas.find((x) => x.id === a2); const out = `/tmp/muestra-${a2}.png`; await R.fotograma(p, e, out, { vertical: process.argv[5] === 'vertical' }); json({ png: out }); }
  else { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n')); process.exit(1); }
  process.exit(0);
} catch (e) { console.error('ERROR:', e.message); process.exit(2); }
