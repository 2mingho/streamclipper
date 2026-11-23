// Recursos en vivo (23-nov-2026), estilo btop: CPU por núcleo, memoria y swap, red, discos (uso y lectura/escritura),
// temperaturas, GPU y procesos agrupados por servicio. Lee /proc y /sys cada 2 s, pero solo mientras alguien mira la
// pantalla (se para a los 3 min sin peticiones). Guarda 5 min de historia para las gráficas. Vive en el proceso web.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import { discos, bateria, TODOS as SERVICIOS } from './sistema.mjs';

const LINUX = process.platform === 'linux';
const HZ = 100, PAGINA = 4096, PASO = 2000, HIST = 150, PARAR_MS = 180000;
const leer = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const num = (f) => { const t = leer(f); return t == null ? null : Number(t.trim()); };

let reloj = null, ultimaPeticion = 0, previo = null, ultimo = null, usoDiscos = { t: 0, v: [] }, bat = { t: 0, v: null };
const hist = { cpu: [], mem: [], rx: [], tx: [], lee: [], esc: [] };
const empujar = (k, v) => { hist[k].push(v); if (hist[k].length > HIST) hist[k].shift(); };

function cpuTicks() {
  return (leer('/proc/stat') || '').split('\n').filter((l) => /^cpu\d* /.test(l)).map((l) => {
    const v = l.trim().split(/\s+/).slice(1).map(Number); const inactivo = v[3] + (v[4] || 0);
    return { total: v.slice(0, 8).reduce((a, b) => a + b, 0), inactivo };
  });
}
function memoria() {
  const m = leer('/proc/meminfo') || ''; const kb = (k) => Number(m.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] || 0) * 1024;
  const total = kb('MemTotal'), disponible = kb('MemAvailable'), cache = kb('Cached') + kb('Buffers') + kb('SReclaimable');
  const swaps = (leer('/proc/swaps') || '').split('\n').slice(1).filter(Boolean).map((l) => { const [nombre, tipo, tam, usado] = l.trim().split(/\s+/); return { nombre: nombre.replace(/^.*\//, ''), tipo, total: Number(tam) * 1024, usado: Number(usado) * 1024 }; });
  let zram = null; const mm = leer('/sys/block/zram0/mm_stat'); if (mm) { const [orig, compr] = mm.trim().split(/\s+/).map(Number); zram = { datos: orig, ocupa: compr }; }
  return { total, disponible, usado: total - disponible, cache, libre: kb('MemFree'), swaps, zram };
}
function red() {
  return (leer('/proc/net/dev') || '').split('\n').slice(2).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [n, r] = l.split(':'); const v = r.trim().split(/\s+/).map(Number); return { nombre: n.trim(), rx: v[0], tx: v[8] };
  }).filter((x) => x.nombre !== 'lo' && !/^(veth|docker|br-)/.test(x.nombre));
}
function discosIO() {
  return (leer('/proc/diskstats') || '').split('\n').map((l) => l.trim().split(/\s+/)).filter((v) => v.length > 10 && /^(nvme\d+n\d+|sd[a-z]+|mmcblk\d+)$/.test(v[2]))
    .map((v) => ({ nombre: v[2], lee: Number(v[5]) * 512, esc: Number(v[9]) * 512, ocupado_ms: Number(v[12]) }));
}
function temperaturas() {
  const out = [];
  for (const h of (existsSync('/sys/class/hwmon') ? readdirSync('/sys/class/hwmon') : [])) {
    const d = `/sys/class/hwmon/${h}`, nombre = (leer(`${d}/name`) || '').trim();
    for (const f of readdirSync(d).filter((x) => /^temp\d+_input$/.test(x))) {
      const c = num(`${d}/${f}`); if (c == null || c <= 0) continue;
      const etiqueta = (leer(`${d}/${f.replace('_input', '_label')}`) || '').trim();
      out.push({ sensor: nombre, nombre: nombre === 'coretemp' ? (etiqueta.replace('Package id 0', 'CPU').replace('Core ', 'Núcleo ') || 'CPU') : nombre === 'nvme' ? 'Disco NVMe' : nombre === 'acpitz' ? 'Placa' : etiqueta || nombre, c: c / 1000 });
    }
  }
  return out;
}
function gpu() {
  const card = existsSync('/sys/class/drm') ? readdirSync('/sys/class/drm').find((c) => /^card\d+$/.test(c) && existsSync(`/sys/class/drm/${c}/gt_cur_freq_mhz`)) : null;
  if (!card) return null;
  return { nombre: 'Intel Iris Xe', mhz: num(`/sys/class/drm/${card}/gt_act_freq_mhz`) ?? num(`/sys/class/drm/${card}/gt_cur_freq_mhz`), max: num(`/sys/class/drm/${card}/gt_max_freq_mhz`) };
}
const frecuencias = () => Array.from({ length: os.cpus().length }, (_, i) => { const k = num(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`); return k == null ? null : Math.round(k / 1000); });

const NOMBRES = Object.fromEntries(SERVICIOS.map((s) => [s.id, s.nombre]));
function unidadDe(cg) {
  const partes = String(cg || '').trim().split('/');
  const u = [...partes].reverse().find((x) => x.endsWith('.service'));
  if (u) { const id = u.replace(/\.service$/, ''); return { id, nombre: NOMBRES[id] || (id.startsWith('user@') ? 'Sesión del usuario' : id) }; }
  if (partes.some((x) => x.endsWith('.scope'))) return { id: 'sesion', nombre: 'Terminal / SSH' };
  return { id: 'sistema', nombre: 'Sistema' };
}
function procesos() {
  const out = [];
  for (const p of readdirSync('/proc')) {
    if (!/^\d+$/.test(p)) continue;
    const st = leer(`/proc/${p}/stat`); if (!st) continue;
    const cierre = st.lastIndexOf(')'); const comm = st.slice(st.indexOf('(') + 1, cierre); const v = st.slice(cierre + 2).split(' ');
    const sm = leer(`/proc/${p}/statm`); const rss = sm ? Number(sm.split(' ')[1]) * PAGINA : 0;
    const uid = Number((leer(`/proc/${p}/status`) || '').match(/^Uid:\s+(\d+)/m)?.[1] ?? -1);
    out.push({ pid: Number(p), comm, estado: v[0], ticks: Number(v[11]) + Number(v[12]), hilos: Number(v[17]), nice: Number(v[16]), rss, uid, cg: leer(`/proc/${p}/cgroup`) });
  }
  return out;
}
// Nombre legible: para intérpretes (node, python, bash…) se muestra también el script que ejecutan.
function nombreDe(pid, comm) {
  if (!/^(node|python|python3|bash|sh|uvicorn|java)\b/i.test(comm.replace(/-MainThread$/, ''))) return comm;
  const a = (leer(`/proc/${pid}/cmdline`) || '').split(String.fromCharCode(0)).filter(Boolean);
  const guion = a.slice(1).find((x) => !x.startsWith('-') && /[\w-]+\.(m?js|py|sh)$|\//.test(x));
  return guion ? `${comm.replace(/-MainThread$/, '')} ${guion.split('/').slice(-2).join('/')}` : comm.replace(/-MainThread$/, '');
}
const cmdDe = (pid) => (leer(`/proc/${pid}/cmdline`) || '').split('\0').filter(Boolean).join(' ').slice(0, 300);

function muestrear() {
  if (!LINUX) return;
  const t = Date.now(), cpu = cpuTicks(), mem = memoria(), r = red(), io = discosIO(), ps = procesos();
  if (previo) {
    const dt = (t - previo.t) / 1000;
    const pct = cpu.map((c, i) => { const a = previo.cpu[i]; if (!a) return 0; const tot = c.total - a.total; return tot > 0 ? Math.max(0, Math.min(100, (1 - (c.inactivo - a.inactivo) / tot) * 100)) : 0; });
    const tasa = (lista, ant, k) => lista.map((x) => { const y = ant.find((z) => z.nombre === x.nombre); return y ? Math.max(0, (x[k] - y[k]) / dt) : 0; });
    const rx = tasa(r, previo.red, 'rx'), tx = tasa(r, previo.red, 'tx'), lee = tasa(io, previo.io, 'lee'), esc = tasa(io, previo.io, 'esc');
    const ocupado = io.map((x) => { const y = previo.io.find((z) => z.nombre === x.nombre); return y ? Math.min(100, (x.ocupado_ms - y.ocupado_ms) / (dt * 10)) : 0; });
    const antes = new Map(previo.ps.map((x) => [x.pid, x.ticks]));
    const lista = ps.map((x) => ({ ...x, cpu: antes.has(x.pid) ? Math.max(0, ((x.ticks - antes.get(x.pid)) / HZ / dt) * 100) : 0 }));
    // Por servicio (cgroup de systemd): CPU y memoria sumadas.
    const grupos = new Map();
    for (const x of lista) { const u = unidadDe(x.cg); x.unidad = u.id; x.unidadNombre = u.nombre; const g = grupos.get(u.id) || { id: u.id, nombre: u.nombre, cpu: 0, rss: 0, n: 0 }; g.cpu += x.cpu; g.rss += x.rss; g.n++; grupos.set(u.id, g); }
    const visibles = lista.filter((x) => x.rss > 0); // fuera los hilos del núcleo (kworker…): no usan memoria propia
    const top = new Map();
    for (const x of [...visibles].sort((a, b) => b.cpu - a.cpu).slice(0, 40)) top.set(x.pid, x);
    for (const x of [...visibles].sort((a, b) => b.rss - a.rss).slice(0, 40)) top.set(x.pid, x);
    empujar('cpu', +pct[0].toFixed(1)); empujar('mem', +((mem.usado / mem.total) * 100).toFixed(1));
    empujar('rx', Math.round(rx.reduce((a, b) => a + b, 0))); empujar('tx', Math.round(tx.reduce((a, b) => a + b, 0)));
    empujar('lee', Math.round(lee.reduce((a, b) => a + b, 0))); empujar('esc', Math.round(esc.reduce((a, b) => a + b, 0)));
    if (t - usoDiscos.t > 60000) { usoDiscos.t = t; discos().then((d) => { usoDiscos.v = d; }).catch(() => {}); }
    if (t - bat.t > 30000) { bat.t = t; bateria().then((b) => { bat.v = b; }).catch(() => {}); }
    ultimo = {
      t, nucleos: os.cpus().length, modelo: os.cpus()[0]?.model?.replace(/\s+/g, ' ').replace(/\(R\)|\(TM\)|CPU /g, '').trim(), carga: os.loadavg(), encendido_s: Math.round(os.uptime()),
      cpu: { total: pct[0], nucleos: pct.slice(1), mhz: frecuencias() },
      mem, red: r.map((x, i) => ({ nombre: x.nombre, rx: rx[i], tx: tx[i], rxTotal: x.rx, txTotal: x.tx })),
      discos: io.map((x, i) => ({ nombre: x.nombre, lee: lee[i], esc: esc[i], ocupado: ocupado[i] })), uso: usoDiscos.v,
      temperaturas: temperaturas(), gpu: gpu(), bateria: bat.v,
      procesos: [...top.values()].map((x) => ({ pid: x.pid, nombre: nombreDe(x.pid, x.comm), cpu: +x.cpu.toFixed(1), rss: x.rss, hilos: x.hilos, nice: x.nice, estado: x.estado, unidad: x.unidad, unidadNombre: x.unidadNombre, propio: x.uid === process.getuid?.() })),
      servicios: [...grupos.values()].map((g) => ({ ...g, cpu: +g.cpu.toFixed(1) })).sort((a, b) => b.cpu - a.cpu || b.rss - a.rss),
      total_procesos: ps.length,
    };
  }
  previo = { t, cpu, red: r, io, ps: ps.map(({ pid, ticks }) => ({ pid, ticks })) };
  if (Date.now() - ultimaPeticion > PARAR_MS) { clearInterval(reloj); reloj = null; previo = null; }
}

export async function recursos() {
  if (!LINUX) return { linux: false };
  ultimaPeticion = Date.now();
  if (!reloj) { muestrear(); await new Promise((r) => setTimeout(r, 600)); muestrear(); reloj = setInterval(muestrear, PASO); reloj.unref?.(); }
  return { linux: true, ...ultimo, hist };
}

export function detalleProceso(pid) {
  pid = Number(pid); const st = leer(`/proc/${pid}/status`); if (!st) throw new Error('Ese proceso ya no existe');
  return { pid, cmd: cmdDe(pid), unidad: unidadDe(leer(`/proc/${pid}/cgroup`)), inicio_s: null };
}

// Acciones sobre un proceso (solo el dueño): terminar (SIGTERM), forzar (SIGKILL), prioridad baja o normal.
// Solo procesos del propio usuario del servidor y nunca la propia web ni el gestor de servicios.
export function accionProceso(pid, accion) {
  pid = Number(pid);
  const st = leer(`/proc/${pid}/status`); if (!st) throw new Error('Ese proceso ya no existe');
  const uid = Number(st.match(/^Uid:\s+(\d+)/m)?.[1]); const comm = (leer(`/proc/${pid}/comm`) || '').trim();
  if (uid !== process.getuid()) throw new Error('Es un proceso del sistema: no se puede tocar desde aquí');
  if (pid === process.pid || pid === process.ppid || comm === 'systemd' || pid <= 1) throw new Error('Ese proceso no se puede tocar desde aquí');
  if (accion === 'terminar') process.kill(pid, 'SIGTERM');
  else if (accion === 'forzar') process.kill(pid, 'SIGKILL');
  else if (accion === 'bajar') os.setPriority(pid, 15);
  else if (accion === 'normal') os.setPriority(pid, 0);
  else throw new Error('Acción no válida');
  return { ok: true };
}
