// CLI de estadísticas del canal (lo usa Claude con la skill estadisticas-canal). Salida en JSON.
//   node src/estadisticas/cli.mjs actualizar [días]       descarga vídeos, contadores y analíticas (90 días por defecto)
//   node src/estadisticas/cli.mjs resumen [días]          resumen para analizar (28 días por defecto)
//   node src/estadisticas/cli.mjs estrategia              la estrategia guardada
//   node src/estadisticas/cli.mjs guardar-estrategia <archivo.md>   guarda la estrategia nueva (la usan clips y Estudio)
import { readFileSync } from 'node:fs';
import * as E from './estadisticas.mjs';

const [orden, arg] = process.argv.slice(2);
const salir = (x) => { console.log(JSON.stringify(x, null, 1)); process.exit(0); };
try {
  if (orden === 'actualizar') salir(await E.actualizar({ dias: Number(arg) || 90, log: (m) => console.error(m) }));
  if (orden === 'resumen') salir(E.resumen({ dias: Number(arg) || 28 }));
  if (orden === 'estrategia') salir(E.estrategia());
  if (orden === 'guardar-estrategia') salir(E.guardarEstrategia(readFileSync(arg, 'utf8')));
  console.error('Órdenes: actualizar [días] · resumen [días] · estrategia · guardar-estrategia <archivo>'); process.exit(1);
} catch (e) { console.log(JSON.stringify({ error: e.message })); process.exit(1); }
