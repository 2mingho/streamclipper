// Órdenes de la lista de clips horizontales para la skill «clips-horizontales» (se ejecutan en el servidor por SSH):
//   node src/estudio/horizontales-cli.mjs pendientes                         → cola, elegidos, eligiendo, en curso y errores (JSON)
//   node src/estudio/horizontales-cli.mjs ver <id>                           → una petición completa (JSON)
//   node src/estudio/horizontales-cli.mjs estado <id> <estado> [paso|error]  → analizando | cortando | error | descartado
//   node src/estudio/horizontales-cli.mjs titulo <id> "<título>"             → guarda el título real del vídeo
//   node src/estudio/horizontales-cli.mjs proponer <id> <candidatos.json>    → { titulo, candidatos: [{ inicio, fin, titulo, porque, senales }] }
//   node src/estudio/horizontales-cli.mjs carpeta <id>                       → crea y devuelve la carpeta de salida
//   node src/estudio/horizontales-cli.mjs terminar <id> <clips.json>         → [{ n, archivo, titulo, dur, origen, descripcion }] (archivos en la carpeta)
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import * as H from './horizontales.mjs';

const [orden, a1, a2, a3] = process.argv.slice(2);
const json = (x) => console.log(JSON.stringify(x, null, 2));
try {
  if (orden === 'pendientes') json(H.pendientes());
  else if (orden === 'ver') { const v = H.uno(a1); if (!v) throw new Error('No existe'); json(v); }
  else if (orden === 'estado') json(H.estado(a1, a2, a2 === 'error' ? { error: a3 } : { paso: a3 }));
  else if (orden === 'titulo') { const v = H.uno(a1); if (!v) throw new Error('No existe'); json(H.estado(a1, v.estado, { titulo: a2, paso: v.paso })); }
  else if (orden === 'proponer') { const d = JSON.parse(readFileSync(a2, 'utf8')); json(H.proponer(a1, d.candidatos, d.titulo)); }
  else if (orden === 'carpeta') {
    const v = H.uno(a1); if (!v) throw new Error('No existe');
    const d = H.nombreCarpeta(v); mkdirSync(d, { recursive: true }); try { chmodSync(d, 0o2775); } catch {}
    json({ carpeta: d });
  }
  else if (orden === 'terminar') { const v = H.uno(a1); if (!v) throw new Error('No existe'); json(H.terminar(a1, JSON.parse(readFileSync(a2, 'utf8')), H.nombreCarpeta(v))); }
  else { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n')); process.exit(1); }
  process.exit(0);
} catch (e) { console.error('ERROR:', e.message); process.exit(2); }
