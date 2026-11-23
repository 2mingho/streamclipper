// Página Sistema: estado del equipo (CPU, memoria, discos, temperatura, red) y de los servicios systemd elegidos.
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const LINUX = process.platform === 'linux';
// Nombre del equipo que enseña la pantalla Sistema (NOMBRE_EQUIPO; si no, el hostname).
const NOMBRE = process.env.NOMBRE_EQUIPO || os.hostname();

const ejecutar = (cmd, args, { entrada, timeout = 20000 } = {}) => new Promise((ok) => {
  const p = execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout, stderr) => ok({ codigo: err ? (err.code ?? 1) : 0, salida: String(stdout), error: String(stderr || (err && !stderr ? err.message : '')) }));
  if (entrada != null) { p.stdin.write(entrada); p.stdin.end(); }
});

// Servicios que se muestran (tipo user = servicio de usuario de usuario; system = del sistema, reinicio con sudo).
// Solo se enseñan (y vigilan) los que se nombran en la variable de entorno SERVICIOS, separados por comas
// (p. ej. SERVICIOS=streamclipper,streamclipper-trabajos,ntfy). Sin ella, ninguno.
const VISTOS = String(process.env.SERVICIOS || '').split(',').map((x) => x.trim()).filter(Boolean);
export const TODOS = [
  { id: 'streamclipper', nombre: 'Panel (web y API)', desc: 'El panel, la API y la app; se reinicia en 1 s sin cortar trabajos', tipo: 'user', puerto: 8790 },
  { id: 'streamclipper-trabajos', nombre: 'Trabajos', desc: 'Planificador, descargas, recortes, renders y subidas', tipo: 'user' },
  { id: 'ntfy', nombre: 'Avisos', desc: 'Envía los avisos a tu móvil', tipo: 'user', puerto: 8080, atajo: 'avisos' },
  { id: 'caddy', nombre: 'Proxy web', desc: 'HTTPS delante del panel', tipo: 'system', puerto: 443 },
  { id: 'tailscaled', nombre: 'Tailscale', desc: 'Acceso remoto', tipo: 'system' },
];
export const SERVICIOS = TODOS.filter((s) => VISTOS.includes(s.id));
// Discos que se enseñan además del sistema (puntos de montaje separados por comas en DISCOS, p. ej. DISCOS=/srv,/mnt/datos).
const EXTRA_DISCOS = String(process.env.DISCOS || '').split(',').map((x) => x.trim()).filter(Boolean);

async function leer(f) { try { return (await readFile(f, 'utf8')).trim(); } catch { return null; } }

async function temperatura() {
  // La del paquete de la CPU si existe; si no, la más alta de las zonas térmicas.
  try {
    const zonas = (await readdir('/sys/class/thermal')).filter((z) => z.startsWith('thermal_zone'));
    let max = null;
    for (const z of zonas) {
      const tipo = await leer(`/sys/class/thermal/${z}/type`);
      const t = Number(await leer(`/sys/class/thermal/${z}/temp`)) / 1000;
      if (!Number.isFinite(t) || t <= 0) continue;
      if (tipo === 'x86_pkg_temp') return t;
      if (max === null || t > max) max = t;
    }
    return max;
  } catch { return null; }
}

export async function bateria() {
  try {
    const fuentes = await readdir('/sys/class/power_supply');
    const bat = fuentes.find((f) => f.startsWith('BAT'));
    const ac = fuentes.find((f) => /^(AC|ADP|ACAD)/.test(f));
    return {
      carga: bat ? Number(await leer(`/sys/class/power_supply/${bat}/capacity`)) : null,
      estado: bat ? await leer(`/sys/class/power_supply/${bat}/status`) : null, // Charging, Discharging, Full, Not charging
      enchufado: ac ? (await leer(`/sys/class/power_supply/${ac}/online`)) === '1' : null,
    };
  } catch { return null; }
}

