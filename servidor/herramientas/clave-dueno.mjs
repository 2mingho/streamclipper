// Pone una contraseña nueva a un usuario de la app (por defecto, el dueño «admin»), escribiéndola tú en la terminal.
// Uso:  node herramientas/clave-dueno.mjs            (para admin)
//       node herramientas/clave-dueno.mjs ana        (para otro usuario)
// La contraseña no se ve al escribirla ni se guarda en ningún sitio más que cifrada en la base de datos.
import readline from 'node:readline';
import { db } from '../src/db.mjs';
import { hash } from '../src/usuarios.mjs';

const usuario = process.argv[2] || 'admin';
const u = db.prepare('SELECT id, usuario, nombre FROM usuarios WHERE usuario = ?').get(usuario);
if (!u) { console.error(`No existe el usuario «${usuario}». Usuarios: ${db.prepare('SELECT usuario FROM usuarios').all().map((x) => x.usuario).join(', ')}`); process.exit(1); }

function preguntaOculta(texto) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(texto);
    rl._writeToOutput = () => {}; // no enseña lo que se escribe
    rl.question('', (r) => { rl.close(); process.stdout.write('\n'); ok(r); });
  });
}
const a = await preguntaOculta(`Nueva contraseña para ${u.usuario} (${u.nombre}), mínimo 8 caracteres: `);
const b = await preguntaOculta('Repítela: ');
if (a !== b) { console.error('No coinciden. No se ha cambiado nada.'); process.exit(1); }
if (a.length < 8) { console.error('Tiene menos de 8 caracteres. No se ha cambiado nada.'); process.exit(1); }
db.prepare('UPDATE usuarios SET clave_hash = ?, cambiar_clave = 0, activo = 1 WHERE id = ?').run(hash(a), u.id);
console.log(`Listo: ya puedes entrar con el usuario «${u.usuario}» y la contraseña nueva.`);
process.exit(0);
