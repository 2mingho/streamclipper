// StreamClipper · interfaz social (21-nov-2026; fase 1 de la migración, 22-nov: cola, revisión completa, textos, subidas y campaña).
// Sin dependencias ni compilación. Datos: /api/social/* (src/social.mjs); acciones: las rutas de siempre (/api/clips/*, /api/estudio/*…).
// Todo vive aquí: el panel clásico se retiró el 22-nov-2026 (/clasico redirige a esta app).

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e4 ? `${Math.round(n / 1e3)} mil` : n.toLocaleString('es'));
function hace(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 0) { const m = -s / 60; return m < 60 ? `en ${Math.round(m)} min` : m < 1440 ? `en ${Math.round(m / 60)} h` : new Date(iso).toLocaleString('es', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  return s < 60 ? 'ahora' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : s < 604800 ? `${Math.floor(s / 86400)} d` : new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
const iniciales = (t) => String(t || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
let avisoT;
function aviso(texto) { const a = $('#aviso'); a.textContent = texto; a.hidden = false; clearTimeout(avisoT); avisoT = setTimeout(() => { a.hidden = true; }, 2600); }

// Miniatura que ya no existe (clip caducado o borrado): se oculta en vez de enseñar una imagen rota.
document.addEventListener('error', (e) => { const t = e.target; if (t?.tagName === 'IMG' && !t.dataset.fallo) { t.dataset.fallo = '1'; t.style.visibility = 'hidden'; } }, true);
async function api(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (r.status === 401) { pantallaLogin(); throw new Error('sesión'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ---------- iconos (trazo propio, 24×24) ----------
const P = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  crear: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
  reels: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8.5h18M8 3l3 5.5M14 3l3 5.5"/><path d="m10.5 12.5 4 2.5-4 2.5z"/>',
  corazon: '<path d="M12 20.5s-7.5-4.6-9-9.4C1.9 7.4 4.3 4 7.6 4c2 0 3.4 1.1 4.4 2.6C13 5.1 14.4 4 16.4 4c3.3 0 5.7 3.4 4.6 7.1-1.5 4.8-9 9.4-9 9.4z"/>',
  enviar: '<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="M10 13 21 3"/>',
  comentar: '<path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.1-4.2A8.5 8.5 0 1 1 20.5 12z"/>',
  guardar: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  mas: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  abajo: '<path d="m6 9 6 6 6-6"/>',
  cerrar: '<path d="M6 6l12 12M18 6 6 18"/>',
  pulgar: '<path d="M7 14V4H4v10zM7 14l4.5 6.5c1.2.2 2.2-.8 2-2l-.8-4.5H18a2 2 0 0 0 2-2.3l-1-6A2 2 0 0 0 17 4H7"/>',
  tijera: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>',
  externo: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  sonidoNo: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 4 6M21 9l-4 6"/>',
  sonidoSi: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/>',
  rejilla: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  largo: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>',
  campana: '<path d="M3 11v3l12 5V6L3 11zM15 9h3a3 3 0 0 1 0 6h-3"/><path d="M6.5 15.5 8 21"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  directo: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  tijeras2: '<path d="M4 7h16M4 12h10M4 17h7"/>',
  estudio: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  robot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12v1M15 12v1M9 16h6"/>',
  grafica: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  luna: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  salir: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  cola: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 16 3 2-3 2z"/>',
  lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  texto: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  rayo: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  reintentar: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  papelera: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  estrella: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
const I = (n, cls = '') => `<svg class="icono ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
const LOGO = '<span class="logo"><svg viewBox="0 0 14 14"><path d="M3.5 2v10l8.5-5z"/></svg></span>';

// ---------- estado ----------
const E = { cuenta: localStorage.getItem('cuenta') || 'canal', cuentas: [], motivos: null, actividadVista: localStorage.getItem('actividadVista') || '' };
const cuentaActual = () => E.cuentas.find((c) => c.id === E.cuenta) || E.cuentas[0] || { id: 'canal', nombre: 'StreamClipper' };
async function motivos() {
  if (!E.motivos) { try { E.motivos = (await api('/api/movil/galeria')).motivos; } catch { E.motivos = {}; } }
  return E.motivos;
}

// ---------- acciones ----------
const Acc = {
  sirve: (id, n, nota = '') => api('/api/clips/valorar', { id, n, valor: 1, etiquetas: [], nota }),
  noSirve: (id, n, etiquetas, nota = '') => api('/api/clips/valorar', { id, n, valor: -1, etiquetas, nota }),
  quitarValoracion: (id, n) => api('/api/clips/valorar', { id, n, valor: 0, etiquetas: [], nota: '' }),
  recuperar: (id, n) => api('/api/clips/recuperar', { id, n }),
  textos: (id, n, titulo, texto) => api('/api/clips/texto', { id, n, titulo, texto }),
  gancho: (id, n, gancho) => api('/api/clips/gancho', { id, n, gancho }),
  quitarYoutube: (id, n) => api('/api/clips/youtube/quitar', { id, n }),
  quitarTiktok: (id, n) => api('/api/clips/tiktok/quitar', { id, n }),
  enviadoCampana: (id) => api('/api/campanas/enviado', { id }),
  video: (accion, id) => api(`/api/clips/${accion}`, { id }), // reintentar · urgente · quitar · aprobar · descartar-propuesto
  publicarYa: (id, n, cuenta = null) => api('/api/clips/youtube', { id, n, cuenta }),
  guardar: (id, n) => api('/api/recop/horizontal', { id, n, aprobar: true }),
  aprobar: (slug) => api('/api/estudio/estado', { slug, accion: 'aprobar' }),
  comentarEstudio: (slug, texto) => api('/api/estudio/comentar', { slug, texto, escena: null }),
};

// ---------- capas: hojas y visores ----------
function capa(html, alCerrar) {
  const c = $('#capa'); c.innerHTML = html; c.hidden = false;
  const cerrar = () => { c.hidden = true; c.innerHTML = ''; document.removeEventListener('keydown', tecla); alCerrar?.(); };
  const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  c.onclick = (e) => { if (e.target === c) cerrar(); };
  return { raiz: c, cerrar };
}
function hoja(titulo, ops) {
  const h = capa(`<div class="hoja" role="dialog" aria-label="${esc(titulo)}"><h2>${esc(titulo)}</h2>${ops.map((o, i) =>
    `<button class="op ${o.peligro ? 'peligro' : ''}" data-i="${i}">${o.icono ? I(o.icono) : ''}<span>${esc(o.texto)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></button>`).join('')}</div>`);
  h.raiz.querySelectorAll('.op').forEach((b) => { b.onclick = async () => { const o = ops[Number(b.dataset.i)]; h.cerrar(); try { await o.accion(); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } }; });
  return h;
}
async function hojaNoSirve(id, n, alHecho) {
  const m = await motivos();
  const h = capa(`<form class="hoja" role="dialog" aria-label="Por qué no sirve"><h2>¿Por qué no sirve?</h2>
    ${Object.entries(m).map(([k, v]) => `<label class="op marca"><input type="checkbox" name="m" value="${esc(k)}"><span>${esc(v.texto)}</span></label>`).join('')}
    <textarea name="nota" placeholder="Nota para la IA (opcional)" aria-label="Nota"></textarea>
    <button class="op" type="submit"><span><b>Marcar como «No sirve»</b></span></button></form>`);
  h.raiz.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, et = [...f.querySelectorAll('input[name="m"]:checked')].map((i) => i.value), nota = f.elements.nota.value.trim();
    if (!et.length && !nota) { aviso('Elige un motivo o escribe una nota'); return; }
    h.cerrar();
    try { await Acc.noSirve(id, n, et, nota); aviso('Marcado como «No sirve»'); alHecho?.(); } catch (err) { aviso(err.message); }
  };
}
// Formulario genérico: campos [{ nombre, etiqueta, valor, largo, max }] → alGuardar(valores).
function hojaFormulario(titulo, campos, alGuardar, { boton = 'Guardar', nota = '' } = {}) {
  const h = capa(`<form class="hoja" role="dialog" aria-label="${esc(titulo)}"><h2>${esc(titulo)}</h2>${nota ? `<p class="muted" style="padding:0 16px">${esc(nota)}</p>` : ''}
    ${campos.map((c) => `<label class="campo"><span>${esc(c.etiqueta)}</span>${c.largo ? `<textarea name="${c.nombre}" ${c.max ? `maxlength="${c.max}"` : ''}>${esc(c.valor || '')}</textarea>`
      : `<input name="${c.nombre}" value="${esc(c.valor || '')}" ${c.max ? `maxlength="${c.max}"` : ''}>`}</label>`).join('')}
    <button class="op" type="submit"><span><b>${esc(boton)}</b></span></button></form>`);
  h.raiz.querySelector('input, textarea')?.focus();
  h.raiz.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(campos.map((c) => [c.nombre, e.target.elements[c.nombre].value.trim()]));
    h.cerrar();
    try { await alGuardar(v); } catch (err) { if (err.message !== 'sesión') aviso(err.message); }
  };
}
// Todas las opciones de un clip (feed, reels y explorar usan la misma): ficha = /api/social (fichaClip).
function hojaClip(f, { alQuitar, alCambiar } = {}) {
  const yt = f.youtube, tk = f.tiktok, val = f.valoracion, publicado = yt && ['ok', 'subiendo'].includes(yt.estado);
  const ops = [];
  if (f.prefiltro?.oculto) ops.push({ texto: 'Volver a revisión', sub: `La app lo apartó: ${f.prefiltro.razon || f.prefiltro.motivo}`, icono: 'reintentar', accion: async () => { await Acc.recuperar(f.id, f.n); aviso('De vuelta en «Por revisar»'); alCambiar?.(); } });
  if (!val) ops.push({ texto: 'Sirve', icono: 'corazon', accion: async () => { await Acc.sirve(f.id, f.n); aviso('Sirve: a la cola de publicación'); alQuitar?.(); } },
    { texto: 'No sirve', icono: 'pulgar', peligro: true, accion: () => hojaNoSirve(f.id, f.n, alQuitar) });
  else ops.push({ texto: 'Quitar la valoración', sub: val.valor === 1 ? 'Ahora: sirve' : `Ahora: no sirve${val.etiquetas?.length ? ` (${val.etiquetas.join(', ')})` : ''}`, icono: 'reintentar', accion: async () => { await Acc.quitarValoracion(f.id, f.n); aviso('Valoración quitada'); alCambiar?.(); } });
  if (!publicado) ops.push({ texto: 'Editar título y descripción', sub: 'Es lo que se publica', icono: 'lapiz', accion: () => hojaFormulario('Textos del clip', [
    { nombre: 'titulo', etiqueta: 'Título', valor: f.titulo, max: 100 }, { nombre: 'texto', etiqueta: 'Descripción', valor: f.texto, largo: true, max: 2000 }],
    async (v) => { await Acc.textos(f.id, f.n, v.titulo, v.texto); aviso('Textos guardados'); alCambiar?.(); }) });
  if (!publicado && f.encuadrePropio) ops.push({ texto: 'Cambiar el texto en pantalla', sub: f.gancho ? `Ahora: «${f.gancho}»` : 'El texto fijo de arriba', icono: 'texto', accion: () => hojaFormulario('Texto en pantalla', [
    { nombre: 'gancho', etiqueta: 'Máx. 40 caracteres: creador + lo que hace', valor: f.gancho, max: 45 }],
    async (v) => { aviso('Repintando el vídeo…'); await Acc.gancho(f.id, f.n, v.gancho); aviso('Texto en pantalla cambiado'); alCambiar?.(); }, { nota: 'Se vuelve a generar el vídeo (tarda unos segundos).' }) });
  ops.push({ texto: 'Descargar el vídeo', sub: 'Para subirlo a mano donde quieras', icono: 'abajo', accion: () => { location.href = `/api/clips/video/${f.id}/${f.n}?descargar=1`; } });
  if (f.editable && !publicado) ops.push({ texto: 'Editar el vídeo', sub: 'Encuadre, inicio y final, textos y subtítulos', icono: 'tijera', accion: () => { location.hash = `#/editor/${f.id}/${f.n}`; } });
  if (!yt) ops.push({ texto: f.campana ? 'Programar en YouTube' : 'Publicar ya en YouTube', sub: f.campana ? 'En el siguiente hueco de la franja de la campaña' : undefined, icono: 'enviar', accion: () => elegirCuenta('youtube', async (cuenta) => { const r = await Acc.publicarYa(f.id, f.n, cuenta); aviso(r.programado ? `Campaña: programado ${hace(r.programado + 'Z')} (en su franja)` : 'En la cola de YouTube'); alCambiar?.(); }) });
  else if (yt.estado === 'pendiente' || yt.estado === 'error') ops.push({ texto: 'Quitar de la cola de YouTube', sub: yt.estado === 'error' ? `Falló: ${yt.error || ''}` : yt.cuando ? `Programado ${hace(yt.cuando)}` : 'En cola', icono: 'papelera', peligro: true, accion: async () => { await Acc.quitarYoutube(f.id, f.n); aviso('Quitado de la cola'); alCambiar?.(); } });
  else if (yt.yt) ops.push({ texto: 'Ver en YouTube', icono: 'externo', accion: () => window.open(`https://youtu.be/${yt.yt}`, '_blank', 'noopener') });
  if (!tk) ops.push({ texto: 'Publicar en TikTok', sub: 'Con las opciones que pide TikTok', icono: 'enviar', accion: () => elegirCuenta('tiktok', (cuenta) => hojaTiktok(f, alCambiar, cuenta)) });
  else if (tk.estado === 'pendiente' || tk.estado === 'error') ops.push({ texto: 'Quitar de la cola de TikTok', sub: tk.estado === 'error' ? `Falló: ${tk.error || ''}` : 'En cola', icono: 'papelera', peligro: true, accion: async () => { await Acc.quitarTiktok(f.id, f.n); aviso('Quitado de TikTok'); alCambiar?.(); } });
  ops.push({ texto: 'Guardar para recopilatorio', icono: 'guardar', accion: async () => { await Acc.guardar(f.id, f.n); aviso('Guardado para el recopilatorio'); } });
  ops.push({ texto: 'Rehacer el vídeo', sub: 'Volver a recortar el original, con otro tipo si quieres', icono: 'reintentar', accion: () => hojaTipoVideo('Rehacer como…', async (tipo) => { await api('/api/clips/rehacer', { id: f.id, tipo, urgente: true }); aviso('A la cola: se recorta de nuevo'); }) });
  if (f.original) ops.push({ texto: 'Ver el original', sub: 'En el minuto exacto', icono: 'externo', accion: () => window.open(f.original, '_blank', 'noopener') });
  hoja(f.titulo || 'Clip', ops);
}
// Chips de un clip: lo que importa para decidir de un vistazo.
function chipsClip(f) {
  const out = [];
  if (f.campana) out.push('<span class="chip acento">campaña</span>');
  if (f.ia) out.push(`<span class="chip" title="${esc(f.ia.motivo)}">${I('estrella')} momento de ${esc(f.ia.origen)}</span>`);
  if (f.puntos != null) out.push(`<span class="chip">${f.puntos} pts</span>`);
  if (f.emocion != null) out.push(`<span class="chip">emoción ${f.emocion}</span>`);
  if (f.encuadre) out.push(`<span class="chip ${f.encuadre.ok ? 'ok' : 'mal'}">${f.encuadre.ok ? 'encuadre ok' : `revisar: ${esc(f.encuadre.motivo || 'encuadre')}`}</span>`);
  if (f.logo) out.push(`<span class="chip ${f.logo.ok ? 'ok' : 'mal'}">${f.logo.ok ? 'logo ok' : `logo: ${esc(f.logo.motivo || 'revisar')}`}</span>`);
  if (!f.verificado) out.push('<span class="chip mal">textos sin revisar por la IA</span>');
  const EST = { pendiente: 'en cola de YouTube', subiendo: 'subiendo', ok: 'en YouTube', error: 'YouTube: error' };
  if (f.youtube) out.push(`<span class="chip ${f.youtube.estado === 'error' ? 'mal' : 'ok'}">${EST[f.youtube.estado] || f.youtube.estado}</span>`);
  if (f.tiktok) out.push(`<span class="chip ${f.tiktok.estado === 'error' ? 'mal' : 'ok'}">TikTok: ${esc(f.tiktok.estado)}</span>`);
  return out.length ? `<div class="chips">${out.join('')}</div>` : '';
}
function hojaTexto(titulo, ph, alGuardar) {
  const h = capa(`<div class="hoja" role="dialog"><h2>${esc(titulo)}</h2><textarea placeholder="${esc(ph)}" aria-label="${esc(ph)}"></textarea><button class="op" data-ok><span><b>Enviar</b></span></button></div>`);
  const ta = h.raiz.querySelector('textarea'); ta.focus();
  h.raiz.querySelector('[data-ok]').onclick = async () => { const t = ta.value.trim(); if (!t) return; h.cerrar(); try { await alGuardar(t); } catch (e) { aviso(e.message); } };
}
function visorHistorias(lista, inicio) {
  let i = inicio, t;
  const h = capa('<div class="visor" role="dialog" aria-label="Historias"></div>', () => clearTimeout(t));
  const pintar = () => {
    const s = lista[i]; clearTimeout(t);
    h.raiz.querySelector('.visor').innerHTML = `<div class="barras">${lista.map((_, k) => `<i class="${k < i ? 'hecha' : k === i ? 'ahora' : ''}"><b></b></i>`).join('')}</div>
      <div class="cab">${caraHistoria(s, 's32')}<span>${esc(s.titulo)}</span><span class="muted">${s.vivo ? 'EN DIRECTO' : esc(hace(s.fecha))}</span><button class="cerrar" aria-label="Cerrar">${I('cerrar')}</button></div>
      <div class="cuerpo">${s.poster ? `<img src="${esc(s.poster)}" alt="">` : ''}<div class="grande">${esc(s.texto || s.titulo)}</div>${s.fecha ? `<div class="muted">${esc(new Date(s.fecha).toLocaleString('es', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</div>` : ''}</div>
      <button class="zona izq" aria-label="Anterior"></button><button class="zona der" aria-label="Siguiente"></button>
      ${s.destino ? `<button class="ir boton primario">${s.destino === 'reels' ? 'Revisar ahora' : 'Abrir'}</button>` : ''}`;
    const v = h.raiz.querySelector('.visor');
    v.querySelector('.cerrar').onclick = h.cerrar;
    v.querySelector('.izq').onclick = () => { if (i > 0) { i--; pintar(); } };
    v.querySelector('.der').onclick = () => (i < lista.length - 1 ? (i++, pintar()) : h.cerrar());
    const ir = v.querySelector('.ir'); if (ir) ir.onclick = () => { h.cerrar(); if (s.destino === 'reels') location.hash = '#/reels'; else if (s.destino.startsWith('campana:')) cambiarCuenta(s.destino); };
    t = setTimeout(() => (i < lista.length - 1 ? (i++, pintar()) : h.cerrar()), 5000);
  };
  pintar();
}
const ICONO_HISTORIA = { revisar: 'corazon', directo: 'directo', procesando: 'tijera', estudio: 'estudio', recop: 'largo', campana: 'campana', programado: 'calendario' };
const caraHistoria = (s, tam) => `<span class="avatar ${tam}">${s.poster ? `<img src="${esc(s.poster)}" alt="" loading="lazy">` : I(ICONO_HISTORIA[s.tipo] || 'reloj')}</span>`;

// ---------- vídeo: se reproduce solo cuando está a la vista ----------
const observador = new IntersectionObserver((es) => { for (const e of es) { const v = e.target; if (e.isIntersecting && e.intersectionRatio > 0.6) v.play().catch(() => {}); else v.pause(); } }, { threshold: [0, 0.6, 1] });
function videoHtml(m, { cls = '' } = {}) {
  return `<video class="${cls}" src="${esc(m.url)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} muted loop playsinline preload="metadata"></video><button class="sonido" aria-label="Activar sonido">${I('sonidoNo')}</button>`;
}
function activarVideos(raiz) {
  raiz.querySelectorAll('video').forEach((v) => observador.observe(v));
  raiz.querySelectorAll('.sonido').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); const v = b.parentElement.querySelector('video'); v.muted = !v.muted; b.innerHTML = I(v.muted ? 'sonidoNo' : 'sonidoSi'); if (!v.muted) v.play(); }; });
}
function corazonGrande(cont) { const d = document.createElement('div'); d.className = 'corazon-grande'; d.innerHTML = I('corazon', 'lleno'); cont.appendChild(d); setTimeout(() => d.remove(), 850); }

// ---------- tarjeta ----------
function medios(p) {
  if (!p.medios?.length) return '';
  const vertical = p.medios[0].vertical !== false && p.tipo !== 'propuesta' && p.tipo !== 'recop';
  const uno = (m) => (m.tipo === 'video' ? videoHtml(m) : `<img src="${esc(m.url)}" alt="" loading="lazy">`);
  if (p.medios.length === 1) return `<div class="medios ${vertical ? 'vertical' : 'horizontal'}">${uno(p.medios[0])}</div>`;
  return `<div class="medios horizontal"><div class="carrusel">${p.medios.map((m) => `<div style="position:relative">${uno(m)}</div>`).join('')}</div>
    <div class="puntos-carrusel">${p.medios.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div></div>`;
}
function chipsDe(p) {
  const m = p.meta || {}, out = [];
  if (p.tipo === 'clip' && p.clip) return chipsClip(p.clip);
  if (p.tipo === 'publicado' && p.campana) out.push('<span class="chip acento">campaña</span>');
  if (p.tipo === 'publicado' && m.pct_visto != null) out.push(`<span class="chip">${Math.round(m.pct_visto)} % visto</span>`);
  if (p.tipo === 'propuesta' && p.estado?.estudio) out.push(`<span class="chip">${esc(p.estado.estudio)} · v${p.estado.version}</span>`);
  return out.length ? `<div class="chips">${out.join('')}</div>` : '';
}
function tarjeta(p) {
  const etiqueta = p.estado?.revisar ? '<span class="etiqueta revisar">Por revisar</span>' : p.tipo === 'propuesta' && ['propuesta', 'cambios'].includes(p.estado?.estudio) ? '<span class="etiqueta revisar">Propuesta</span>' : '';
  const acciones = {
    clip: `<button data-a="sirve" aria-label="Sirve">${I('corazon')}</button><button data-a="nota" aria-label="Nota">${I('comentar')}</button><button data-a="publicar" aria-label="Publicar ya">${I('enviar')}</button><button class="derecha" data-a="guardar" aria-label="Guardar para recopilatorio">${I('guardar')}</button>`,
    propuesta: ['propuesta', 'cambios'].includes(p.estado?.estudio) ? `<button data-a="aprobar" aria-label="Aprobar">${I('corazon')}</button><button data-a="comentar" aria-label="Pedir cambios">${I('comentar')}</button>` : `<button data-a="comentar" aria-label="Comentar">${I('comentar')}</button>`,
    publicado: `<button data-a="yt" aria-label="Abrir en YouTube">${I('externo')}</button>`,
    recop: `<button data-a="verRecop" aria-label="Abrir en recopilatorios">${I('externo')}</button>`,
  }[p.tipo] || '';
  const meta = p.tipo === 'publicado' ? `<div class="post-meta tnum">${num(p.meta?.vistas)} visualizaciones · ${num(p.meta?.megusta)} me gusta</div>`
    : p.tipo === 'propuesta' && p.estado?.comentarios_pendientes ? `<div class="post-meta">${p.estado.comentarios_pendientes} comentarios sin atender</div>` : '';
  return `<article class="post" data-id="${esc(p.id)}">
    <header class="post-cab"><span class="avatar s32">${esc(iniciales(p.autor?.nombre))}</span><span class="quien">${esc(p.autor?.nombre)}</span><span class="cuando">· ${esc(hace(p.fecha))}</span>${etiqueta}
      <button class="mas" data-a="mas" aria-label="Más opciones">${I('mas')}</button></header>
    ${medios(p)}
    ${acciones ? `<div class="post-acc">${acciones}</div>` : ''}
    ${meta}
    <div class="post-texto"><b>${esc(p.autor?.nombre)}</b>${esc(p.titulo)}${p.clip?.gancho ? `<br><span class="muted">En pantalla: «${esc(p.clip.gancho)}»</span>` : ''}${p.texto ? ` <span class="muted">${esc(String(p.texto).slice(0, 220))}</span>` : ''}</div>
    ${chipsDe(p)}
  </article>`;
}
function conectarTarjetas(raiz, posts, recargar) {
  const porId = Object.fromEntries(posts.map((p) => [p.id, p]));
  raiz.querySelectorAll('.post').forEach((art) => {
    const p = porId[art.dataset.id]; if (!p) return;
    const quitar = () => { art.style.transition = 'opacity .25s'; art.style.opacity = '0'; setTimeout(() => art.remove(), 260); };
    const hacer = async (a, b) => {
      try {
        if (a === 'sirve') { b.classList.add('on-rojo'); corazonGrande(art.querySelector('.medios') || art); await Acc.sirve(p.ref.id, p.ref.n); aviso('Sirve: a la cola de publicación'); setTimeout(quitar, 700); }
        if (a === 'nota') hojaTexto('Nota sobre el clip', 'Qué tiene de bueno o de malo (la IA aprende de esto)', async (t) => { hoja('¿Y el veredicto?', [{ texto: 'Sirve', icono: 'corazon', accion: async () => { await Acc.sirve(p.ref.id, p.ref.n, t); aviso('Guardado'); quitar(); } }, { texto: 'No sirve', icono: 'pulgar', accion: async () => { await Acc.noSirve(p.ref.id, p.ref.n, [], t); aviso('Guardado'); quitar(); } }]); });
        if (a === 'publicar') { await Acc.publicarYa(p.ref.id, p.ref.n); aviso('En la cola de YouTube'); setTimeout(quitar, 400); }
        if (a === 'guardar') { b.classList.add('on-acento'); await Acc.guardar(p.ref.id, p.ref.n); aviso('Guardado para el recopilatorio'); }
        if (a === 'aprobar') { b.classList.add('on-rojo'); await Acc.aprobar(p.ref.slug); aviso('Propuesta aprobada: se produce sola esta noche'); recargar?.(); }
        if (a === 'comentar') hojaTexto('Pedir cambios', 'Qué cambiarías de la propuesta', async (t) => { await Acc.comentarEstudio(p.ref.slug, t); aviso('Comentario enviado al Estudio'); });
        if (a === 'yt' || a === 'enlace') window.open(p.enlace, '_blank', 'noopener');
        if (a === 'verRecop') location.hash = '#/recopilatorios';
        if (a === 'mas' && p.tipo === 'clip' && p.clip) return hojaClip(p.clip, { alQuitar: quitar, alCambiar: recargar });
        if (a === 'mas') hoja(p.titulo || 'Opciones', [
          ...(p.enlace ? [{ texto: 'Abrir', icono: 'externo', accion: () => window.open(p.enlace, '_blank', 'noopener') }] : []),
          ...(p.tipo === 'recop' ? [{ texto: 'Abrir en recopilatorios', sub: 'Bolsa y montaje', icono: 'largo', accion: () => { location.hash = '#/recopilatorios'; } }] : []),
          ...(p.tipo === 'propuesta' ? [{ texto: 'Ver la propuesta completa', sub: 'Escenas, guion y comentarios', icono: 'estudio', accion: () => { location.hash = `#/propuesta/${encodeURIComponent(p.ref.slug)}`; } },
            { texto: 'Descartar', icono: 'cerrar', peligro: true, accion: async () => { await api('/api/estudio/estado', { slug: p.ref.slug, accion: 'descartar' }); aviso('Descartada'); quitar(); } }] : []),
        ]);
      } catch (e) { if (e.message !== 'sesión') aviso(e.message); }
    };
    art.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => hacer(b.dataset.a, b); });
    const m = art.querySelector('.medios');
    if (m && p.tipo === 'clip') m.ondblclick = () => hacer('sirve', art.querySelector('[data-a="sirve"]'));
    const car = art.querySelector('.carrusel');
    if (car) car.onscroll = () => { const k = Math.round(car.scrollLeft / car.clientWidth); art.querySelectorAll('.puntos-carrusel i').forEach((d, j) => d.classList.toggle('on', j === k)); };
  });
  activarVideos(raiz);
}

// ---------- vistas ----------
// ---------- primeros pasos: del panel vacío al primer clip revisado (solo el dueño) ----------
// Página del manual (docs/manual) con la instalación de cada herramienta.
const MANUAL_HERRAMIENTAS = '/manual.pdf#page=3';
let relojPrimeros;
const REPO = 'https://github.com/2mingho/streamclipper';
// «Reportar un problema»: abre una incidencia de GitHub ya rellenada con el diagnóstico (sin datos personales) para revisarla antes de enviarla.
async function reportarProblema() {
  let d = {}; try { d = await api('/api/diagnostico'); } catch {}
  const h = d.herramientas || {}, si = (x) => (x ? 'sí' : 'no');
  const cuerpo = ['**Qué pasó / What happened**', '', '(Cuéntalo aquí: qué hiciste y qué esperabas. No pegues contraseñas ni claves.)', '', '**Diagnóstico**',
    `- StreamClipper: ${d.version || '?'}`, `- Sistema: ${d.os || '?'}`, `- Node.js: ${d.node || '?'}`,
    `- FFmpeg: ${si(h.ffmpeg)} · yt-dlp: ${si(h['yt-dlp'])} · Whisper: ${si(h.whisper)}`, `- Primeros pasos: ${d.paso || '?'}`, `- Último error: ${d.error || '?'}`].join('\n');
  window.open(`${REPO}/issues/new?${new URLSearchParams({ title: 'Problema: ', body: cuerpo })}`, '_blank', 'noopener');
}
function htmlTelemetria(t) {
  if (!t || t.preguntado || t.forzadaOff) return '';
  return `<div class="tele-pp"><div><b>¿Nos ayudas a mejorar StreamClipper?</b><br><small class="muted">Envía datos anónimos de uso: versión, sistema, qué pasos completas y códigos de error. Nunca títulos, enlaces ni nombres. <a href="${REPO}/blob/main/TELEMETRY.md" target="_blank" rel="noopener">Qué se envía exactamente</a></small></div>
    <div class="botones"><button class="boton primario" data-pp="tele-si">Sí, ayudar</button><button class="boton" data-pp="tele-no">No, gracias</button></div></div>`;
}
const FASE_VIDEO = { cola: 'En la cola: empieza en unos segundos', procesando: 'En marcha', troceando: 'Bajando los momentos elegidos', propuesto: 'Esperando tu aprobación', descartado: 'Descartado', error: 'No se pudo recortar' };
function pasoPrimeros(k, p, cuerpo, boton = '') {
  return `<li class="paso ${p.hecho ? 'hecho' : ''} ${p.opcional ? 'opcional' : ''}" data-paso="${p.id}">
    <span class="marca-paso" aria-hidden="true">${p.hecho ? I('check') : esc(String(k))}</span>
    <div class="txt"><b>${esc(p.titulo)}</b>${p.opcional ? ' <span class="chip-estado">Opcional</span>' : ''}<div class="detalle">${cuerpo}</div></div>
    ${boton ? `<div class="botones">${boton}</div>` : ''}</li>`;
}
function htmlPrimeros(d) {
  const P = Object.fromEntries(d.pasos.map((p) => [p.id, p]));
  const obligatorios = d.pasos.filter((p) => !p.opcional), hechos = obligatorios.filter((p) => p.hecho).length;
  if (d.completo) return `<div class="primeros-cab"><div><b>Primeros pasos completados</b><br><small class="muted">Tu primer clip está revisado. Lo siguiente: añade streamers para que StreamClipper los vigile solo.</small></div><button class="enlace" data-pp="ocultar">Ocultar</button></div>${htmlTelemetria(d.telemetria)}`;
  const h = P.herramientas, faltan = h.detalle.filter((x) => x.obligatorio && !x.ok), extra = h.detalle.filter((x) => !x.obligatorio);
  const herr = (faltan.length ? `Falta ${faltan.map((x) => `<b>${esc(x.nombre)}</b>`).join(' y ')}: ${esc(faltan.map((x) => x.para).join(' '))}`
    : 'FFmpeg y yt-dlp están listos.') + `<ul class="herr">${extra.map((x) => `<li><span class="punto-estado ${x.ok ? 'ok' : ''}"></span>${esc(x.nombre)}: ${x.ok ? 'listo' : esc(x.para)}</li>`).join('')}</ul>`;
  const v = P.procesando.video;
  const proc = !v ? 'Cuando añadas un vídeo, aquí verás en qué fase va.'
    : P.procesando.hecho ? `«${esc(v.titulo || 'Tu vídeo')}» ya tiene clips.`
    : `<span class="fase ${v.estado === 'error' ? 'error-txt' : ''}">${esc(FASE_VIDEO[v.estado] || v.estado)}${v.paso && v.estado === 'procesando' ? `: ${esc(v.paso)}` : ''}</span>${v.estado === 'error' && v.error ? `<br><small>${esc(v.error)}</small>` : ''}<br><small class="muted">«${esc(v.titulo || 'Tu vídeo')}» · añadido ${esc(hace(v.creado))}</small>`;
  const btnProc = v && !P.procesando.hecho ? (v.estado === 'error' ? `<button class="boton primario" data-pp="reintentar" data-id="${v.id}">Reintentar</button><button class="boton" data-pp="reportar">Reportar un problema</button>` : '<a class="boton" href="#/cola">Ver la cola</a>') : '';
  return `<div class="primeros-cab"><div><b>Primeros pasos</b> <span class="muted tnum">· ${hechos} de ${obligatorios.length}</span><br><small class="muted">Hasta tu primer clip, en unos 20 minutos.</small></div><button class="enlace" data-pp="ocultar">Ocultar</button></div>
    <div class="progreso-pp" role="progressbar" aria-valuemin="0" aria-valuemax="${obligatorios.length}" aria-valuenow="${hechos}"><i style="width:${(hechos / obligatorios.length) * 100}%"></i></div>
    <ol class="pasos-pp">
      ${pasoPrimeros(1, h, herr, h.hecho ? '<button class="boton" data-pp="comprobar">Comprobar</button>' : `<a class="boton primario" href="${MANUAL_HERRAMIENTAS}" target="_blank" rel="noopener">Cómo instalarlo</a><button class="boton" data-pp="comprobar">Comprobar</button>`)}
      ${pasoPrimeros(2, P.video, P.video.hecho ? 'Hecho. Puedes añadir más desde Crear › Vídeo.' : 'Pega el enlace de un vídeo o un directo ya emitido de YouTube, Twitch o Kick. Si es largo, StreamClipper elige sus mejores momentos.',
        P.video.hecho ? '' : `<button class="boton ${h.hecho ? 'primario' : ''}" data-pp="video">Pegar un enlace</button>`)}
      ${pasoPrimeros(3, P.procesando, proc, btnProc)}
      ${pasoPrimeros(4, P.revisar, P.revisar.hecho ? 'Hecho. Cada «Sirve» o «No sirve» enseña a la app qué te gusta.' : P.revisar.video ? 'Tu primer clip está listo. Míralo y marca «Sirve» o «No sirve».' : 'Cuando el vídeo termine, lo verás aquí.',
        P.revisar.video && !P.revisar.hecho ? '<a class="boton primario" href="#/reels">Abrir mi primer clip</a>' : '')}
      ${P.ia ? pasoPrimeros(5, P.ia, P.ia.hecho ? `Hecho: ${esc(P.ia.detalle || 'IA conectada')}.` : 'Para que cada clip salga con título, texto en pantalla y descripciones. ¿Sin cuenta de IA? Usa tu cuenta de Google: una clave gratuita de Gemini se saca en tres pasos, sin tarjeta. También vale tu propio modelo (Ollama, LM Studio, OpenRouter, OpenAI…).', P.ia.hecho ? '' : '<a class="boton primario" href="#/ajustes/ia/gemini">Gemini gratis con Google</a><a class="boton" href="#/ajustes/ia">Otras opciones</a>') : ''}
      ${pasoPrimeros(6, P.streamer, P.streamer.hecho ? 'Hecho: StreamClipper mira sus vídeos nuevos solo.' : 'Un canal de YouTube o Twitch que StreamClipper vigilará solo.', P.streamer.hecho ? '' : '<button class="boton" data-pp="streamer">Añadir streamer</button>')}
      ${pasoPrimeros(7, P.youtube, P.youtube.hecho ? 'Hecho.' : 'Para publicar los clips desde aquí. Necesita una app propia en Google Cloud (el manual lo explica).', P.youtube.hecho ? '' : '<a class="boton" href="#/ajustes/publicacion">Conectar YouTube</a>')}
    </ol>${htmlTelemetria(d.telemetria)}`;
}
async function montarPrimeros(el, { refrescar = false } = {}) {
  clearTimeout(relojPrimeros);
  if (!el || E.yo?.rol !== 'dueno') return;
  let d; try { d = await api(`/api/primeros-pasos${refrescar ? '?refrescar=1' : ''}`); } catch { el.hidden = true; return; }
  if (!el.isConnected) return;
  el.hidden = d.oculto; if (d.oculto) return;
  el.classList.toggle('completo', d.completo);
  el.innerHTML = htmlPrimeros(d);
  const recargar = (o) => montarPrimeros(el, o);
  el.querySelectorAll('[data-pp]').forEach((b) => { b.onclick = async () => {
    const op = b.dataset.pp;
    try {
      if (op === 'ocultar') { await api('/api/primeros-pasos', { oculto: true }); el.hidden = true; aviso('Puedes volver a abrirlos desde Más › Primeros pasos'); }
      if (op === 'comprobar') { b.disabled = true; await recargar({ refrescar: true }); aviso('Comprobado'); }
      if (op === 'video') hojaPrimerVideo(() => recargar());
      if (op === 'streamer') hojaNuevoStreamer();
      if (op === 'tele-si' || op === 'tele-no') { await api('/api/telemetria', { activa: op === 'tele-si' }); aviso(op === 'tele-si' ? 'Gracias. Puedes cambiarlo en Ajustes › Servidor › Privacidad' : 'Entendido: no se envía nada'); recargar(); }
      if (op === 'reportar') reportarProblema();
      if (op === 'reintentar') { await api('/api/clips/reintentar', { id: Number(b.dataset.id) }); aviso('Vuelve a la cola'); recargar(); }
    } catch (e) { errAviso(e); }
  }; });
  // Mientras el primer vídeo se recorta, la fase se actualiza sola.
  const p3 = d.pasos.find((p) => p.id === 'procesando');
  if (!d.completo && p3.video && !p3.hecho && p3.video.estado !== 'error') relojPrimeros = setTimeout(() => { if (['', '#/'].includes(location.hash) && $('#capa').hidden) recargar(); }, 5000);
}
function hojaPrimerVideo(alTerminar) {
  hojaFormulario('Tu primer vídeo', [{ nombre: 'fuente', etiqueta: 'Enlace de YouTube, Twitch o Kick' }],
    async (v) => {
      if (!/^https?:\/\/\S+$/i.test(v.fuente)) throw new Error('Pega un enlace completo, que empiece por https://');
      await api('/api/clips/videos', { fuente: v.fuente, tipo: 'general', urgente: true });
      aviso('Recibido: empieza a recortarse'); alTerminar?.();
    },
    { boton: 'Recortar este vídeo', nota: 'Copia el enlace desde la barra del navegador. Un vídeo corto o un clip de Twitch tarda un par de minutos; uno largo, algo más: primero busca los mejores momentos y solo descarga esos.' });
}

async function vistaInicio(main) {
  main.innerHTML = `<div class="inicio"><div class="columna-feed"><section class="primeros" aria-label="Primeros pasos" hidden></section><div class="historias" aria-label="Historias"></div><div class="feed"><p class="cargando">Cargando…</p></div></div><aside class="columna-der"></aside></div>`;
  const cargar = async () => {
    const [h, f] = await Promise.all([E.cuenta === 'canal' ? api('/api/social/historias') : Promise.resolve({ historias: [] }), api(`/api/social/feed?cuenta=${encodeURIComponent(E.cuenta)}`)]);
    const hs = h.historias;
    const cont = $('.historias', main);
    cont.innerHTML = hs.map((s, k) => `<button class="historia" data-k="${k}"><span class="anillo ${s.activo ? 'activo' : ''}"><span class="dentro"><span class="cara">${s.poster ? `<img src="${esc(s.poster)}" alt="">` : I(ICONO_HISTORIA[s.tipo] || 'reloj')}</span></span>${s.vivo ? '<span class="vivo">EN VIVO</span>' : ''}</span><span class="nombre">${esc(s.titulo)}</span></button>`).join('');
    cont.hidden = !hs.length;
    cont.querySelectorAll('.historia').forEach((b) => { b.onclick = () => visorHistorias(hs, Number(b.dataset.k)); });
    const feed = $('.feed', main);
    feed.innerHTML = f.posts.length ? f.posts.map(tarjeta).join('') : `<div class="vacio">${I('check')}<p><b>Estás al día.</b><br>No hay nada que revisar ahora mismo.</p></div>`;
    conectarTarjetas(feed, f.posts, cargar);
  };
  montarPrimeros($('.primeros', main));
  await cargar();
  columnaDerecha($('.columna-der', main));
}
async function columnaDerecha(el) {
  if (!el || getComputedStyle(el).display === 'none') return;
  const c = cuentaActual();
  // Lo programado (rápido).
  let prox = []; try { prox = ((await api('/api/social/perfil?cuenta=canal')).pestañas?.programados || []).filter((x) => x.fecha).slice(0, 6); } catch {}
  el.innerHTML = `<div class="yo"><span class="avatar s56">${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : esc(iniciales(c.nombre))}</span><div><div class="n">${esc(c.nombre)}</div><div class="muted">${esc(c.tipo === 'campana' ? 'Campaña' : 'Canal de YouTube')}</div></div><button class="cambiar" data-cambiar>Cambiar</button></div>
    <div class="bloque-titulo"><span>Programado</span><a href="#/perfil" style="color:var(--texto)">Ver todo</a></div>
    ${prox.map((p) => `<div class="linea-proximo"><img src="${esc(p.poster)}" alt="" style="width:36px;height:48px;object-fit:cover;border-radius:6px;background:var(--superficie)" loading="lazy"><span style="flex:1;min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.titulo)}</span><span class="muted">${esc(hace(p.fecha))}${p.campana ? ' · campaña' : ''}</span></span></div>`).join('') || '<p class="muted">Nada programado.</p>'}
    <div class="pie"><a href="#/ajustes">Ajustes</a> · <a href="#/sistema">Servidor</a> · <a href="#/operaciones">Operaciones</a><br>StreamClipper · AGPL-3.0</div>`;
  el.querySelector('[data-cambiar]').onclick = selectorCuentas;
}

async function vistaReels(main) {
  main.innerHTML = '<div class="reels" aria-label="Reels"><p class="cargando">Cargando…</p></div>';
  const { clips } = await api(`/api/social/reels?cuenta=${encodeURIComponent(E.cuenta)}`);
  const cont = $('.reels', main);
  if (!clips.length) { cont.innerHTML = `<div class="vacio" style="align-self:center">${I('reels')}<p><b>No hay clips por revisar.</b><br>Los nuevos aparecerán aquí.</p></div>`; return; }
  cont.innerHTML = clips.map((c, k) => `<section class="reel" data-k="${k}"><div class="pantalla">${videoHtml(c.medio)}
      <div class="info"><div class="quien"><span class="avatar s32">${esc(iniciales(c.canal))}</span>${esc(c.canal)}</div><p>${esc(c.titulo)}</p>${chipsClip(c)}</div></div>
    <div class="lado"><button data-a="sirve" aria-label="Sirve">${I('corazon')}<span>Sirve</span></button><button data-a="no" aria-label="No sirve">${I('pulgar')}<span>No</span></button>
      <button data-a="nota" aria-label="Nota">${I('comentar')}<span>Nota</span></button><button data-a="mas" aria-label="Más">${I('mas')}</button></div></section>`).join('');
  const siguiente = (sec) => { const n = sec.nextElementSibling; if (n) n.scrollIntoView({ behavior: 'smooth' }); else location.hash = '#/'; };
  cont.querySelectorAll('.reel').forEach((sec) => {
    const c = clips[Number(sec.dataset.k)];
    const sirve = async () => { sec.querySelector('[data-a="sirve"]').classList.add('on-rojo'); corazonGrande(sec.querySelector('.pantalla')); try { await Acc.sirve(c.id, c.n); aviso('Sirve'); } catch (e) { aviso(e.message); } setTimeout(() => siguiente(sec), 650); };
    sec.querySelector('.pantalla').ondblclick = sirve;
    sec.querySelector('[data-a="sirve"]').onclick = sirve;
    sec.querySelector('[data-a="no"]').onclick = () => hojaNoSirve(c.id, c.n, () => siguiente(sec));
    sec.querySelector('[data-a="nota"]').onclick = () => hojaTexto('Nota sobre el clip', 'La IA aprende de esto', async (t) => hoja('¿Y el veredicto?', [{ texto: 'Sirve', icono: 'corazon', accion: async () => { await Acc.sirve(c.id, c.n, t); siguiente(sec); } }, { texto: 'No sirve', icono: 'pulgar', accion: async () => { await Acc.noSirve(c.id, c.n, [], t); siguiente(sec); } }]));
    sec.querySelector('[data-a="mas"]').onclick = () => hojaClip(c, { alQuitar: () => siguiente(sec) });
  });
  activarVideos(cont);
  document.onkeydown = (e) => {
    if (location.hash !== '#/reels' || !$('#capa').hidden) return;
    const vis = [...cont.querySelectorAll('.reel')].find((s) => Math.abs(s.getBoundingClientRect().top - cont.getBoundingClientRect().top) < 40);
    if (!vis) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); siguiente(vis); }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); vis.previousElementSibling?.scrollIntoView({ behavior: 'smooth' }); }
    if (e.key === 'l') vis.querySelector('[data-a="sirve"]').click();
  };
}

async function vistaExplorar(main) {
  const filtro = sessionStorage.getItem('filtro') || 'todo', q = sessionStorage.getItem('q') || '';
  main.innerHTML = `<div class="explorar"><label class="buscador">${I('buscar')}<input type="search" placeholder="Buscar clips, streamers o vídeos" value="${esc(q)}" aria-label="Buscar"></label><div class="filtros" role="toolbar"></div><div class="rejilla"><p class="cargando">Cargando…</p></div></div>`;
  const NOMBRE = { todo: 'Todo', pendientes: 'Por revisar', descartados_app: 'Descartados por la app', clips: 'Clips', campanas: 'Campañas', propuestas: 'Propuestas del Estudio', largos: 'Vídeos largos', horizontales: 'Horizontales', recopilatorios: 'Recopilatorios', publicados: 'Publicados', estudio: 'Shorts del Estudio' };
  let turno = 0;
  const cargar = async () => {
    const f = sessionStorage.getItem('filtro') || 'todo', t = sessionStorage.getItem('q') || '', mio = ++turno;
    const r = await api(`/api/social/explorar?filtro=${f}&q=${encodeURIComponent(t)}`);
    if (mio !== turno || !main.querySelector('.explorar')) return; // llegó tarde: otro filtro u otra pantalla
    $('.filtros', main).innerHTML = r.filtros.map((x) => `<button class="filtro" aria-pressed="${x === f}" data-f="${x}">${NOMBRE[x] || x}</button>`).join('');
    $('.filtros', main).querySelectorAll('.filtro').forEach((b) => { b.onclick = () => { sessionStorage.setItem('filtro', b.dataset.f); cargar(); }; });
    const EST = { publicado: 'Publicado', en_cola: 'En cola', subiendo: 'Subiendo', error: 'Error al subir', aprobado: 'Sirve', descartado: 'No sirve', descartado_app: 'Apartado', pendiente: '' };
    $('.rejilla', main).innerHTML = r.items.length ? r.items.map((it, k) => `<button class="celda ${it.vertical ? '' : 'ancha'}" data-k="${k}" aria-label="${esc(it.titulo)}">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : ''}${!it.vertical ? `<span class="titulo-celda"><small>${esc({ propuesta: 'Propuesta del Estudio', largo: 'Vídeo largo', horizontal: 'Horizontal' }[it.tipo] || it.canal || '')}${it.tipo === 'propuesta' && ESTADO_PROP[it.estado] ? ` · ${esc(ESTADO_PROP[it.estado])}` : ''}</small>${esc(it.titulo)}</span>` : ''}
      <span class="marca-celda">${I(it.vertical ? 'reels' : 'largo')}</span>${EST[it.estado] ? `<span class="estado-celda">${EST[it.estado]}</span>` : ''}</button>`).join('')
      : `<div class="vacio" style="grid-column:1/-1">${I('buscar')}<p>Sin resultados.</p></div>`;
    $('.rejilla', main).querySelectorAll('.celda').forEach((b) => { b.onclick = () => { const it = r.items[Number(b.dataset.k)]; if (it.slug) location.hash = `#/propuesta/${encodeURIComponent(it.slug)}`; else verItem(it); }; });
  };
  let tq; $('input', main).oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { sessionStorage.setItem('q', e.target.value); cargar(); }, 250); };
  void filtro; await cargar();
}
function verItem(it) {
  const h = capa(`<div class="visor" style="background:#000"><div class="cab"><span>${esc(it.canal)}</span>${it.ficha ? `<button class="cerrar" data-opciones aria-label="Opciones">${I('mas')}</button>` : ''}<button class="cerrar" data-cerrar aria-label="Cerrar">${I('cerrar')}</button></div>
    <video src="${esc(it.video)}" poster="${esc(it.poster || '')}" controls autoplay playsinline style="width:100%;height:100%;object-fit:contain"></video>
    ${it.ficha ? `<div class="pie-visor"><p>${esc(it.ficha.titulo)}</p>${chipsClip(it.ficha)}</div>` : ''}</div>`);
  h.raiz.querySelector('[data-cerrar]').onclick = h.cerrar;
  const o = h.raiz.querySelector('[data-opciones]'); if (o) o.onclick = () => { h.cerrar(); hojaClip(it.ficha, { alCambiar: () => ruta() }); };
}

