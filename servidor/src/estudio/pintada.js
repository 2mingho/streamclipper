// Escenas «pintadas»: cada plano es una ilustración anime generada en la GPU de la laptop y separada en tres capas por
// profundidad (fondo, medio, frente). Aquí se anima en 2.5D: la cámara empuja, se aleja o barre, y cada capa se mueve a
// su ritmo (paralaje). Encima van los subtítulos karaoke, rótulos, cifras, líneas de velocidad, destellos y látigos.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeIO = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const lerp = (a, b, k) => a + (b - a) * k;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const ruido = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 5.3 + s * 0.7) * 0.1;

  function horario(e, dur) {
    const pl = e.planos && e.planos.length ? e.planos : [{}];
    const pesos = pl.map((p) => p.dur ?? 1), tot = pesos.reduce((a, b) => a + b, 0);
    let t0 = 0; return pl.map((p, i) => { const d = (pesos[i] / tot) * dur, r = { ...p, i, t0, t1: t0 + d }; t0 += d; return r; });
  }
  window.PINTADA_URLS = (e, base) => (e.planos || []).filter((p) => p.clave).flatMap((p) => ['fondo.jpg', 'medio.png', 'frente.png'].map((f) => `${base}/${p.clave}/${f}`));
  window.PINTADA_SONIDOS = (e, dur) => { const s = []; for (const p of horario(e, dur)) { if (p.i > 0 || p.transicion) s.push({ t: p.t0, tipo: p.transicion === 'latigo' ? 'barrido' : p.efecto === 'flash' || p.mov === 'golpe' ? 'golpe' : 'corte' }); } if (e.dato) s.push({ t: e.dato.entra ?? 0.6, tipo: 'pop' }); return s.filter((x) => x.tipo !== 'corte'); };
  window.PINTADA_T_CLAVE = (e, dur) => { const h = horario(e, dur)[0]; return (h.t0 + h.t1) / 2; };

  function lineasVelocidad(W, H, t) {
    const sem = Math.floor(t * 15), cx = W / 2, cy = H / 2;
    return Array.from({ length: 70 }, (_, i) => { const a = (i / 70) * Math.PI * 2 + hash(i + sem) * 0.08, r0 = Math.min(W, H) * (0.34 + hash(i * 3 + sem) * 0.12), r1 = Math.max(W, H), w = 0.008 + hash(i + sem * 7) * 0.012;
      return `<path d="M${cx + Math.cos(a - w) * r1} ${cy + Math.sin(a - w) * r1} L${cx + Math.cos(a) * r0} ${cy + Math.sin(a) * r0} L${cx + Math.cos(a + w) * r1} ${cy + Math.sin(a + w) * r1}Z" fill="#fff" opacity=".8"/>`; }).join('');
  }
  function monedas(t, W, H) {
    return Array.from({ length: 30 }, (_, i) => { const x = hash(i) * W, v = H * (0.45 + hash(i + 50) * 0.5), t0 = hash(i + 99) * 1.6, y = -100 + (t - t0) * v; if (y < -100 || y > H + 100) return '';
      return `<g transform="translate(${x} ${y}) rotate(${(t * 220 + i * 40) % 360}) scale(${Math.abs(Math.cos(t * 4 + i))} 1)"><circle r="${H * 0.03}" fill="#f5c542" stroke="#a8761c" stroke-width="3"/><circle r="${H * 0.018}" fill="none" stroke="#fff4c2" stroke-width="3"/></g>`; }).join('');
  }
  function polvo(t, W, H, color) {
    return Array.from({ length: 26 }, (_, i) => { const x = (hash(i) * W + Math.sin(t * 0.6 + i) * 30), y = ((hash(i + 40) * H - t * (12 + hash(i + 9) * 25)) % H + H) % H;
      return `<circle cx="${x}" cy="${y}" r="${(1.5 + hash(i + 3) * 3) * H / 1080}" fill="${color}" opacity="${0.25 + 0.45 * Math.abs(Math.sin(t * 1.3 + i))}"/>`; }).join('');
  }
  function subtitulo(txt, t, dur, W, H, V) {
    const w = String(txt || '').replace(/\*/g, '').split(/\s+/).filter(Boolean); if (!w.length) return '';
    const pesos = w.map((p) => p.length + 2), tot = pesos.reduce((a, b) => a + b, 0), util = Math.max(0.5, dur - 0.3);
    let acc = 0; const ini = pesos.map((p) => { const s = (acc / tot) * util; acc += p; return s; });
    let cur = ini.findIndex((s, i) => t >= s && (i === w.length - 1 || t < ini[i + 1])); if (cur < 0) cur = 0;
    const tam = V ? 3 : 5, g = Math.floor(cur / tam), grupo = w.slice(g * tam, g * tam + tam), k = ease((t - ini[g * tam]) / 0.16);
    const fs = V ? H * 0.04 : H * 0.054, y = V ? H * 0.7 : H * 0.87;
    return `<g transform="translate(${W / 2} ${y}) scale(${0.82 + 0.18 * k})" font-weight="900" font-size="${fs}" text-anchor="middle" paint-order="stroke" stroke="#140c1c" stroke-width="${fs * 0.17}" stroke-linejoin="round">
      <text>${grupo.map((p, i) => `<tspan fill="${g * tam + i === cur ? '#ffd34d' : '#ffffff'}">${esc(p.toUpperCase())}</tspan>`).join(' ')}</text></g>`;
  }

  window.PINTADA = function (e, t, dur, ctx) {
    const V = !!ctx.vertical, W = V ? 1080 : 1920, H = V ? 1920 : 1080;
    const plan = horario(e, dur), p = plan.find((q) => t >= q.t0 && t < q.t1) || plan.at(-1);
    const dt = t - p.t0, k = dt / Math.max(0.01, p.t1 - p.t0), kk = easeIO(k);
    // Cámara: zoom s y desplazamiento (en fracción del encuadre).
    let s = lerp(1.03, 1.09, kk), dx = 0, dy = 0;
    const m = p.mov || 'empuja';
    if (m === 'empuja') s = lerp(1.02, 1.16, kk);
    else if (m === 'aleja') s = lerp(1.18, 1.03, kk);
    else if (m === 'barrido') { s = 1.12; dx = lerp(0.045, -0.045, kk); }
    else if (m === 'barrido_izq') { s = 1.12; dx = lerp(-0.045, 0.045, kk); }
    else if (m === 'sube') { s = 1.12; dy = lerp(0.04, -0.04, kk); }
    else if (m === 'baja') { s = 1.12; dy = lerp(-0.04, 0.04, kk); }
    else if (m === 'golpe') s = 1.08 + 0.1 * Math.exp(-dt * 6) * Math.cos(dt * 18);
    const temb = (p.efecto === 'temblor' ? 0.012 * Math.exp(-dt * 2.2) : 0) + 0.0022;
    dx += ruido(t * 1.2, 1) * temb; dy += ruido(t * 1.0, 5) * temb;
    const lat = p.transicion === 'latigo' && dt < 0.2 ? 1 - dt / 0.2 : 0;
    if (lat) dx += (p.desde_izq ? -1 : 1) * lat * 0.35;
    const rot = p.angulo === 'holandes' ? 4 : 0;
    // Imagen a cubrir: 1344×768 → en horizontal cubre de lado a lado; en vertical cubre el alto y se encuadra en foco_x.
    const ar = 1344 / 768, margen = 1.08;
    let iw, ih; if (V) { ih = H * margen; iw = ih * ar; } else { iw = W * margen; ih = iw / ar; if (ih < H * margen) { ih = H * margen; iw = ih * ar; } }
    const foco = p.foco_x ?? 0.5, baseX = V ? clamp(W / 2 - iw * foco, W - iw, 0) : (W - iw) / 2, baseY = (H - ih) / 2;
    const capa = (f, prof) => { const sc = Math.pow(s, prof), ox = dx * W * prof, oy = dy * H * prof;
      return `<g transform="translate(${W / 2 + ox} ${H / 2 + oy}) rotate(${rot}) scale(${sc}) translate(${-W / 2} ${-H / 2})"><image href="${ctx.imgBase}/${p.clave}/${f}" x="${baseX}" y="${baseY}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid slice"/></g>`; };
    const imagenes = p.clave ? capa('fondo.jpg', 0.55) + capa('medio.png', 1) + capa('frente.png', 1.45)
      : `<rect width="${W}" height="${H}" fill="#2b2f6b"/><text x="${W / 2}" y="${H / 2}" fill="#fff" font-size="40" text-anchor="middle">Falta la imagen de este plano</text>`;
    const blurLat = lat ? `filter="url(#latP)"` : '';
    const efectos = (p.efecto === 'lineas' ? lineasVelocidad(W, H, t) : '') + (e.efecto === 'lluvia_monedas' ? monedas(t, W, H) : '') + polvo(t, W, H, e.hora === 'noche' ? '#bcd0ff' : '#fff3c9');
    const flash = p.efecto === 'flash' && dt < 0.28 ? `<rect width="${W}" height="${H}" fill="#fff" opacity="${1 - dt / 0.28}"/>` : '';
    const rotulo = e.rotulo ? (() => { const k2 = ease((t - 0.15) / 0.4), fs = V ? 44 : 36, ww = e.rotulo.length * fs * 0.56 + 70; return `<g transform="translate(${(V ? 50 : 70) - (1 - k2) * 520} ${V ? 230 : 86}) skewX(-12)" opacity="${k2}"><rect width="${ww}" height="${fs * 1.9}" fill="#140c1c" opacity=".82"/><rect width="10" height="${fs * 1.9}" fill="#ffd34d"/><text x="34" y="${fs * 1.3}" font-size="${fs}" font-weight="800" fill="#fff" letter-spacing="1">${esc(e.rotulo)}</text></g>`; })() : '';
    const dato = e.dato ? (() => { const t0 = e.dato.entra ?? 0.6; if (t < t0) return ''; const k2 = ease((t - t0) / 0.3), pop = 1 + 0.25 * Math.exp(-(t - t0) * 6) * Math.sin((t - t0) * 18), fs = V ? 150 : 170;
      const mm = String(e.dato.valor).match(/^(\D*)([\d.,]+)(.*)$/); let val = e.dato.valor; if (mm) { const limpio = mm[2].replace(/[.,](?=\d{3}\b)/g, ''), d2 = (limpio.split(/[.,]/)[1] || '').length; val = mm[1] + (parseFloat(limpio.replace(',', '.')) * ease((t - t0) / 1)).toLocaleString('es', { minimumFractionDigits: d2, maximumFractionDigits: d2 }) + mm[3]; }
      const x = V ? W / 2 : (e.dato.lado === 'izq' ? W * 0.27 : W * 0.73), y = V ? H * 0.3 : H * 0.36;
      return `<g transform="translate(${x} ${y}) scale(${k2 * pop}) rotate(-3)">${Array.from({ length: 16 }, (_, i) => `<path d="M0 0 L${Math.cos(i / 16 * 6.283 - 0.08) * 420} ${Math.sin(i / 16 * 6.283 - 0.08) * 420} L${Math.cos(i / 16 * 6.283 + 0.08) * 420} ${Math.sin(i / 16 * 6.283 + 0.08) * 420}Z" fill="#ffd34d" opacity="${0.16 + 0.1 * Math.sin(t * 6 + i)}"/>`).join('')}
        <text y="${fs * 0.3}" text-anchor="middle" font-size="${fs}" font-weight="900" fill="url(#datoP)" stroke="#140c1c" stroke-width="${fs * 0.09}" paint-order="stroke" stroke-linejoin="round">${esc(val)}</text>
        ${e.dato.etiqueta ? `<g transform="translate(0 ${fs * 0.75})"><rect x="${-e.dato.etiqueta.length * 13 - 30}" y="-36" width="${e.dato.etiqueta.length * 26 + 60}" height="56" rx="10" fill="#140c1c" opacity=".85"/><text y="4" text-anchor="middle" font-size="34" font-weight="800" fill="#fff">${esc(e.dato.etiqueta)}</text></g>` : ''}</g>`; })() : '';
    const sub = e.subtitulos === false ? '' : subtitulo(ctx.narracion, t, dur, W, H, V);
    return `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui;background:#140c1c">
      <defs><filter id="latP"><feGaussianBlur stdDeviation="${(70 * lat).toFixed(1)} 0"/></filter>
        <radialGradient id="vinP" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#140c1c" stop-opacity="0"/><stop offset="1" stop-color="#140c1c" stop-opacity=".45"/></radialGradient>
        <linearGradient id="datoP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c2"/><stop offset=".5" stop-color="#ffd34d"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient></defs>
      <g ${blurLat}>${imagenes}</g>${efectos}<rect width="${W}" height="${H}" fill="url(#vinP)"/>${rotulo}${dato}${sub}${flash}
      ${lat ? `<rect width="${W}" height="${H}" fill="#fff" opacity="${lat * 0.22}"/>` : ''}</svg>`;
  };
})();
