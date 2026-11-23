// Planificador: revisa cada 30 s el horario configurado en el panel.
// - Dentro del horario mantiene el equipo despierto.
// - A la hora de cada tarea la lanza (una vez por día).
// - A la hora de dormir suspende hasta el próximo despertar.
import { ajustes } from './db.mjs';
import { mantenerDespierto, suspenderHasta } from './energia.mjs';
import { cicloClips } from './tareas/clips.mjs';
import { vigilarGemini } from './gemini-vigia.mjs';
import { cicloRecop, enCurso as recopEnCurso } from './tareas/recopilatorios.mjs';
import { cicloOperaciones } from './operaciones.mjs';
import { cicloVigia } from './vigia-servidor.mjs';
import { precalentarEditor } from './tareas/clips-editor.mjs';
import { cicloPrefiltro } from './tareas/automatizaciones.mjs';
import { cicloTranscripciones, limpiarTranscripciones } from './tareas/transcripciones.mjs';
import { enCurso as clipEnCurso } from './tareas/clips.mjs';

const aMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const diaSemana = (d) => ((d.getDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
const hoyISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dentroDeHorario(cfg = ajustes(), ahora = new Date()) {
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  return cfg['horario.dias'].includes(diaSemana(ahora)) && min >= aMin(cfg['horario.despertar']) && min < aMin(cfg['horario.dormir']);
}

// Próxima fecha (a partir de `desde`) en que toca la hora `hhmm` en un día activo.
export function proxima(hhmm, cfg = ajustes(), desde = new Date()) {
  for (let i = 0; i <= 8; i++) {
    const d = new Date(desde); d.setDate(d.getDate() + i);
    const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0);
    if (d > desde && cfg['horario.dias'].includes(diaSemana(d))) return d;
  }
  return null;
}

let ultimoDormir = '';
let suspendiendo = false;

async function tick() {
  const cfg = ajustes();
  const ahora = new Date();
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const diaActivo = cfg['horario.dias'].includes(diaSemana(ahora));
  // Sin suspensión (servidor 24/7) siempre despierto; si no, solo dentro del horario o con una tarea en marcha.
  mantenerDespierto(!cfg['horario.suspender'] || dentroDeHorario(cfg, ahora));

  // Clips (OpenShorts): seguir el trabajo en marcha, revisar canales y mandar el siguiente de la cola.
  cicloClips().catch((e) => console.error('Clips:', e.message));
  // Pasadas de Gemini: aviso con botones si no marcó nada.
  vigilarGemini().catch((e) => console.error('Gemini (vigía):', e.message));
  // Operaciones lanzadas a mano desde el panel (de una en una, en el orden de su cola).
  cicloOperaciones().catch((e) => console.error('Operaciones:', e.message));
  // Vigía: salud del servidor cada 5 min, con aviso al móvil si algo falla.
  cicloVigia();
  // Prefiltro: Groq juzga los clips nuevos con las valoraciones del editor (los muy flojos van a «Descartados por la app»).
  cicloPrefiltro().catch((e) => console.error('Prefiltro:', e.message));
  cicloTranscripciones().catch((e) => console.error('Transcripciones:', e.message));
  try { limpiarTranscripciones(); } catch {}
  // Editor precalentado: de noche y con el servidor libre, proxies y webcam de los clips recientes (abren al instante).
  precalentarEditor({ ocupado: !!clipEnCurso() || recopEnCurso?.() }).catch((e) => console.error('Editor (precalentado):', e.message));
  // Recopilatorios: versiones horizontales de los clips y montaje (de uno en uno, con prioridad baja de CPU).
  cicloRecop().catch((e) => console.error('Recopilatorios:', e.message));

  // Dormir: en los 10 minutos siguientes a la hora de dormir (una vez por día), si no hay nada en marcha.
  const hoy = hoyISO(ahora);
  if (cfg['horario.suspender'] && diaActivo && !suspendiendo && ultimoDormir !== hoy && !recopEnCurso()
      && min >= aMin(cfg['horario.dormir']) && min < aMin(cfg['horario.dormir']) + 10) {
    ultimoDormir = hoy;
    await suspenderAhora().catch((e) => console.error('Suspender:', e.message));
  }
}

export async function suspenderAhora() {
  const cfg = ajustes();
  const despertar = proxima(cfg['horario.despertar'], cfg);
  if (!despertar) throw new Error('No hay días activos en el horario');
  suspendiendo = true;
  try { return { despertar: despertar.toISOString(), ...(await suspenderHasta(despertar)) }; }
  finally { suspendiendo = false; }
}

export function iniciarPlanificador() {
  tick().catch((e) => console.error(e));
  setInterval(() => tick().catch((e) => console.error(e)), 30000);
}