async function vistaPerfil(main) {
  main.innerHTML = '<div class="perfil"><p class="cargando">Cargando…</p></div>';
  const r = await api(`/api/social/perfil?cuenta=${encodeURIComponent(E.cuenta)}`);
  const cont = $('.perfil', main), c = r.cuenta;
  const P2 = r.pestañas, tabs = [['shorts', 'rejilla', 'Shorts'], ['largos', 'largo', 'Vídeos'], ['campanas', 'campana', 'Campañas'], ['programados', 'calendario', 'Programados']];
  let tab = sessionStorage.getItem('tabPerfil') || 'shorts';
  cont.innerHTML = `<header class="perfil-cab"><span class="avatar s150">${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : esc(iniciales(c.nombre))}</span><div>
      <h1>${esc(c.nombre)} <a class="boton" href="#/estadisticas">Estadísticas</a><a class="boton" href="${E.cuenta.startsWith('campana:') ? `#/ajustes/campana/${encodeURIComponent(E.cuenta.slice(8))}` : '#/ajustes/clips'}">Editar</a></h1>
      <div class="contadores"><span><b class="tnum">${num(r.contadores.publicaciones)}</b> publicaciones</span><span><b class="tnum">${num(r.contadores.suscriptores)}</b> suscriptores</span><span><b class="tnum">${num(r.contadores.vistas)}</b> vistas</span></div>
      <div class="bio">${esc(c.bio || '')}</div></div></header>
    <div class="pestanas" role="tablist">${tabs.map(([k, ic, t]) => `<button class="pestana" role="tab" aria-selected="${k === tab}" data-t="${k}">${I(ic)}<span>${t}</span></button>`).join('')}</div><div class="rejilla"></div>`;
  const pintar = () => {
    const items = P2[tab] || [];
    $('.rejilla', cont).innerHTML = items.length ? items.map((it, k) => `<a class="celda" data-k="${k}" href="${esc(it.enlace || '#')}" ${it.enlace ? 'target="_blank" rel="noopener"' : ''}>${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : `<span class="vacio" style="padding:12px;font-size:12px">${esc(it.titulo)}</span>`}
      ${it.vistas != null ? `<span class="estado-celda">${num(it.vistas)} vistas</span>` : it.fecha && tab === 'programados' ? `<span class="estado-celda">${esc(hace(it.fecha))}</span>` : tab === 'campanas' ? `<span class="estado-celda">${it.enviado ? 'Enviado' : 'Sin enviar'}${it.retirable_desde ? (new Date(it.retirable_desde.replace(' ', 'T') + 'Z') > new Date() ? ` · hasta ${new Date(it.retirable_desde.replace(' ', 'T') + 'Z').toLocaleDateString('es', { day: 'numeric', month: 'short' })}` : ' · ya se puede retirar') : ''}</span>` : ''}</a>`).join('')
      : `<div class="vacio" style="grid-column:1/-1">${I(tabs.find((x) => x[0] === tab)[1])}<p>Nada por aquí todavía.</p></div>`;
    $('.rejilla', cont).querySelectorAll('.celda[data-k]').forEach((a) => {
      const it = items[Number(a.dataset.k)];
      if (tab === 'programados') a.onclick = (e) => { e.preventDefault(); verItem({ canal: it.campana ? 'Campaña' : 'Programado', video: it.video, poster: it.poster }); };
      if (tab === 'campanas') a.onclick = (e) => { e.preventDefault(); hoja(it.titulo || 'Publicación de campaña', [
        { texto: 'Abrir en YouTube', icono: 'externo', accion: () => window.open(it.enlace, '_blank', 'noopener') },
        ...(it.enviado ? [] : [{ texto: 'Marcar como enviado a la campaña', sub: 'Ya lo enviaste a la plataforma de la campaña', icono: 'check', accion: async () => { await Acc.enviadoCampana(it.id); it.enviado = 1; aviso('Marcado como enviado'); pintar(); } }])]); };
    });
  };
  cont.querySelectorAll('.pestana').forEach((b) => { b.onclick = () => { tab = b.dataset.t; sessionStorage.setItem('tabPerfil', tab); cont.querySelectorAll('.pestana').forEach((x) => x.setAttribute('aria-selected', x === b)); pintar(); }; });
  pintar();
}

const ICONO_EVENTO = { publicado: ['check', 'verde'], error: ['alerta', 'rojo'], autopiloto: ['robot', 'acento'], alerta: ['alerta', 'rojo'], campana: ['campana', 'acento'], estudio: ['estudio', ''], rendimiento: ['grafica', ''] };
async function vistaActividad(main) {
  main.innerHTML = '<div class="lista"><h1>Actividad</h1><p class="cargando">Cargando…</p></div>';
  const { eventos } = await api('/api/social/actividad');
  const visto = E.actividadVista; E.actividadVista = new Date().toISOString(); localStorage.setItem('actividadVista', E.actividadVista);
  const grupos = [['Nuevo', (e) => !visto || e.fecha > visto], ['Hoy', (e) => Date.now() - new Date(e.fecha) < 864e5], ['Esta semana', () => true]];
  const usados = new Set(); let html = '';
  for (const [t, f] of grupos) {
    const g = eventos.filter((e) => !usados.has(e) && f(e)); g.forEach((e) => usados.add(e));
    if (g.length) html += `<div class="seccion-fecha">${t}</div>` + g.map((e) => { const [ic, col] = ICONO_EVENTO[e.tipo] || ['reloj', '']; return `<div class="fila"><span class="ico-fila ${col}">${I(ic)}</span><div class="txt">${e.enlace ? `<a href="${esc(e.enlace)}" target="_blank" rel="noopener">${esc(e.texto)}</a>` : esc(e.texto)} <small>${esc(hace(e.fecha))}</small></div>${e.accion?.tipo === 'enviado' ? `<button class="boton" data-enviado="${e.accion.id}">Enviado</button>` : ''}</div>`; }).join('');
  }
  $('.lista', main).innerHTML = '<h1>Actividad</h1>' + (html || `<div class="vacio">${I('corazon')}<p>Sin actividad todavía.</p></div>`);
  $('.lista', main).querySelectorAll('[data-enviado]').forEach((b) => { b.onclick = async () => { try { await Acc.enviadoCampana(Number(b.dataset.enviado)); b.replaceWith(Object.assign(document.createElement('span'), { className: 'chip ok', textContent: 'enviado' })); aviso('Marcado como enviado a la campaña'); } catch (e) { aviso(e.message); } }; });
  Promise.all([api('/api/operaciones'), api('/api/sistema/alertas').catch(() => [])]).then(([d, al]) => { const h = $('.lista h1', main); if (!h || !location.hash.startsWith('#/actividad') || main.querySelector('.en-marcha')) return; h.insertAdjacentHTML('afterend', `<section class="grupo-ajustes en-marcha"><div class="cab-cliente"><h2>En marcha</h2><a class="enlace-cola" href="#/operaciones">Operaciones</a></div>${enMarchaHtml(d.enMarcha, al)}</section>`); }).catch(() => {});
  hayActividad = false; document.querySelectorAll('.nav-item .punto').forEach((x) => x.remove()); // solo el punto: repintar el marco borraría la lista
}
async function vistaMensajes(main) {
  main.innerHTML = '<div class="lista"><h1>Mensajes</h1><p class="cargando">Cargando…</p></div>';
  const { hilos } = await api('/api/social/mensajes');
  $('.lista', main).innerHTML = '<h1>Mensajes</h1>' + (hilos.map((h, k) => `<button class="fila" data-k="${k}" style="width:100%;text-align:left"><span class="avatar s56">${I(h.id === 'estudio' ? 'estudio' : 'robot')}</span><div class="txt"><b>${esc(h.nombre)}</b><br><small>${esc(String(h.mensajes[0]?.texto || '').slice(0, 70))} · ${esc(hace(h.ultimo))}</small></div></button>`).join('')
    || `<div class="vacio">${I('enviar')}<p>Sin mensajes.</p></div>`);
  $('.lista', main).querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => {
    const h = hilos[Number(b.dataset.k)];
    $('.lista', main).innerHTML = `<h1><button class="boton" data-volver>←</button> ${esc(h.nombre)}</h1>` + h.mensajes.map((m) => `<div class="fila"><div class="txt">${esc(m.texto)}<br><small>${esc([m.proyecto, m.estado, m.atendido === false ? 'sin atender' : '', hace(m.fecha)].filter(Boolean).join(' · '))}</small></div></div>`).join('');
    $('[data-volver]', main).onclick = () => vistaMensajes(main);
  }; });
}

// ---------- cola de recorte ----------
const ESTADO_COLA = { procesando: 'Recortando', error: 'Con error', propuesto: 'Propuestos (apruébalos para recortarlos)', cola: 'En cola', troceando: 'Directos largos por trocear', descartado: 'Descartados (3 días)' };
async function vistaCola(main) {
  main.innerHTML = '<div class="lista"><h1>Cola de recorte</h1><p class="cargando">Cargando…</p></div>';
  const { videos, soloIA, directos = [], proximaPasada } = await api('/api/social/cola');
  const grupos = Object.keys(ESTADO_COLA).map((k) => [k, videos.filter((v) => v.estado === k)]).filter(([, l]) => l.length);
  const fila = (v) => `<div class="fila cola-fila" data-id="${v.id}"><span class="ico-fila ${v.estado === 'error' ? 'rojo' : v.campana ? 'acento' : ''}">${I(v.estado === 'error' ? 'alerta' : v.estado === 'procesando' ? 'tijera' : v.campana ? 'campana' : v.twitch ? 'directo' : 'cola')}</span>
    <div class="txt"><b>${esc(v.titulo)}</b><br><small>${esc([v.canal, v.campana && 'campaña', v.tramo && 'tramo', v.twitch && 'clip de Twitch', v.urgente && 'urgente', v.gemini ? `${v.gemini} momentos de Gemini` : null, hace(v.fecha)].filter(Boolean).join(' · '))}</small>
      ${v.paso ? `<br><small>${esc(v.paso)}</small>` : ''}${v.espera ? `<br><small class="aviso-txt">${esc(v.espera)}</small>` : ''}${v.error ? `<br><small class="error-txt">${esc(v.error)}</small>` : ''}</div>
    <div class="botones">${({
      error: '<button class="boton" data-a="reintentar">Reintentar</button><button class="boton" data-a="quitar">Quitar</button>',
      propuesto: '<button class="boton primario" data-a="aprobar">Aprobar</button><button class="boton" data-a="descartar-propuesto">Descartar</button>',
      cola: `${v.urgente ? '' : '<button class="boton" data-a="urgente">Ya</button>'}<button class="boton" data-a="quitar">Quitar</button>`,
      descartado: '<button class="boton" data-a="recuperar" title="Recortar con señales propias, sin esperar a Gemini">Recortar igual</button>',
    })[v.estado] || ''}${v.original ? `<a class="boton" href="${esc(v.original)}" target="_blank" rel="noopener" aria-label="Ver el original">${I('externo')}</a>` : ''}</div></div>`;
  $('.lista', main).innerHTML = `<h1>Cola de recorte</h1><div class="pestanas-mini"><a class="enlace-cola" href="#/subida">Ver la cola de subida</a></div>${soloIA ? `<p class="muted">Solo se recortan los momentos que marca Gemini (y los clips de Twitch). Lo de campaña va primero.${proximaPasada ? ` Próxima pasada de Gemini: ${esc(proximaPasada)}.` : ''}</p>` : ''}`
    + (directos.length ? `<div class="seccion-fecha">En directo · ${directos.length}</div>${directos.map((d) => `<div class="fila directo-fila" data-d="${d.id}"><span class="ico-fila ${d.estado === 'grabando' ? 'rojo' : ''}">${I('directo')}</span><div class="txt"><b>${esc(d.titulo)}</b><br><small>${esc([d.canal, d.estado === 'grabando' ? (d.detenido ? 'parando…' : 'grabando') : 'terminado', d.inicio && `desde ${hace(d.inicio)}`].filter(Boolean).join(' · '))}</small></div>${d.estado === 'grabando' && !d.detenido ? '<div class="botones"><button class="boton" data-dir="recortar">Parar y recortar</button><button class="boton" data-dir="descartar">Parar y descartar</button></div>' : ''}</div>`).join('')}` : '')
    + (grupos.map(([k, l]) => `<div class="seccion-fecha">${ESTADO_COLA[k]} · ${l.length}</div>${l.map(fila).join('')}`).join('') || `<div class="vacio">${I('check')}<p>No hay nada en la cola.</p></div>`);
  $('.lista', main).querySelectorAll('[data-dir]').forEach((b) => { b.onclick = async () => {
    try { await api('/api/clips/directos/detener', { id: Number(b.closest('.directo-fila').dataset.d), descartar: b.dataset.dir === 'descartar' }); aviso(b.dataset.dir === 'descartar' ? 'Directo parado y descartado' : 'Directo parado: se recorta lo grabado'); vistaCola(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); }
  }; });
  const NOMBRE = { recuperar: 'A la cola con señales propias', reintentar: 'Vuelve a la cola', quitar: 'Quitado de la cola', aprobar: 'Aprobado', 'descartar-propuesto': 'Descartado', urgente: 'Se recorta el siguiente' };
  $('.lista', main).querySelectorAll('[data-a]').forEach((b) => { b.onclick = async () => {
    const id = Number(b.closest('.cola-fila').dataset.id);
    try { await Acc.video(b.dataset.a, id); aviso(NOMBRE[b.dataset.a] || 'Hecho'); vistaCola(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); }
  }; });
}

// ---------- ajustes (fase 2: registro único, por capas: categoría → sección → Avanzado) ----------
const ESTADO_PASADA = { ok: 'Marcó momentos', nuevo: 'Mirando', avisado: 'Esperando tu respuesta', reintento: 'Reintento en 10 min', resuelto: 'Resuelto', vencido: 'Sin respuesta' };
function controlAjuste(r, id) {
  const v = r.valor ?? '';
  const ph = r.tipo === 'horas' ? 'p. ej. 08:00, 14:00' : r.tipo === 'url' ? 'http://…' : '';
  switch (r.tipo) {
    case 'bool': return `<label class="interruptor"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}><span></span></label>`;
    case 'opcion': return `<select id="${id}">${r.opciones.map(([o, t]) => `<option value="${esc(o)}" ${String(o) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    case 'num': return `<span class="num-unidad"><input id="${id}" type="number" inputmode="decimal" value="${esc(v)}" ${r.min != null ? `min="${r.min}"` : ''} ${r.max != null ? `max="${r.max}"` : ''} step="${r.paso || 1}">${r.unidad ? `<small>${esc(r.unidad)}</small>` : ''}</span>`;
    case 'hora': return `<input id="${id}" type="time" value="${esc(v)}">`;
    case 'dias': {
      const sel = (Array.isArray(v) ? v : String(v).split(',')).map(Number);
      return `<span class="dias" id="${id}" role="group">${[['L', 'lunes'], ['M', 'martes'], ['X', 'miércoles'], ['J', 'jueves'], ['V', 'viernes'], ['S', 'sábado'], ['D', 'domingo']].map(([d, n], i) => `<button type="button" class="dia ${sel.includes(i + 1) ? 'on' : ''}" data-d="${i + 1}" aria-pressed="${sel.includes(i + 1)}" aria-label="${n}" title="${n}">${d}</button>`).join('')}</span>`;
    }
    case 'horas': {
      const l = String(v || '').split(/[,\s]+/).filter(Boolean);
      return `<span class="horas" id="${id}">${l.map((h) => `<span class="hora-item"><input type="time" value="${esc(h)}" aria-label="Hora"><button type="button" class="quitar-hora" aria-label="Quitar ${esc(h)}">${I('cerrar')}</button></span>`).join('')}${l.length < 8 ? `<button type="button" class="boton anadir-hora">${I('crear')}<span>Añadir hora</span></button>` : ''}</span>`;
    }
    case 'largo': return `<textarea id="${id}" rows="5">${esc(v)}</textarea>`;
    case 'secreto': return `<input id="${id}" type="password" autocomplete="new-password" placeholder="${v ? 'Guardada · escribe para cambiarla' : 'Sin guardar'}">`;
    default: return `<input id="${id}" type="${r.tipo === 'url' ? 'url' : 'text'}" value="${esc(v)}" placeholder="${ph}">`;
  }
}
function filaAjuste(r, i, { donde = '' } = {}) {
  const id = `aj${i}`, ancho = ['largo', 'texto', 'url', 'secreto', 'horas', 'lista'].includes(r.tipo);
  return `<div class="ajuste ${ancho ? 'ancho' : ''}" data-i="${i}"><label for="${id}"><b>${esc(r.titulo)}</b>${donde ? `<small class="donde">${esc(donde)}</small>` : ''}
    ${r.ayuda ? `<small>${esc(r.ayuda)}</small>` : ''}${r.cambiado ? '<small class="cambiado">Cambiado · <button type="button" class="enlace" data-defecto>volver al valor por defecto</button></small>' : ''}</label>
    <div class="control">${controlAjuste(r, id)}</div></div>`;
}
function leerControl(r, cont) {
  const el = cont.querySelector('.control > *');
  if (r.tipo === 'bool') return cont.querySelector('input').checked;
  if (r.tipo === 'dias') return [...cont.querySelectorAll('.dia.on')].map((b) => Number(b.dataset.d));
  if (r.tipo === 'horas') return [...cont.querySelectorAll('.hora-item input')].map((i) => i.value).filter(Boolean);
  if (r.tipo === 'num') return cont.querySelector('input').value;
  return (el.matches('input,select,textarea') ? el : el.querySelector('input,select,textarea')).value;
}
// Pinta una lista de ajustes y los guarda al cambiar (sin botón Guardar).
function enlazarAjustes(raiz, lista, guardar, alMaestro) {
  raiz.querySelectorAll('.ajuste').forEach((cont) => {
    const r = lista[Number(cont.dataset.i)]; if (!r) return; // bloques propios (Groq…) que no son ajustes del registro
    const repintar = (c) => { const nuevo = document.createElement('div'); nuevo.innerHTML = filaAjuste(r, Number(c.dataset.i), { donde: c.querySelector('.donde')?.textContent }); const el = nuevo.firstElementChild; c.replaceWith(el); enlazarAjustes(el.parentElement, lista, guardar, alMaestro); return el; };
    const enviar = async (defecto = false) => {
      try {
        const out = await guardar(r, defecto ? null : leerControl(r, cont), defecto);
        Object.assign(r, out); aviso(defecto ? 'Valor por defecto' : 'Guardado');
        if (r.maestro && alMaestro) return alMaestro();
        if (defecto || 'cambiado' in out || r.tipo === 'horas' || r.tipo === 'dias') repintar(cont);
      } catch (e) { if (e.message === 'sesión') return; aviso(e.message); if (r.tipo === 'horas' || r.tipo === 'dias') repintar(cont); }
    };
    cont.querySelectorAll('.dia').forEach((b) => { b.onclick = () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); enviar(); }; });
    if (r.tipo === 'horas') {
      cont.querySelectorAll('.hora-item input').forEach((i) => { i.onchange = () => { if (i.value) enviar(); }; });
      cont.querySelectorAll('.quitar-hora').forEach((b) => { b.onclick = () => { b.closest('.hora-item').remove(); enviar(); }; });
      const mas = cont.querySelector('.anadir-hora');
      if (mas) mas.onclick = () => {
        const it = document.createElement('span'); it.className = 'hora-item';
        it.innerHTML = `<input type="time" aria-label="Nueva hora"><button type="button" class="quitar-hora" aria-label="Quitar">${I('cerrar')}</button>`;
        mas.before(it); const inp = it.querySelector('input'); inp.focus(); try { inp.showPicker?.(); } catch {}
        inp.onchange = () => { if (inp.value) enviar(); };
        it.querySelector('button').onclick = () => it.remove();
      };
      return;
    }
    const c = cont.querySelector('.control input, .control select, .control textarea');
    if (c) c.onchange = () => { if (r.tipo === 'secreto' && !c.value) return; enviar(); };
    const d = cont.querySelector('[data-defecto]'); if (d) d.onclick = () => enviar(true);
  });
}
function bloquesPorSeccion(lista, idx, opts) {
  lista = lista.filter((r) => r.nivel !== 'oculto');
  const secs = [...new Set(lista.map((r) => r.seccion))];
  const basicos = secs.map((s) => [s, lista.filter((r) => r.seccion === s && r.nivel !== 'avanzado')]).filter(([, l]) => l.length);
  const avanz = lista.filter((r) => r.nivel === 'avanzado');
  return basicos.map(([s, l]) => `<section class="grupo-ajustes"><h2>${esc(s)}</h2>${l.map((r) => filaAjuste(r, idx(r), opts)).join('')}</section>`).join('')
    + (avanz.length ? `<details class="avanzado"><summary>Avanzado · ${avanz.length}</summary>${secs.map((s) => [s, avanz.filter((r) => r.seccion === s)]).filter(([, l]) => l.length)
      .map(([s, l]) => `<section class="grupo-ajustes"><h2>${esc(s)}</h2>${l.map((r) => filaAjuste(r, idx(r), opts)).join('')}</section>`).join('')}</details>` : '');
}
const guardarGeneral = async (r, valor, defecto) => api('/api/ajustes/uno', defecto ? { clave: r.clave, defecto: true } : { clave: r.clave, valor });

async function vistaAjustes(main) {
  const [, , cat, extra] = location.hash.split('/');
  main.innerHTML = '<div class="lista ajustes-vista"><p class="cargando">Cargando…</p></div>';
  const datos = await api('/api/ajustes/registro');
  const L = $('.lista', main), todos = datos.ajustes, idx = (r) => todos.indexOf(r);
  const atras = (href, t) => `<a class="atras" href="${href}">${I('abajo')}<span>${esc(t)}</span></a>`;

  if (!cat) { // portada: buscador + categorías
    L.innerHTML = `<h1>Ajustes</h1><input class="buscador" type="search" placeholder="Buscar un ajuste (p. ej. Gemini, TikTok, logo)" aria-label="Buscar un ajuste">
      <div class="cats">${filasCuenta()}${datos.categorias.map((c) => { const m = todos.find((r) => r.categoria === c.id && r.maestro); const off = m && !m.valor; return `<a class="fila ${off ? 'apagada' : ''}" href="#/ajustes/${c.id}"><span class="ico-fila">${I(c.icono)}</span><div class="txt"><b>${esc(c.titulo)}</b>${off ? ' <span class="etiqueta-off">Apagado</span>' : ''}<br><small>${esc(c.sub)}</small></div><span class="flecha">${I('abajo')}</span></a>`; }).join('')}</div>
      <div class="resultados" hidden></div>`;
    const b = $('.buscador', L), res = $('.resultados', L), cats = $('.cats', L);
    const nombreCat = Object.fromEntries(datos.categorias.map((c) => [c.id, c.titulo]));
    b.oninput = () => {
      const q = b.value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      cats.hidden = !!q; res.hidden = !q; if (!q) return;
      const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const hits = todos.filter((r) => r.nivel !== 'oculto' && norm(`${r.titulo} ${r.ayuda} ${r.seccion} ${nombreCat[r.categoria]}`).includes(q));
      res.innerHTML = hits.length ? hits.map((r) => filaAjuste(r, idx(r), { donde: `${nombreCat[r.categoria]} › ${r.seccion}${r.nivel === 'avanzado' ? ' › Avanzado' : ''}` })).join('') : '<p class="muted">Ningún ajuste coincide.</p>';
      enlazarAjustes(res, todos, guardarGeneral);
    };
    return;
  }

  if (cat === 'campana') { // una campaña
    const c = datos.campanas.find((x) => x.slug === extra);
    if (!c) { L.innerHTML = `${atras('#/ajustes/campanas', 'Campañas')}<p class="muted">Esa campaña no existe.</p>`; return; }
    L.innerHTML = `${atras('#/ajustes/campanas', 'Campañas')}<h1>${esc(c.nombre)}</h1><p class="muted">Todo lo de esta campaña se recorta, se revisa y se publica solo con estos requisitos.</p>${bloquesPorSeccion(c.campos, (r) => c.campos.indexOf(r))}`;
    const secLogo = [...L.querySelectorAll('.grupo-ajustes h2')].find((h) => h.textContent === 'Logo')?.parentElement;
    if (secLogo) { const d = document.createElement('div'); d.className = 'logo-campana'; d.innerHTML = `<img alt="Logo de la campaña" src="/api/campanas/logo?slug=${encodeURIComponent(c.slug)}&t=${Date.now()}" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'muted',textContent:'Sin logo todavía.'}))"><label class="boton">${I('crear')}<span>Subir logo (PNG)</span><input type="file" accept="image/png" hidden></label>`; secLogo.querySelector('h2').after(d);
      d.querySelector('input').onchange = (e) => { const file = e.target.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = async () => { try { await api('/api/campanas/logo', { slug: c.slug, nombre: file.name, datos: rd.result }); aviso('Logo guardado: se pone en los clips nuevos'); vistaAjustes(main); } catch (err) { if (err.message !== 'sesión') aviso(err.message); } }; rd.readAsDataURL(file); }; }
    enlazarAjustes(L, c.campos, (r, valor) => api('/api/campanas/ajuste', { slug: c.slug, ruta: r.ruta, valor }));
    return;
  }

  if (cat === 'streamer') { // un streamer
    const c = datos.streamers.find((x) => String(x.id) === extra);
    if (!c) { L.innerHTML = `${atras('#/ajustes/streamers', 'Streamers')}<p class="muted">Ese streamer no existe.</p>`; return; }
    L.innerHTML = `${atras('#/ajustes/streamers', 'Streamers')}<h1>${esc(c.nombre)}</h1><p class="muted">${c.listos} vídeos recortados · ${c.twitch ? 'Twitch' : 'YouTube'}</p>${c.twitch ? '' : '<div class="ficha-acciones"><button class="boton" data-traer>' + I('abajo') + '<span>Traer sus últimos vídeos</span></button></div>'}${bloquesPorSeccion(c.campos, (r) => c.campos.indexOf(r))}`;
    enlazarAjustes(L, c.campos, (r, valor) => api('/api/streamers/ajuste', { id: c.id, ruta: r.ruta, valor }));
    const tr = L.querySelector('[data-traer]'); if (tr) tr.onclick = async () => { tr.disabled = true; aviso('Mirando su canal…'); try { const r = await api('/api/clips/proponer', { canal: c.id }); aviso(r.nuevos ? `${r.nuevos} vídeo(s) nuevos: esperan a Gemini` : 'No hay vídeos nuevos'); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } tr.disabled = false; };
    return;
  }

  if (cat === 'cuenta') return paginaCuenta(L, atras);
  if (cat === 'equipo') return paginaEquipo(L, atras);
  const C = datos.categorias.find((x) => x.id === cat);
  if (!C) { location.hash = '#/ajustes'; return; }
  const maestro = todos.find((r) => r.categoria === cat && r.maestro);
  const lista = todos.filter((r) => r.categoria === cat && !r.maestro);
  let html = `${atras('#/ajustes', 'Ajustes')}<h1>${esc(C.titulo)}</h1><p class="muted">${esc(C.sub)}</p>`;
  if (maestro) html += `<div class="maestro ${maestro.valor ? '' : 'off'}">${filaAjuste(maestro, idx(maestro))}</div>`;
  html += `<div class="dependientes" ${maestro && !maestro.valor ? 'inert' : ''}>`;
  if (cat === 'streamers') {
    html += '<button class="boton primario nuevo" data-nuevo="streamer">' + I('crear') + '<span>Añadir streamer</span></button>';
    const grupos = [['', 'StreamClipper'], ...datos.campanas.map((c) => [c.slug, c.nombre])];
    html += grupos.map(([slug, t]) => { const l = datos.streamers.filter((x) => (x.campana || '') === slug); return l.length ? `<section class="grupo-ajustes"><h2>${esc(t)} · ${l.length}</h2>${l.map((x) => `<a class="fila ${x.activo ? '' : 'apagada'}" href="#/ajustes/streamer/${x.id}"><span class="ico-fila">${I(x.twitch ? 'directo' : 'reels')}</span><div class="txt"><b>${esc(x.nombre)}</b>${x.activo ? '' : ' <span class="etiqueta-off">Apagado</span>'}<br><small>${x.listos} vídeos recortados${x.campos.find((f) => f.ruta === 'sin_cara')?.valor ? ' · sin cara' : ''}</small></div><span class="flecha">${I('abajo')}</span></a>`).join('')}</section>` : ''; }).join('');
  }
  if (cat === 'campanas') html += '<button class="boton primario nuevo" data-nuevo="campana">' + I('crear') + '<span>Nueva campaña</span></button>';
  if (cat === 'campanas') html += datos.campanas.map((c) => { const est = c.campos.find((f) => f.ruta === 'estado')?.valor;
    return `<a class="fila" href="#/ajustes/campana/${esc(c.slug)}"><span class="ico-fila ${est === 'activa' ? 'acento' : ''}">${I('estrella')}</span><div class="txt"><b>${esc(c.nombre)}</b><br><small>${est === 'activa' ? 'Activa: recorta y publica sola' : 'Pausada'}</small></div><span class="flecha">${I('abajo')}</span></a>`; }).join('') || '<p class="muted">No hay campañas.</p>';
  if (cat === 'ia' && datos.gemini?.length) html += `<section class="grupo-ajustes"><h2>Últimas pasadas de Gemini</h2>${datos.gemini.map((p) => `<div class="fila pasada" data-clave="${esc(p.clave)}"><div class="txt"><b>${esc(p.clave)}</b><br><small>${esc(ESTADO_PASADA[p.estado] || p.estado)}${p.resuelto ? ` · ${esc(p.resuelto)}` : ''}${p.videos ? ` · ${p.videos} vídeos esperaban` : ''}</small></div>
    ${p.estado === 'avisado' ? '<div class="botones"><button class="boton" data-op="reintentar">En 10 min</button><button class="boton" data-op="propias">Señales propias</button><button class="boton" data-op="descartar">Descartar</button></div>' : ''}</div>`).join('')}</section>`;
  if (cat === 'ia') {
    const pr = datos.propio || { presets: [] }, alguna = pr.configurado || datos.groq || datos.geminiClave;
    const actual = pr.presets.find((p) => p.url && p.url === pr.url) || (pr.url ? pr.presets.find((p) => p.id === 'otro') : pr.presets[0]) || {};
    html += `<section class="grupo-ajustes" id="ia-propio"><h2>Tu propio modelo</h2>
    <p class="muted">${alguna ? '' : '<b>Aún no hay ninguna IA conectada:</b> los clips salen igual, pero sin título, texto en pantalla ni descripciones. ¿No tienes ninguna cuenta de IA? Lo más fácil y gratis es una <a href="#/ajustes/ia/gemini">clave de Gemini con tu cuenta de Google</a> (más abajo, en tres pasos). '}Conecta cualquier servicio compatible con la API de OpenAI: un modelo en tu equipo (Ollama, LM Studio, llama.cpp) o uno en la nube con tu clave (OpenRouter, OpenAI, DeepSeek…). Si lo conectas, va primero; Groq y Gemini quedan de respaldo.</p>
    ${pr.configurado ? `<div class="fila"><span class="ico-fila verde">${I('robot')}</span><div class="txt"><b>${esc(pr.modelo)}</b><br><small>${esc(pr.url)}${pr.clave ? ' · con clave' : ''}${pr.vision ? ' · entiende imágenes' : ''}</small></div><div class="botones"><button class="boton" data-propio-quitar>Quitar</button></div></div>` : ''}
    <div class="ajuste ancho"><label for="pr-servicio"><b>Servicio</b><small>Elige uno y se rellena la dirección.</small></label>
      <div class="control"><select id="pr-servicio">${pr.presets.map((p) => `<option value="${esc(p.id)}" ${p.id === actual.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div></div>
    <div class="ajuste ancho"><label for="pr-url"><b>Dirección de la API</b><small>Vale con o sin /v1. Si el modelo corre en otro equipo, pon su IP en vez de 127.0.0.1.</small></label>
      <div class="control"><input id="pr-url" type="url" autocomplete="off" value="${esc(pr.url || actual.url || '')}" placeholder="http://127.0.0.1:11434/v1"></div></div>
    <div class="ajuste ancho"><label for="pr-clave"><b>Clave de API</b><small>Solo para servicios en la nube. Se guarda en un archivo protegido del servidor, nunca en la base de datos.</small></label>
      <div class="control"><input id="pr-clave" type="password" autocomplete="off" placeholder="${pr.clave ? '(guardada; escribe otra para cambiarla)' : 'sk-… (déjala vacía si es local)'}"></div></div>
    <div class="ajuste ancho"><label for="pr-modelo"><b>Modelo</b><small>Pulsa «Ver modelos» para elegir de la lista, o escribe su nombre.</small></label>
      <div class="control groq-control"><input id="pr-modelo" list="pr-lista" autocomplete="off" value="${esc(pr.modelo || '')}" placeholder="${esc(actual.ejemplo || 'nombre-del-modelo')}"><datalist id="pr-lista"></datalist><button class="boton" data-propio-modelos>Ver modelos</button></div></div>
    <div class="ajuste ancho"><label for="pr-vision"><b>Entiende imágenes</b><small>Márcalo si el modelo tiene visión (p. ej. qwen2.5-vl, gemma3, gpt-4.1-mini): así también mira fotogramas y busca la webcam.</small></label>
      <div class="control"><input id="pr-vision" type="checkbox" ${pr.vision ? 'checked' : ''}></div></div>
    <div class="ficha-acciones"><button class="boton primario" data-propio-guardar>${I('robot')}<span>Guardar y probar</span></button></div><div class="propio-res" hidden></div></section>`;
  }
  if (cat === 'ia') html += `<section class="grupo-ajustes" id="ia-gemini"><h2>Gemini con tu cuenta de Google (gratis)</h2>
    ${datos.geminiClave ? '' : `<div class="guia-gemini"><p class="muted">No necesitas Google Cloud ni tarjeta: basta tu cuenta de Google de siempre.</p>
    <ol class="pasos-yt">
      <li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"><b>Google AI Studio</b></a> y entra con tu cuenta de Google (acepta las condiciones la primera vez).</li>
      <li>Pulsa <b>Create API key</b> («Crear clave de API»). Si te pide un proyecto, deja el que propone: Google lo crea solo.</li>
      <li>Copia la clave (empieza por <code>AIza</code>), pégala aquí abajo y pulsa <b>Guardar</b>. La app la prueba antes de guardarla.</li>
    </ol>
    <p class="muted">El plan gratuito tiene un límite de peticiones al día: para unos pocos clips diarios suele bastar. Si se te queda corto, añade también una clave gratuita de Groq (abajo) como respaldo.</p></div>`}
    <div class="ajuste ancho"><label for="gemini-clave"><b>Clave de la API de Gemini</b><small>${datos.geminiClave ? 'Guardada. Escribe otra para cambiarla. ' : ''}Se guarda en un archivo protegido del servidor, nunca en la base de datos.</small></label>
    <div class="control groq-control"><input id="gemini-clave" type="password" autocomplete="off" placeholder="${datos.geminiClave ? 'AIza… (guardada)' : 'AIza…'}"><button class="boton primario" data-gemini>Guardar</button>${datos.geminiClave ? '<button class="boton" data-gemini-quitar>Quitar</button>' : ''}</div></div></section>`;
  if (cat === 'ia') html += `<section class="grupo-ajustes"><h2>Groq (IA de respaldo, va antes que Gemini)</h2>
    <div class="ajuste ancho"><label for="groq"><b>Clave de la API de Groq</b><small>${datos.groq ? 'Guardada y funcionando. Escribe otra para cambiarla.' : 'Sin clave: todo depende del cupo de Gemini.'} Se guarda en un archivo protegido del servidor, nunca en la base de datos.</small></label>
    <div class="control groq-control"><input id="groq" type="password" autocomplete="off" placeholder="${datos.groq ? 'gsk_… (guardada)' : 'gsk_…'}"><button class="boton primario" data-groq>Guardar</button>${datos.groq ? '<button class="boton" data-groq-quitar>Quitar</button>' : ''}</div></div>${datos.groq ? '<div class="groq-modelos"><p class="muted">Cargando los modelos de tu cuenta de Groq…</p></div>' : ''}</section>`;
  if (cat === 'publicacion') {
    const cr = datos.cuentasRed || [], yo = E.yo || {};
    const filaC = (k) => `<div class="fila" data-cuenta="${k.id}"><span class="ico-fila ${k.conectada ? 'verde' : 'rojo'}">${I(k.red === 'youtube' ? 'reels' : 'enviar')}</span><div class="txt"><b>${esc(k.nombre)}</b>${k.por_defecto ? ' <span class="chip-estado listo">Por defecto</span>' : ''}<br><small>${k.red === 'youtube' ? 'YouTube' : 'TikTok'} · conectada por ${esc(k.de || '—')}${k.conectada ? '' : ' · sin autorización: vuelve a conectarla'}</small></div>
      <div class="botones">${!k.por_defecto && yo.rol === 'dueno' ? '<button class="boton" data-cu="defecto">Por defecto</button>' : ''}${yo.rol === 'dueno' || k.usuario_id === yo.id ? '<button class="boton" data-cu="borrar">Quitar</button>' : ''}</div></div>`;
    html += `<section class="grupo-ajustes"><h2>Cuentas conectadas</h2><p class="muted">Cada persona del equipo puede conectar sus propios canales. Al publicar a mano eliges a cuál va; lo automático y las campañas van a la cuenta «por defecto» de cada red.</p>
      ${cr.map(filaC).join('') || '<p class="muted">Ninguna cuenta conectada.</p>'}
      <div class="ficha-acciones"><button class="boton primario" data-conectar="youtube">${I('crear')}<span>Conectar un canal de YouTube</span></button><button class="boton" data-tk="conectar">${I('crear')}<span>Conectar TikTok</span></button></div><div class="conectar-yt" hidden></div></section>`;
  }
  html += bloquesPorSeccion(lista, idx) + '</div>';
  L.innerHTML = html;
  // #/ajustes/ia/gemini (desde «Primeros pasos» o el aviso de «sin IA»): baja hasta la guía de la clave de Gemini.
  if (cat === 'ia' && extra === 'gemini') requestAnimationFrame(() => { const g = L.querySelector('#ia-gemini'); if (g) { g.scrollIntoView({ block: 'start' }); g.querySelector('#gemini-clave')?.focus({ preventScroll: true }); } });
  enlazarAjustes(L, todos, guardarGeneral, () => vistaAjustes(main));
  const gq = L.querySelector('[data-groq]'); if (gq) gq.onclick = async () => { const v = L.querySelector('#groq').value.trim(); if (!v) return aviso('Pega la clave'); gq.disabled = true; aviso('Probando la clave…'); try { await api('/api/ia/groq', { clave: v }); aviso('Clave de Groq guardada y probada'); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } gq.disabled = false; };
  const gm = L.querySelector('.groq-modelos');
  if (gm) api('/api/ia/groq/modelos').then(({ modelos, texto, vision }) => {
    const opciones = (sel, soloVision) => modelos.filter((m) => !soloVision || m.vision).map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.id)}${m.contexto ? ` · ${Math.round(m.contexto / 1000)}k` : ''}</option>`).join('');
    const falta = (sel, soloVision) => (modelos.some((m) => m.id === sel && (!soloVision || m.vision)) ? '' : `<option value="${esc(sel)}" selected>${esc(sel)} (ya no está en tu cuenta)</option>`);
    gm.innerHTML = [['texto', 'Modelo para textos', 'Títulos, textos en pantalla y descripciones a partir de lo que se dice.', texto, false], ['vision', 'Modelo con visión', 'Mira fotogramas del clip para comprobar el juego y lo que pasa.', vision, true]].map(([t, n, d, sel, sv]) => `
      <div class="ajuste ancho groq-mod" data-tipo="${t}"><label><b>${n}</b><small>${d}</small></label>
        <div class="control groq-control"><select>${falta(sel, sv)}${opciones(sel, sv)}</select><button class="boton" data-probar>Probar</button></div><div class="groq-res" hidden></div></div>`).join('')
      + `<p class="muted">${modelos.length} modelos disponibles en tu cuenta. «Probar» hace la tarea real con el último clip terminado: compara el resultado y los segundos.</p>`;
    gm.querySelectorAll('.groq-mod').forEach((box) => {
      const sel = box.querySelector('select'), res = box.querySelector('.groq-res'), t = box.dataset.tipo;
      sel.onchange = async () => { try { await api('/api/ajustes/uno', { clave: `groq.modelo_${t}`, valor: sel.value }); aviso('Modelo guardado'); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
      box.querySelector('[data-probar]').onclick = async (ev) => {
        const b = ev.currentTarget; b.disabled = true; res.hidden = false; res.innerHTML = '<p class="muted">Probando…</p>';
        try {
          const r = await api('/api/ia/groq/probar', { modelo: sel.value, tipo: t });
          res.innerHTML = `<div class="groq-ficha"><b>${esc(r.modelo)}</b> · ${r.segundos} s${r.fotogramas ? ` · ${r.fotogramas} fotogramas` : ''} · clip ${esc(r.clip)}
            <dl>${Object.entries(r.resultado || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</dd>`).join('')}<dt>título actual</dt><dd>${esc(r.original)}</dd></dl></div>`;
        } catch (e) { res.innerHTML = `<p class="error-txt">${esc(e.message)}</p>`; }
        b.disabled = false;
      };
    });
  }).catch((e) => { gm.innerHTML = `<p class="error-txt">${esc(e.message)}</p>`; });
  // Tu propio modelo (API compatible con OpenAI)
  const pp = L.querySelector('#ia-propio');
  if (pp) {
    const presets = datos.propio?.presets || [], $p = (s) => pp.querySelector(s), res = $p('.propio-res');
    const mostrar = (h) => { res.hidden = false; res.innerHTML = h; };
    $p('#pr-servicio').onchange = () => { const p = presets.find((x) => x.id === $p('#pr-servicio').value); if (!p) return; if (p.url) $p('#pr-url').value = p.url; $p('#pr-modelo').placeholder = p.ejemplo || 'nombre-del-modelo'; $p('#pr-clave').placeholder = p.clave ? 'sk-…' : '(no hace falta en local)'; };
    $p('[data-propio-modelos]').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; mostrar('<p class="muted">Preguntando al servicio qué modelos tiene…</p>');
      try {
        const r = await api('/api/ia/propio/modelos', { url: $p('#pr-url').value.trim(), clave: $p('#pr-clave').value.trim() });
        $p('#pr-lista').innerHTML = r.modelos.map((m) => `<option value="${esc(m)}">`).join('');
        if (!$p('#pr-modelo').value && r.modelos.length === 1) $p('#pr-modelo').value = r.modelos[0];
        mostrar(r.modelos.length ? `<p class="muted">${r.modelos.length === 1 ? "1 modelo" : `${r.modelos.length} modelos`} en ${esc(r.url)}. Toca el campo «Modelo» para elegir.</p>` : '<p class="muted">El servicio responde pero no lista modelos: escribe el nombre a mano.</p>');
        $p('#pr-modelo').focus();
      } catch (e) { if (e.message !== 'sesión') mostrar(`<p class="error-txt">${esc(e.message)}</p>`); }
      b.disabled = false;
    };
    $p('[data-propio-guardar]').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; mostrar('<p class="muted">Probando tu modelo con una petición real (un modelo local puede tardar en cargarse)…</p>');
      try {
        const r = await api('/api/ia/propio', { url: $p('#pr-url').value.trim(), modelo: $p('#pr-modelo').value.trim(), clave: $p('#pr-clave').value.trim(), vision: $p('#pr-vision').checked });
        aviso(`Tu modelo funciona (${r.segundos} s) y queda conectado`); vistaAjustes(main); return;
      } catch (e) { if (e.message !== 'sesión') mostrar(`<p class="error-txt">${esc(e.message)}</p>`); }
      b.disabled = false;
    };
    const q = $p('[data-propio-quitar]'); if (q) q.onclick = async () => { try { await api('/api/ia/propio', { quitar: true }); aviso('Tu modelo quedó desconectado'); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
  }
  const gk = L.querySelector('[data-gemini]'); if (gk) gk.onclick = async () => { const v = L.querySelector('#gemini-clave').value.trim(); if (!v) return aviso('Pega la clave'); gk.disabled = true; aviso('Probando la clave…'); try { await api('/api/ia/gemini', { clave: v }); aviso('Clave de Gemini guardada y probada'); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } gk.disabled = false; };
  const gkx = L.querySelector('[data-gemini-quitar]'); if (gkx) gkx.onclick = async () => { try { await api('/api/ia/gemini', { quitar: true }); aviso('Clave de Gemini quitada'); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
  const gx = L.querySelector('[data-groq-quitar]'); if (gx) gx.onclick = async () => { try { await api('/api/ia/groq', { quitar: true }); aviso('Clave de Groq quitada'); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
  L.querySelectorAll('[data-tk]').forEach((x) => { x.onclick = async () => {
    try {
      if (x.dataset.tk === 'conectar') { const r = await api(`/api/tiktok/conectar?origen=${encodeURIComponent(location.origin)}`); location.href = r.url; }
      else { await api('/api/tiktok/desconectar', {}); aviso('TikTok desconectado'); vistaAjustes(main); }
    } catch (e) { if (e.message !== 'sesión') aviso(e.message); }
  }; });
  L.querySelectorAll('[data-nuevo]').forEach((b) => { b.onclick = () => ({ streamer: hojaNuevoStreamer }[b.dataset.nuevo] || hojaNuevaCampana)(); });
  L.querySelectorAll('[data-cuenta] [data-cu]').forEach((b) => { b.onclick = () => {
    const id = Number(b.closest('[data-cuenta]').dataset.cuenta), op = b.dataset.cu;
    const hacer = async () => { try { await api(`/api/cuentas/${op}`, { id }); E.cuentasRed = null; aviso(op === 'borrar' ? 'Cuenta quitada' : 'Ahora es la cuenta por defecto'); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
    if (op === 'borrar') hoja('¿Quitar esta cuenta?', [{ texto: 'Quitar la cuenta', sub: 'Lo que estaba en cola para ella irá a la de por defecto', peligro: true, icono: 'papelera', accion: hacer }, { texto: 'Cancelar', accion: () => {} }]); else hacer();
  }; });
  const cyt = L.querySelector('[data-conectar="youtube"]');
  if (cyt) cyt.onclick = async () => {
    // Ventana propia, encima de todo (antes salía dentro de la lista y se confundía con los ajustes).
    const dlg = capa(`<div class="dialogo" role="dialog" aria-modal="true" aria-label="Conectar un canal de YouTube"><div class="dialogo-cab"><h2>Conectar un canal de YouTube</h2><button class="boton icono-solo" data-cerrar aria-label="Cerrar">${I('cerrar')}</button></div><div class="dialogo-cuerpo"></div></div>`);
    dlg.raiz.querySelector('[data-cerrar]').onclick = dlg.cerrar;
    const box = dlg.raiz.querySelector('.dialogo-cuerpo');
    let propio = (await api('/api/cuentas/youtube/cliente').catch(() => ({ propio: false }))).propio;
    box.innerHTML = '<div class="pestanas-mini" role="tablist"><button role="tab" data-modo="clips" aria-selected="true">Con la app de Clips</button><button role="tab" data-modo="propia" aria-selected="false">Con tu propia app de Google</button></div><div class="modo-yt"></div>';
    const zona = box.querySelector('.modo-yt'), err = (e) => { if (e.message !== 'sesión') aviso(e.message); };
    const pasosAutorizar = async (propia) => {
      const { url } = await api('/api/cuentas/youtube/url', { propio: propia });
      return `<li><a class="boton primario" href="${esc(url)}" target="_blank" rel="noopener">Abrir Google para autorizar</a><br><small class="muted">Entra con la cuenta de Google del canal. Si sale «Google no ha verificado esta aplicación», pulsa «Configuración avanzada» › «Ir a ${propia ? 'tu app' : 'Clips'} (no seguro)»: es una app tuya o del equipo, no de un tercero.</small></li>
        <li>Acepta los permisos. Al terminar, Google te lleva a una página que no carga (<code>localhost</code>). Es lo esperado: copia la dirección completa de esa pestaña.</li>
        <li>Pégala aquí:<div class="groq-control"><input data-vuelta placeholder="http://localhost/?state=…&amp;code=…" aria-label="Dirección de vuelta de Google"><button class="boton primario" data-completar>Conectar</button></div></li>`;
    };
    const enlazarCompletar = () => { const bt = zona.querySelector('[data-completar]'); if (!bt) return;
      bt.onclick = async () => { bt.disabled = true; try { const r = await api('/api/cuentas/youtube/completar', { pegado: zona.querySelector('[data-vuelta]').value }); E.cuentasRed = null; aviso(`Canal conectado: ${r.nombre}`); dlg.cerrar(); vistaAjustes(main); } catch (e) { err(e); bt.disabled = false; } }; };
    const G = (ruta, txt) => `<a href="https://console.cloud.google.com/${ruta}" target="_blank" rel="noopener">${txt}</a>`;
    const modos = {
      clips: async () => { zona.innerHTML = `<p class="muted">Usa la app de Google del dueño. Si esa app está «en prueba», el dueño tiene que añadir tu correo de Google en Google Cloud › Google Auth Platform › Público › Usuarios de prueba (y el permiso caduca cada 7 días). Si no, usa tu propia app (la otra pestaña).</p><ol class="pasos-yt">${await pasosAutorizar(false)}</ol>`; enlazarCompletar(); },
      propia: async () => {
        zona.innerHTML = `<p class="muted">Se hace una sola vez (unos 10 minutos). Tu canal usará tu propia app de Google y no dependerá de nadie. Necesitas estar en tu cuenta de Google en el navegador.</p>
        <ol class="pasos-yt guia-google">
          <li><b>Crea un proyecto.</b> ${G('projectcreate', 'Nuevo proyecto en Google Cloud')}: ponle un nombre (p. ej. «Clips de Ana») y pulsa <i>Crear</i>. Comprueba arriba a la izquierda que ese proyecto queda seleccionado.</li>
          <li><b>Activa la API de YouTube.</b> ${G('apis/library/youtube.googleapis.com', 'YouTube Data API v3')} › <i>Habilitar</i>.</li>
          <li><b>Pantalla de permisos.</b> ${G('auth/overview', 'Google Auth Platform')} › <i>Comenzar</i>: nombre de la app «Clips», tu correo como asistencia, Público <b>Externo</b>, tu correo de contacto, acepta la política y <i>Crear</i>.</li>
          <li><b>Publícala.</b> ${G('auth/audience', 'Público')} › <i>Publicar aplicación</i> › <i>Confirmar</i>. Si la dejas «en prueba», Google corta el permiso cada 7 días. No hace falta pedir la verificación.</li>
          <li><b>Crea el cliente.</b> ${G('auth/clients/create', 'Crear cliente')} › Tipo de aplicación: <b>App de escritorio</b> › <i>Crear</i> › <b>Descargar JSON</b>.</li>
          <li><b>Pega aquí ese archivo</b> (ábrelo con el Bloc de notas, Ctrl+A, Ctrl+C) o súbelo:
            <textarea data-json rows="4" placeholder='{"installed":{"client_id":"….apps.googleusercontent.com", …}}' aria-label="JSON del cliente de Google"></textarea>
            <div class="ficha-acciones"><label class="boton">${I('crear')}<span>Subir el archivo</span><input type="file" accept=".json,application/json" hidden data-archivo></label><button class="boton primario" data-guardar-json>Guardar mi app</button>${propio ? '<button class="boton" data-quitar-json>Quitar mi app</button>' : ''}</div>
            ${propio ? '<small class="muted">Tu app ya está guardada: sigue con el paso de abajo.</small>' : '<small class="muted">Se guarda en un archivo protegido del servidor, solo para tus canales.</small>'}</li>
          ${propio ? await pasosAutorizar(true) : '<li class="muted">Cuando guardes tu app, aquí aparecerá el botón para autorizar tu canal.</li>'}
        </ol>`;
        const ta = zona.querySelector('[data-json]');
        zona.querySelector('[data-archivo]').onchange = (e) => { const fi = e.target.files[0]; if (fi) fi.text().then((t) => { ta.value = t; }); };
        zona.querySelector('[data-guardar-json]').onclick = async () => { try { await api('/api/cuentas/youtube/cliente', { json: ta.value }); aviso('Tu app de Google está guardada'); propio = true; modos.propia().catch(err); } catch (e) { err(e); } };
        const qj = zona.querySelector('[data-quitar-json]'); if (qj) qj.onclick = async () => { try { await api('/api/cuentas/youtube/cliente/quitar', {}); aviso('Tu app quitada'); propio = false; modos.propia().catch(err); } catch (e) { err(e); } };
        enlazarCompletar();
      },
    };
    box.querySelectorAll('[data-modo]').forEach((b) => { b.onclick = () => { box.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-selected', x === b)); modos[b.dataset.modo]().catch(err); }; });
    if (propio) box.querySelector('[data-modo="propia"]').click(); else modos.clips().catch(err);
  };
  L.querySelectorAll('.pasada [data-op]').forEach((b) => { b.onclick = async () => {
    try { const r = await api('/api/gemini/decidir', { clave: b.closest('.pasada').dataset.clave, op: b.dataset.op }); aviso(r.texto); vistaAjustes(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); }
  }; });
}

function hojaNuevoStreamer() {
  hojaFormulario('Añadir streamer', [{ nombre: 'nombre', etiqueta: 'Nombre (como saldrá en los títulos)', max: 120 }, { nombre: 'url', etiqueta: 'Canal: @nombre de YouTube o enlace de Twitch' }],
    async (v) => { const r = await api('/api/streamers/crear', v); aviso('Streamer añadido'); location.hash = `#/ajustes/streamer/${r.id}`; },
    { boton: 'Añadir', nota: 'Después eliges su campaña, si sale su cara y si espera a Gemini.' });
}
function hojaNuevaCampana() {
  hojaFormulario('Nueva campaña', [{ nombre: 'nombre', etiqueta: 'Nombre de la campaña', max: 80 }],
    async (v) => { const r = await api('/api/campanas/crear', v); aviso('Campaña creada en pausa'); location.hash = `#/ajustes/campana/${r.slug}`; },
    { boton: 'Crear', nota: 'Se crea en pausa: rellena sus requisitos y actívala cuando esté lista.' });
}

// ---------- cola de subida (fase 4): qué se publica, en qué orden y cuándo ----------
const TIPO_SUBIDA = { campana: 'Campaña', clip: 'Clip', estudio: 'Short del Estudio', largo: 'Vídeo largo', recop: 'Recopilatorio' };
const ORDENES = [['actual', 'Orden de subida'], ['puntos-', 'Más puntos primero'], ['puntos+', 'Menos puntos primero'], ['fecha+', 'Más antiguo primero'], ['fecha-', 'Más reciente primero'], ['tipo', 'Por tipo']];
const FS = { red: 'youtube', orden: 'actual', tipo: '', idioma: '', creador: '', fuente: '' };
async function vistaSubida(main) {
  main.innerHTML = '<div class="lista subida-vista"><p class="cargando">Cargando…</p></div>';
  const { items } = await api('/api/subidas');
  const L = $('.lista', main);
  const actual = (a, b) => (a.orden ?? 1e9) - (b.orden ?? 1e9) || b.prioridad - a.prioridad || String(a.fecha).localeCompare(String(b.fecha));
  const cmp = { actual, 'puntos-': (a, b) => (b.puntos ?? -1) - (a.puntos ?? -1), 'puntos+': (a, b) => (a.puntos ?? 999) - (b.puntos ?? 999),
    'fecha+': (a, b) => String(a.fecha).localeCompare(String(b.fecha)), 'fecha-': (a, b) => String(b.fecha).localeCompare(String(a.fecha)),
    tipo: (a, b) => Object.keys(TIPO_SUBIDA).indexOf(a.tipo) - Object.keys(TIPO_SUBIDA).indexOf(b.tipo) || actual(a, b) };
  const opc = (campo) => [...new Set(items.filter((x) => x.red === FS.red).map((x) => x[campo]).filter(Boolean))].sort();
  const sel = (campo, todos, etiqueta = (x) => x) => `<select data-f="${campo}" aria-label="${todos}"><option value="">${todos}</option>${opc(campo).map((o) => `<option value="${esc(o)}" ${FS[campo] === o ? 'selected' : ''}>${esc(etiqueta(o))}</option>`).join('')}</select>`;
  const pintar = () => {
    const deRed = items.filter((x) => x.red === FS.red);
    const pasa = (x) => (!FS.tipo || x.tipo === FS.tipo) && (!FS.idioma || x.idioma === FS.idioma) && (!FS.creador || x.creador === FS.creador) && (!FS.fuente || x.fuente === FS.fuente);
    const fijos = deRed.filter((x) => x.programado && x.estado !== 'error').sort((a, b) => a.programado.localeCompare(b.programado));
    const cola = deRed.filter((x) => !x.programado && x.estado !== 'error').sort(cmp[FS.orden]);
    const errores = deRed.filter((x) => x.estado === 'error');
    const filtrando = FS.tipo || FS.idioma || FS.creador || FS.fuente;
    const fila = (x, i, mover) => `<div class="fila subida-fila ${pasa(x) ? '' : 'oculta'}" data-k="${items.indexOf(x)}">
      <img class="mini" src="${esc(x.poster)}" alt="" loading="lazy">
      <div class="txt"><b>${mover ? `<span class="pos">${i + 1}</span>` : ''}${esc(x.titulo)}</b><br><small>${esc([x.creador, TIPO_SUBIDA[x.tipo], x.idioma?.toUpperCase(), x.fuente, x.puntos != null ? `${x.puntos} puntos` : null].filter(Boolean).join(' · '))}</small>
        ${x.programado ? `<br><small class="aviso-txt">${esc(x.campana ? `${x.campana}: ` : '')}sale ${esc(hace(x.programado))}</small>` : ''}${x.estado === 'subiendo' ? '<br><small class="aviso-txt">Subiendo ahora</small>' : ''}${x.error ? `<br><small class="error-txt">${esc(x.error)}</small>` : ''}</div>
      <div class="botones">${mover && FS.orden === 'actual' && !filtrando ? `<button class="boton icono-solo" data-m="arriba" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${I('abajo')}</button><button class="boton icono-solo" data-m="abajo" aria-label="Bajar">${I('abajo')}</button><button class="boton" data-m="primero">Primero</button>` : ''}<button class="boton icono-solo" data-m="mas" aria-label="Opciones">${I('mas')}</button></div></div>`;
    L.innerHTML = `<h1>Cola de subida</h1>
      <div class="pestanas-mini" role="tablist">${[['youtube', 'YouTube'], ['tiktok', 'TikTok']].map(([k, t]) => `<button role="tab" aria-selected="${FS.red === k}" data-red="${k}">${t} · ${items.filter((x) => x.red === k).length}</button>`).join('')}<a class="enlace-cola" href="#/cola">Cola de recorte</a></div>
      <div class="filtros-subida">
        <select data-f="orden" aria-label="Ordenar">${ORDENES.map(([k, t]) => `<option value="${k}" ${FS.orden === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${sel('tipo', 'Todos los tipos', (t) => TIPO_SUBIDA[t] || t)}${sel('idioma', 'Todos los idiomas', (t) => t.toUpperCase())}${sel('creador', 'Todos los creadores')}${sel('fuente', 'Todas las fuentes')}
      </div>
      ${FS.orden !== 'actual' ? `<div class="aplicar-orden"><span>Así se vería la cola ordenada por «${esc(ORDENES.find((o) => o[0] === FS.orden)[1].toLowerCase())}».</span><button class="boton primario" data-aplicar>Subir en este orden</button></div>` : ''}
      ${filtrando && FS.orden === 'actual' ? '<p class="muted">Con filtros puestos solo se ve una parte: quítalos para mover clips.</p>' : ''}
      <div class="seccion-fecha">En cola · ${cola.length}</div>${cola.map((x, i) => fila(x, i, true)).join('') || '<p class="muted">Nada esperando.</p>'}
      ${fijos.length ? `<div class="seccion-fecha">Con hora fija · ${fijos.length}</div><p class="muted">Campañas (en su franja) y vídeos largos: salen a su hora.</p>${fijos.map((x, i) => fila(x, i, false)).join('')}` : ''}
      ${errores.length ? `<div class="seccion-fecha">Con error · ${errores.length}</div>${errores.map((x, i) => fila(x, i, false)).join('')}` : ''}`;
    L.querySelectorAll('[data-red]').forEach((b) => { b.onclick = () => { FS.red = b.dataset.red; FS.tipo = FS.idioma = FS.creador = FS.fuente = ''; pintar(); }; });
    L.querySelectorAll('[data-f]').forEach((s) => { s.onchange = () => { FS[s.dataset.f] = s.value; pintar(); }; });
    const guardarOrden = async (lista, msg) => { try { await api('/api/subidas/orden', { red: FS.red, sids: lista.map((x) => x.sid) }); lista.forEach((x, i) => { x.orden = i + 1; }); aviso(msg); FS.orden = 'actual'; pintar(); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
    const ap = L.querySelector('[data-aplicar]'); if (ap) ap.onclick = () => guardarOrden(cola, 'Orden guardado: se sube así');
    L.querySelectorAll('.subida-fila [data-m]').forEach((b) => { b.onclick = () => {
      const x = items[Number(b.closest('.subida-fila').dataset.k)], i = cola.indexOf(x), l = [...cola];
      if (b.dataset.m === 'mas') return hojaClip(x.ficha, { alQuitar: () => vistaSubida(main), alCambiar: () => vistaSubida(main) });
      if (b.dataset.m === 'primero') { l.splice(i, 1); l.unshift(x); return guardarOrden(l, 'Será el siguiente en subir'); }
      const j = b.dataset.m === 'arriba' ? i - 1 : i + 1; if (j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]]; guardarOrden(l, 'Orden cambiado');
    }; });
  };
  pintar();
}

// ---------- publicar en TikTok desde la ficha (fase 4; pantalla con las opciones que exige TikTok) ----------
// Con varias cuentas de una red, se elige a cuál va (con una sola, directo).
async function elegirCuenta(red, alElegir) {
  let l = E.cuentasRed; if (!l) { try { l = E.cuentasRed = await api('/api/cuentas'); } catch { l = []; } }
  const cs = l.filter((k) => k.red === red && k.conectada);
  if (cs.length <= 1) return alElegir(cs[0]?.id ?? null);
  hoja(red === 'youtube' ? '¿A qué canal de YouTube?' : '¿A qué cuenta de TikTok?', cs.map((k) => ({ texto: k.nombre, sub: `${k.por_defecto ? 'Por defecto · ' : ''}conectada por ${k.de || '—'}`, icono: red === 'youtube' ? 'reels' : 'enviar', accion: () => alElegir(k.id) })));
}
async function hojaTiktok(f, alHecho, cuenta = null) {
  let cr; try { cr = await api(`/api/tiktok/creador${cuenta ? `?cuenta=${cuenta}` : ''}`); } catch (e) { if (e.message !== 'sesión') aviso(`TikTok: ${e.message}`); return; }
  const NOM = { PUBLIC_TO_EVERYONE: 'Todo el mundo', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores', SELF_ONLY: 'Solo yo' };
  const texto = [f.texto || f.titulo || '', f.original ? `▶ Completo: ${f.original}` : ''].filter(Boolean).join('\n');
  const legal = (marca) => `Al publicar, aceptas ${marca ? 'la <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Política de contenido de marca</a> y ' : ''}la <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Confirmación de uso de música</a> de TikTok.`;
  const h = capa(`<form class="hoja hoja-tiktok" role="dialog" aria-label="Publicar en TikTok"><h2>Publicar en TikTok</h2>
    <div class="tk-cab">${cr.avatar ? `<img src="${esc(cr.avatar)}" alt="" width="36" height="36">` : ''}<div><b>${esc(cr.nombre || cr.usuario || '')}</b>${cr.usuario ? `<br><small>@${esc(cr.usuario)}</small>` : ''}</div></div>
    ${cr.maxSegundos && f.dur > cr.maxSegundos ? `<p class="error-txt">Este clip dura ${Math.round(f.dur)} s y tu cuenta admite ${cr.maxSegundos} s.</p>` : ''}
    <label class="campo"><span>Texto (título y hashtags)</span><textarea name="titulo" rows="3" maxlength="2200">${esc(texto)}</textarea></label>
    <label class="campo"><span>Quién puede verlo</span><select name="privacidad" required><option value="" selected disabled>Elige…</option>${(cr.privacidades || []).map((k) => `<option value="${esc(k)}">${NOM[k] || esc(k)}</option>`).join('')}</select></label>
    <div class="tk-opciones">
      <label><input type="checkbox" name="comentarios" ${cr.sinComentarios ? 'disabled' : ''}> Comentarios</label>
      <label><input type="checkbox" name="duo" ${cr.sinDuo ? 'disabled' : ''}> Dúo</label>
      <label><input type="checkbox" name="stitch" ${cr.sinStitch ? 'disabled' : ''}> Stitch</label>
      <label><input type="checkbox" name="ia"> Hecho con IA</label>
    </div>
    <label class="tk-check"><input type="checkbox" name="comercial"> Es contenido comercial (promociona una marca, producto o servicio)</label>
    <div class="tk-com" hidden><label class="tk-check"><input type="checkbox" name="propia"> Tu marca: se mostrará «Contenido promocional»</label><label class="tk-check"><input type="checkbox" name="marca"> Colaboración pagada con un tercero</label></div>
    <p class="muted tk-legal">${legal(false)}</p>
    <label class="tk-check"><input type="checkbox" name="consiente" required> Lo acepto</label>
    <p class="muted">Puede tardar unos minutos en aparecer mientras TikTok lo procesa.</p>
    <button class="op" type="submit"><span><b>Publicar en TikTok</b></span></button></form>`);
  const fm = h.raiz.querySelector('form'), el = fm.elements;
  el.comercial.onchange = () => { fm.querySelector('.tk-com').hidden = !el.comercial.checked; };
  el.marca.onchange = () => { fm.querySelector('.tk-legal').innerHTML = legal(el.marca.checked); };
  fm.onsubmit = async (e) => {
    e.preventDefault();
    const b = { id: f.id, n: f.n, titulo: el.titulo.value, privacidad: el.privacidad.value, consiente: el.consiente.checked };
    for (const k of ['comentarios', 'duo', 'stitch', 'ia', 'comercial', 'propia', 'marca']) b[k] = el[k].checked;
    try { await api('/api/clips/tiktok', { ...b, cuenta }); h.cerrar(); aviso('En la cola de TikTok'); alHecho?.(); } catch (err) { if (err.message !== 'sesión') aviso(err.message); }
  };
}

// ---------- estadísticas del canal y estrategia (fase 5) ----------
const NOMBRE_ORIGEN = { clip: 'Clips de streamers', estudio: 'Estudio', recop: 'Recopilatorios', campana: 'Campañas', otro: 'Otros' };
const NOMBRE_TRAFICO = { SHORTS: 'Feed de Shorts', YT_SEARCH: 'Búsqueda', YT_OTHER_PAGE: 'Otras páginas de YouTube', SUBSCRIBER: 'Suscriptores', RELATED_VIDEO: 'Vídeos sugeridos', EXT_URL: 'Enlaces externos', BROWSE: 'Inicio y explorar', PLAYLIST: 'Listas', NO_LINK_OTHER: 'Directo o desconocido', YT_CHANNEL: 'Página del canal', NOTIFICATION: 'Notificaciones', END_SCREEN: 'Pantallas finales', HASHTAGS: 'Hashtags' };
let diasEst = 28;
async function vistaEstadisticas(main) {
  main.innerHTML = '<div class="lista est-vista"><p class="cargando">Cargando…</p></div>';
  const r = await api(`/api/estadisticas/resumen?dias=${diasEst}`);
  const L = $('.lista', main);
  const dias = r.canal_por_dia || [];
  const suma = (k) => dias.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const tabla = (titulo, grupo, nombre = (k) => k, max = 8) => {
    const filas = Object.entries(grupo || {}).slice(0, max);
    return filas.length ? `<section class="grupo-ajustes"><h2>${esc(titulo)}</h2><table class="est-tabla"><thead><tr><th></th><th>Vídeos</th><th>Vistas medias</th><th>% visto</th><th>Suscr.</th></tr></thead><tbody>
      ${filas.map(([k, v]) => `<tr><td>${esc(nombre(k))}</td><td>${num(v.videos)}</td><td><b>${num(v.vistas_media)}</b></td><td>${v.pct_visto_medio != null ? `${v.pct_visto_medio} %` : '—'}</td><td>${num(v.subs)}</td></tr>`).join('')}</tbody></table></section>` : '';
  };
  const ficha = (v) => `<a class="fila" href="https://youtube.com/${v.formato === 'short' ? 'shorts/' : 'watch?v='}${esc(v.yt)}" target="_blank" rel="noopener">
    <img class="mini-yt" src="https://i.ytimg.com/vi/${esc(v.yt)}/mqdefault.jpg" alt="" loading="lazy"><div class="txt"><b>${esc(v.titulo)}</b><br><small>${esc([`${num(v.vistas)} vistas`, v.pct_visto != null ? `${v.pct_visto} % visto` : null, v.subs ? `+${v.subs} suscr.` : null, NOMBRE_ORIGEN[v.origen?.tipo] || null, v.publicado].filter(Boolean).join(' · '))}</small></div></a>`;
  L.innerHTML = `<h1>Estadísticas</h1>
    <div class="pestanas-mini" role="tablist">${[7, 28, 90].map((d) => `<button role="tab" aria-selected="${d === diasEst}" data-dias="${d}">${d} días</button>`).join('')}<button class="enlace-cola" data-actualizar style="border:0;background:none">Actualizar datos</button></div>
    <div class="kpis">
      <div><b class="tnum">${num(suma('vistas'))}</b><span>vistas</span></div>
      <div><b class="tnum">${num(Math.round(suma('minutos') / 60))}</b><span>horas vistas</span></div>
      <div><b class="tnum">${num(suma('subs_ganados') - suma('subs_perdidos'))}</b><span>suscriptores netos</span></div>
      <div><b class="tnum">${num(r.publicados_en_periodo)}</b><span>vídeos publicados</span></div>
    </div>
    ${dias[0] ? `<p class="muted">Datos de YouTube hasta el ${esc(dias[0].dia)} (YouTube los da con 2 o 3 días de retraso).</p>` : ''}
    <section class="grupo-ajustes"><h2>Estrategia del canal</h2>
      <p class="muted">Reglas que usan la IA al elegir clips y el Estudio al proponer vídeos.${r.estrategia_fecha ? ` Última versión: ${esc(hace(r.estrategia_fecha))}.` : ''}</p>
      <textarea class="estrategia" rows="7">${esc(r.estrategia_actual || '')}</textarea>
      <div class="ficha-acciones"><button class="boton primario" data-estrategia>Guardar la estrategia</button></div></section>
    ${tabla('Qué funciona: por tipo', r.por_origen, (k) => NOMBRE_ORIGEN[k] || k)}
    ${tabla('Por creador (clips)', r.por_creador)}
    ${tabla('Por hora de publicación', r.por_hora_publicacion, (k) => k, 24)}
    ${r.trafico?.length ? `<section class="grupo-ajustes"><h2>De dónde llegan las vistas</h2><table class="est-tabla"><tbody>${r.trafico.slice(0, 8).map((t) => `<tr><td>${esc(NOMBRE_TRAFICO[t.fuente] || t.fuente)}</td><td><b>${num(t.vistas)}</b></td></tr>`).join('')}</tbody></table></section>` : ''}
    <section class="grupo-ajustes"><h2>Los que mejor van</h2>${(r.mejores || []).slice(0, 8).map(ficha).join('')}</section>
    <section class="grupo-ajustes"><h2>Los que peor van</h2>${(r.peores || []).map(ficha).join('')}</section>`;
  L.querySelectorAll('[data-dias]').forEach((b) => { b.onclick = () => { diasEst = Number(b.dataset.dias); vistaEstadisticas(main); }; });
  L.querySelector('[data-estrategia]').onclick = async () => { try { await api('/api/estadisticas/estrategia', { texto: L.querySelector('.estrategia').value }); aviso('Estrategia guardada: la IA la usa desde ya'); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
  L.querySelector('[data-actualizar]').onclick = async (ev) => { ev.currentTarget.disabled = true; aviso('Pidiendo datos a YouTube…'); try { await api('/api/estadisticas/actualizar', {}); aviso('Datos actualizados'); vistaEstadisticas(main); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } };
}

// ---------- bolsa y recopilatorios (fase 5) ----------
const ESTADO_RECOP = { borrador: 'Borrador', cola: 'En cola para montar', montando: 'Montándose', listo: 'Montado', error: 'Con error', publicado: 'Publicado' };
async function vistaRecop(main) {
  main.innerHTML = '<div class="lista recop-vista"><p class="cargando">Cargando…</p></div>';
  const { clips, recops, dur, objetivo } = await api('/api/recop');
  const L = $('.lista', main), porId = new Map(clips.map((c) => [c.id, c]));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const durRecop = (r) => r.items.reduce((a, it) => a + (it.fin - it.ini) + (dur?.sep || 0), (dur?.intro || 0) + (dur?.teaser || 0) + (dur?.outro || 0));
  const porAprobar = clips.filter((c) => c.estado === 'listo' && c.aprobado == null);
  const bolsa = clips.filter((c) => c.estado === 'listo' && c.aprobado === 1 && !c.recop_id);
  const fallidos = clips.filter((c) => c.estado === 'error');
  const mini = (c) => `<img class="mini" src="/api/clips/poster/${c.video_id}/${c.n}" alt="" loading="lazy">`;
  const filaClip = (c, botones) => `<div class="fila recop-clip" data-rc="${c.id}">${mini(c)}<div class="txt"><b>${esc(c.titulo || c.video)}</b><br><small>${esc([c.canal, c.dur ? mmss(c.dur) : null, c.nota != null ? `nota ${Math.round(c.nota * 100)}` : null].filter(Boolean).join(' · '))}</small>${c.error ? `<br><small class="error-txt">${esc(c.error)}</small>` : ''}</div><div class="botones">${botones}</div></div>`;
  const tarjeta = (r) => {
    const d = durRecop(r), ok = d >= (objetivo?.min || 0) && d <= (objetivo?.max || 1e9), editable = ['borrador', 'listo', 'error'].includes(r.estado);
    return `<section class="recop-tarjeta" data-id="${r.id}">
      <div class="recop-cab"><input class="recop-titulo" value="${esc(r.titulo)}" ${editable ? '' : 'disabled'} aria-label="Título"><span class="chip-estado ${r.estado}">${esc(ESTADO_RECOP[r.estado] || r.estado)}</span></div>
      <small class="${ok ? 'muted' : 'aviso-txt'}">${r.items.length} clips · ${mmss(d)} ${objetivo ? `(objetivo ${mmss(objetivo.min)}–${mmss(objetivo.max)})` : ''}${r.paso ? ` · ${esc(r.paso)}` : ''}${r.error ? ` · ${esc(r.error)}` : ''}</small>
      <div class="recop-items">${r.items.map((it, i) => { const c = porId.get(it.id) || { titulo: `Clip ${it.id}`, video_id: 0, n: 0 }; return `<div class="fila" data-i="${i}">${mini(c)}<div class="txt"><b><span class="pos">${i + 1}</span>${esc(c.titulo || c.video || '')}</b><br><small>${esc(c.canal || '')} · ${mmss(it.fin - it.ini)}</small></div>
        ${editable ? `<div class="botones"><button class="boton icono-solo" data-m="arriba" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${I('abajo')}</button><button class="boton icono-solo" data-m="abajo" aria-label="Bajar" ${i === r.items.length - 1 ? 'disabled' : ''}>${I('abajo')}</button><button class="boton icono-solo" data-m="quitar" aria-label="Quitar">${I('cerrar')}</button></div>` : ''}</div>`; }).join('')}</div>
      <div class="ficha-acciones">${editable ? `<button class="boton primario" data-a="montar">${r.estado === 'listo' ? 'Volver a montar' : 'Montar'}</button>` : ''}${editable && bolsa.length ? `<button class="boton" data-a="anadir">Añadir de la bolsa (${bolsa.length})</button>` : ''}${r.estado !== 'montando' ? '<button class="boton" data-a="borrar">Borrar</button>' : ''}</div></section>`;
  };
  L.innerHTML = `<h1>Bolsa y recopilatorios</h1>
    <p class="muted">Los clips que marcas como buenos para recopilatorio pasan aquí. Con suficientes clips se monta un vídeo largo horizontal (${objetivo ? `${Math.round(objetivo.min / 60)}–${Math.round(objetivo.max / 60)} min` : ''}).</p>
    ${porAprobar.length ? `<div class="seccion-fecha">Por aprobar para recopilatorio · ${porAprobar.length}</div>${porAprobar.slice(0, 30).map((c) => filaClip(c, '<button class="boton" data-ap="1">Sí</button><button class="boton" data-ap="0">No</button>')).join('')}` : ''}
    <div class="seccion-fecha">En la bolsa · ${bolsa.length}</div>${bolsa.map((c) => filaClip(c, '')).join('') || '<p class="muted">La bolsa está vacía.</p>'}
    ${bolsa.length >= 3 ? '<div class="ficha-acciones"><button class="boton primario" data-crear>Crear un recopilatorio con la bolsa</button></div>' : ''}
    <div class="seccion-fecha">Recopilatorios · ${recops.length}</div>${recops.map(tarjeta).join('') || '<p class="muted">Todavía no hay recopilatorios.</p>'}
    ${fallidos.length ? `<div class="seccion-fecha">Versiones horizontales con error · ${fallidos.length}</div>${fallidos.map((c) => filaClip(c, '<button class="boton" data-reint>Reintentar</button>')).join('')}` : ''}`;
  const hecho = (msg) => { aviso(msg); vistaRecop(main); };
  const err = (e) => { if (e.message !== 'sesión') aviso(e.message); };
  L.querySelectorAll('[data-ap]').forEach((b) => { b.onclick = () => api('/api/recop/aprobar', { rc: Number(b.closest('.recop-clip').dataset.rc), si: b.dataset.ap === '1' }).then(() => hecho(b.dataset.ap === '1' ? 'A la bolsa' : 'Descartado para recopilatorio')).catch(err); });
  L.querySelectorAll('[data-reint]').forEach((b) => { b.onclick = () => api('/api/recop/reintentar', { rc: Number(b.closest('.recop-clip').dataset.rc) }).then(() => hecho('Se vuelve a intentar')).catch(err); });
  const crear = L.querySelector('[data-crear]'); if (crear) crear.onclick = () => api('/api/recop/crear', {}).then(() => hecho('Borrador creado')).catch(err);
  L.querySelectorAll('.recop-tarjeta').forEach((t) => {
    const r = recops.find((x) => x.id === Number(t.dataset.id));
    const guardar = (items, msg) => api('/api/recop/guardar', { id: r.id, titulo: t.querySelector('.recop-titulo').value, items }).then(() => hecho(msg)).catch(err);
    const tit = t.querySelector('.recop-titulo'); if (!tit.disabled) tit.onchange = () => guardar(r.items, 'Título guardado');
    t.querySelectorAll('.recop-items [data-m]').forEach((b) => { b.onclick = () => {
      const i = Number(b.closest('.fila').dataset.i), l = [...r.items];
      if (b.dataset.m === 'quitar') { l.splice(i, 1); return guardar(l, 'Clip quitado (vuelve a la bolsa)'); }
      const j = b.dataset.m === 'arriba' ? i - 1 : i + 1; [l[i], l[j]] = [l[j], l[i]]; guardar(l, 'Orden cambiado');
    }; });
    t.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => {
      if (b.dataset.a === 'montar') return api('/api/recop/montar', { id: r.id }).then(() => hecho('En cola para montar')).catch(err);
      if (b.dataset.a === 'borrar') return api('/api/recop/borrar', { id: r.id }).then(() => hecho('Recopilatorio borrado (sus clips vuelven a la bolsa)')).catch(err);
      if (b.dataset.a === 'anadir') return guardar([...r.items, ...bolsa.map((c) => ({ id: c.id, ini: 0, fin: c.dur, texto: '' }))], 'Clips de la bolsa añadidos');
    }; });
  });
}

// ---------- ficha de una propuesta del Estudio (fase 6) ----------
const ESTADO_PROP = { propuesta: 'Por revisar', cambios: 'Cambios pedidos', aprobado: 'Aprobada: se produce sola', produciendo: 'Produciéndose', terminado: 'Terminada', descartado: 'Descartada', error: 'Con error' };
async function vistaPropuesta(main) {
  const slug = decodeURIComponent(location.hash.split('/')[2] || '');
  main.innerHTML = '<div class="lista prop-vista"><p class="cargando">Cargando…</p></div>';
  const p = await api(`/api/estudio/proyecto?slug=${encodeURIComponent(slug)}`);
  const L = $('.lista', main), pr = p.proyecto || {}, v = p.version || 1;
  const arch = (f) => `/api/estudio/archivo/${encodeURIComponent(p.slug)}/${f}`;
  const final = p.archivos || [], tieneVideo = final.includes('video.mp4');
  const coms = p.comentarios || [], pend = coms.filter((c) => !c.atendido);
  const comentariosDe = (esc_) => coms.filter((c) => (c.escena || null) === esc_).map((c) => `<p class="coment ${c.atendido ? 'atendido' : ''}"><span>${esc(c.texto)}</span><small>${c.atendido ? `atendido en v${c.version + 1}` : 'pendiente'}</small></p>`).join('');
  const formCom = (escena) => `<form class="form-com" data-escena="${esc(escena || '')}"><input placeholder="${escena ? 'Comenta esta escena…' : 'Comentario general…'}" aria-label="Comentario"><button class="boton">Enviar</button></form>`;
  const acciones = { propuesta: ['aprobar', 'cambios', 'descartar'], cambios: ['aprobar', 'descartar'], descartado: ['reabrir'], terminado: [], aprobado: [], produciendo: [], error: ['reabrir'] }[p.estado] || [];
  const NOM = { aprobar: ['Aprobar', 'primario'], cambios: ['Pedir cambios', ''], descartar: ['Descartar', ''], reabrir: ['Recuperar', ''] };
  L.innerHTML = `<a class="atras" href="#/explorar">${I('abajo')}<span>Explorar</span></a>
    <h1>${esc(p.titulo)}</h1>
    <p class="muted"><span class="chip-estado ${esc(p.estado)}">${esc(ESTADO_PROP[p.estado] || p.estado)}</span> ${esc([pr.formato, pr.serie, `versión ${v}`, pr.duracion_objetivo_s ? `${Math.round(pr.duracion_objetivo_s / 60)} min` : null].filter(Boolean).join(' · '))}${p.paso ? ` · ${esc(p.paso)}` : ''}</p>
    ${p.error ? `<p class="error-txt">${esc(p.error)}</p>` : ''}
    ${tieneVideo ? `<video class="prop-video" src="${arch('video.mp4')}" poster="${arch('miniatura.png')}" controls preload="metadata" playsinline></video>`
      : `<video class="prop-video" src="${arch(`propuesta/v${v}/avance.mp4`)}" poster="${arch(`propuesta/v${v}/miniatura.png`)}" controls preload="metadata" playsinline></video><p class="muted">Avance de la versión ${v}: las primeras escenas con voz, para juzgar ritmo y estilo.</p>`}
    ${acciones.length ? `<div class="ficha-acciones">${acciones.map((a) => `<button class="boton ${NOM[a][1]}" data-estado="${a}">${NOM[a][0]}</button>`).join('')}</div>
      <p class="muted">${p.estado === 'propuesta' ? 'Aprobar: se produce sola esta noche y se programa en el siguiente hueco de vídeos largos. Pedir cambios: deja antes tus comentarios; Claude hará una versión nueva.' : ''}</p>` : ''}
    ${final.some((f) => f.startsWith('shorts/') && f.endsWith('.mp4')) ? `<section class="grupo-ajustes"><h2>Shorts del vídeo</h2><div class="prop-shorts">${final.filter((f) => f.startsWith('shorts/') && f.endsWith('.mp4')).map((f) => `<video src="${arch(f)}" controls preload="metadata" playsinline></video>`).join('')}</div></section>` : ''}
    <section class="grupo-ajustes"><h2>Comentarios generales${pend.length ? ` · ${pend.length} pendientes` : ''}</h2>${comentariosDe(null) || '<p class="muted">Sin comentarios generales.</p>'}${formCom(null)}</section>
    <section class="grupo-ajustes"><h2>Escenas · ${(pr.escenas || []).length}</h2>
      ${(pr.escenas || []).map((e, i) => `<div class="escena"><img src="${arch(`propuesta/v${v}/escenas/${e.id}.png`)}" alt="Fotograma de la escena ${i + 1}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div><small class="muted">${i + 1}${e.capitulo ? ` · ${esc(e.capitulo)}` : ''}${e.visual?.tipo ? ` · ${esc(e.visual.tipo)}` : ''}</small><p>${esc(e.narracion || '')}</p>${comentariosDe(e.id)}${formCom(e.id)}</div></div>`).join('')}</section>
    ${pr.publicacion ? `<section class="grupo-ajustes"><h2>Textos de publicación</h2><pre class="prop-pub">${esc(typeof pr.publicacion === 'string' ? pr.publicacion : [pr.publicacion.titulo, pr.publicacion.descripcion, (pr.publicacion.etiquetas || pr.publicacion.hashtags || []).join?.(' ')].filter(Boolean).join('\n\n'))}</pre></section>` : ''}`;
  const err = (e) => { if (e.message !== 'sesión') aviso(e.message); };
  L.querySelectorAll('.form-com').forEach((f) => { f.onsubmit = async (ev) => { ev.preventDefault(); const t = f.querySelector('input').value.trim(); if (!t) return; try { await api('/api/estudio/comentar', { slug: p.slug, escena: f.dataset.escena || null, texto: t }); aviso('Comentario guardado'); vistaPropuesta(main); } catch (e) { err(e); } }; });
  L.querySelectorAll('[data-estado]').forEach((b) => { b.onclick = async () => { try { await api('/api/estudio/estado', { slug: p.slug, accion: b.dataset.estado }); aviso({ aprobar: 'Aprobada: se produce sola', cambios: 'Cambios pedidos', descartar: 'Descartada', reabrir: 'Recuperada' }[b.dataset.estado]); vistaPropuesta(main); } catch (e) { err(e); } }; });
}
function hojaEncargo() {
  hojaFormulario('Proponer un vídeo', [{ nombre: 'titulo', etiqueta: 'Tema o título', max: 140 }, { nombre: 'detalle', etiqueta: 'Qué quieres contar (opcional)', largo: true, max: 1500 }],
    async (v) => { await api('/api/estudio/encargo', v); aviso('Encargo guardado: Claude lo convertirá en propuesta'); },
    { boton: 'Encargar', nota: 'La próxima vez que trabajes el Estudio con Claude, lo convierte en una propuesta con guion y escenas.' });
}

// ---------- utilidades de formularios y fechas ----------
const errAviso = (e) => { if (e.message !== 'sesión') aviso(e.message); };

// Formulario con tipos (texto, largo, fecha, num, opcion, bool) en una hoja.
function hojaCampos(titulo, campos, alGuardar, { boton = 'Guardar', nota = '', peligro = null } = {}) {
  const control = (c) => {
    const v = c.valor ?? '';
    if (c.tipo === 'largo') return `<textarea name="${c.nombre}" rows="${c.filas || 4}" ${c.max ? `maxlength="${c.max}"` : ''} placeholder="${esc(c.ph || '')}">${esc(v)}</textarea>`;
    if (c.tipo === 'opcion') return `<select name="${c.nombre}">${c.opciones.map(([o, t]) => `<option value="${esc(o)}" ${String(o) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    if (c.tipo === 'bool') return `<span class="interruptor"><input type="checkbox" name="${c.nombre}" ${v ? 'checked' : ''}><span></span></span>`;
    return `<input name="${c.nombre}" type="${c.tipo === 'fecha' ? 'date' : c.tipo === 'num' ? 'number' : c.tipo === 'clave' ? 'password' : 'text'}" ${c.tipo === 'clave' ? 'autocomplete="new-password"' : ''} value="${esc(v)}" ${c.max ? `maxlength="${c.max}"` : ''} placeholder="${esc(c.ph || '')}">`;
  };
  const h = capa(`<form class="hoja hoja-campos" role="dialog" aria-label="${esc(titulo)}"><h2>${esc(titulo)}</h2>${nota ? `<p class="muted" style="padding:0 16px">${esc(nota)}</p>` : ''}
    ${campos.map((c) => `<label class="campo ${c.tipo === 'bool' ? 'campo-bool' : ''}"><span>${esc(c.etiqueta)}${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</span>${control(c)}</label>`).join('')}
    <button class="op" type="submit"><span><b>${esc(boton)}</b></span></button>${peligro ? `<button class="op peligro" type="button" data-peligro><span>${esc(peligro.texto)}</span></button>` : ''}</form>`);
  h.raiz.querySelector('input:not([type=checkbox]), textarea, select')?.focus();
  const f = h.raiz.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(campos.map((c) => [c.nombre, c.tipo === 'bool' ? f.elements[c.nombre].checked : c.tipo === 'num' ? Number(f.elements[c.nombre].value) : f.elements[c.nombre].value.trim()]));
    try { await alGuardar(v); h.cerrar(); } catch (err) { errAviso(err); }
  };
  const p = f.querySelector('[data-peligro]'); if (p) p.onclick = () => { h.cerrar(); peligro.accion(); };
}
// Confirmación en hoja (sin diálogos del navegador).
const confirmar = (titulo, texto, accion) => hoja(titulo, [{ texto, peligro: true, icono: 'papelera', accion }, { texto: 'Cancelar', accion: () => {} }]);

// ---------- servidor (fase 8): sistema, operaciones y «en marcha» ----------
const fBytes = (b) => (b == null ? '–' : b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(b >= 1e11 ? 0 : 1)} GB` : `${Math.round(b / 1e6)} MB`);
const fEncendido = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
const medidor = (pct, aviso = 80, mal = 92) => `<span class="medidor ${pct >= mal ? 'mal' : pct >= aviso ? 'aviso' : ''}"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></span>`;
const NIVEL_ALERTA = { alto: 'rojo', medio: 'acento', bajo: '' };
const filaAlerta = (a) => `<div class="fila"><span class="ico-fila ${NIVEL_ALERTA[a.nivel] || ''}">${I('alerta')}</span><div class="txt"><b>${esc(a.titulo)}</b><br><small>${esc(a.texto)} · desde ${esc(hace(a.desde))}</small></div></div>`;
// ---------- recursos en vivo, estilo btop (23-nov-2026) ----------
// Se dibuja una vez y se actualiza cada 2 s con /api/sistema/recursos mientras la pantalla está a la vista.
const fTasa = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${Math.round(b / 1e3)} KB/s` : `${Math.round(b || 0)} B/s`);
const fMem = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round((b || 0) / 1e6)} MB`);
const colorPct = (p) => (p >= 85 ? 'var(--rojo)' : p >= 60 ? 'var(--acento-2)' : p >= 30 ? 'var(--acento)' : 'var(--verde)');
const barraBt = (pct, color = colorPct(pct)) => `<span class="bt-barra"><i style="width:${Math.max(1, Math.min(100, pct))}%;background:${color}"></i></span>`;
function graficaBt(canvas, series, colores, max = null) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(canvas), tope = max ?? Math.max(1, ...series.flat());
  g.strokeStyle = css.getPropertyValue('--borde').trim(); g.lineWidth = 1; g.setLineDash([2, 4]);
  for (const f of [0.25, 0.5, 0.75]) { g.beginPath(); g.moveTo(0, Math.round(h * f) + 0.5); g.lineTo(w, Math.round(h * f) + 0.5); g.stroke(); }
  g.setLineDash([]);
  series.forEach((s, k) => {
    if (s.length < 2) return;
    const paso = w / 149, x0 = w - (s.length - 1) * paso, c = css.getPropertyValue(colores[k]).trim() || colores[k];
    g.beginPath(); s.forEach((v, i) => { const x = x0 + i * paso, y = h - Math.min(1, v / tope) * (h - 2) - 1; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = c; g.lineWidth = 1.5; g.stroke();
    g.lineTo(w, h); g.lineTo(x0, h); g.closePath(); g.globalAlpha = 0.16; g.fillStyle = c; g.fill(); g.globalAlpha = 1;
  });
}

function montarBtop(servicios = []) {
  const el = document.createElement('section'); el.className = 'btop';
  el.innerHTML = `
    <div class="bt-caja bt-cpu"><header><b>CPU</b><span class="muted" data-modelo></span><span class="bt-dato tnum" data-cpu-total></span></header>
      <canvas data-g="cpu" aria-label="Uso de CPU en los últimos 5 minutos"></canvas><div class="bt-nucleos tnum" data-nucleos></div><footer class="muted tnum" data-cpu-pie></footer></div>
    <div class="bt-caja bt-mem"><header><b>Memoria</b><span class="bt-dato tnum" data-mem-pct></span></header><canvas data-g="mem" aria-label="Memoria en uso"></canvas><div class="bt-filas tnum" data-mem></div></div>
    <div class="bt-caja bt-red"><header><b>Red</b><span class="bt-dato tnum" data-red-dato></span></header><canvas data-g="red" aria-label="Tráfico de red"></canvas><div class="bt-filas tnum" data-red></div></div>
    <div class="bt-caja bt-disco"><header><b>Discos</b><span class="bt-dato tnum" data-io-dato></span></header><canvas data-g="io" aria-label="Lectura y escritura de disco"></canvas><div class="bt-filas tnum" data-discos></div></div>
    <div class="bt-caja bt-temp"><header><b>Sensores</b></header><div class="bt-filas tnum" data-temps></div></div>
    <div class="bt-caja bt-proc"><header><b>Procesos</b><span class="muted tnum" data-proc-n></span>
      <div class="bt-ctrl"><input type="search" placeholder="Filtrar" aria-label="Filtrar procesos" data-filtro>
        <div class="bt-seg" role="group" aria-label="Orden"><button data-orden="cpu" aria-pressed="true">CPU</button><button data-orden="rss" aria-pressed="false">Memoria</button><button data-agrupar aria-pressed="false">Por servicio</button></div></div></header>
      <div class="bt-tabla tnum" data-procs role="table"></div></div>`;
  let orden = 'cpu', agrupar = false, filtro = '', unidad = null, d = null, reloj = null, vivo = true;
  const $e = (s) => el.querySelector(s);
  $e('[data-filtro]').oninput = (ev) => { filtro = ev.target.value.trim().toLowerCase(); unidad = null; pintarProcs(); };
  el.querySelectorAll('[data-orden]').forEach((b) => { b.onclick = () => { orden = b.dataset.orden; el.querySelectorAll('[data-orden]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); pintarProcs(); }; });
  $e('[data-agrupar]').onclick = (ev) => { agrupar = !agrupar; unidad = null; ev.currentTarget.setAttribute('aria-pressed', String(agrupar)); pintarProcs(); };

  function pintarProcs() {
    if (!d?.procesos) return;
    const T = $e('[data-procs]');
    if (agrupar && !unidad) {
      const filas = d.servicios.filter((g) => !filtro || g.nombre.toLowerCase().includes(filtro)).sort((a, b) => b[orden] - a[orden]).slice(0, 40);
      T.innerHTML = `<div class="bt-fila bt-cab" role="row"><span>Servicio</span><span>Proc.</span><span>CPU</span><span>Memoria</span></div>` + filas.map((g) => `<button class="bt-fila" role="row" data-unidad="${esc(g.id)}"><span class="bt-nom"><b>${esc(g.nombre)}</b></span><span>${g.n}</span><span>${g.cpu.toFixed(1)}%${barraBt(Math.min(100, g.cpu / d.nucleos))}</span><span>${fMem(g.rss)}</span></button>`).join('');
      T.querySelectorAll('[data-unidad]').forEach((b) => { b.onclick = () => { unidad = b.dataset.unidad; pintarProcs(); }; });
      return;
    }
    const lista = d.procesos.filter((p) => (!unidad || p.unidad === unidad) && (!filtro || `${p.nombre} ${p.unidadNombre} ${p.pid}`.toLowerCase().includes(filtro)))
      .sort((a, b) => b[orden] - a[orden]).slice(0, 50);
    T.innerHTML = (unidad ? `<button class="bt-volver" data-volver>← ${esc(d.servicios.find((g) => g.id === unidad)?.nombre || unidad)}</button>` : '')
      + `<div class="bt-fila bt-cab" role="row"><span>Proceso</span><span>PID</span><span>CPU</span><span>Memoria</span></div>`
      + lista.map((p) => `<button class="bt-fila" role="row" data-pid="${p.pid}"><span class="bt-nom"><b>${esc(p.nombre)}</b><small>${esc(p.unidadNombre)}${p.nice > 0 ? ' · prioridad baja' : ''}</small></span><span>${p.pid}</span><span>${p.cpu.toFixed(1)}%${barraBt(Math.min(100, p.cpu))}</span><span>${fMem(p.rss)}</span></button>`).join('')
      + (lista.length ? '' : '<p class="muted">Nada coincide.</p>');
    T.querySelector('[data-volver]')?.addEventListener('click', () => { unidad = null; pintarProcs(); });
    T.querySelectorAll('[data-pid]').forEach((b) => { b.onclick = () => accionesProceso(d.procesos.find((p) => p.pid === Number(b.dataset.pid))); });
  }
  async function accionesProceso(p) {
    if (!p) return;
    let det = null; try { det = await api(`/api/sistema/proceso?pid=${p.pid}`); } catch {}
    const sv = servicios.find((s) => s.id === p.unidad);
    const hacer = (accion, ok) => async () => { try { await api('/api/sistema/proceso', { pid: p.pid, accion }); aviso(ok); } catch (e) { errAviso(e); } };
    const ops = [];
    if (p.propio) {
      ops.push(p.nice > 0 ? { texto: 'Prioridad normal', sub: 'Vuelve a competir por la CPU como los demás', icono: 'reintentar', accion: hacer('normal', 'Prioridad normal') }
        : { texto: 'Prioridad baja', sub: 'Sigue funcionando, pero deja la CPU a lo demás', icono: 'abajo', accion: hacer('bajar', 'Ahora con prioridad baja') });
      ops.push({ texto: 'Terminar', sub: 'Le pide que se cierre ordenadamente', icono: 'alerta', peligro: true, accion: hacer('terminar', `${p.nombre}: terminado`) });
      ops.push({ texto: 'Forzar cierre', sub: 'Lo corta en seco: puede dejar un trabajo a medias', icono: 'alerta', peligro: true, accion: hacer('forzar', `${p.nombre}: cerrado`) });
    }
    if (sv) ops.push({ texto: `Reiniciar «${sv.nombre}»`, sub: 'El servicio entero al que pertenece', icono: 'reintentar', accion: async () => { try { await api('/api/sistema/servicio', { id: sv.id }); aviso(`${sv.nombre}: reiniciando`); } catch (e) { errAviso(e); } } });
    ops.push({ texto: 'Cerrar', accion: () => {} });
    const h = hoja(`${p.nombre} · PID ${p.pid}`, ops);
    h.raiz.querySelector('h2')?.insertAdjacentHTML('afterend', `<p class="muted bt-cmd">${esc(det?.cmd || '')}${p.propio ? '' : '<br>Proceso del sistema: solo se puede mirar.'}</p>`);
  }

  function pintar() {
    const c = d.cpu, m = d.mem;
    $e('[data-modelo]').textContent = `${d.modelo || ''} · ${d.nucleos} hilos`;
    $e('[data-cpu-total]').innerHTML = `<b style="color:${colorPct(c.total)}">${Math.round(c.total)}%</b>`;
    $e('[data-nucleos]').innerHTML = c.nucleos.map((p, i) => `<div><span>C${i}</span>${barraBt(p)}<span>${Math.round(p)}%</span><span class="muted">${c.mhz[i] ? `${(c.mhz[i] / 1000).toFixed(1)} GHz` : ''}</span></div>`).join('');
    $e('[data-cpu-pie]').textContent = `carga ${d.carga.map((x) => x.toFixed(2)).join(' · ')} · ${d.total_procesos} procesos · encendido ${fEncendido(d.encendido_s)}`;
    const memPct = (m.usado / m.total) * 100;
    $e('[data-mem-pct]').innerHTML = `<b style="color:${colorPct(memPct)}">${Math.round(memPct)}%</b> de ${fMem(m.total)}`;
    $e('[data-mem]').innerHTML = [['En uso', m.usado, m.total], ['Caché', m.cache, m.total], ['Disponible', m.disponible, m.total]].map(([n, v, t]) => `<div><span>${n}</span>${barraBt((v / t) * 100, n === 'Disponible' ? 'var(--verde)' : n === 'Caché' ? 'var(--suave)' : undefined)}<span>${fMem(v)}</span></div>`).join('')
      + m.swaps.map((s) => `<div><span>${s.nombre === 'zram0' ? 'zram' : 'Swap'}</span>${barraBt((s.usado / s.total) * 100)}<span>${fMem(s.usado)}</span></div>`).join('')
      + (m.zram?.ocupa ? `<p class="muted">zram comprime ${fMem(m.zram.datos)} en ${fMem(m.zram.ocupa)} (×${(m.zram.datos / m.zram.ocupa).toFixed(1)})</p>` : '');
    const rx = d.red.reduce((a, x) => a + x.rx, 0), tx = d.red.reduce((a, x) => a + x.tx, 0);
    $e('[data-red-dato]').innerHTML = `<span class="bt-baja">↓ ${fTasa(rx)}</span> <span class="bt-sube">↑ ${fTasa(tx)}</span>`;
    $e('[data-red]').innerHTML = d.red.filter((x) => x.rxTotal + x.txTotal > 0).map((x) => `<div><span>${esc(x.nombre)}</span><span class="bt-baja">↓ ${fTasa(x.rx)}</span><span class="bt-sube">↑ ${fTasa(x.tx)}</span></div>`).join('');
    const lee = d.discos.reduce((a, x) => a + x.lee, 0), es = d.discos.reduce((a, x) => a + x.esc, 0);
    $e('[data-io-dato]').innerHTML = `<span class="bt-baja">L ${fTasa(lee)}</span> <span class="bt-sube">E ${fTasa(es)}</span>`;
    $e('[data-discos]').innerHTML = d.discos.map((x) => `<div><span>${esc(x.nombre)}</span>${barraBt(x.ocupado)}<span>${Math.round(x.ocupado)}% ocupado</span></div>`).join('')
      + (d.uso || []).map((x) => `<div><span>${esc(x.nombre)}</span>${barraBt((x.usado / x.total) * 100)}<span>${fBytes(x.libre)} libres</span></div>`).join('');
    const temps = d.temperaturas.filter((t, i, a) => t.sensor !== 'coretemp' || t.nombre === 'CPU' || a.filter((x) => x.sensor === 'coretemp').length < 6);
    $e('[data-temps]').innerHTML = temps.map((t) => `<div><span>${esc(t.nombre)}</span>${barraBt(((t.c - 30) / 70) * 100)}<span>${Math.round(t.c)} °C</span></div>`).join('')
      + (d.gpu ? `<div><span>GPU</span>${barraBt((d.gpu.mhz / d.gpu.max) * 100, 'var(--acento)')}<span>${d.gpu.mhz} MHz</span></div>` : '')
      + (d.bateria?.carga != null ? `<div><span>Batería</span>${barraBt(d.bateria.carga, d.bateria.carga < 25 ? 'var(--rojo)' : 'var(--verde)')}<span>${d.bateria.carga}%${d.bateria.enchufado ? ' ⚡' : ''}</span></div>` : '');
    $e('[data-proc-n]').textContent = `${d.total_procesos}`;
    graficaBt($e('[data-g="cpu"]'), [d.hist.cpu], ['--acento'], 100);
    graficaBt($e('[data-g="mem"]'), [d.hist.mem], ['--verde'], 100);
    graficaBt($e('[data-g="red"]'), [d.hist.rx, d.hist.tx], ['--verde', '--acento-2']);
    graficaBt($e('[data-g="io"]'), [d.hist.lee, d.hist.esc], ['--verde', '--acento-2']);
    pintarProcs();
  }
  async function vuelta() {
    clearTimeout(reloj);
    if (!vivo || !el.isConnected || !location.hash.startsWith('#/sistema')) { vivo = false; return; }
    if (!document.hidden) { try { d = await api('/api/sistema/recursos'); if (d.linux === false) { el.innerHTML = '<p class="muted">Solo en el servidor.</p>'; return; } pintar(); } catch {} }
    reloj = setTimeout(vuelta, 2000);
  }
  el.arrancar = () => { if (!vivo) { vivo = true; } vuelta(); };
  el.ponerServicios = (s) => { servicios = s; };
  return el;
}

let relojSistema;

async function vistaSistema(main) {
  clearTimeout(relojSistema);
  if (!main.querySelector('.sistema-vista')) main.innerHTML = '<div class="lista sistema-vista"><p class="cargando">Cargando…</p></div>';
  const [s, alertas, ac] = await Promise.all([api('/api/sistema'), api('/api/sistema/alertas').catch(() => []), api('/api/acelerador').catch(() => null)]);
  const L = $('.sistema-vista', main); if (!L) return;
  const bt = L.querySelector('.btop'); bt?.remove(); // el panel en vivo se conserva entre recargas
  const memPct = ((s.memoria.total - s.memoria.disponible) / s.memoria.total) * 100;
  const b = s.bateria, caidos = s.servicios.filter((x) => !['active', 'simulado'].includes(x.estado));
  const acTxt = !ac ? '' : !ac.activo ? 'Desactivada' : !ac.conectada ? 'Apagada o desconectada' : !ac.acepta?.length ? (ac.info?.pausa ? 'En pausa' : 'Con batería: no acepta trabajo') : ac.enCurso?.length ? 'Trabajando' : 'Lista';
  L.innerHTML = `<h1>Servidor</h1><p class="muted">${esc(s.nombre)} · encendido desde hace ${fEncendido(s.encendido_s)} · ${caidos.length ? `<b class="error-txt">${caidos.length} servicio(s) sin funcionar</b>` : 'todo funcionando'}</p>
    <div class="ficha-acciones"><a class="boton" href="#/operaciones">${I('reloj')}<span>Operaciones</span></a><a class="boton" href="#/ajustes/servidor">${I('ajustes')}<span>Horario</span></a></div>
    ${alertas.length ? `<section class="grupo-ajustes"><h2>Problemas · ${alertas.length}</h2>${alertas.map(filaAlerta).join('')}<p class="muted">Te llegan al móvil (Ajustes › Avisos › «Problemas del servidor»). Se revisa cada 5 minutos.</p></section>` : ''}
    <div data-btop></div>
    ${s.reinicioPendiente ? '<p class="aviso-txt">Hay un núcleo nuevo instalado: reinicia el servidor cuando no haya tareas en marcha.</p>' : ''}
    <section class="grupo-ajustes"><h2>Servicios</h2>${s.servicios.map((x) => `<div class="fila"><span class="ico-fila ${x.estado === 'active' ? 'verde' : 'rojo'}">${I(x.estado === 'active' ? 'check' : 'alerta')}</span><div class="txt"><b>${esc(x.nombre)}</b><br><small>${esc(x.desc)}${x.estado === 'active' ? '' : ` · ${esc(x.estado)}`}</small></div>
      <div class="botones"><button class="boton" data-registro="${x.id}">Registro</button><button class="boton" data-reiniciar="${x.id}">Reiniciar</button></div></div>`).join('')}</section>
    ${ac ? `<section class="grupo-ajustes"><h2>Laptop con GPU</h2><div class="fila"><span class="ico-fila ${ac.conectada && ac.activo ? 'verde' : ''}">${I('grafica')}</span><div class="txt"><b>${esc(acTxt)}</b><br><small>Hace la IA y las transcripciones unas 10 veces más rápido cuando está encendida y enchufada · ${ac.stats?.hechos || 0} trabajos hechos${ac.visto ? ` · última señal ${esc(hace(ac.visto))}` : ''}</small></div></div></section>` : ''}
    <section class="grupo-ajustes"><h2>Red</h2><p class="muted">Wi-Fi: ${s.red.wifi ? `${esc(s.red.wifi.ssid)} · señal ${s.red.wifi.senal} %` : 'sin Wi-Fi (o por cable)'} · red local <code>${esc(s.red.lan || '–')}</code>${s.red.tailscale ? ` · Tailscale <code>${esc(s.red.tailscale)}</code>` : ''} · ${esc(s.so)}</p></section>
    <section class="grupo-ajustes"><h2>Más acciones</h2>
      <button class="fila" data-suspender><span class="ico-fila">${I('luna')}</span><div class="txt"><b>Suspender ahora</b><br><small>Se despierta a su hora</small></div><span class="flecha">${I('abajo')}</span></button></section>`;
  { const panel = bt || montarBtop(s.servicios); panel.ponerServicios(s.servicios); L.querySelector('[data-btop]')?.replaceWith(panel); panel.arrancar(); }
  const recargar = () => vistaSistema(main);
  L.querySelectorAll('[data-reiniciar]').forEach((x) => { const sv = s.servicios.find((y) => y.id === x.dataset.reiniciar); x.onclick = () => hoja(`¿Reiniciar «${sv.nombre}»?`, [
    { texto: 'Reiniciar', icono: 'reintentar', accion: async () => { const r = await api('/api/sistema/servicio', { id: sv.id }); if (r.propio) { aviso('Reiniciando la app: vuelve en unos segundos'); setTimeout(() => location.reload(), 7000); return; } aviso(`${sv.nombre}: reiniciado`); recargar(); } },
    { texto: 'Cancelar', accion: () => {} }]); });
  L.querySelectorAll('[data-registro]').forEach((x) => { x.onclick = async () => {
    const sv = s.servicios.find((y) => y.id === x.dataset.registro);
    try { const { texto } = await api(`/api/sistema/registro?id=${encodeURIComponent(sv.id)}`);
      const h = capa(`<div class="visor-correo" role="dialog" aria-label="Registro"><div class="cab"><b>Registro · ${esc(sv.nombre)}</b><button class="boton icono-solo" data-cerrar aria-label="Cerrar">${I('cerrar')}</button></div><pre class="registro grande">${esc(texto)}</pre></div>`);
      h.raiz.querySelector('[data-cerrar]').onclick = h.cerrar; const pre = h.raiz.querySelector('pre'); pre.scrollTop = pre.scrollHeight;
    } catch (e) { errAviso(e); }
  }; });
  L.querySelector('[data-suspender]').onclick = () => hoja('¿Suspender el servidor ahora?', [{ texto: 'Suspender', icono: 'luna', accion: async () => { await api('/api/energia/suspender', {}); aviso('Suspendiendo'); } }, { texto: 'Cancelar', accion: () => {} }]);
  if (location.hash.startsWith('#/sistema')) relojSistema = setTimeout(() => { if (location.hash.startsWith('#/sistema') && $('#capa').hidden) vistaSistema(main).catch(() => {}); }, 30000);
}

// --- operaciones: lanzar tareas a mano, en una cola ordenable ---
const ESTADO_OP = { pendiente: 'En cola', en_curso: 'En marcha', hecha: 'Hecha', error: 'Con error', cancelada: 'Cancelada' };
let relojOps;
function enMarchaHtml(m, alertas = []) {
  const filas = [];
  if (m.clip) filas.push(['tijera', `Recortando: ${m.clip.titulo}`, m.clip.paso || '']);
  if (m.editor && (m.editor.trabajando || m.editor.editor || m.editor.horizontales)) filas.push(['tijera', 'Renderizando', `${m.editor.editor || 0} del editor · ${m.editor.horizontales || 0} horizontales en cola`]);
  if (m.colaClips) filas.push(['cola', `${m.colaClips} vídeos en la cola de recorte`, '']);
  if (m.subidas && (m.subidas.youtube || m.subidas.tiktok)) filas.push(['enviar', 'Por subir', `YouTube ${m.subidas.youtube} · TikTok ${m.subidas.tiktok}`]);
  return alertas.map(filaAlerta).join('') + (filas.map(([ic, t, sub]) => `<div class="fila"><span class="ico-fila acento">${I(ic)}</span><div class="txt"><b>${esc(t)}</b>${sub ? `<br><small>${esc(sub)}</small>` : ''}</div></div>`).join('') || (alertas.length ? '' : '<p class="muted">Nada en marcha ahora mismo.</p>'));
}
async function vistaOperaciones(main) {
  clearTimeout(relojOps);
  if (!main.querySelector('.ops-vista')) main.innerHTML = '<div class="lista ops-vista"><p class="cargando">Cargando…</p></div>';
  const d = await api('/api/operaciones');
  const L = $('.ops-vista', main); if (!L) return;
  const grupos = [...new Set(d.catalogo.map((c) => c.grupo))];
  const fila = (o, cola) => { const t = d.catalogo.find((c) => c.tipo === o.tipo); const p = Object.values(o.params || {}).join(' · ');
    return `<div class="fila" data-id="${o.id}"><span class="ico-fila ${o.estado === 'error' ? 'rojo' : o.estado === 'en_curso' ? 'acento' : o.estado === 'hecha' ? 'verde' : ''}">${I(o.estado === 'error' ? 'alerta' : o.estado === 'hecha' ? 'check' : 'reloj')}</span><div class="txt"><b>${esc(t?.nombre || o.tipo)}</b>${p ? ` <small>${esc(p)}</small>` : ''}<br><small>${esc(ESTADO_OP[o.estado] || o.estado)} · ${esc(hace(`${(o.fin || o.inicio || o.creado).replace(' ', 'T')}Z`))}${o.resultado ? ` · ${esc(o.resultado)}` : ''}</small>${o.error ? `<br><small class="error-txt">${esc(o.error)}</small>` : ''}</div>
      ${cola && o.estado === 'pendiente' ? `<div class="botones"><button class="boton icono-solo" data-mov="arriba" aria-label="Subir">${I('abajo')}</button><button class="boton icono-solo" data-mov="abajo" aria-label="Bajar">${I('abajo')}</button><button class="boton icono-solo" data-cancelar aria-label="Cancelar">${I('cerrar')}</button></div>` : ''}</div>`; };
  L.innerHTML = `<h1>Operaciones</h1><p class="muted">Lanza cualquier tarea del servidor cuando quieras. Van de una en una, en el orden de la cola; las automáticas siguen a su hora.</p>
    <section class="grupo-ajustes"><h2>En marcha</h2>${enMarchaHtml(d.enMarcha)}</section>
    ${d.cola.length ? `<section class="grupo-ajustes ops-cola"><h2>Cola · ${d.cola.length}</h2>${d.cola.map((o) => fila(o, true)).join('')}</section>` : ''}
    ${grupos.map((g) => `<section class="grupo-ajustes"><h2>Lanzar · ${esc(g)}</h2>${d.catalogo.filter((c) => c.grupo === g).map((c) => `<button class="fila" data-lanzar="${c.tipo}"><span class="ico-fila">${I('crear')}</span><div class="txt"><b>${esc(c.nombre)}</b><br><small>${esc(c.desc)}</small></div><span class="flecha">${I('abajo')}</span></button>`).join('')}</section>`).join('')}
    ${d.historial.length ? `<section class="grupo-ajustes"><h2>Historial</h2>${d.historial.map((o) => fila(o, false)).join('')}</section>` : ''}`;
  const recargar = () => vistaOperaciones(main);
  L.querySelectorAll('[data-lanzar]').forEach((b) => { b.onclick = () => {
    const c = d.catalogo.find((x) => x.tipo === b.dataset.lanzar);
    const lanzar = async (params = {}) => { await api('/api/operaciones', { tipo: c.tipo, params }); aviso('En la cola: empieza en menos de 30 s si no hay otra delante'); recargar(); };
    if (!c.params.length) return hoja(c.nombre, [{ texto: 'Lanzar ahora', sub: c.desc, icono: 'enviar', accion: lanzar }, { texto: 'Cancelar', accion: () => {} }]);
    hojaCampos(c.nombre, c.params.map((p) => (p.tipo === 'date' ? { nombre: p.k, etiqueta: p.etiqueta, tipo: 'fecha', valor: p.defecto || '' } : { nombre: p.k, etiqueta: p.etiqueta, tipo: 'opcion', opciones: (p.opciones || []).length ? p.opciones : [['', 'No hay nada que elegir']], valor: p.defecto || '' })), lanzar, { boton: 'Lanzar', nota: c.desc });
  }; });
  L.querySelectorAll('.ops-cola [data-id] button').forEach((b) => { b.onclick = async () => {
    const id = Number(b.closest('[data-id]').dataset.id);
    try { if (b.dataset.mov) await api('/api/operaciones/mover', { id, dir: b.dataset.mov }); else await api('/api/operaciones/cancelar', { id }); recargar(); } catch (e) { errAviso(e); }
  }; });
  if (location.hash.startsWith('#/operaciones')) relojOps = setTimeout(() => { if (location.hash.startsWith('#/operaciones') && $('#capa').hidden) vistaOperaciones(main).catch(() => {}); }, 8000);
}

// ---------- editor de clips (portado del panel clásico, 22-nov-2026) ----------
// Editor de clips (#/editor/<vídeo>/<clip>): reencuadrar contenido y cámara, mover el inicio y el final, y cambiar o mover
// los textos. La vista previa se dibuja aquí (canvas, en el equipo de quien edita) con la misma receta que luego renderiza
// el servidor desde el vídeo original, en vertical y horizontal a la vez.
const LIENZOS = { v: { W: 1080, H: 1920 }, h: { W: 1920, H: 1080 } };
const COLORES_CAPA = { contenido: '#3ec7ff', camara: '#ffd23f' };

async function vistaEditor(main) {
  const $$ = (q, raiz = document) => [...raiz.querySelectorAll(q)];
  const toast = (m) => aviso(m);
  const preguntar = (titulo, texto, accion) => hoja(titulo, [{ texto, icono: 'reintentar', peligro: true, accion }, { texto: 'Cancelar', accion: () => {} }]);
  const [, id, n] = location.hash.match(/^#\/editor\/(\d+)\/(\d+)/) || [];
  if (!id) { main.innerHTML = '<div class="vacio"><p>Falta el clip.</p></div>'; return; }
  main.innerHTML = '<p class="cargando" style="padding:24px">Abriendo el clip (la primera vez se prepara una copia ligera del original; puede tardar un minuto)…</p>';
  const d = await api(`/api/editor?id=${id}&n=${n}`);
  const R = d.receta, V = d.ventana, F = d.fuente;
  R.v.imagenes ||= []; R.h.imagenes ||= [];
  const imgs = new Map(), imagen = (id) => { if (!imgs.has(id)) { const im = new Image(); im.src = `/api/editor/recurso/${id}`; imgs.set(id, im); } return imgs.get(id); };
  const logoImg = d.logo ? Object.assign(new Image(), { src: d.logo.url }) : null;
  if (!Array.isArray(R.audios)) R.audios = R.audio ? [{ ...R.audio, ini: 0, bucle: true, fade: 0 }] : [];
  if (R.voz == null) R.voz = R.audio?.voz ?? 1; delete R.audio; R.fundido ||= { entrada: 0, salida: 0 };
  const sonidos = new Map(), sonido = (id) => { if (!sonidos.has(id)) { const a = new Audio(`/api/editor/recurso/${id}`); a.preload = 'auto'; sonidos.set(id, a); } return sonidos.get(id); };
  const videos = new Map(), videoDe = (id) => { if (!videos.has(id)) { const v = document.createElement('video'); v.src = `/api/editor/recurso/${id}`; v.muted = true; v.playsInline = true; v.preload = 'auto'; videos.set(id, v); } return videos.get(id); };
  const durClip = () => R.fin - R.inicio;
  // Cuándo se ve un elemento (en segundos desde el inicio del clip): todo, los primeros/últimos N s o a medida (pistas).
  const ventanaEl = (el) => { const d0 = durClip(); if (el.cuando === 'rango' && el.fin > el.ini) return [el.ini, Math.min(d0, el.fin)]; return el.cuando === 'final' ? [Math.max(0, d0 - (el.seg || 3)), d0] : el.cuando === 'inicio' ? [0, Math.min(d0, el.seg || 3)] : [0, d0]; };
  const alfaEl = (el, rel) => { const [a, b] = ventanaEl(el); if (rel < a || rel > b) return 0; const fd = el.fade || 0; return fd > 0 ? Math.max(0.05, Math.min(1, (rel - a) / fd, (b - rel) / fd)) : 1; };
  const pararSonidos = () => { for (const a of sonidos.values()) a.pause(); for (const v of videos.values()) v.pause(); };
  let fmt = 'v', sel = null; // sel: { tipo: 'capa' | 'texto' | 'subs', i }
  const fuenteTxt = new FontFace('Montserrat ExtraBold', 'url(/api/editor/fuente.ttf)');
  fuenteTxt.load().then((f) => document.fonts.add(f)).catch(() => {});

  main.innerHTML = `<style>
    .ed { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.9fr); gap: 16px; align-items: start; }
    @media (max-width: 1000px) { .ed { grid-template-columns: 1fr; } }
    .ed-fuente { position: relative; background: #000; border-radius: 10px; overflow: hidden; touch-action: none; }
    .ed-fuente video { display: block; width: 100%; }
    .ed-rect { position: absolute; border: 2px solid; box-shadow: 0 0 0 9999px rgba(0,0,0,.0); cursor: move; }
    .ed-rect span { position: absolute; left: 0; top: -1px; font: 600 11px system-ui; padding: 1px 6px; color: #000; }
    .ed-rect i { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border-radius: 3px; cursor: nwse-resize; }
    .ed-lienzo { display: grid; place-items: center; background: #15171c; border-radius: 10px; padding: 10px; }
    .ed-lienzo canvas { max-width: 100%; max-height: 70vh; border-radius: 6px; touch-action: none; cursor: default; }
    .ed-tl { display: grid; gap: 8px; margin-top: 10px; }
    .ed-pal { max-height: 130px; overflow: auto; font-size: 13px; line-height: 1.9; padding: 6px 8px; border: 1px solid var(--line, #2a2e35); border-radius: 8px; }
    .ed-pal b { font-weight: 400; cursor: pointer; padding: 1px 2px; border-radius: 3px; }
    .ed-pal b.dentro { background: rgba(62,199,255,.18); } .ed-pal b.co { background: rgba(255,210,63,.35); } .ed-pal b:hover { outline: 1px solid #3ec7ff; }
    .ed-props { display: grid; gap: 8px; } .ed-props textarea { width: 100%; }
    .ed .seg { display: inline-flex; border: 1px solid var(--line, #2a2e35); border-radius: 8px; overflow: hidden; } .ed .seg button { border: 0; border-radius: 0; }
    .ed .seg button[aria-pressed="true"] { background: var(--accent, #2a78d6); color: #fff; }
    .ed-pasos { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; font-size: 13px; }
    .ed-pasos span { padding: 4px 10px; border-radius: 999px; background: var(--panel-2, #eceef1); }
    .ed-pasos b { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--text, #111); color: var(--panel, #fff); font-size: 11px; margin-right: 6px; }
    .ed-rect.inactiva { border-style: dashed; opacity: .55; pointer-events: none; }
    .ed-rect.activa { box-shadow: 0 0 0 9999px rgba(0,0,0,.35); }
    .ed-capas { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
    .ed-capas .btn[aria-pressed="true"] { outline: 2px solid currentColor; outline-offset: 1px; font-weight: 600; }
    .ed-linea { position: relative; height: 56px; border-radius: 8px; background: var(--panel-2, #eceef1); cursor: pointer; touch-action: none; user-select: none; }
    .ed-linea .sel { position: absolute; top: 14px; bottom: 14px; background: rgba(62,199,255,.35); border: 2px solid #3ec7ff; border-radius: 4px; cursor: grab; }
    .ed-linea .co { position: absolute; top: 4px; height: 8px; background: #ffd23f; border-radius: 3px; }
    .ed-linea .h { position: absolute; top: 6px; bottom: 6px; width: 14px; margin-left: -7px; background: #3ec7ff; border-radius: 4px; cursor: ew-resize; display: grid; place-items: center; color: #00111a; font: 700 10px system-ui; }
    .ed-linea .cab { position: absolute; top: 0; bottom: 0; width: 2px; background: #e5484d; pointer-events: none; }
    .ed-linea .marca { position: absolute; bottom: 0; font: 10px system-ui; color: var(--muted, #666); transform: translateX(-50%); pointer-events: none; }
    .ed-teclas { font-size: 12px; color: var(--muted, #666); } .ed-teclas kbd { border: 1px solid var(--line, #ccc); border-radius: 4px; padding: 0 4px; font: 11px ui-monospace, monospace; }
  </style>
  <div class="ed-vista"><div class="ed-cabecera"><div><h1>Editar clip</h1><p>${esc(d.clip.titulo)} · ${d.clip.puntos ?? '–'} pts${d.clip.editado ? ' · <span class="chip-estado cola">editado</span>' : ''}</p></div>
    <div class="row" style="gap:6px"><a class="boton" href="#/explorar">Volver</a>${d.clip.editado ? '<button class="boton" id="ed-deshacer" type="button">Volver al original</button>' : ''}<button class="boton primario" id="ed-guardar" type="button">Guardar y renderizar</button></div></div>
  <div class="ed-pasos"><span><b>1</b>Elige el diseño (a la derecha)</span><span><b>2</b>Marca en el original qué es el juego y qué es la cara</span><span><b>3</b>Ajusta dónde empieza y acaba</span><span><b>4</b>Guardar y renderizar</span></div>
  <div class="row" style="gap:8px;margin-bottom:10px"><span class="seg"><button class="boton" data-fmt="v" aria-pressed="true">Vertical 9:16</button><button class="boton" data-fmt="h" aria-pressed="false">Horizontal 16:9</button></span>
    <span id="ed-estado" class="muted"></span></div>
  <div class="ed">
    <section class="ed-panel">
      <div class="ed-cab"><h2>Original</h2><span class="muted">Elige qué recuadro ajustas; arrástralo, tira de su esquina, o dibuja uno nuevo arrastrando sobre la imagen.</span></div>
      <div class="ed-capas" id="ed-capas"></div>
      <div class="ed-fuente" id="ed-fuente"><video id="ed-video" src="/api/editor/proxy/${id}/${n}?desde=${V.desde}&hasta=${V.hasta}" preload="auto" playsinline></video></div>
      <div class="ed-tl">
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
          <button class="boton" id="ed-play" type="button">▶ Reproducir</button>
          <span class="tnum small" id="ed-t"></span>
          <button class="boton" data-marcar="inicio" type="button">⇤ Empieza aquí</button><button class="boton" data-marcar="fin" type="button">Acaba aquí ⇥</button>
          <button class="boton" data-original type="button">Duración original</button>
        </div>
        <div class="ed-linea" id="ed-tiempo" title="Arrastra los tiradores azules para cambiar dónde empieza y acaba; arrastra la franja para moverla entera; clic para ir a un momento."></div>
        <div class="small" id="ed-dur"></div>
        <div class="ed-teclas"><kbd>Espacio</kbd> reproducir · <kbd>I</kbd> empieza aquí · <kbd>O</kbd> acaba aquí · <kbd>←</kbd><kbd>→</kbd> ±0,5 s (con <kbd>Mayús</kbd> ±5 s)</div>
        <div class="ed-pal" id="ed-pal" title="Clic en una palabra: va a ese momento. Mayús+clic: el clip empieza ahí. Alt+clic: termina ahí."></div>
        <div class="row small" style="gap:8px;flex-wrap:wrap"><label><input type="checkbox" id="ed-co"> Cold open (frase repetida al principio)</label>
          <button class="boton" data-co="inicio" type="button">Empieza aquí</button><button class="boton" data-co="fin" type="button">Acaba aquí</button><span class="muted" id="ed-co-txt"></span></div>
      </div>
    </section>
    <section class="ed-panel">
      <div class="ed-cab"><h2>Resultado</h2><span class="muted">Arrastra textos, imágenes, subtítulos y bloques. El logo de la campaña es fijo.</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px" id="ed-plantillas"></div>
      <div class="ed-lienzo"><canvas id="ed-canvas"></canvas></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="boton" id="ed-mas-texto" type="button">+ Texto</button><button class="boton" id="ed-mas-imagen" type="button">+ Imagen</button><button class="boton" id="ed-mas-video" type="button">+ Vídeo</button><button class="boton" id="ed-mas-musica" type="button">+ Música</button><button class="boton" id="ed-biblio" type="button">Biblioteca</button><input type="file" id="ed-archivo" hidden>
        <label class="small"><input type="checkbox" id="ed-subs"> Subtítulos</label>
        <label class="small">Fondo <select id="ed-fondo"><option value="oscuro">Oscuro</option><option value="difuminado">Difuminado</option></select></label>
        <label class="small"><input type="checkbox" id="ed-linea"> Línea entre bloques</label>
      </div>
      <div id="ed-musica"></div><div class="ed-pistas" id="ed-pistas"></div><div class="ed-props" id="ed-props" style="margin-top:10px"></div>
    </section>
  </div></div>`;

  const video = $('#ed-video'), cv = $('#ed-canvas'), ctx = cv.getContext('2d'), caja = $('#ed-fuente');
  const f = () => R[fmt];
  const lienzo = () => LIENZOS[fmt];
  const fuenteT = () => V.desde + video.currentTime; // segundo de la fuente que se ve
  const irA = (t) => { video.currentTime = Math.max(0, Math.min(V.hasta - V.desde - 0.05, t - V.desde)); };
  const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  // ---------- proporción: el recorte del original siempre con la forma de su hueco ----------
  function ajustarRecorte(capa) {
    const asp = capa.dst.w / capa.dst.h, s = capa.src;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    let w = s.w * F.w, h = s.h * F.h;
    if (w / h > asp) w = h * asp; else h = w / asp;
    if (w > F.w) { w = F.w; h = w / asp; } if (h > F.h) { h = F.h; w = h * asp; }
    s.w = w / F.w; s.h = h / F.h;
    s.x = Math.min(1 - s.w, Math.max(0, cx - s.w / 2)); s.y = Math.min(1 - s.h, Math.max(0, cy - s.h / 2));
  }

  // ---------- plantillas ----------
  const camaraPorDefecto = () => (d.webcam?.cam ? { x: d.webcam.cam[0] / F.w, y: d.webcam.cam[1] / F.h, w: d.webcam.cam[2] / F.w, h: d.webcam.cam[3] / F.h } : { x: 0.02, y: 0.03, w: 0.25, h: 0.3 });
  const PLANTILLAS = {
    v: [
      ['Cara + logo + juego', () => { const jh = Math.round(1080 * F.h / F.w / 2) * 2, ch = Math.min(820, 1920 - jh - 300); return { fondo: 'oscuro', linea: false, subs: { ...R.v.subs, y: ch - 95 }, capas: [{ id: 'camara', src: camaraPorDefecto(), dst: { x: 0, y: 0, w: 1080, h: ch } }, { id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 1920 - jh, w: 1080, h: jh } }] }; }],
      ['Juego + cara', () => { const jh = Math.round(1080 * F.h / F.w / 2) * 2; return { fondo: 'oscuro', linea: true, capas: [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 280, w: 1080, h: jh } }, { id: 'camara', src: camaraPorDefecto(), dst: { x: 0, y: 280 + jh, w: 1080, h: 1920 - 280 - jh - 180 } }] }; }],
      ['Cara + juego', () => { const jh = Math.round(1080 * F.h / F.w / 2) * 2; return { fondo: 'oscuro', linea: true, capas: [{ id: 'camara', src: camaraPorDefecto(), dst: { x: 0, y: 280, w: 1080, h: 640 } }, { id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 920, w: 1080, h: jh } }] }; }],
      ['Solo 9:16', () => ({ fondo: 'oscuro', linea: false, capas: [{ id: 'contenido', src: { x: 0.34, y: 0, w: 0.32, h: 1 }, dst: { x: 0, y: 0, w: 1080, h: 1920 } }] })],
      ['Juego con fondo', () => { const jh = Math.round(1080 * F.h / F.w / 2) * 2; return { fondo: 'difuminado', linea: false, capas: [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 400, w: 1080, h: jh } }] }; }],
    ],
    h: [
      ['Pantalla completa', () => ({ fondo: 'oscuro', linea: false, capas: [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1920, h: 1080 } }] })],
      ['Con cámara en esquina', () => ({ fondo: 'oscuro', linea: false, capas: [{ id: 'contenido', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1920, h: 1080 } }, { id: 'camara', src: camaraPorDefecto(), dst: { x: 1380, y: 640, w: 500, h: 400 } }] })],
      ['Ampliar (zoom)', () => ({ fondo: 'oscuro', linea: false, capas: [{ id: 'contenido', src: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, dst: { x: 0, y: 0, w: 1920, h: 1080 } }] })],
    ],
  };
  function pintarPlantillas() {
    $('#ed-plantillas').innerHTML = PLANTILLAS[fmt].map(([t], i) => `<button class="boton" data-pl="${i}" type="button">${esc(t)}</button>`).join('')
      + (f().capas.some((k) => k.id === 'camara') ? '<button class="boton" data-quitarcam type="button">Quitar cámara</button>' : '');
  }
  $('#ed-plantillas').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pl) { const p = PLANTILLAS[fmt][Number(b.dataset.pl)][1](); Object.assign(f(), p); f().capas.forEach(ajustarRecorte); }
    if (b.hasAttribute('data-quitarcam')) f().capas = f().capas.filter((k) => k.id !== 'camara');
    activa = 0; sel = null; todo();
  };

  // ---------- recuadros sobre el original ----------
  // Recuadro activo: solo ese se mueve en el original (los demás se ven punteados). Se elige con los botones de arriba
  // o tocando su bloque en el resultado.
  let activa = 0;
  const nombreCapa = (k) => (k.id === 'camara' ? 'Cara / cámara' : 'Juego / contenido');
  function pintarCapas() {
    const capas = f().capas; if (activa >= capas.length) activa = 0;
    $('#ed-capas').innerHTML = `<span class="muted">Ajustando:</span>${capas.map((k, i) => `<button class="boton" data-capa="${i}" aria-pressed="${i === activa}" type="button" style="color:${COLORES_CAPA[k.id] === '#ffd23f' ? '#9a7400' : '#0b7fb3'}"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${COLORES_CAPA[k.id] || '#ff6b9a'};margin-right:6px"></span>${nombreCapa(k)}</button>`).join('')}`
      + (capas.some((k) => k.id === 'camara') ? '<button class="boton" data-detectar type="button" title="La IA busca la cámara del streamer y centra la cara">✨ Detectar cara</button>' : '<span class="muted">· Para añadir la cara, elige el diseño «Juego + cara» o «Cara + juego».</span>');
  }
  $('#ed-capas').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.capa) { activa = Number(b.dataset.capa); sel = { tipo: 'capa', i: activa }; pintarCapas(); pintarRecuadros(); pintarProps(); return; }
    if (b.hasAttribute('data-detectar')) {
      b.disabled = true; b.textContent = 'Buscando la cara…';
      try {
        const r = await api('/api/editor/detectar', { id: Number(id), n: Number(n), t: fuenteT() });
        const k = f().capas.find((x) => x.id === 'camara');
        if (!r?.cam || !k) throw new Error('No encuentro una cámara en este momento del vídeo: prueba en otro instante o márcala a mano.');
        const [bx, by, bw, bh] = r.cam, cara = r.cara;
        const cx = cara ? cara[0] + cara[2] / 2 : bx + bw / 2, cy = cara ? cara[1] + cara[3] / 2 : by + bh * 0.45;
        k.src = { x: bx / F.w, y: by / F.h, w: bw / F.w, h: bh / F.h };
        ajustarRecorte(k);
        // Centrado en la cara, sin salirse de la cámara.
        k.src.x = Math.min((bx + bw) / F.w - k.src.w, Math.max(bx / F.w, cx / F.w - k.src.w / 2));
        k.src.y = Math.min((by + bh) / F.h - k.src.h, Math.max(by / F.h, cy / F.h - k.src.h / 2));
        activa = f().capas.indexOf(k); pintarCapas(); pintarRecuadros(); toast('Cara encontrada y centrada');
      } catch (err) { toast(err.message, true); pintarCapas(); }
    }
  };
  function pintarRecuadros() {
    $$('.ed-rect', caja).forEach((x) => x.remove());
    f().capas.forEach((k, i) => {
      const col = COLORES_CAPA[k.id] || '#ff6b9a', el = document.createElement('div');
      el.className = `ed-rect ${i === activa ? 'activa' : 'inactiva'}`; el.dataset.i = i;
      el.style.cssText = `left:${k.src.x * 100}%;top:${k.src.y * 100}%;width:${k.src.w * 100}%;height:${k.src.h * 100}%;border-color:${col}`;
      el.innerHTML = `<span style="background:${col}">${nombreCapa(k)}</span>${i === activa ? `<i style="background:${col}"></i>` : ''}`;
      caja.appendChild(el);
    });
  }
  let arrastre = null;
  caja.addEventListener('pointerdown', (e) => {
    const k = f().capas[activa]; if (!k) return;
    e.preventDefault(); caja.setPointerCapture(e.pointerId);
    const r = caja.getBoundingClientRect(), el = e.target.closest('.ed-rect.activa');
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    // Dentro del recuadro activo: mover (o redimensionar por la esquina). Fuera: dibujar uno nuevo desde ese punto.
    arrastre = { k, x0: e.clientX, y0: e.clientY, px, py, s0: { ...k.src }, r, modo: !el ? 'dibujar' : e.target.tagName === 'I' ? 'redim' : 'mover' };
  });
  caja.addEventListener('pointermove', (e) => {
    if (!arrastre) return;
    const { k, s0, r } = arrastre, dx = (e.clientX - arrastre.x0) / r.width, dy = (e.clientY - arrastre.y0) / r.height;
    const asp = k.dst.w / k.dst.h; // forma del hueco de destino (en píxeles)
    if (arrastre.modo === 'mover') {
      k.src.x = Math.max(0, Math.min(1 - k.src.w, s0.x + dx)); k.src.y = Math.max(0, Math.min(1 - k.src.h, s0.y + dy));
    } else {
      // Redimensionar o dibujar: el ancho sigue al ratón y el alto sale de la forma del hueco (nunca se deforma).
      const x0 = arrastre.modo === 'redim' ? s0.x : Math.min(arrastre.px, arrastre.px + dx);
      const y0 = arrastre.modo === 'redim' ? s0.y : (dy < 0 ? arrastre.py + dy : arrastre.py);
      let w = Math.abs(arrastre.modo === 'redim' ? s0.w + dx : dx); w = Math.max(0.03, Math.min(1 - x0, w));
      let h = (w * F.w / asp) / F.h; if (y0 + h > 1) { h = 1 - y0; w = (h * F.h * asp) / F.w; }
      if (arrastre.modo === 'dibujar' && Math.abs(dx) < 0.01) return;
      k.src = { x: Math.max(0, x0), y: Math.max(0, y0), w, h };
    }
    pintarRecuadros();
  });
  const soltar = () => { arrastre = null; };
  caja.addEventListener('pointerup', soltar); caja.addEventListener('pointercancel', soltar);

  // ---------- lienzo del resultado ----------
  const escala = () => cv.width / lienzo().W;
  function medidas() { const { W, H } = lienzo(); cv.width = fmt === 'v' ? 405 : 720; cv.height = Math.round(cv.width * H / W); }
  function cajaTexto(t) {
    const lineas = String(t.texto || '').split('\n').filter((l) => l.trim());
    ctx.font = `${t.tam * escala()}px "Montserrat ExtraBold", system-ui`;
    const lh = t.tam * 1.2 * escala(), w = Math.max(20, ...lineas.map((l) => ctx.measureText(l).width));
    return { lineas, lh, x: t.x * escala() - w / 2, y: t.y * escala() - (lineas.length * lh) / 2, w, h: lineas.length * lh };
  }
  function grupoSubs(t) {
    const enClip = d.palabras.filter((p) => p.t >= R.inicio && p.f <= R.fin + 0.2);
    const i = enClip.findIndex((p, k) => p.t <= t && (enClip[k + 1]?.t ?? p.f + 0.6) > t);
    if (i < 0) return null;
    const g = Math.floor(i / 3) * 3; return { palabras: enClip.slice(g, g + 3), activa: i - g };
  }
  function dibujar() {
    const { W, H } = lienzo(), s = escala(), fm = f(), t = fuenteT();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    if (fm.fondo === 'difuminado' && video.readyState >= 2) {
      const k = Math.max(cv.width / vw, cv.height / vh);
      ctx.filter = 'blur(12px) brightness(0.85)'; ctx.drawImage(video, (cv.width - vw * k) / 2, (cv.height - vh * k) / 2, vw * k, vh * k); ctx.filter = 'none';
    } else { ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, cv.width, cv.height); }
    for (const k of fm.capas) {
      if (video.readyState >= 2) ctx.drawImage(video, k.src.x * vw, k.src.y * vh, k.src.w * vw, k.src.h * vh, k.dst.x * s, k.dst.y * s, k.dst.w * s, k.dst.h * s);
      const col = COLORES_CAPA[k.id] || '#fff', act = fm.capas.indexOf(k) === activa;
      ctx.strokeStyle = col; ctx.lineWidth = act ? 2.5 : 1; ctx.setLineDash(act ? [] : [4, 4]); ctx.strokeRect(k.dst.x * s + 1, k.dst.y * s + 1, k.dst.w * s - 2, k.dst.h * s - 2); ctx.setLineDash([]);
      if (fm.capas.length > 1) { ctx.font = '600 11px system-ui'; ctx.textBaseline = 'top'; const et = k.id === 'camara' ? 'CARA' : 'JUEGO', ew = ctx.measureText(et).width + 10; ctx.fillStyle = col; ctx.fillRect(k.dst.x * s + 4, k.dst.y * s + 4, ew, 16); ctx.fillStyle = '#000'; ctx.fillText(et, k.dst.x * s + 9, k.dst.y * s + 6); }
    }
    if (fm.linea && fm.capas.length > 1) { const cam = fm.capas.find((k) => k.id === 'camara') || fm.capas[1]; ctx.fillStyle = '#ffd23f'; ctx.fillRect(0, (cam.dst.y - 3) * s, cv.width, 6 * s); }
    const relI = t - R.inicio, durI = R.fin - R.inicio;
    (fm.imagenes || []).forEach((im, i) => {
      const al = alfaEl(im, relI), vis = al > 0, elegida = sel?.tipo === 'imagen' && sel.i === i;
      const el = im.tipo === 'video' ? videoDe(im.archivo) : imagen(im.archivo);
      if (im.tipo === 'video') { const obj = (im.desde || 0) + Math.max(0, relI - ventanaEl(im)[0]); if (Math.abs(el.currentTime - obj) > 0.3 && el.readyState >= 1) { try { el.currentTime = obj; } catch {} } if (vis && reproduciendo) { if (el.paused) el.play().catch(() => {}); } else if (!el.paused) el.pause(); }
      if (!vis && !elegida) return;
      ctx.globalAlpha = (vis ? al : 0.5) * (im.op ?? 1);
      if (im.tipo === 'video' ? el.readyState >= 2 : el.complete && el.naturalWidth) ctx.drawImage(el, im.x * s, im.y * s, im.w * s, im.h * s);
      ctx.globalAlpha = 1;
      if (elegida) { ctx.strokeStyle = '#3ec7ff'; ctx.setLineDash([4, 3]); ctx.strokeRect(im.x * s, im.y * s, im.w * s, im.h * s); ctx.setLineDash([]); ctx.fillStyle = '#3ec7ff'; ctx.fillRect((im.x + im.w) * s - 6, (im.y + im.h) * s - 6, 12, 12); }
    });
    // Textos (con su momento: «final» = los últimos N s del clip; «inicio» = los primeros N s)
    const rel = t - R.inicio, dur = R.fin - R.inicio;
    fm.textos.forEach((tx, i) => {
      const alT = alfaEl(tx, rel), visible = alT > 0;
      if (!visible && !(sel?.tipo === 'texto' && sel.i === i)) return; // los del final (cierre) solo se ven en su momento
      const b = cajaTexto(tx);
      ctx.globalAlpha = visible ? alT : 0.6;
      b.lineas.forEach((l, j) => {
        const lw = ctx.measureText(l).width, x = tx.x * s - lw / 2, y = b.y + j * b.lh;
        if (tx.caja) { const p = tx.tam * 0.3 * s; ctx.fillStyle = tx.caja; ctx.fillRect(x - p, y - p * 0.2, lw + 2 * p, b.lh * 0.95 + p * 0.4); }
        else { ctx.lineWidth = 3 * s * 2; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.textBaseline = 'top'; ctx.strokeText(l, x, y); }
        ctx.fillStyle = tx.color; ctx.textBaseline = 'top'; ctx.fillText(l, x, y);
      });
      ctx.globalAlpha = 1;
      if (sel?.tipo === 'texto' && sel.i === i) { ctx.strokeStyle = '#3ec7ff'; ctx.setLineDash([4, 3]); ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); ctx.setLineDash([]); }
    });
    if (fm.subs.activo) {
      const g = grupoSubs(t);
      ctx.font = `${fm.subs.tam * s}px "Montserrat ExtraBold", system-ui`; ctx.textBaseline = 'middle';
      const txt = g ? g.palabras.map((p) => p.w.toUpperCase()) : ['SUBTÍTULOS'];
      const total = ctx.measureText(txt.join(' ')).width; let x = W * s / 2 - total / 2;
      txt.forEach((w, j) => { ctx.lineWidth = 7 * s; ctx.strokeStyle = '#000'; ctx.strokeText(w, x, fm.subs.y * s); ctx.fillStyle = g && j === g.activa ? '#ffd23f' : '#fff'; ctx.fillText(w, x, fm.subs.y * s); x += ctx.measureText(w + ' ').width; });
      if (sel?.tipo === 'subs') { ctx.strokeStyle = '#3ec7ff'; ctx.setLineDash([4, 3]); ctx.strokeRect(10, fm.subs.y * s - fm.subs.tam * s * 0.7, cv.width - 20, fm.subs.tam * s * 1.4); ctx.setLineDash([]); }
    }
    if (fmt === 'v' && d.logo && logoImg?.complete && logoImg.naturalWidth) {
      const p0 = d.logo.pos, lh = p0.h || (p0.w * logoImg.naturalHeight) / logoImg.naturalWidth;
      // Igual que el render: si hay hueco entre dos bloques, el logo va centrado ahí (nunca sobre la cara).
      const bl = fm.capas.map((k) => k.dst).sort((a, b) => a.y - b.y); let p = p0;
      for (let i = 0; i + 1 < bl.length; i++) { const fin = bl[i].y + bl[i].h, sig = bl[i + 1].y; if (sig - fin >= lh + 28) { p = { ...p0, x: Math.round((1080 - p0.w) / 2), y: Math.round(fin + (sig - fin - lh) / 2) }; break; } }
      ctx.drawImage(logoImg, p.x * s, p.y * s, p.w * s, lh * s);
      const zonas = [...fm.textos.map((tx) => { const b = cajaTexto(tx); return { x: b.x / s, y: b.y / s, w: b.w / s, h: b.h / s }; }), ...(fm.imagenes || [])];
      const tapa = zonas.some((r) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + lh && r.y + r.h > p.y);
      ctx.strokeStyle = tapa ? '#e5484d' : 'rgba(255,255,255,.55)'; ctx.lineWidth = tapa ? 2.5 : 1; ctx.setLineDash([5, 4]); ctx.strokeRect(p.x * s, p.y * s, p.w * s, lh * s); ctx.setLineDash([]);
      ctx.font = '600 10px system-ui'; ctx.textBaseline = 'bottom'; ctx.fillStyle = tapa ? '#e5484d' : 'rgba(255,255,255,.85)';
      ctx.fillText(tapa ? 'LOGO TAPADO: mueve ese elemento' : `LOGO · ${d.logo.campana} (fijo)`, p.x * s + 4, p.y * s - 3);
    }
    { const fu = R.fundido || {}, d0 = durClip(), r0 = t - R.inicio; let k = 0;
      if (fu.entrada > 0 && r0 < fu.entrada) k = 1 - r0 / fu.entrada; if (fu.salida > 0 && r0 > d0 - fu.salida) k = Math.max(k, (r0 - (d0 - fu.salida)) / fu.salida);
      if (k > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, k).toFixed(2)})`; ctx.fillRect(0, 0, cv.width, cv.height); } }
    // Fuera del clip: velo y aviso
    if (t < R.inicio - 0.05 || t > R.fin + 0.05) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui'; ctx.textBaseline = 'top'; ctx.fillText('Fuera del clip', 10, 10); }
  }
  // Bucle de dibujo y de reproducción (al llegar al final vuelve al inicio, con el cold open delante si lo hay).
  let reproduciendo = false;
  (function bucle() {
    if (!cv.isConnected) { video.pause(); pararSonidos(); return; }
    if (reproduciendo && fuenteT() >= R.fin) irA(R.inicio);
    dibujar(); pintarTiempo(); sincronizar(); pintarCabezal();
    requestAnimationFrame(bucle);
  })();
  $('#ed-play').onclick = () => { reproduciendo = !reproduciendo; if (reproduciendo) { if (fuenteT() < R.inicio || fuenteT() >= R.fin) irA(R.inicio); video.play(); } else video.pause(); $('#ed-play').textContent = reproduciendo ? '❚❚ Pausa' : '▶ Reproducir'; };
  video.addEventListener('loadedmetadata', () => irA(R.inicio), { once: true });

  // Interacción en el lienzo: textos > subtítulos > bloques (el de arriba primero).
  let mov = null;
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * cv.width / r.width, py = (e.clientY - r.top) * cv.height / r.height, s = escala(), fm = f();
    const ti = fm.textos.map((t, i) => [i, cajaTexto(t)]).reverse().find(([, b]) => px >= b.x - 6 && px <= b.x + b.w + 6 && py >= b.y - 6 && py <= b.y + b.h + 6);
    const ii = (fm.imagenes || []).map((im, i) => [i, im]).reverse().find(([, im]) => px >= im.x * s - 6 && px <= (im.x + im.w) * s + 6 && py >= im.y * s - 6 && py <= (im.y + im.h) * s + 6);
    if (ti) sel = { tipo: 'texto', i: ti[0] };
    else if (ii) sel = { tipo: 'imagen', i: ii[0] };
    else if (fm.subs.activo && Math.abs(py - fm.subs.y * s) < fm.subs.tam * s * 0.8) sel = { tipo: 'subs' };
    else { const ci = fm.capas.map((k, i) => [i, k]).reverse().find(([, k]) => px >= k.dst.x * s && px <= (k.dst.x + k.dst.w) * s && py >= k.dst.y * s && py <= (k.dst.y + k.dst.h) * s); sel = ci ? { tipo: 'capa', i: ci[0] } : null; if (ci) { activa = ci[0]; pintarCapas(); pintarRecuadros(); } }
    if (sel) {
      cv.setPointerCapture(e.pointerId);
      const o = sel.tipo === 'texto' ? fm.textos[sel.i] : sel.tipo === 'imagen' ? fm.imagenes[sel.i] : sel.tipo === 'subs' ? fm.subs : fm.capas[sel.i].dst;
      // En un bloque, cerca del borde de abajo = cambiar su alto; si no, moverlo.
      const borde = sel.tipo === 'capa' && Math.abs(py - (o.y + o.h) * s) < 10;
      const esquina = sel.tipo === 'imagen' && Math.abs(px - (o.x + o.w) * s) < 14 && Math.abs(py - (o.y + o.h) * s) < 14;
      mov = { px, py, x0: o.x, y0: o.y, h0: o.h, w0: o.w, o, borde, esquina };
    }
    pintarProps();
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * cv.width / r.width, py = (e.clientY - r.top) * cv.height / r.height;
    if (!mov) { const fm = f(), s = escala(); cv.style.cursor = fm.capas.some((k) => Math.abs(py - (k.dst.y + k.dst.h) * s) < 10 && px >= k.dst.x * s && px <= (k.dst.x + k.dst.w) * s) ? 'ns-resize' : 'default'; return; }
    const s = escala(), dx = (px - mov.px) / s, dy = (py - mov.py) / s, { W, H } = lienzo();
    if (mov.esquina) { const nw = Math.max(20, Math.round(mov.w0 + dx)); mov.o.h = Math.round((mov.h0 * nw) / mov.w0); mov.o.w = nw; return; }
    if (mov.borde) { mov.o.h = Math.max(80, Math.round(mov.h0 + dy)); ajustarRecorte(f().capas[sel.i]); pintarRecuadros(); }
    else if (sel.tipo === 'subs') mov.o.y = Math.max(40, Math.min(H - 40, Math.round(mov.y0 + dy)));
    else { mov.o.x = Math.round(Math.max(sel.tipo === 'texto' ? 0 : -W, Math.min(W, mov.x0 + dx))); mov.o.y = Math.round(Math.max(sel.tipo === 'texto' ? 0 : -H, Math.min(H, mov.y0 + dy))); }
  });
  const fin = () => { if (mov) { mov = null; pintarProps(); } };
  cv.addEventListener('pointerup', fin); cv.addEventListener('pointercancel', fin);

  // ---------- propiedades de lo seleccionado ----------
  function pintarProps() {
    const p = $('#ed-props'), fm = f();
    if (sel?.tipo === 'texto') {
      const t = fm.textos[sel.i];
      p.innerHTML = `<label class="f">Texto <span class="muted">(Intro = otra línea)</span><textarea rows="3" data-p="texto">${esc(t.texto)}</textarea></label>
        <div class="row" style="gap:8px;flex-wrap:wrap"><label class="f">Tamaño <input type="number" min="16" max="220" data-p="tam" value="${Math.round(t.tam)}" style="width:80px"></label>
        <label class="f">Color <input type="color" data-p="color" value="${t.color}"></label>
        <label class="f">Fondo <select data-p="cajaSi"><option value="">Sin fondo (borde)</option><option value="1" ${t.caja ? 'selected' : ''}>Con fondo</option></select></label>
        ${t.caja ? `<label class="f">Color del fondo <input type="color" data-p="caja" value="${t.caja}"></label>` : ''}
        <label class="f">Cuándo <select data-p="cuando"><option value="siempre">Todo el clip</option><option value="inicio" ${t.cuando === 'inicio' ? 'selected' : ''}>Primeros segundos</option><option value="final" ${t.cuando === 'final' ? 'selected' : ''}>Últimos segundos</option><option value="rango" ${t.cuando === 'rango' ? 'selected' : ''}>A medida (en las pistas)</option></select></label><label class="f">Fundido (s) <input type="number" min="0" max="2" step="0.1" data-p="fade" value="${t.fade || 0}" style="width:70px"></label>
        ${['inicio', 'final'].includes(t.cuando) ? `<label class="f">Segundos <input type="number" min="1" max="30" data-p="seg" value="${t.seg}" style="width:70px"></label>` : ''}</div>
        <div class="row" style="gap:6px"><button class="boton" data-centrar type="button">Centrar</button><button class="boton" data-borrar type="button">Quitar texto</button></div>`;
    } else if (sel?.tipo === 'imagen') {
      const im = fm.imagenes[sel.i];
      p.innerHTML = `<p class="muted" style="margin:0">${im.tipo === 'video' ? 'Vídeo' : 'Imagen'}: arrástralo; tira de la esquina azul para cambiar el tamaño. Cuándo sale, en las pistas de abajo.</p>
        <label class="f">Ancho <input type="range" min="40" max="${lienzo().W}" step="10" data-im="w" value="${Math.round(im.w)}"></label>
        <label class="f">Opacidad <input type="range" min="0.1" max="1" step="0.05" data-im="op" value="${im.op ?? 1}"></label>
        <div class="row" style="gap:8px;flex-wrap:wrap"><label class="f">Cuándo <select data-im="cuando"><option value="siempre">Todo el clip</option><option value="inicio" ${im.cuando === 'inicio' ? 'selected' : ''}>Primeros segundos</option><option value="final" ${im.cuando === 'final' ? 'selected' : ''}>Últimos segundos</option><option value="rango" ${im.cuando === 'rango' ? 'selected' : ''}>A medida (en las pistas)</option></select></label><label class="f">Fundido (s) <input type="number" min="0" max="2" step="0.1" data-im="fade" value="${im.fade || 0}" style="width:70px"></label>${im.tipo === 'video' ? `<label class="f">Empieza en su segundo <input type="number" min="0" step="0.1" data-im="desde" value="${im.desde || 0}" style="width:80px"></label>` : ''}
        ${['inicio', 'final'].includes(im.cuando) ? `<label class="f">Segundos <input type="number" min="1" max="30" data-im="seg" value="${im.seg}" style="width:70px"></label>` : ''}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="boton" data-im-centrar type="button">Centrar</button><button class="boton" data-im-frente type="button">Al frente</button><button class="boton" data-im-quitar type="button">Quitar imagen</button></div>`;
    } else if (sel?.tipo === 'subs') {
      p.innerHTML = `<label class="f">Tamaño de los subtítulos <input type="number" min="30" max="140" data-s="tam" value="${Math.round(fm.subs.tam)}" style="width:80px"></label>`;
    } else if (sel?.tipo === 'capa') {
      const k = fm.capas[sel.i];
      p.innerHTML = `<p class="muted" style="margin:0">Bloque «${k.id === 'camara' ? 'cámara' : 'contenido'}»: arrástralo para moverlo; tira de su borde de abajo para cambiar el alto. Lo que se ve dentro se elige en el original (recuadro ${k.id === 'camara' ? 'amarillo' : 'azul'}).</p>
        <label class="f">Alto del bloque <input type="range" min="160" max="${lienzo().H}" step="10" data-alto value="${Math.round(k.dst.h)}"></label>
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="boton" data-ancho type="button">Ancho completo</button>${fm.capas.length > 1 ? '<button class="boton" data-intercambiar type="button">⇅ Intercambiar arriba / abajo</button><button class="boton" data-arriba type="button">Traer al frente</button>' : ''}</div>`;
    } else p.innerHTML = '<p class="muted" style="margin:0">Toca un texto, los subtítulos o un bloque para cambiarlo.</p>';
  }
  $('#ed-props').addEventListener('input', (e) => {
    const fm = f(), el = e.target;
    if (el.dataset.im && sel?.tipo === 'imagen') { const im = fm.imagenes[sel.i], k = el.dataset.im; if (k === 'w') { const r = im.h / im.w; im.w = Number(el.value); im.h = Math.round(im.w * r); } else im[k] = k === 'cuando' ? el.value : Number(el.value); if (k === 'cuando') { if (im.cuando === 'rango' && !(im.fin > im.ini)) [im.ini, im.fin] = [0, +durClip().toFixed(2)]; pintarProps(); pintarPistas(); } return; }
    if (el.dataset.s) { fm.subs[el.dataset.s] = Number(el.value); return; }
    if (el.hasAttribute('data-alto') && sel?.tipo === 'capa') {
      // Cambia el alto del bloque y desplaza el de debajo para que sigan pegados.
      const k = fm.capas[sel.i], antes = k.dst.h; k.dst.h = Number(el.value); ajustarRecorte(k);
      for (const o of fm.capas) if (o !== k && Math.abs(o.dst.y - (k.dst.y + antes)) < 4) o.dst.y = k.dst.y + k.dst.h;
      pintarRecuadros(); return;
    }
    if (!el.dataset.p || sel?.tipo !== 'texto') return;
    const t = fm.textos[sel.i];
    if (el.dataset.p === 'cajaSi') { t.caja = el.value ? (t.caja || '#ffffff') : null; pintarProps(); return; }
    t[el.dataset.p] = ['tam', 'seg', 'fade'].includes(el.dataset.p) ? Number(el.value) : el.value;
    if (el.dataset.p === 'cuando') { if (t.cuando === 'rango' && !(t.fin > t.ini)) [t.ini, t.fin] = [0, +durClip().toFixed(2)]; pintarProps(); pintarPistas(); }
  });
  $('#ed-props').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const fm = f();
    if (b.hasAttribute('data-borrar')) { fm.textos.splice(sel.i, 1); sel = null; }
    if (b.hasAttribute('data-im-quitar')) { const [q] = fm.imagenes.splice(sel.i, 1); if (q?.tipo === 'video') videoDe(q.archivo).pause(); sel = null; }
    if (b.hasAttribute('data-im-centrar')) { const im = fm.imagenes[sel.i]; im.x = Math.round((lienzo().W - im.w) / 2); }
    if (b.hasAttribute('data-im-frente')) { const [im] = fm.imagenes.splice(sel.i, 1); fm.imagenes.push(im); sel.i = fm.imagenes.length - 1; }
    if (b.hasAttribute('data-centrar')) fm.textos[sel.i].x = lienzo().W / 2;
    if (b.hasAttribute('data-ancho')) { const k = fm.capas[sel.i]; k.dst.x = 0; k.dst.w = lienzo().W; ajustarRecorte(k); pintarRecuadros(); }
    if (b.hasAttribute('data-intercambiar') && fm.capas.length > 1) {
      // Dos bloques apilados: el de abajo pasa arriba (cada uno conserva su alto).
      const [a, c] = [...fm.capas].sort((x, y) => x.dst.y - y.dst.y), top = a.dst.y;
      c.dst.y = top; a.dst.y = top + c.dst.h; pintarRecuadros();
    }
    if (b.hasAttribute('data-arriba')) { const [k] = fm.capas.splice(sel.i, 1); fm.capas.push(k); sel.i = fm.capas.length - 1; pintarRecuadros(); }
    pintarProps(); pintarPistas();
  });
  $('#ed-mas-texto').onclick = () => { const { W, H } = lienzo(); f().textos.push({ id: `texto${Date.now() % 1e5}`, texto: 'TEXTO', x: W / 2, y: H / 2, tam: fmt === 'v' ? 70 : 64, color: '#ffffff', caja: null, cuando: 'siempre', seg: 3 }); sel = { tipo: 'texto', i: f().textos.length - 1 }; pintarProps(); pintarPistas(); };
  const anadirImagen = (r) => {
    const esVideo = r.tipo === 'video', el = esVideo ? videoDe(r.id) : imagen(r.id);
    const poner = () => { const { W, H } = lienzo(), nw = esVideo ? el.videoWidth : el.naturalWidth, nh = esVideo ? el.videoHeight : el.naturalHeight, w = Math.round(W * (esVideo ? 0.5 : 0.35)), h = Math.round((w * (nh || 9)) / (nw || 16));
      const rel = Math.max(0, fuenteT() - R.inicio), d0 = durClip(), largo = esVideo ? Math.min(d0 - rel, el.duration || 5) : 0;
      f().imagenes.push({ id: `img${Date.now() % 1e5}`, archivo: r.id, tipo: esVideo ? 'video' : 'imagen', x: Math.round((W - w) / 2), y: Math.round(H * 0.12), w, h, op: 1, fade: 0, desde: 0,
        ...(esVideo && largo > 0.3 ? { cuando: 'rango', ini: +rel.toFixed(2), fin: +(rel + largo).toFixed(2) } : { cuando: 'siempre', seg: 3 }) });
      sel = { tipo: 'imagen', i: f().imagenes.length - 1 }; pintarProps(); pintarPistas(); };
    if (esVideo ? el.readyState >= 1 : el.complete && el.naturalWidth) poner(); else el.addEventListener(esVideo ? 'loadedmetadata' : 'load', poner, { once: true });
  };
  const volumenes = () => { video.volume = Math.min(1, R.voz ?? 1); };
  function pintarMusica() {
    const el = $('#ed-musica'); if (!el) return;
    el.innerHTML = `<div class="ed-musica-caja"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:end"><label class="f">Voz original <input type="range" min="0" max="1.5" step="0.05" data-voz value="${R.voz ?? 1}"></label><label class="f">Fundido de entrada (s) <input type="number" min="0" max="3" step="0.1" data-fu="entrada" value="${R.fundido.entrada || 0}" style="width:70px"></label><label class="f">Fundido de salida (s) <input type="number" min="0" max="3" step="0.1" data-fu="salida" value="${R.fundido.salida || 0}" style="width:70px"></label></div>
      ${R.audios.map((a, i) => `<div class="ed-audio" data-a="${i}"><b>♪ ${esc(a.nombre || 'Audio')}</b><label class="f">Volumen <input type="range" min="0" max="1.5" step="0.05" data-au="volumen" value="${a.volumen}"></label><label class="f">Entra en el segundo <input type="number" min="0" step="0.1" data-au="ini" value="${a.ini || 0}" style="width:80px"></label><label class="f">Fundido (s) <input type="number" min="0" max="3" step="0.1" data-au="fade" value="${a.fade || 0}" style="width:70px"></label><label class="small"><input type="checkbox" data-au="bucle" ${a.bucle !== false ? 'checked' : ''}> Repetir</label><button class="boton" data-au-quitar type="button">Quitar</button></div>`).join('')}</div>`;
    el.querySelector('[data-voz]').oninput = (e) => { R.voz = Number(e.target.value); volumenes(); };
    el.querySelectorAll('[data-fu]').forEach((i) => { i.oninput = () => { R.fundido[i.dataset.fu] = Number(i.value) || 0; }; });
    el.querySelectorAll('.ed-audio').forEach((box) => {
      const a = R.audios[Number(box.dataset.a)];
      box.querySelectorAll('[data-au]').forEach((i) => { i.oninput = i.onchange = () => { a[i.dataset.au] = i.type === 'checkbox' ? i.checked : Number(i.value) || 0; pintarPistas(); }; });
      box.querySelector('[data-au-quitar]').onclick = () => { sonido(a.archivo).pause(); R.audios.splice(R.audios.indexOf(a), 1); pintarMusica(); pintarPistas(); };
    });
  }
  const ponerMusica = (r) => {
    if (R.audios.length >= 4) { toast('Como mucho 4 audios por clip'); return; }
    const rel = Math.max(0, fuenteT() - R.inicio), primero = !R.audios.length;
    R.audios.push({ archivo: r.id, nombre: r.nombre, volumen: primero ? 0.35 : 0.9, ini: primero ? 0 : +rel.toFixed(2), desde: 0, fade: 0, bucle: primero });
    pintarMusica(); pintarPistas(); toast(primero ? 'Música puesta: suena con el clip al reproducir' : 'Sonido añadido donde está el cabezal');
  };
  // Audios de la vista previa, al ritmo del clip (cada uno entra en su segundo).
  function sincronizar() {
    const rel = fuenteT() - R.inicio;
    for (const a of R.audios) {
      const el = sonido(a.archivo), d = el.duration || 1e9, pos = rel - (a.ini || 0) + (a.desde || 0), bucle = a.bucle !== false, dentro = rel >= (a.ini || 0) && (bucle || pos < d);
      el.volume = Math.min(1, a.volumen ?? 1); el.loop = bucle;
      if (reproduciendo && dentro) { const obj = bucle ? pos % d : pos; if (el.paused) { try { el.currentTime = obj; } catch {} el.play().catch(() => {}); } else if (Math.abs(el.currentTime - obj) > 0.35) { try { el.currentTime = obj; } catch {} } }
      else if (!el.paused) el.pause();
    }
  }
  // Pistas: una barra por texto, imagen, vídeo y audio sobre la duración del clip; se arrastran para elegir cuándo salen.
  function pintarPistas() {
    const el = $('#ed-pistas'); if (!el) return; const d0 = durClip(), fm = f();
    const filas = [...fm.textos.map((o, i) => ({ tipo: 'texto', i, nombre: `Texto · ${String(o.texto || '').split('\n')[0].slice(0, 16)}`, o })),
      ...(fm.imagenes || []).map((o, i) => ({ tipo: 'imagen', i, nombre: `${o.tipo === 'video' ? 'Vídeo' : 'Imagen'} ${i + 1}`, o })),
      ...R.audios.map((o, i) => ({ tipo: 'audio', i, nombre: `♪ ${String(o.nombre || 'Audio').slice(0, 16)}`, o }))];
    const pct = (x) => `${Math.max(0, Math.min(100, (x / d0) * 100)).toFixed(2)}%`;
    el.innerHTML = filas.length ? `<div class="ed-pistas-cab"><b>Pistas</b><span class="muted">Arrastra una barra para moverla y sus bordes para alargarla o acortarla.</span></div>` + filas.map((r, k) => {
      const [a, b] = r.tipo === 'audio' ? [r.o.ini || 0, d0] : ventanaEl(r.o), act = sel?.tipo === r.tipo && sel.i === r.i;
      return `<div class="ed-pista"><span class="ed-pista-n" title="${esc(r.nombre)}">${esc(r.nombre)}</span><div class="ed-pista-l" data-k="${k}"><div class="ed-barra ${r.tipo} ${r.o.tipo === 'video' ? 'video' : ''} ${act ? 'activa' : ''}" data-arr="mover" style="left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})">${r.tipo === 'audio' ? '' : '<i data-arr="ini"></i><i data-arr="fin" class="d"></i>'}</div><div class="ed-cabezal"></div></div></div>`;
    }).join('') : '';
    el.querySelectorAll('.ed-pista-l').forEach((l) => {
      const r = filas[Number(l.dataset.k)];
      l.onpointerdown = (e) => {
        if (r.tipo !== 'audio') { sel = { tipo: r.tipo, i: r.i }; pintarProps(); }
        const modo = e.target.dataset.arr, rc = l.getBoundingClientRect();
        if (!modo) { irA(R.inicio + ((e.clientX - rc.left) / rc.width) * d0); return; }
        e.preventDefault(); l.setPointerCapture(e.pointerId);
        const t0 = ((e.clientX - rc.left) / rc.width) * d0, [a0, b0] = r.tipo === 'audio' ? [r.o.ini || 0, d0] : ventanaEl(r.o);
        if (r.tipo !== 'audio') { r.o.cuando = 'rango'; r.o.ini = +a0.toFixed(2); r.o.fin = +b0.toFixed(2); }
        l.onpointermove = (ev) => {
          const dt = ((ev.clientX - rc.left) / rc.width) * d0 - t0;
          if (r.tipo === 'audio') r.o.ini = +Math.max(0, Math.min(d0 - 0.5, a0 + dt)).toFixed(2);
          else if (modo === 'mover') { const w = b0 - a0; r.o.ini = +Math.max(0, Math.min(d0 - w, a0 + dt)).toFixed(2); r.o.fin = +(r.o.ini + w).toFixed(2); }
          else if (modo === 'ini') r.o.ini = +Math.max(0, Math.min(b0 - 0.3, a0 + dt)).toFixed(2);
          else r.o.fin = +Math.min(d0, Math.max(a0 + 0.3, b0 + dt)).toFixed(2);
          const bar = l.querySelector('.ed-barra'), na = r.o.ini || 0, nb = r.tipo === 'audio' ? d0 : r.o.fin;
          bar.style.left = pct(na); bar.style.width = `calc(${pct(nb)} - ${pct(na)})`; irA(R.inicio + (modo === 'fin' ? nb : na));
        };
        l.onpointerup = () => { l.onpointermove = null; pintarPistas(); pintarProps(); pintarMusica(); };
      };
    });
  }
  function pintarCabezal() { const p = Math.max(0, Math.min(100, ((fuenteT() - R.inicio) / durClip()) * 100)); for (const c of document.querySelectorAll('#ed-pistas .ed-cabezal')) c.style.left = `${p}%`; }
  const subir = (acepta, alSubir) => { const inp = $('#ed-archivo'); inp.accept = acepta; inp.value = ''; inp.onchange = () => { const file = inp.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = async () => { try { toast('Subiendo…'); alSubir(await api('/api/editor/recurso', { nombre: file.name, datos: rd.result })); } catch (err) { toast(err.message); } }; rd.readAsDataURL(file); }; inp.click(); };
  $('#ed-mas-imagen').onclick = () => subir('image/png,image/jpeg,image/webp', anadirImagen);
  $('#ed-mas-video').onclick = () => subir('video/mp4,video/webm,video/quicktime', anadirImagen);
  $('#ed-mas-musica').onclick = () => subir('audio/*', ponerMusica);
  $('#ed-biblio').onclick = async () => { const l = await api('/api/editor/recursos').catch(() => []); if (!l.length) { toast('La biblioteca está vacía: sube una imagen, un vídeo o una música'); return; } hoja('Biblioteca', l.slice(0, 40).map((r) => ({ texto: r.nombre, sub: { audio: 'Música o sonido', video: 'Vídeo', imagen: 'Imagen' }[r.tipo] || r.tipo, icono: r.tipo === 'audio' ? 'sonidoSi' : r.tipo === 'video' ? 'reels' : 'rejilla', accion: () => (r.tipo === 'audio' ? ponerMusica(r) : anadirImagen(r)) }))); };
  pintarMusica(); volumenes();
  $('#ed-subs').onchange = (e) => { f().subs.activo = e.target.checked; };
  $('#ed-fondo').onchange = (e) => { f().fondo = e.target.value; };
  $('#ed-linea').onchange = (e) => { f().linea = e.target.checked; };

  // ---------- tiempo: inicio, final, palabras y cold open ----------
  // Línea de tiempo: toda la ventana del original; la franja azul es el clip (tiradores = inicio y final), la amarilla
  // el cold open y la raya roja el momento que se ve.
  const linea = $('#ed-tiempo');
  const pctDe = (t) => ((t - V.desde) / (V.hasta - V.desde)) * 100;
  const tDe = (clientX) => { const r = linea.getBoundingClientRect(); return V.desde + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (V.hasta - V.desde); };
  function pintarLinea() {
    const total = V.hasta - V.desde, paso = total > 150 ? 30 : total > 60 ? 10 : 5;
    let marcas = '';
    for (let t = Math.ceil(V.desde / paso) * paso; t <= V.hasta; t += paso) marcas += `<span class="marca" style="left:${pctDe(t)}%">${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</span>`;
    linea.innerHTML = `${marcas}${R.coldOpen ? `<div class="co" style="left:${pctDe(R.coldOpen.inicio)}%;width:${pctDe(R.coldOpen.fin) - pctDe(R.coldOpen.inicio)}%" title="Cold open"></div>` : ''}`
      + `<div class="sel" data-arr="mover" style="left:${pctDe(R.inicio)}%;width:${pctDe(R.fin) - pctDe(R.inicio)}%"></div>`
      + `<div class="h" data-arr="inicio" style="left:${pctDe(R.inicio)}%" title="Inicio: arrastra">⇤</div><div class="h" data-arr="fin" style="left:${pctDe(R.fin)}%" title="Final: arrastra">⇥</div><div class="cab" id="ed-cab"></div>`;
  }
  let arrT = null;
  linea.addEventListener('pointerdown', (e) => {
    e.preventDefault(); linea.setPointerCapture(e.pointerId);
    const modo = e.target.dataset.arr || 'buscar';
    arrT = { modo, t0: tDe(e.clientX), i0: R.inicio, f0: R.fin };
    if (modo === 'buscar') irA(arrT.t0);
  });
  linea.addEventListener('pointermove', (e) => {
    if (!arrT) return;
    const t = tDe(e.clientX);
    if (arrT.modo === 'inicio') { R.inicio = +Math.min(t, R.fin - 3).toFixed(2); irA(R.inicio); }
    else if (arrT.modo === 'fin') { R.fin = +Math.max(t, R.inicio + 3).toFixed(2); irA(R.fin); }
    else if (arrT.modo === 'mover') { const d0 = t - arrT.t0, dur = arrT.f0 - arrT.i0; R.inicio = +Math.max(V.desde, Math.min(V.hasta - dur, arrT.i0 + d0)).toFixed(2); R.fin = +(R.inicio + dur).toFixed(2); }
    else irA(t);
    if (arrT.modo !== 'buscar') pintarDuracion();
  });
  const sueltaT = () => { arrT = null; };
  linea.addEventListener('pointerup', sueltaT); linea.addEventListener('pointercancel', sueltaT);
  // Teclado (si no se está escribiendo): espacio, I, O y flechas.
  const teclas = (e) => {
    if (!linea.isConnected) { removeEventListener('keydown', teclas); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === ' ') { e.preventDefault(); $('#ed-play').click(); }
    else if (e.key === 'i' || e.key === 'I') { R.inicio = +Math.min(fuenteT(), R.fin - 3).toFixed(2); pintarDuracion(); }
    else if (e.key === 'o' || e.key === 'O') { R.fin = +Math.max(fuenteT(), R.inicio + 3).toFixed(2); pintarDuracion(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); irA(fuenteT() + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 0.5)); }
  };
  addEventListener('keydown', teclas);
  function pintarTiempo() {
    $('#ed-t').textContent = `${mmss(fuenteT())}`;
    const cab = $('#ed-cab'); if (cab) cab.style.left = `${pctDe(fuenteT())}%`;
  }
  function pintarDuracion() {
    const o = d.clip.original;
    pintarLinea();
    $('#ed-dur').innerHTML = `Clip: ${mmss(R.inicio)} → ${mmss(R.fin)} · <b>${(R.fin - R.inicio).toFixed(1)} s</b>`
      + `${Math.abs(R.inicio - o.inicio) > 0.05 || Math.abs(R.fin - o.fin) > 0.05 ? ` <span class="muted">(antes ${(o.fin - o.inicio).toFixed(1)} s: ${R.inicio < o.inicio ? `empieza ${(o.inicio - R.inicio).toFixed(1)} s antes` : R.inicio > o.inicio ? `empieza ${(R.inicio - o.inicio).toFixed(1)} s después` : 'mismo inicio'}, ${R.fin > o.fin ? `acaba ${(R.fin - o.fin).toFixed(1)} s después` : R.fin < o.fin ? `acaba ${(o.fin - R.fin).toFixed(1)} s antes` : 'mismo final'})</span>` : ''}`;
    $('#ed-pal').innerHTML = d.palabras.map((p, i) => `<b data-w="${i}" class="${p.t >= R.inicio && p.f <= R.fin + 0.2 ? 'dentro' : ''}${R.coldOpen && p.t >= R.coldOpen.inicio - 0.05 && p.f <= R.coldOpen.fin + 0.1 ? ' co' : ''}">${esc(p.w)}</b>`).join(' ') || '<span class="muted">Sin transcripción para este tramo.</span>';
    $('#ed-co').checked = !!R.coldOpen;
    $('#ed-co-txt').textContent = R.coldOpen ? `${mmss(R.coldOpen.inicio)}–${mmss(R.coldOpen.fin)} (${(R.coldOpen.fin - R.coldOpen.inicio).toFixed(1)} s)` : '';
  }
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-marcar],[data-co],[data-original]'); if (!b) return;
    if (b.hasAttribute('data-original')) { R.inicio = d.clip.original.inicio; R.fin = d.clip.original.fin; irA(R.inicio); }
    if (b.dataset.marcar) R[b.dataset.marcar] = +fuenteT().toFixed(2);
    if (b.dataset.co) { R.coldOpen ||= { inicio: fuenteT(), fin: fuenteT() + 2.5 }; R.coldOpen[b.dataset.co] = +fuenteT().toFixed(2); }
    R.inicio = Math.max(V.desde, Math.min(R.inicio, R.fin - 3)); R.fin = Math.min(V.hasta, Math.max(R.fin, R.inicio + 3));
    pintarDuracion();
  });
  $('#ed-pal').onclick = (e) => {
    const w = e.target.closest('[data-w]'); if (!w) return;
    const p = d.palabras[Number(w.dataset.w)];
    if (e.shiftKey) R.inicio = +(p.t - 0.1).toFixed(2); else if (e.altKey) R.fin = +(p.f + 0.25).toFixed(2); else irA(p.t);
    pintarDuracion();
  };
  $('#ed-co').onchange = (e) => { R.coldOpen = e.target.checked ? { inicio: +fuenteT().toFixed(2), fin: +(fuenteT() + 2.5).toFixed(2) } : null; pintarDuracion(); };

  // ---------- formato, guardar, deshacer ----------
  function todo() {
    medidas(); pintarPlantillas(); pintarCapas(); pintarRecuadros(); pintarProps(); pintarDuracion(); pintarPistas();
    $('#ed-subs').checked = !!f().subs.activo; $('#ed-fondo').value = f().fondo; $('#ed-linea').checked = !!f().linea;
    $$('[data-fmt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt)));
  }
  $$('[data-fmt]').forEach((b) => { b.onclick = () => { fmt = b.dataset.fmt; sel = null; todo(); }; });
  async function estado() {
    const e = await api(`/api/editor/estado?id=${id}&n=${n}`).catch(() => null);
    const el = $('#ed-estado'); if (!el) return;
    el.innerHTML = !e ? '' : e.estado === 'listo' ? `<span class="chip-estado listo">Renderizado</span> <a href="/api/clips/video/${id}/${n}" target="_blank" rel="noopener">ver vertical</a> · <a href="/api/clips/horizontal/${id}/${n}" target="_blank" rel="noopener">ver horizontal</a>`
      : e.estado === 'error' ? `<span class="chip-estado error">Error: ${esc(e.error || '')}</span>` : `<span class="chip-estado cola">${e.estado === 'en cola' ? 'En cola para renderizar…' : 'Renderizando vertical y horizontal…'}</span>`;
    if (e && ['en cola', 'renderizando'].includes(e.estado)) setTimeout(estado, 4000);
  }
  $('#ed-guardar').onclick = async () => {
    const b = $('#ed-guardar'); b.disabled = true;
    try { await api('/api/editor/render', { id: Number(id), n: Number(n), receta: R }); toast('Guardado: se renderiza en vertical y horizontal (1–3 min). Puedes seguir usando la app.'); estado(); }
    catch (err) { toast(err.message, true); } finally { b.disabled = false; }
  };
  if ($('#ed-deshacer')) $('#ed-deshacer').onclick = () => preguntar('¿Volver al clip original?', 'Volver al original (se pierden las ediciones)', async () => { await api('/api/editor/deshacer', { id: Number(id), n: Number(n) }); toast('Vuelto al original'); location.hash = '#/explorar'; });
  todo(); estado();
}

// ---------- equipo, mi cuenta y recorrido guiado (fase 9) ----------
const ROL_TXT = { dueno: 'Dueño', editor: 'Editor', lector: 'Solo ver' };
const ROL_AYUDA = { dueno: 'Todo, también el servidor, el equipo y el acceso de Claude', editor: 'Revisa, edita, crea y publica; no toca el servidor ni el equipo', lector: 'Lo ve todo, no cambia nada' };
const filasCuenta = () => `<a class="fila" href="#/ajustes/cuenta"><span class="avatar s32">${esc(iniciales(E.yo?.nombre || '?'))}</span><div class="txt"><b>Mi cuenta</b><br><small>${esc(E.yo ? `${E.yo.nombre} · @${E.yo.usuario} · ${ROL_TXT[E.yo.rol] || E.yo.rol}` : 'Tu usuario y tu contraseña')}</small></div><span class="flecha">${I('abajo')}</span></a>`
  + (E.yo?.rol === 'dueno' ? `<a class="fila" href="#/ajustes/equipo"><span class="ico-fila">${I('rejilla')}</span><div class="txt"><b>Equipo</b><br><small>Quién entra en la app y qué puede hacer</small></div><span class="flecha">${I('abajo')}</span></a>` : '');

function verClaveTemporal(titulo, usuario, clave) {
  const h = capa(`<div class="hoja" role="dialog" aria-label="${esc(titulo)}"><h2>${esc(titulo)}</h2>
    <p style="padding:0 16px">Pásale estos datos por un canal privado. Solo se ven ahora: al entrar, la app le pedirá una contraseña propia.</p>
    <div class="clave-temporal"><div><small>Dirección</small><b>${esc(location.origin)}</b></div><div><small>Usuario</small><b>${esc(usuario)}</b></div><div><small>Contraseña temporal</small><b class="tnum">${esc(clave)}</b></div></div>
    <button class="op" data-copiar><span><b>Copiar los tres datos</b></span></button><button class="op" data-cerrar><span>Hecho</span></button></div>`);
  h.raiz.querySelector('[data-copiar]').onclick = async () => { try { await navigator.clipboard.writeText(`StreamClipper\n${location.origin}\nUsuario: ${usuario}\nContraseña temporal: ${clave}`); aviso('Copiado'); } catch { aviso('No se pudo copiar: cópialo a mano'); } };
  h.raiz.querySelector('[data-cerrar]').onclick = h.cerrar;
}

async function paginaCuenta(L, atras) {
  const yo = await api('/api/yo'); E.yo = yo;
  L.innerHTML = `${atras('#/ajustes', 'Ajustes')}<h1>Mi cuenta</h1>
    <div class="fila"><span class="avatar s56">${esc(iniciales(yo.nombre))}</span><div class="txt"><b>${esc(yo.nombre)}</b><br><small>@${esc(yo.usuario)} · ${esc(ROL_TXT[yo.rol] || yo.rol)}: ${esc(ROL_AYUDA[yo.rol] || '')}</small></div></div>
    <section class="grupo-ajustes"><h2>Tus datos</h2>
      <button class="fila" data-a="nombre"><span class="ico-fila">${I('lapiz')}</span><div class="txt"><b>Nombre</b><br><small>${esc(yo.nombre)}</small></div><span class="flecha">${I('abajo')}</span></button>
      <button class="fila" data-a="usuario"><span class="ico-fila">${I('texto')}</span><div class="txt"><b>Usuario para entrar</b><br><small>@${esc(yo.usuario)}</small></div><span class="flecha">${I('abajo')}</span></button>
      <button class="fila" data-a="clave"><span class="ico-fila">${I('ajustes')}</span><div class="txt"><b>Cambiar la contraseña</b><br><small>Mínimo 8 caracteres</small></div><span class="flecha">${I('abajo')}</span></button></section>
    <section class="grupo-ajustes"><h2>Ayuda</h2>
      <button class="fila" data-a="tour"><span class="ico-fila">${I('estrella')}</span><div class="txt"><b>Ver el recorrido guiado otra vez</b><br><small>Qué hay en cada parte de la app</small></div><span class="flecha">${I('abajo')}</span></button>
      <a class="fila" href="#/ajustes/publicacion"><span class="ico-fila">${I('enviar')}</span><div class="txt"><b>Cuentas conectadas</b><br><small>Los canales de YouTube y TikTok donde se publica</small></div><span class="flecha">${I('abajo')}</span></a></section>
    <div class="ficha-acciones"><button class="boton" data-a="salir">${I('salir')}<span>Cerrar sesión</span></button></div>`;
  const recargar = () => paginaCuenta(L, atras);
  const A = {
    nombre: () => hojaCampos('Tu nombre', [{ nombre: 'nombre', etiqueta: 'Nombre', valor: yo.nombre, max: 60 }], async (v) => { await api('/api/yo/nombre', v); aviso('Nombre guardado'); recargar(); }),
    usuario: () => hojaCampos('Usuario para entrar', [{ nombre: 'usuario', etiqueta: 'Usuario', ayuda: 'De 3 a 30 letras sin tildes, números, punto o guion.', valor: yo.usuario, max: 30 }], async (v) => { await api('/api/yo/usuario', v); aviso('Usuario cambiado: úsalo la próxima vez que entres'); recargar(); }),
    clave: () => hojaCampos('Cambiar la contraseña', [{ nombre: 'actual', etiqueta: 'Contraseña actual', tipo: 'clave' }, { nombre: 'nueva', etiqueta: 'Nueva contraseña', tipo: 'clave', ayuda: 'Mínimo 8 caracteres.' }, { nombre: 'repite', etiqueta: 'Repítela', tipo: 'clave' }],
      async (v) => { if (v.nueva !== v.repite) throw new Error('Las dos nuevas no coinciden'); await api('/api/yo/clave', { actual: v.actual, nueva: v.nueva }); aviso('Contraseña cambiada'); }, { boton: 'Cambiar' }),
    tour: () => { location.hash = '#/'; setTimeout(() => tourGuiado(true), 600); },
    salir: async () => { await fetch('/api/salir', { method: 'POST' }).catch(() => {}); pantallaLogin(); },
  };
  L.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => A[b.dataset.a](); });
}

async function paginaEquipo(L, atras) {
  const { usuarios } = await api('/api/usuarios');
  L.innerHTML = `${atras('#/ajustes', 'Ajustes')}<h1>Equipo</h1>
    <p class="muted">Todos trabajáis el mismo contenido. Cada persona entra con su usuario y puede conectar sus propios canales en Ajustes › Publicación.</p>
    <div class="ficha-acciones"><button class="boton primario" data-nuevo>${I('crear')}<span>Añadir a alguien</span></button></div>
    <section class="grupo-ajustes"><h2>Personas · ${usuarios.length}</h2>${usuarios.map((u) => `<button class="fila ${u.activo ? '' : 'apagada'}" data-u="${u.id}"><span class="avatar s32">${esc(iniciales(u.nombre))}</span><div class="txt"><b>${esc(u.nombre)}</b>${u.id === E.yo?.id ? ' <small>(tú)</small>' : ''}${u.activo ? '' : ' <span class="etiqueta-off">Desactivado</span>'}<br><small>@${esc(u.usuario)} · ${esc(ROL_TXT[u.rol])} · ${u.ultimo ? `entró ${esc(hace(`${u.ultimo.replace(' ', 'T')}Z`))}` : u.cambiarClave ? 'aún no ha entrado' : 'sin entradas'}</small></div><span class="flecha">${I('abajo')}</span></button>`).join('')}</section>
    <section class="grupo-ajustes"><h2>Roles</h2>${Object.entries(ROL_TXT).map(([k, t]) => `<p class="muted"><b>${t}:</b> ${ROL_AYUDA[k]}.</p>`).join('')}</section>`;
  const recargar = () => paginaEquipo(L, atras);
  const opRol = Object.entries(ROL_TXT).map(([k, t]) => [k, `${t} · ${ROL_AYUDA[k]}`]);
  L.querySelector('[data-nuevo]').onclick = () => hojaCampos('Añadir a alguien', [
    { nombre: 'nombre', etiqueta: 'Nombre', max: 60, ph: 'Ana' }, { nombre: 'usuario', etiqueta: 'Usuario para entrar', ayuda: 'De 3 a 30 letras sin tildes, números, punto o guion.', max: 30, ph: 'ana' },
    { nombre: 'rol', etiqueta: 'Qué puede hacer', tipo: 'opcion', opciones: opRol, valor: 'editor' }],
  async (v) => { const r = await api('/api/usuarios/crear', v); recargar(); verClaveTemporal('Usuario creado', r.usuario.usuario, r.clave); }, { boton: 'Crear', nota: 'Se crea con una contraseña temporal que verás una sola vez.' });
  L.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => {
    const u = usuarios.find((x) => x.id === Number(b.dataset.u)), yo = u.id === E.yo?.id;
    hoja(u.nombre, [
      { texto: 'Cambiar el rol', sub: `Ahora: ${ROL_TXT[u.rol]}`, icono: 'ajustes', accion: () => hojaCampos(`Rol de ${u.nombre}`, [{ nombre: 'rol', etiqueta: 'Qué puede hacer', tipo: 'opcion', opciones: opRol, valor: u.rol }], async (v) => { await api('/api/usuarios/guardar', { id: u.id, rol: v.rol }); aviso('Rol cambiado'); recargar(); }) },
      { texto: 'Cambiar el nombre', icono: 'lapiz', accion: () => hojaCampos('Nombre', [{ nombre: 'nombre', etiqueta: 'Nombre', valor: u.nombre, max: 60 }], async (v) => { await api('/api/usuarios/guardar', { id: u.id, nombre: v.nombre }); aviso('Nombre guardado'); recargar(); }) },
      ...(yo ? [] : [
        { texto: 'Nueva contraseña temporal', sub: 'Si la olvidó: cierra sus sesiones abiertas', icono: 'reintentar', accion: async () => { const r = await api('/api/usuarios/restablecer', { id: u.id }); verClaveTemporal('Contraseña restablecida', u.usuario, r.clave); recargar(); } },
        { texto: u.activo ? 'Desactivar' : 'Activar', sub: u.activo ? 'No podrá entrar; no se borra nada' : 'Podrá volver a entrar', icono: u.activo ? 'cerrar' : 'check', accion: async () => { await api('/api/usuarios/guardar', { id: u.id, activo: !u.activo }); aviso(u.activo ? 'Desactivado' : 'Activado'); recargar(); } },
        { texto: 'Borrar', icono: 'papelera', peligro: true, accion: () => confirmar(`¿Borrar a ${u.nombre}?`, 'Borrar el usuario (su trabajo se queda)', async () => { await api('/api/usuarios/borrar', { id: u.id }); aviso('Usuario borrado'); recargar(); }) },
      ]),
    ]);
  }; });
}

function pantallaClaveNueva() {
  $('#app').innerHTML = `<div class="login"><form><div class="marca">${LOGO}<span>StreamClipper</span></div><p class="muted" style="margin:0">Hola, ${esc(E.yo?.nombre || '')}. Pon una contraseña propia para seguir.</p>
    <input type="password" name="nueva" autocomplete="new-password" placeholder="Nueva contraseña (mín. 8)" aria-label="Nueva contraseña" required minlength="8">
    <input type="password" name="repite" autocomplete="new-password" placeholder="Repítela" aria-label="Repite la contraseña" required minlength="8">
    <button type="submit">Guardar y entrar</button><div class="error" role="alert"></div></form></div>`;
  const f = $('.login form'); f.elements.nueva.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.elements.nueva.value !== f.elements.repite.value) { $('.error', f).textContent = 'No coinciden'; return; }
    try { await api('/api/yo/clave', { nueva: f.elements.nueva.value }); arrancar(); } catch (err) { if (err.message !== 'sesión') $('.error', f).textContent = err.message; }
  };
}

// Recorrido guiado: resalta cada parte de la app con una explicación corta. Sale solo la primera vez (y desde Mi cuenta).
const PASOS_TOUR = [
  { t: 'Bienvenido a StreamClipper', x: 'Un recorrido de un minuto por la app. Puedes saltarlo y volver a verlo en Ajustes › Mi cuenta.' },
  { s: '.primeros', t: 'Primeros pasos', x: 'Esta lista te lleva hasta tu primer clip. Cada paso tiene un botón que abre justo lo que hay que hacer. La ocultas cuando quieras y vuelve desde Más.' },
  { s: '.nav-item[href="#/"]', t: 'Inicio', x: 'Lo que pide tu atención: clips por revisar, directos que se están grabando y propuestas del Estudio.' },
  { s: '.nav-item[href="#/explorar"]', t: 'Explorar', x: 'Todo el contenido en un sitio: clips, campañas, propuestas, vídeos largos y horizontales. Filtra por tipo o busca.' },
  { s: '.nav-item[href="#/reels"]', t: 'Reels', x: 'Revisa los clips a pantalla completa y di si sirven o no: la IA aprende de cada decisión.' },
  { s: '[data-crear]', t: 'Crear', x: 'Añade un streamer, una campaña, un vídeo para recortar o un encargo para el Estudio.' },
  { s: '.nav-item[href="#/actividad"]', t: 'Actividad', x: 'Lo que está en marcha ahora y lo que ha pasado: publicaciones, errores y avisos del servidor.' },
  { s: '.nav-item[href="#/mensajes"]', t: 'Mensajes', x: 'Lo que te cuentan la IA y el Estudio: propuestas, comentarios y avisos.' },
  { s: '[data-mas]', t: 'Más', x: 'Ajustes, cola de subida, estadísticas, recopilatorios y el servidor.' },
  { t: 'Conecta tus cuentas', x: 'En Ajustes › Publicación › Cuentas conectadas puedes conectar tus canales de YouTube y TikTok. ¡Listo!', ir: ['Ir a cuentas conectadas', '#/ajustes/publicacion'] },
];
function tourGuiado(forzado = false) {
  if (document.querySelector('.tour')) return;
  const visible = (s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0);
  const pasos = PASOS_TOUR.filter((p) => !p.s || visible(p.s));
  let i = 0;
  const el = document.createElement('div'); el.className = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Recorrido guiado');
  document.body.append(el);
  const terminar = () => { el.remove(); removeEventListener('keydown', tecla); removeEventListener('resize', pintar); api('/api/yo/tour', { visto: true }).then(() => { if (E.yo) E.yo.tour = true; }).catch(() => {}); };
  const tecla = (e) => { if (e.key === 'Escape') terminar(); if (e.key === 'ArrowRight' && i < pasos.length - 1) { i++; pintar(); } if (e.key === 'ArrowLeft' && i > 0) { i--; pintar(); } };
  function pintar() {
    const p = pasos[i], t = p.s && visible(p.s), r = t?.getBoundingClientRect();
    const hueco = r ? `<div class="tour-hueco" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>` : '<div class="tour-velo"></div>';
    const abajo = r && r.top < innerHeight / 2, izq = r ? Math.min(Math.max(12, r.left + r.width / 2 - 160), innerWidth - 332) : null;
    const pos = !r ? 'left:50%;top:50%;transform:translate(-50%,-50%)' : `left:${izq}px;${abajo ? `top:${r.bottom + 14}px` : `bottom:${innerHeight - r.top + 14}px`}`;
    el.innerHTML = `${hueco}<div class="tour-burbuja" style="${pos}"><small>${i + 1} de ${pasos.length}</small><h2>${esc(p.t)}</h2><p>${esc(p.x)}</p>
      <div class="tour-botones">${i < pasos.length - 1 ? '<button class="enlace" data-saltar>Saltar</button>' : ''}<span></span>${i > 0 ? '<button class="boton" data-atras>Atrás</button>' : ''}${p.ir ? `<button class="boton" data-ir>${esc(p.ir[0])}</button>` : ''}<button class="boton primario" data-sig>${i < pasos.length - 1 ? 'Siguiente' : 'Terminar'}</button></div></div>`;
    el.querySelector('[data-sig]').onclick = () => { if (i < pasos.length - 1) { i++; pintar(); } else terminar(); };
    el.querySelector('[data-atras]')?.addEventListener('click', () => { i--; pintar(); });
    el.querySelector('[data-saltar]')?.addEventListener('click', terminar);
    el.querySelector('[data-ir]')?.addEventListener('click', () => { terminar(); location.hash = p.ir[1]; });
    el.querySelector('[data-sig]').focus();
  }
  addEventListener('keydown', tecla); addEventListener('resize', pintar);
  pintar();
}

// ---------- crear y más ----------
function hojaCrear() {
  hoja('Crear', [
    { texto: 'Recopilatorio', sub: 'Con los clips de la bolsa', icono: 'largo', accion: () => { location.hash = '#/recopilatorios'; } },
    { texto: 'Ver la cola de recorte', sub: 'Lo que espera, se recorta o falló', icono: 'cola', accion: () => { location.hash = '#/cola'; } },
    { texto: 'Ver la cola de subida', sub: 'Qué se publica y en qué orden', icono: 'enviar', accion: () => { location.hash = '#/subida'; } },
    { texto: 'Streamer', sub: 'Sacar clips de un canal de YouTube o Twitch', icono: 'directo', accion: hojaNuevoStreamer },
    { texto: 'Campaña', sub: 'Con sus requisitos, franja y logo', icono: 'estrella', accion: hojaNuevaCampana },
    { texto: 'Vídeo', sub: 'Un enlace de YouTube o Twitch para recortarlo ya', icono: 'video', accion: hojaNuevoVideo },
    { texto: 'Proponer un vídeo', sub: 'Un encargo para el Estudio', icono: 'estudio', accion: hojaEncargo },
  ]);
}
function hojaMas() {
  const oscuro = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  hoja('Más', [
    { texto: 'Ajustes', sub: 'Todo lo que decide la app, en un solo sitio', icono: 'ajustes', accion: () => { location.hash = '#/ajustes'; } },
    ...(E.yo?.rol === 'dueno' ? [{ texto: 'Primeros pasos', sub: 'La lista guiada hasta tu primer clip', icono: 'check', accion: async () => { await api('/api/primeros-pasos', { oculto: false }); if (['', '#/'].includes(location.hash)) ruta(); else location.hash = '#/'; } }] : []),
    { texto: 'Cola de subida', sub: 'YouTube y TikTok, en orden', icono: 'enviar', accion: () => { location.hash = '#/subida'; } },
    { texto: 'Reportar un problema', sub: 'Abre una incidencia en GitHub con el diagnóstico (la revisas antes de enviarla)', icono: 'alerta', accion: reportarProblema },
    { texto: 'Bolsa y recopilatorios', icono: 'largo', accion: () => { location.hash = '#/recopilatorios'; } },
    { texto: 'Estadísticas', sub: 'Qué funciona y la estrategia del canal', icono: 'grafica', accion: () => { location.hash = '#/estadisticas'; } },
    { texto: 'Servidor', sub: 'Salud, recursos y servicios', icono: 'grafica', accion: () => { location.hash = '#/sistema'; } },
    { texto: 'Operaciones', sub: 'Lanzar una tarea ahora', icono: 'reloj', accion: () => { location.hash = '#/operaciones'; } },
    { texto: oscuro ? 'Modo claro' : 'Modo oscuro', icono: 'luna', accion: () => { const t = oscuro ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('tema', t); } },
    { texto: 'Cerrar sesión', icono: 'salir', peligro: true, accion: async () => { await fetch('/api/salir', { method: 'POST' }).catch(() => {}); pantallaLogin(); } },
  ]);
}
function selectorCuentas() {
  hoja('Cambiar de cuenta', E.cuentas.map((c) => ({ texto: c.nombre, sub: c.id === E.cuenta ? 'Cuenta actual' : c.tipo === 'campana' ? 'Campaña' : 'Canal', icono: c.tipo === 'campana' ? 'campana' : 'reels', accion: () => cambiarCuenta(c.id) })));
}
function cambiarCuenta(id) { E.cuenta = id; localStorage.setItem('cuenta', id); pintarMarco(); ruta(); }

// ---------- marco y rutas ----------
const NAV = [['#/', 'inicio', 'Inicio'], ['#/explorar', 'buscar', 'Explorar'], ['#/reels', 'reels', 'Reels'], ['#/mensajes', 'enviar', 'Mensajes'], ['#/actividad', 'corazon', 'Actividad'], ['crear', 'crear', 'Crear'], ['#/perfil', null, 'Perfil'], ['#/cola', 'cola', 'Cola']];
let hayActividad = false;
function pintarMarco() {
  const h = location.hash || '#/', c = cuentaActual();
  const av = `<span class="avatar s24">${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : esc(iniciales(c.nombre))}</span>`;
  const item = ([href, ic, t]) => href === 'crear' ? `<button class="nav-item" data-crear>${I(ic)}<span class="etq">${t}</span></button>`
    : `<a class="nav-item" href="${href}" ${h === href ? 'aria-current="page"' : ''}>${ic ? I(ic, h === href && ic === 'corazon' ? 'lleno' : '') : av}${ic === 'corazon' && hayActividad && h !== href ? '<span class="punto"></span>' : ''}<span class="etq">${t}</span></a>`;
  $('#app').innerHTML = `<div class="marco">
    <nav class="lateral" aria-label="Principal"><a class="marca" href="#/">${LOGO}<span>StreamClipper</span></a>${[...NAV.slice(0, 5), NAV[7], NAV[5], NAV[6]].map(item).join('')}<div class="relleno"></div><button class="nav-item" data-mas>${I('menu')}<span class="etq">Más</span></button></nav>
    <header class="barra-sup"><button class="selector-cuenta" data-cuentas>${esc(c.nombre)}${I('abajo')}</button><div class="acciones-sup">${item(NAV[7])}${item(NAV[4])}${item(NAV[3])}<button class="nav-item" data-mas aria-label="Más">${I('menu')}</button></div></header>
    <main class="principal" id="vista"></main>
    <nav class="barra-inf" aria-label="Principal">${[NAV[0], NAV[1], NAV[5], NAV[2], NAV[6]].map(item).join('')}</nav></div>`;
  $('#app').querySelectorAll('[data-crear]').forEach((b) => { b.onclick = hojaCrear; });
  $('#app').querySelectorAll('[data-mas]').forEach((b) => { b.onclick = hojaMas; });
  $('#app').querySelectorAll('[data-cuentas]').forEach((b) => { b.onclick = selectorCuentas; });
}
const VISTAS = { '#/': vistaInicio, '#/explorar': vistaExplorar, '#/reels': vistaReels, '#/actividad': vistaActividad, '#/mensajes': vistaMensajes, '#/perfil': vistaPerfil, '#/cola': vistaCola, '#/ajustes': vistaAjustes, '#/subida': vistaSubida, '#/estadisticas': vistaEstadisticas, '#/recopilatorios': vistaRecop, '#/propuesta': vistaPropuesta, '#/sistema': vistaSistema, '#/operaciones': vistaOperaciones, '#/editor': vistaEditor, '#/galeria': vistaExplorar, '#/clips': vistaCola, '#/publicacion': vistaSubida };
// Direcciones antiguas: a su sitio en esta app.
const ALIAS = { '#/estudio': '#/explorar' };
async function ruta() {
  { const [, b, x] = location.hash.split('/'); const al = location.hash.startsWith('#/estudio/') && x ? `#/propuesta/${x}` : ALIAS[`#/${b || ''}`]; if (al) { if (b === 'estudio' && !x) sessionStorage.setItem('filtro', 'propuestas'); location.replace(al); return; } }
  const base = location.hash.split('/').slice(0, 2).join('/');
  const h = VISTAS[location.hash] ? location.hash : VISTAS[base] ? base : '#/';
  document.onkeydown = null;
  if (!$('#vista')) pintarMarco();
  $('#app').querySelectorAll('.nav-item[href]').forEach((a) => { if (a.getAttribute('href') === h) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const main = $('#vista'); main.scrollTop = 0; window.scrollTo(0, 0);
  try { await VISTAS[h](main); } catch (e) { if (e.message !== 'sesión') main.innerHTML = `<div class="vacio">${I('alerta')}<p>No se pudo cargar: ${esc(e.message)}</p><button class="boton" onclick="location.reload()">Reintentar</button></div>`; }
}

// ---------- sesión ----------
function pantallaLogin({ nueva = false } = {}) {
  $('#app').innerHTML = `<div class="login"><form><div class="marca">${LOGO}<span>StreamClipper</span></div>${nueva ? '<p class="muted" style="margin:0"><b>Bienvenido.</b> Crea tu cuenta: elige un nombre de usuario y una contraseña de al menos 8 caracteres. Serás el dueño de esta instalación.</p>' : ''}<input name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Usuario" aria-label="Usuario"><input name="clave" type="password" autocomplete="current-password" placeholder="Contraseña" aria-label="Contraseña" required><button type="submit">${nueva ? 'Crear mi cuenta' : 'Entrar'}</button><div class="error" role="alert"></div>${nueva ? '' : '<small class="muted">Si eres el dueño y entrabas solo con la contraseña, tu usuario es <b>admin</b>.</small>'}</form></div>`;
  const f = $('.login form'); f.elements.usuario.value = localStorage.getItem('ultimoUsuario') || ''; (f.elements.usuario.value ? f.elements.clave : f.elements.usuario).focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const usuario = f.elements.usuario.value.trim();
    const r = await fetch('/api/sesion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, clave: f.elements.clave.value }) });
    if (r.ok) { localStorage.setItem('ultimoUsuario', usuario); arrancar(); } else $('.error', f).textContent = (await r.json().catch(() => ({}))).error || 'Usuario o contraseña incorrectos';
  };
}
async function arrancar() {
  const s = await fetch('/api/sesion').then((r) => r.json()).catch(() => ({}));
  if (!s.autenticado) return pantallaLogin({ nueva: !s.tieneClave }); // instalación nueva: la primera cuenta es la del dueño
  E.yo = s.usuario || null;
  api('/api/cuentas').then((l) => { E.cuentasRed = l; }).catch(() => {});
  if (E.yo?.cambiarClave) return pantallaClaveNueva();
  try { E.cuentas = (await api('/api/social/cuentas')).cuentas; } catch { return; }
  if (!E.cuentas.some((c) => c.id === E.cuenta)) E.cuenta = 'canal';
  try { const { eventos } = await api('/api/social/actividad'); hayActividad = !!eventos[0] && (!E.actividadVista || eventos[0].fecha > E.actividadVista); } catch {}
  pintarMarco(); ruta();
  if (E.yo && !E.yo.tour) setTimeout(() => tourGuiado(), 1600);
}
window.addEventListener('hashchange', ruta);
arrancar();

const TIPOS_VIDEO = [['gaming', 'Directo de videojuegos', 'Juego arriba y la cara del streamer abajo'], ['reaccion', 'Reacción', 'Contenido arriba y la cara abajo'], ['conversacion', 'Podcast / entrevista', 'Dos personas apiladas'], ['formativo', 'Formativo / consejos', 'Diapositiva arriba y la cara abajo'], ['general', 'General', 'OpenShorts decide el encuadre']];
function hojaTipoVideo(titulo, alElegir) {
  hoja(titulo, TIPOS_VIDEO.map(([t, n, d]) => ({ texto: n, sub: d, icono: t === 'gaming' || t === 'reaccion' ? 'directo' : 'video', accion: async () => { try { await alElegir(t); } catch (e) { if (e.message !== 'sesión') aviso(e.message); } } })));
}
function hojaNuevoVideo() {
  hojaFormulario('Recortar un vídeo', [{ nombre: 'fuente', etiqueta: 'Enlace de YouTube o Twitch' }],
    (v) => hojaTipoVideo('¿Qué tipo de vídeo es?', async (tipo) => { await api('/api/clips/videos', { fuente: v.fuente, tipo, urgente: true }); aviso('A la cola: se recorta el siguiente'); location.hash = '#/cola'; }),
    { boton: 'Siguiente', nota: 'Se recorta sin esperar a Gemini. Para un streamer fijo, usa Crear › Streamer.' });
}
