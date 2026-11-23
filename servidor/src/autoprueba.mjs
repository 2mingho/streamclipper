// Autoprueba (23-nov-2026): tras cada arranque del servidor (y a petición), el propio servidor recorre su API y abre la web en
// un navegador sin ventana, en ordenador y en móvil, como el dueño. Lo que falle (error 500, página que no carga, error de
// JavaScript, pantalla que se sale de lado en el móvil) sale como alerta en Sistema y llega al móvil; cuando se arregla, «resuelto».
// Entra con una llave de un solo uso que vive en memoria y solo vale desde el propio equipo (127.0.0.1).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { ajustes } from './db.mjs';
import { ponerExterno, quitarExternos } from './vigia-servidor.mjs';

let llave = null, ultimo = null, corriendo = false;
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function valida(req) {
  const h = req.headers['x-autoprueba']; if (!llave || !h || !LOCAL.has(req.socket?.remoteAddress)) return false;
  const a = Buffer.from(String(h)), b = Buffer.from(llave); return a.length === b.length && timingSafeEqual(a, b);
}
export const resultado = () => ultimo;

// GET sin parámetros que no salen a servicios de fuera ni tocan nada.
const RUTAS = ['/api/social/cuentas', '/api/social/historias', '/api/social/feed', '/api/social/reels', '/api/social/explorar',
  '/api/social/explorar?filtro=descartados_app', '/api/social/actividad', '/api/social/perfil', '/api/social/mensajes', '/api/social/cola', '/api/ajustes/registro',
  '/api/subidas', '/api/estadisticas/resumen', '/api/estudio', '/api/estudio/ideas',
  '/api/ajustes', '/api/clips', '/api/clips/galeria',
  '/api/movil/galeria', '/api/recop', '/api/publicacion', '/api/pendientes', '/api/operaciones', '/api/editor/recursos',
  '/api/cuentas', '/api/sistema', '/api/sistema/alertas', '/api/sistema/recursos', '/api/yo', '/api/usuarios', '/api/app/version'];
const PAGINAS = ['', 'explorar', 'reels', 'perfil', 'actividad', 'mensajes', 'clips', 'galeria', 'cola', 'subida', 'publicacion', 'estudio', 'recopilatorios',
  'estadisticas', 'operaciones', 'sistema', 'ajustes'];

export async function autoprueba(puerto, { navegador = true } = {}) {
  if (corriendo) return ultimo; corriendo = true;
  const t0 = Date.now(), fallos = [], base = `http://127.0.0.1:${puerto}`;
  llave = randomBytes(24).toString('hex');
  const cab = { 'x-autoprueba': llave };
  try {
    for (const r of RUTAS) {
      try {
        const res = await fetch(base + r, { headers: cab, signal: AbortSignal.timeout(30000) });
        if (res.status >= 500) fallos.push({ donde: r, que: `responde ${res.status}: ${(await res.text()).slice(0, 160)}` });
        else if (res.status === 401) fallos.push({ donde: r, que: 'pide sesión aunque la autoprueba entra como dueño' });
      } catch (e) { fallos.push({ donde: r, que: /timeout|abort/i.test(e.message) ? 'no responde en 30 s' : e.message.slice(0, 160) }); }
    }
    if (navegador) await probarWeb(base, cab, fallos).catch((e) => fallos.push({ donde: 'navegador', que: `no se pudo abrir: ${e.message.slice(0, 160)}` }));
  } finally { llave = null; corriendo = false; }
  ultimo = { fecha: new Date().toISOString(), segundos: Math.round((Date.now() - t0) / 1000), rutas: RUTAS.length, paginas: navegador ? PAGINAS.length * 2 : 0, fallos };
  quitarExternos('autoprueba:', new Set(fallos.slice(0, 12).map((f) => `autoprueba:${f.donde}`)));
  for (const f of fallos.slice(0, 12)) ponerExterno(`autoprueba:${f.donde}`, 'medio', `Falla ${f.donde}`, `${f.que}. Lo detectó la autoprueba tras el arranque.`);
  console.log(`Autoprueba: ${RUTAS.length} rutas${navegador ? ` y ${PAGINAS.length} pantallas (ordenador y móvil)` : ''} en ${ultimo.segundos} s · ${fallos.length ? `${fallos.length} fallos: ${fallos.map((f) => `${f.donde} → ${f.que}`).join(' | ')}` : 'todo bien'}`);
  return ultimo;
}

async function probarWeb(base, cab, fallos) {
  const { chromium } = await import('playwright-core');
  const exe = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'].find(existsSync);
  const nav = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  try {
    for (const [nombre, opc] of [['ordenador', { viewport: { width: 1366, height: 860 } }], ['móvil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
      const ctx = await nav.newContext({ ...opc, extraHTTPHeaders: cab, locale: 'es-DO' });
      const page = await ctx.newPage();
      let errores = [];
      page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) errores.push(m.text().slice(0, 160)); });
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      for (const p of PAGINAS) {
        errores = [];
        const donde = `#/${p} (${nombre})`;
        try {
          await page.evaluate((h) => { location.hash = h; }, `#/${p}`);
          await page.waitForTimeout(2200);
          const r = await page.evaluate(() => ({ texto: document.body.innerText.slice(0, 20000), ancho: document.documentElement.scrollWidth, vista: innerWidth }));
          const m = r.texto.match(/No se pudo cargar[^\n]{0,140}/);
          if (m) fallos.push({ donde, que: m[0] });
          else if (errores.length) fallos.push({ donde, que: `error de JavaScript: ${errores[0]}` });
          else if (nombre === 'móvil' && r.ancho > r.vista + 4) {
            await page.waitForTimeout(2500); // terminó de cargar: se vuelve a medir antes de avisar
            const r2 = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, vista: innerWidth }));
            if (r2.ancho > r2.vista + 4) fallos.push({ donde, que: `la pantalla se sale de lado (${r2.ancho} px de ${r2.vista})` });
          }
        } catch (e) { if (/has been closed/i.test(e.message)) return; fallos.push({ donde, que: e.message.slice(0, 160) }); } // navegador cerrado = el servidor se está reiniciando
      }
      await ctx.close();
    }
  } finally { await nav.close(); }
}

// Tras arrancar: espera a que el planificador se asiente y prueba una vez.
export function alArrancar(puerto) {
  if (ajustes()['servidor.autoprueba'] === false) return;
  setTimeout(() => autoprueba(puerto).catch((e) => console.error('Autoprueba:', e.message)), 120e3).unref?.();
}