export async function discos() {
  const r = await ejecutar('df', ['-B1', '--output=target,size,used,avail', '/', ...EXTRA_DISCOS]);
  const nombres = { '/': 'Sistema', ...Object.fromEntries(EXTRA_DISCOS.map((d) => [d, d])) };
  const vistos = new Set();
  return r.salida.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter(([t]) => nombres[t])
    .map(([t, total, usado, libre]) => ({ punto: t, nombre: nombres[t], total: +total, usado: +usado, libre: +libre }))
    // Un punto de montaje en el mismo disco que el sistema no se repite.
    .filter((d) => { const k = `${d.total}`; if (d.punto !== '/' && vistos.has(k)) return false; vistos.add(k); return true; });
}

async function red() {
  const ifs = os.networkInterfaces();
  const ipv4 = (n) => (ifs[n] || []).find((a) => a.family === 'IPv4')?.address || null;
  const lan = Object.keys(ifs).filter((n) => n !== 'lo' && n !== 'tailscale0' && !n.startsWith('docker') && !n.startsWith('br-') && !n.startsWith('veth')).map(ipv4).find(Boolean) || null;
  let wifi = null;
  const w = await ejecutar('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi']);
  const activa = w.salida.split('\n').find((l) => l.startsWith('yes:') || l.startsWith('sí:'));
  if (activa) { const [, ssid, senal] = activa.split(':'); wifi = { ssid, senal: Number(senal) }; }
  return { lan, tailscale: ipv4('tailscale0'), wifi, nombre: NOMBRE };
}

async function estadoServicio(s) {
  const args = s.tipo === 'user' ? ['--user', 'is-active', s.id] : ['is-active', s.id];
  const r = await ejecutar('systemctl', args, { timeout: 5000 });
  return r.salida.trim() || 'desconocido';
}

export async function estadoSistema() {
  const mem = await leer('/proc/meminfo');
  const kb = (k) => Number((mem || '').match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] || 0) * 1024;
  const [temp, bat, dis, net, servicios] = await Promise.all([
    LINUX ? temperatura() : null, LINUX ? bateria() : null, LINUX ? discos() : [], red(),
    Promise.all(SERVICIOS.map(async (s) => ({ ...s, estado: LINUX ? await estadoServicio(s) : 'simulado' }))),
  ]);
  return {
    nombre: NOMBRE, so: `${os.type()} ${os.release()}`, encendido_s: Math.round(os.uptime()),
    carga: os.loadavg()[0], nucleos: os.cpus().length, temperatura: temp,
    memoria: { total: kb('MemTotal') || os.totalmem(), disponible: kb('MemAvailable') || os.freemem() },
    bateria: bat, discos: dis, red: net, servicios,
    reinicioPendiente: LINUX && !existsSync(`/usr/lib/modules/${os.release()}`),
    linux: LINUX,
  };
}

function servicio(id) {
  const s = SERVICIOS.find((x) => x.id === id);
  if (!s) throw new Error('Servicio desconocido');
  return s;
}

export async function reiniciarServicio(id) {
  const s = servicio(id);
  if (!LINUX) return { simulado: true };
  if (s.id === 'streamclipper' || s.id === 'streamclipper-trabajos') {
    setTimeout(() => spawn('systemctl', ['--user', 'restart', s.id], { detached: true, stdio: 'ignore' }).unref(), 800);
    return { ok: true, propio: true };
  }
  const r = s.tipo === 'user' ? await ejecutar('systemctl', ['--user', 'restart', s.id], { timeout: 60000 })
    : await ejecutar('sudo', ['-n', '/usr/bin/systemctl', 'restart', s.id], { timeout: 60000 });
  if (r.codigo) throw new Error(r.error.trim() || `No se pudo reiniciar (${r.codigo})`);
  return { ok: true, estado: await estadoServicio(s) };
}

export async function registroServicio(id) {
  const s = servicio(id);
  if (!LINUX) return { texto: '(solo en el servidor)' };
  const args = [...(s.tipo === 'user' ? ['--user'] : []), '-u', s.id, '-n', '120', '--no-pager', '-o', 'short-iso'];
  const r = await ejecutar('journalctl', args);
  return { texto: r.salida || r.error || 'Sin registro' };
}
