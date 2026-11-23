// Cliente para cualquier servidor compatible con la API de OpenAI (LM Studio, llama-server).
import { aceleradorDisponible, aceleradorTieneModelo, encargar } from './acelerador.mjs';
import { ajustes } from './db.mjs';
import { claveGroq, contarUso } from './ia-nube.mjs';

export async function modelosDisponibles(url) {
  const r = await fetch(`${url.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`El servidor de modelos respondió ${r.status}`);
  return ((await r.json()).data || []).map((m) => m.id).filter((id) => !/embed/i.test(id));
}

// Textos por Groq (plan gratuito: 1000 peticiones/día y 8000 tokens/min por modelo): si pide esperar, espera; si el JSON
// estructurado no le vale, pide JSON simple; si falla del todo (cupo del día), lo hace el modelo local.
// Groq gratis limita tokens por minuto POR MODELO: con varios modelos en el grupo, cuando uno llega al tope se sigue con el
// siguiente libre en vez de esperar (23-nov-2026). Ajuste «groq.modelos_respaldo»; un modelo pedido a propósito no rota.
const enfriando = new Map(); // modelo -> ms hasta que vuelve a tener cupo
const grupoGroq = () => [...new Set([ajustes()['groq.modelo_texto'] || 'openai/gpt-oss-120b', ...String(ajustes()['groq.modelos_respaldo'] ?? 'qwen/qwen3.8-27b, openai/gpt-oss-20b').split(/[,\s]+/).filter(Boolean)])];
const libre = (m) => (enfriando.get(m) || 0) <= Date.now();
async function chatGroq({ messages, schema, max_tokens, temperature, modeloGroq }, intento = 0, sinEsquema = false, elegido = null) {
  const k = claveGroq(); if (!k) throw new Error('Groq sin configurar');
  const grupo = grupoGroq(), fijo = modeloGroq && !grupo.includes(modeloGroq);
  const modelo = elegido || (modeloGroq && (fijo || libre(modeloGroq)) ? modeloGroq : grupo.find(libre) || grupo.reduce((a, b) => ((enfriando.get(a) || 0) <= (enfriando.get(b) || 0) ? a : b)));
  const body = { model: modelo, messages, temperature, max_tokens: Math.min(8000, max_tokens * 2 + 600), reasoning_effort: 'low', stream: false };
  if (schema) body.response_format = sinEsquema ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'resultado', strict: false, schema } };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const txt = await r.text();
  if (r.status === 429 && intento < 8) {
    const diario = /per day|\(TPD\)|\(RPD\)/i.test(txt);
    const m = txt.match(/try again in (?:(\d+)m)?([\d.]+)s/); const seg = diario ? 3600 : m ? (Number(m[1] || 0) * 60 + Number(m[2])) : 15;
    enfriando.set(modelo, Date.now() + (seg + 1) * 1000);
    const otro = !fijo && grupo.find((x) => x !== modelo && libre(x));
    if (otro) return chatGroq({ messages, schema, max_tokens, temperature, modeloGroq }, intento + 1, sinEsquema, otro);
    if (!diario && seg <= 120) { await new Promise((ok) => setTimeout(ok, (seg + 1) * 1000)); return chatGroq({ messages, schema, max_tokens, temperature, modeloGroq }, intento + 1, sinEsquema); }
  }
  if (r.status === 400 && schema && !sinEsquema && /json_schema|response_format|schema|Failed to (generate|validate) JSON/i.test(txt)) return chatGroq({ messages, schema, max_tokens, temperature, modeloGroq }, intento, true, modelo);
  if (!r.ok) { contarUso('groq', true); throw new Error(`Groq ${r.status}: ${txt.slice(0, 200)}`); }
  contarUso('groq');
  return (JSON.parse(txt).choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function chat(url, opciones) {
  if (url === 'groq') {
    try { return await chatGroq({ max_tokens: 800, temperature: 0, ...opciones }); }
    catch (e) {
      if (!opciones.model || opciones.model === 'groq') throw e;
      console.warn(`IA: Groq no disponible (${String(e.message).slice(0, 120)}); lo hace el modelo local.`);
      return chatLocal(ajustes()['llm.url'], opciones);
    }
  }
  return chatLocal(url, opciones);
}

async function chatLocal(url, { model, messages, schema, max_tokens = 800, temperature = 0, timeoutMs = 600000 }) {
  // reasoning_effort "none": Gemma 4 / Qwen3.5 razonan por defecto y gastan los tokens "pensando".
  const body = { model, messages, temperature, max_tokens, stream: false, reasoning_effort: 'none' };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'resultado', strict: true, schema } };
  // Si la laptop está encendida y tiene este modelo, lo hace ella (8-15 veces más rápida); si falla, sigue aquí.
  if (aceleradorDisponible('chat') && (!model || aceleradorTieneModelo(model))) {
    try {
      const j = await encargar('chat', body, { timeoutMs: Math.min(timeoutMs, 240000) });
      return (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    } catch (e) { console.warn(`IA en la laptop no disponible (${e.message}); se hace en el servidor.`); }
  }
  const r = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Modelo ${r.status}: ${txt.slice(0, 300)}`);
  const j = JSON.parse(txt);
  return (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
