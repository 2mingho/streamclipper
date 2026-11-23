// Agente del acelerador (laptop Windows con GPU). Sin dependencias: Node 18+.
// Pregunta al servidor si hay trabajo; si lo hay, arranca lo necesario en la GPU, lo hace y devuelve el resultado.
//  · chat: llama-server con la misma Gemma que el servidor (se arranca al primer trabajo y se cierra tras unos
//    minutos sin trabajo, liberando GPU y RAM).
//  · transcribir: whisper-cli con CUDA, un proceso por trabajo (no queda nada en memoria).
// Con batería (si así se configura) o en pausa, solo envía un latido y no acepta trabajo.
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, existsSync, statSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const LOG = path.join(DIR, 'agente.log');
const log = (m) => {
  const l = `${new Date().toLocaleString('es')}  ${m}\n`;
  try { if (existsSync(LOG) && statSync(LOG).size > 2e6) renameSync(LOG, `${LOG}.1`); appendFileSync(LOG, l); } catch {}
  if (process.stdout.isTTY) process.stdout.write(l);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- servidor ----------
let base = null; // dirección del servidor que responde (casa o Tailscale)
async function api(ruta, cuerpo, { timeoutMs = 40000 } = {}) {
  const r = await fetch(`${base}${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Acelerador': cfg.token },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`servidor ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
async function buscarServidor() {
  for (const s of cfg.servidores) {
    try {
      const r = await fetch(`${s}/api/acelerador/trabajo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Acelerador': cfg.token }, body: JSON.stringify({ capacidades: [], info: await info() }), signal: AbortSignal.timeout(5000) });
      if (r.ok) { if (base !== s) log(`Conectado al servidor ${s}`); base = s; return true; }
      if (r.status === 401) log(`El servidor ${s} rechaza el token: revisa config.json`);
    } catch {}
  }
  if (base) log('Servidor no disponible; reintento en 30 s');
  base = null;
  return false;
}

// ---------- energía ----------
let enchufado = true;
function revisarEnergia() {
  execFile('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus'], { timeout: 15000, windowsHide: true }, (e, so) => {
    const s = Number(String(so).trim());
    const antes = enchufado;
    enchufado = !s || s === 2 || s >= 6; // sin batería, 2 = corriente, 6-9 = cargando
    if (antes !== enchufado) log(enchufado ? 'Enchufada: acepto trabajo' : 'Con batería: no acepto trabajo');
  });
}
const pausada = () => existsSync(path.join(DIR, 'PAUSA'));
const aceptaTrabajo = () => !pausada() && (enchufado || cfg.usarConBateria);
let whisper = null; // transcripción en curso (para cortarla al pausar)

// Interruptor (icono de la bandeja o archivo PAUSA): al pausar se libera la GPU al momento y se avisa al servidor;
// lo que estuviera a medias falla y el servidor lo rehace él.
let estabaPausada = pausada();
setInterval(async () => {
  const p = pausada();
  if (p === estabaPausada) return;
  estabaPausada = p;
  if (p) {
    log('Pausada por el usuario: libero la GPU y no acepto trabajo');
    pararLlama();
    if (whisper) whisper.kill();
  } else log('Reanudada: vuelvo a aceptar trabajo');
  if (base) api('/api/acelerador/trabajo', { capacidades: [], info: await info() }, { timeoutMs: 5000 }).catch(() => {});
}, 1500);

// ---------- llama-server bajo demanda ----------
let llama = null, llamaListo = null, ultimoUso = 0, chatsEnCurso = 0;
const URL_LLAMA = `http://127.0.0.1:${cfg.llama.puerto}`;
function arrancarLlama() {
  if (llamaListo) return llamaListo;
  log('Arrancando llama-server en la GPU…');
  const t0 = Date.now();
  llama = spawn(cfg.llama.exe, ['-m', cfg.llama.modelo, '-a', cfg.llama.alias, '-ngl', '99', '-c', String(cfg.llama.contexto * cfg.llama.paralelo), '-np', String(cfg.llama.paralelo), '-rea', 'off', '--host', '127.0.0.1', '--port', String(cfg.llama.puerto)], { stdio: 'ignore', windowsHide: true });
  llama.on('exit', (c) => { log(`llama-server cerrado (${c ?? 'señal'})`); llama = null; llamaListo = null; });
  llamaListo = (async () => {
    for (let i = 0; i < 120; i++) {
      if (!llama) throw new Error('llama-server no arrancó');
      try { if ((await fetch(`${URL_LLAMA}/health`, { signal: AbortSignal.timeout(2000) })).ok) { log(`llama-server listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`); return; } } catch {}
      await esperar(1000);
    }
    throw new Error('llama-server no respondió en 2 minutos');
  })();
  llamaListo.catch(() => { pararLlama(); });
  return llamaListo;
}
function pararLlama() { if (llama) { llama.kill(); llama = null; } llamaListo = null; }
setInterval(() => {
  if (llama && !chatsEnCurso && Date.now() - ultimoUso > cfg.inactividadMin * 60000) { log(`${cfg.inactividadMin} min sin trabajo: libero la GPU`); pararLlama(); }
}, 30000);

async function hacerChat(cuerpo) {
  chatsEnCurso++;
  try {
    await arrancarLlama();
    const r = await fetch(`${URL_LLAMA}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cuerpo, model: cfg.llama.alias }), signal: AbortSignal.timeout(230000) });
    const txt = await r.text();
    if (!r.ok) throw new Error(`llama-server ${r.status}: ${txt.slice(0, 200)}`);
    return JSON.parse(txt);
  } finally { chatsEnCurso--; ultimoUso = Date.now(); }
}

// ---------- whisper por trabajo ----------
async function hacerTranscripcion(trabajo) {
  const dir = path.join(tmpdir(), `acelerador-${trabajo.id}`);
  mkdirSync(dir, { recursive: true });
  try {
    const r = await api(trabajo.audio, undefined, { timeoutMs: 600000 });
    const audio = path.join(dir, 'audio.mp3');
    writeFileSync(audio, Buffer.from(await r.arrayBuffer()));
    const t0 = Date.now();
    await new Promise((ok, mal) => {
      whisper = execFile(cfg.whisper.exe, ['-m', cfg.whisper.modelo, '-l', trabajo.datos?.idioma || 'es', '-t', '4', '-np', '-oj', '-of', path.join(dir, 'texto'), '-f', audio],
        { timeout: 3 * 3600000, windowsHide: true, maxBuffer: 16 << 20 }, (e, so, se) => { whisper = null; e ? mal(new Error(pausada() ? 'pausada por el usuario' : String(se || e.message).slice(-300))) : ok(); });
    });
    const j = JSON.parse(readFileSync(path.join(dir, 'texto.json'), 'utf8'));
    log(`Transcripción hecha en ${((Date.now() - t0) / 1000).toFixed(0)} s (${j.transcription?.length || 0} frases)`);
    return { transcription: j.transcription };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- bucles: un "hueco" por tipo de trabajo ----------
const hechos = { chat: 0, transcribir: 0 };
const info = async () => ({
  nombre: 'Laptop', gpu: cfg.gpu || 'GPU', enchufado, pausa: pausada(),
  acepta: aceptaTrabajo() ? ['chat', 'transcribir'] : [], modelos: [cfg.llama.alias], llamaCargado: !!llama, hechos,
});

async function hueco(tipo, n) {
  for (;;) {
    if (!base) { await esperar(5000); continue; }
    try {
      const acepta = aceptaTrabajo();
      const r = await api('/api/acelerador/trabajo', { capacidades: acepta ? [tipo] : [], info: await info() });
      const { trabajo } = await r.json();
      if (!trabajo) { if (!acepta) await esperar(5000); continue; }
      // Llegó justo al pausar: se devuelve enseguida para que el servidor lo haga.
      if (!aceptaTrabajo()) { await api('/api/acelerador/resultado', { id: trabajo.id, ok: false, error: 'pausada por el usuario' }).catch(() => {}); continue; }
      const t0 = Date.now();
      let resultado, error;
      try { resultado = tipo === 'chat' ? await hacerChat(trabajo.datos) : await hacerTranscripcion(trabajo); hechos[tipo]++; }
      catch (e) { error = e.message; log(`Error en ${tipo}: ${e.message}`); }
      await api('/api/acelerador/resultado', { id: trabajo.id, ok: !error, resultado, error }, { timeoutMs: 120000 });
      if (tipo === 'transcribir' || error) log(`${tipo} #${n}: ${error ? 'falló' : 'hecho'} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      log(`Conexión perdida (${e.message.slice(0, 80)})`);
      base = null;
      await esperar(3000);
    }
  }
}

// ---------- arranque ----------
log(`Agente iniciado (${cfg.servidores.join(' / ')})`);
// Si una ejecución anterior se cerró de golpe, puede quedar un llama-server huérfano en nuestro puerto.
execFile('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${cfg.llama.puerto} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { windowsHide: true }, () => {});
revisarEnergia(); setInterval(revisarEnergia, 60000);
(async () => { for (;;) { if (!base) await buscarServidor(); await esperar(30000); } })();
for (let i = 1; i <= cfg.llama.paralelo; i++) hueco('chat', i);
hueco('transcribir', 1);
process.on('SIGINT', () => { pararLlama(); process.exit(0); });
process.on('exit', () => pararLlama());
