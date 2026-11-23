// Energía: mantener despierto dentro del horario y suspender hasta el próximo despertar.
// Solo actúa en Linux; en Windows (pruebas) se limita a registrar lo que haría.
import { spawn, execFile } from 'node:child_process';

const LINUX = process.platform === 'linux';
let inhibidor = null;

export function mantenerDespierto(activo) {
  if (!LINUX) return;
  if (activo && !inhibidor) {
    // Impide que el escritorio lo suspenda por inactividad o al cerrar la tapa durante el horario.
    inhibidor = spawn('systemd-inhibit', ['--what=idle:sleep:handle-lid-switch', '--who=streamclipper', '--why=Horario de trabajo', '--mode=block', 'sleep', 'infinity'], { stdio: 'ignore' });
    inhibidor.on('exit', () => { inhibidor = null; });
    inhibidor.on('error', (e) => { console.error('No se pudo crear el inhibidor:', e.message); inhibidor = null; });
  } else if (!activo && inhibidor) {
    inhibidor.kill(); inhibidor = null;
  }
}

// Programa el reloj del hardware para despertar en `fecha` y suspende (rtcwake escribe en /sys/power/state).
export function suspenderHasta(fecha) {
  const epoch = Math.floor(fecha.getTime() / 1000);
  if (!LINUX) {
    console.log(`[energía] (simulado en ${process.platform}) suspendería hasta ${fecha.toLocaleString('es')}`);
    return Promise.resolve({ simulado: true });
  }
  mantenerDespierto(false);
  return new Promise((resolve, reject) => {
    execFile('sudo', ['-n', '/usr/bin/rtcwake', '-m', 'mem', '-t', String(epoch)], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message)); else resolve({ simulado: false, salida: stdout });
    });
  });
}
