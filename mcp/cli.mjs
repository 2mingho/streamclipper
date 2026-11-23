// Lo que han aportado las IA externas vía MCP (para la skill estudio-videos). node cli.mjs [dias]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DATOS = process.env.DATOS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'servidor', 'datos');
const db = new DatabaseSync(path.join(DATOS, 'app.db'), { readOnly: true });
const d = `-${Number(process.argv[2]) || 7} days`;
const q = (sql) => { try { return db.prepare(sql).all(d); } catch { return []; } };
console.log(JSON.stringify({
  tendencias: q("SELECT creado, origen, tema, resumen, por_que_ahora, nicho, palabras_clave, fuentes FROM ia_tendencias WHERE creado > datetime('now', ?) AND caduca > datetime('now') ORDER BY id DESC LIMIT 40"),
  ideas: q("SELECT id, creado, origen, titulo, angulo, formato, gancho, por_que, fuentes, estado FROM ia_ideas WHERE creado > datetime('now', ?) ORDER BY id DESC LIMIT 30"),
  escenas: q("SELECT creado, origen, video, json_array_length(momentos) n FROM ia_escenas WHERE creado > datetime('now', ?) ORDER BY id DESC LIMIT 30"),
}, null, 1));
