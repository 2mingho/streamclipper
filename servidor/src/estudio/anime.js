// Escenas «anime» del Estudio: personajes de estilo anime con sombreado plano (cel-shading), cielos y luz pintados,
// y una cámara con planificación de planos (general, conjunto, medio, primer plano, detalle, contrapicado, por encima del
// hombro…) que corta, barre y empuja dentro de cada escena. Todo depende solo de t: el mismo t da el mismo fotograma.
// Mundo de 1920×1080 (el suelo está en y = 900); la cámara es una ventana sobre ese mundo con la proporción de salida.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeIO = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const lerp = (a, b, k) => a + (b - a) * k;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const ruido = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 5.3 + s * 0.7) * 0.1;
  const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb = ([r, g, b]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  const osc = (h, k = 0.25) => rgb(hex(h).map((c) => c * (1 - k)));
  const cla = (h, k = 0.25) => rgb(hex(h).map((c) => c + (255 - c) * k));
  const linea = (h) => rgb(hex(h).map((c, i) => c * 0.42 + [40, 20, 30][i] * 0.2));
  let DEFS = new Map();
  const def = (id, svg) => { if (!DEFS.has(id)) DEFS.set(id, svg); return `url(#${id})`; };
  const grad = (id, stops, vertical = true) => def(id, `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
  const radial = (id, stops) => def(id, `<radialGradient id="${id}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);

  // ---------- personajes ----------
  const PIEL = { clara: '#f7dccb', media: '#ecc09d', morena: '#cf9468', oscura: '#93603f' };
  const POSES = {
    de_pie: { i: [6, 8], d: [6, 8] }, senala: { i: [8, 10], d: [100, 8] }, manos_arriba: { i: [150, 25], d: [150, 25] },
    piensa: { i: [30, 100], d: [35, 140] }, brazos_cruzados: { cruzados: true }, saluda: { i: [6, 8], d: [145, 40] },
    sostiene: { i: [6, 8], d: [50, 70] }, explica: { i: [40, 55], d: [55, 45] }, camina: { i: [6, 8], d: [6, 8], camina: true },
    celebra: { i: [20, 30], d: [160, 15] }, puno: { i: [10, 12], d: [70, 120] }, cabeza: { i: [140, 120], d: [140, 120] }, cadera: { i: [40, -95], d: [40, -95] },
  };
  // Cejas por expresión: [inclinación (positivo = interior arriba), altura]
  const CEJA = { neutral: [0, 0], feliz: [3, 3], preocupado: [12, 4], sorprendido: [4, 12], enfadado: [-14, -2], triste: [14, 0], pensativo: [6, 2], decidido: [-8, -1], risa: [4, 5] };

  function ojo(expr, parpadeo, color, mirar, t, semilla) {
    const iris = grad(`iris${color.replace('#', '')}`, [[0, osc(color, 0.55)], [0.55, color], [1, cla(color, 0.45)]]);
    if (parpadeo || expr === 'risa') return expr === 'risa' ? `<path d="M-15 4 Q0 -12 15 4" fill="none" stroke="#2a1a1f" stroke-width="5" stroke-linecap="round"/>` : `<path d="M-16 2 Q0 8 16 2" fill="none" stroke="#2a1a1f" stroke-width="4.5" stroke-linecap="round"/>`;
    const alto = expr === 'sorprendido' ? 1.12 : expr === 'feliz' ? 0.82 : expr === 'enfadado' || expr === 'decidido' ? 0.78 : 1;
    const pup = expr === 'sorprendido' ? 0.55 : 1, gx = mirar + Math.sin(t * 0.7 + semilla) * 1.2;
    const tapa = expr === 'enfadado' || expr === 'decidido' ? `<path d="M-19 -12 L19 -4 L19 -26 L-19 -26Z" fill="var(--pielf)"/>` : expr === 'triste' || expr === 'preocupado' ? `<path d="M-19 -6 L19 -14 L19 -26 L-19 -26Z" fill="var(--pielf)"/>` : '';
    return `<g transform="scale(1 ${alto})">
      <path d="M-16 0 Q-15 -19 2 -20 Q16 -18 17 -3 Q15 14 0 15 Q-15 13 -16 0Z" fill="#fffdfb"/>
      <ellipse cx="${gx}" cy="1" rx="11.5" ry="15" fill="${iris}"/><ellipse cx="${gx}" cy="2" rx="${5 * pup}" ry="${8 * pup}" fill="#1c1018"/>
      <circle cx="${gx - 5}" cy="-6" r="4.2" fill="#fff"/><circle cx="${gx + 5}" cy="8" r="2" fill="#fff" opacity=".9"/>
      ${tapa}<path d="M-19 -1 Q-14 -22 3 -22 Q17 -20 21 -6 L25 -10" fill="none" stroke="#2a1a1f" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-11 15 Q0 18 10 14" fill="none" stroke="#2a1a1f" stroke-width="2" opacity=".6"/></g>`;
  }
  function boca(expr, habla, t, semilla) {
    if (habla) { const a = Math.abs(Math.sin(t * 12 + semilla)) * (0.5 + 0.5 * Math.abs(Math.sin(t * 4.3 + semilla))); return `<path d="M${-8 - a * 2} 0 Q0 ${-2} ${8 + a * 2} 0 Q${6} ${4 + a * 12} 0 ${5 + a * 13} Q-6 ${4 + a * 12} ${-8 - a * 2} 0Z" fill="#7a2c34"/><path d="M-4 ${3 + a * 9} Q0 ${1 + a * 7} 4 ${3 + a * 9}" fill="#e3727c" opacity="${a > 0.3 ? 1 : 0}"/>`; }
    return {
      feliz: '<path d="M-11 -2 Q0 9 11 -2" fill="none" stroke="#5a2830" stroke-width="3.5" stroke-linecap="round"/>',
      risa: '<path d="M-12 -3 Q0 -2 12 -3 Q8 14 0 15 Q-8 14 -12 -3Z" fill="#7a2c34"/><path d="M-6 9 Q0 6 6 9" fill="#e3727c"/>',
      sorprendido: '<ellipse cx="0" cy="4" rx="6" ry="8" fill="#7a2c34"/>',
      enfadado: '<path d="M-11 4 Q0 -3 11 4" fill="none" stroke="#5a2830" stroke-width="3.5" stroke-linecap="round"/>',
      triste: '<path d="M-9 5 Q0 -2 9 5" fill="none" stroke="#5a2830" stroke-width="3" stroke-linecap="round"/>',
      preocupado: '<path d="M-9 3 Q-3 -1 0 2 Q3 5 9 1" fill="none" stroke="#5a2830" stroke-width="3" stroke-linecap="round"/>',
      decidido: '<path d="M-9 1 Q2 4 10 -2" fill="none" stroke="#5a2830" stroke-width="3.5" stroke-linecap="round"/>',
    }[expr] || '<path d="M-6 1 Q0 3 6 1" fill="none" stroke="#5a2830" stroke-width="3" stroke-linecap="round"/>';
  }
  function peloAtras(est, c) {
    const s = osc(c, 0.3), l = linea(c);
    return {
      largo: `<path d="M-72 -40 Q-84 -116 0 -118 Q84 -116 72 -40 L86 180 Q50 168 34 70 L-34 70 Q-50 168 -86 180Z" fill="${s}" stroke="${l}" stroke-width="3"/>`,
      melena: `<path d="M-76 -30 Q-84 -118 0 -120 Q84 -118 76 -30 L80 74 Q54 88 40 52 L-40 52 Q-54 88 -80 74Z" fill="${s}" stroke="${l}" stroke-width="3"/>`,
      coleta: `<path d="M50 -70 Q140 -60 128 60 Q120 150 70 190 Q100 90 60 0Z" fill="${s}" stroke="${l}" stroke-width="3"/><path d="M-70 -30 Q-78 -114 0 -118 Q78 -114 70 -30Z" fill="${s}" stroke="${l}" stroke-width="3"/>`,
      rizado: `${[[-70, -40, 38], [-60, -90, 40], [-20, -116, 42], [30, -114, 42], [66, -84, 40], [74, -34, 36], [-78, 10, 30], [80, 14, 30]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${s}" stroke="${l}" stroke-width="3"/>`).join('')}`,
      corto: `<path d="M-68 -26 Q-76 -114 0 -118 Q76 -114 68 -26Z" fill="${s}" stroke="${l}" stroke-width="3"/>`,
      canas: `<path d="M-68 -26 Q-76 -112 0 -116 Q76 -112 68 -26Z" fill="${s}" stroke="${l}" stroke-width="3"/>`,
    }[est] || '';
  }
  function peloDelante(est, c, t) {
    const l = linea(c), b = cla(c, 0.35), sw = Math.sin(t * 1.6) * 2;
    const brillo = `<path d="M-42 -80 Q-4 -98 38 -84" fill="none" stroke="${b}" stroke-width="7" stroke-linecap="round" opacity=".85"/><path d="M-30 -70 Q0 -82 26 -74" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>`;
    const formas = {
      corto: `M-68 -14 L-62 -72 Q-24 -120 30 -108 Q72 -92 70 -20 L58 -48 L50 ${-6 + sw} L34 -52 L18 ${-12 + sw} L6 -58 L-10 ${-8 + sw} L-22 -56 L-38 ${-14 + sw} L-48 -52Z`,
      largo: `M-74 30 Q-80 -104 0 -112 Q76 -106 74 20 L62 -40 Q40 -66 18 ${-30 + sw} Q-6 -64 -30 ${-34 + sw} Q-46 -50 -54 ${10 + sw}Z`,
      melena: `M-76 10 Q-80 -108 0 -114 Q78 -108 76 6 L64 -36 L50 ${-6 + sw} L34 -50 L14 ${-16 + sw} L-2 -54 L-20 ${-14 + sw} L-36 -50 L-52 ${-4 + sw} L-60 -30Z`,
      coleta: `M-70 -10 Q-76 -110 0 -114 Q72 -110 70 -16 L56 -50 Q34 -70 10 ${-32 + sw} Q-14 -66 -38 ${-30 + sw} Q-52 -44 -58 ${-6 + sw}Z`,
      rizado: `M-74 -20 q-6 -40 20 -58 q10 -36 50 -34 q30 -20 56 4 q34 4 30 50 q-20 -26 -40 -10 q-20 -20 -40 0 q-24 -20 -46 2 q-18 -10 -30 46Z`,
      canas: `M-68 -20 Q-70 -106 0 -112 Q70 -106 68 -24 Q50 -74 0 -80 Q-46 -74 -68 -20Z`,
    };
    if (est === 'calvo') return `<path d="M-60 -40 Q-66 -70 -52 -82 M60 -40 Q66 -70 52 -82" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`;
    if (est === 'gorra') return `<path d="M-72 -34 Q-74 -122 0 -124 Q74 -122 72 -34Z" fill="${c}" stroke="${l}" stroke-width="3"/><path d="M-72 -40 Q0 -54 76 -40 L130 -30 Q70 -16 -72 -26Z" fill="${osc(c, 0.2)}" stroke="${l}" stroke-width="3"/><path d="M-40 -100 Q0 -114 36 -102" fill="none" stroke="${cla(c, 0.4)}" stroke-width="6" stroke-linecap="round"/>`;
    return `<path d="${formas[est] || formas.corto}" fill="${est === 'canas' ? c : c}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>${est === 'calvo' ? '' : brillo}`;
  }
  function brazo(lado, [a1, a2], manga, piel, objeto) {
    const s = lado === 'i' ? -1 : 1, lm = linea(manga), lp = linea(piel);
    const mano = objeto ? `<g transform="translate(0 132) rotate(${s * (a1 + a2)})">${objeto}</g>` : '';
    return `<g transform="translate(${s * 64} -528) rotate(${-s * a1})">
      <path d="M-15 -4 Q-17 70 -12 146 L12 146 Q17 70 15 -4 Q0 -14 -15 -4Z" fill="${manga}" stroke="${lm}" stroke-width="3"/><path d="M${s * 4} 0 Q${s * 16} 70 ${s * 11} 146 L${s * 3} 146Z" fill="${osc(manga, 0.22)}"/>
      <g transform="translate(0 140) rotate(${-s * a2})"><path d="M-13 -6 Q-14 60 -10 122 L10 122 Q14 60 13 -6Z" fill="${manga}" stroke="${lm}" stroke-width="3"/>
        <path d="M-12 112 L12 112 L13 124 L-13 124Z" fill="${osc(manga, 0.3)}"/><ellipse cx="0" cy="134" rx="13" ry="15" fill="${piel}" stroke="${lp}" stroke-width="2.5"/>${mano}</g></g>`;
  }

  function personaje(dp, ap, t, objetoMano) {
    const piel = PIEL[dp.piel] || dp.piel || PIEL.media, lp = linea(piel), sp = osc(piel, 0.16);
    const ropa = dp.ropa?.color || '#3d5a99', pant = dp.ropa?.pantalon || '#2d3142', tipo = dp.ropa?.tipo || 'camisa';
    const pc = dp.pelo?.color || (dp.pelo?.estilo === 'canas' ? '#d9d6d2' : '#3a2a26'), est = dp.pelo?.estilo || 'corto';
    const ojos = dp.ojos || '#6b4a2e', expr = ap.expresion || 'neutral', semilla = (dp.id || 'x').length * 1.7 + (dp.id || 'x').charCodeAt(0) * 0.13;
    const pose = POSES[ap.pose] || POSES.de_pie, resp = Math.sin(t * 2.1 + semilla) * 3;
    const parp = ((t + semilla) % 4.1) < 0.12, paso = pose.camina ? Math.sin(t * 8) * 18 : 0, rebote = pose.camina ? Math.abs(Math.cos(t * 8)) * -8 : 0;
    const cab = (ap.habla ? Math.sin(t * 3.3 + semilla) * 3 : 0) + (expr === 'pensativo' ? -6 : expr === 'triste' ? 5 : 0);
    const [ci, ch] = CEJA[expr] || CEJA.neutral, mir = 4;
    const manga = tipo === 'vestido' ? piel : ropa, ls = linea(ropa);
    const largoT = tipo === 'bata' ? 250 : tipo === 'vestido' ? 300 : 0;
    // torso
    let torso = `<path d="M-68 -540 Q-76 -450 -52 -368 L-56 -326 L56 -326 L52 -368 Q76 -450 68 -540 Q0 -566 -68 -540Z" fill="${ropa}" stroke="${ls}" stroke-width="3"/><path d="M26 -552 Q70 -540 68 -540 Q76 -450 52 -368 L56 -326 L30 -326 Q44 -440 26 -552Z" fill="${osc(ropa, 0.2)}"/>`;
    if (tipo === 'bata' || tipo === 'vestido') torso = `<path d="M-68 -540 Q-80 -420 -${tipo === 'vestido' ? 110 : 76} ${-326 + largoT * 0.5} L${tipo === 'vestido' ? 110 : 76} ${-326 + largoT * 0.5} Q80 -420 68 -540 Q0 -566 -68 -540Z" fill="${ropa}" stroke="${ls}" stroke-width="3"/><path d="M26 -552 Q70 -540 68 -540 Q80 -420 ${tipo === 'vestido' ? 110 : 76} ${-326 + largoT * 0.5} L36 ${-326 + largoT * 0.5} Q46 -430 26 -552Z" fill="${osc(ropa, 0.18)}"/>`;
    const detalle = {
      traje: `<path d="M-26 -552 L0 -456 L26 -552Z" fill="#f4f1ec" stroke="${ls}" stroke-width="2"/><path d="M0 -540 L-9 -470 L0 -440 L9 -470Z" fill="${dp.ropa?.corbata || '#c43d4b'}" stroke="${linea(dp.ropa?.corbata || '#c43d4b')}" stroke-width="2"/><path d="M-26 -552 L-8 -470 L-20 -460 M26 -552 L8 -470 L20 -460" fill="none" stroke="${ls}" stroke-width="3"/><line x1="0" y1="-440" x2="0" y2="-330" stroke="${ls}" stroke-width="3"/>`,
      chaqueta: `<path d="M-24 -552 L0 -470 L24 -552Z" fill="${dp.ropa?.debajo || '#f2efe9'}" stroke="${ls}" stroke-width="2"/><path d="M-24 -552 L-6 -470 L-6 -330 M24 -552 L6 -470 L6 -330" fill="none" stroke="${ls}" stroke-width="3"/>`,
      bata: `<path d="M-24 -552 L0 -456 L24 -552Z" fill="${dp.ropa?.debajo || '#7fa6d6'}" stroke="${ls}" stroke-width="2"/><line x1="0" y1="-456" x2="0" y2="${-326 + largoT * 0.5}" stroke="${ls}" stroke-width="3"/><rect x="-54" y="-420" width="30" height="22" rx="3" fill="none" stroke="${ls}" stroke-width="2.5"/>`,
      sudadera: `<path d="M-46 -552 Q0 -520 46 -552 Q40 -580 0 -582 Q-40 -580 -46 -552Z" fill="${osc(ropa, 0.25)}" stroke="${ls}" stroke-width="3"/><path d="M-10 -540 L-12 -488 M10 -540 L12 -488" stroke="#f4f1ec" stroke-width="4" stroke-linecap="round"/><path d="M-40 -400 L40 -400 L34 -356 L-34 -356Z" fill="none" stroke="${ls}" stroke-width="3"/>`,
      camisa: `<path d="M-30 -552 L-4 -520 L-18 -508Z M30 -552 L4 -520 L18 -508Z" fill="${cla(ropa, 0.25)}" stroke="${ls}" stroke-width="2.5"/>${[-490, -450, -410, -370].map((y) => `<circle cx="0" cy="${y}" r="3.5" fill="${ls}"/>`).join('')}`,
      vestido: `<path d="M-40 -552 Q0 -520 40 -552" fill="none" stroke="${ls}" stroke-width="3"/><path d="M-62 -380 Q0 -366 62 -380" fill="none" stroke="${osc(ropa, 0.3)}" stroke-width="10"/>`,
    }[tipo] || '';
    // piernas
    const zap = '#2b2430';
    const pierna = (x, rot, color) => `<g transform="rotate(${rot} ${x} -330)"><path d="M${x - 22} -334 L${x - 18} -24 L${x + 16} -24 L${x + 22} -334Z" fill="${color}" stroke="${linea(color)}" stroke-width="3"/><path d="M${x + 4} -334 L${x + 6} -24 L${x + 16} -24 L${x + 22} -334Z" fill="${osc(color, 0.2)}"/><path d="M${x - 22} -26 Q${x - 24} 4 ${x + 2} 4 L${x + 30} 4 Q${x + 32} -18 ${x + 16} -28Z" fill="${zap}"/></g>`;
    const piernas = tipo === 'vestido' ? pierna(-24, paso, piel) + pierna(24, -paso, piel) : pierna(-26, paso, pant) + pierna(26, -paso, pant);
    const brazos = pose.cruzados
      ? `<path d="M-90 -470 Q0 -430 90 -470 L86 -420 Q0 -392 -86 -420Z" fill="${manga}" stroke="${linea(manga)}" stroke-width="3"/><ellipse cx="-74" cy="-444" rx="14" ry="13" fill="${piel}" stroke="${lp}" stroke-width="2.5"/><ellipse cx="74" cy="-444" rx="14" ry="13" fill="${piel}" stroke="${lp}" stroke-width="2.5"/>`
      : null;
    const bi = brazos ? '' : brazo('i', pose.i, manga, piel), bd = brazos ? '' : brazo('d', pose.d, manga, piel, objetoMano);
    // cabeza
    const ojoI = ojo(expr, parp, ojos, -mir, t, semilla), ojoD = ojo(expr, parp, ojos, mir, t, semilla + 1);
    const ceja = (s) => `<path d="M${s * 9} ${-30 - ch - ci * 0.5} Q${s * 20} ${-37 - ch} ${s * 32} ${-31 - ch + ci * 0.4}" fill="none" stroke="${osc(pc === '#d9d6d2' ? '#8a8580' : pc, 0.2)}" stroke-width="4.5" stroke-linecap="round"/>`;
    const extras = (expr === 'preocupado' ? `<path d="M60 -50 Q70 -30 62 -22 Q52 -28 60 -50Z" fill="#9fd3f5" stroke="#4a86b8" stroke-width="2"/>` : '')
      + (expr === 'enfadado' ? `<g transform="translate(48 -78) scale(.9)" stroke="#d6334a" stroke-width="5" fill="none" stroke-linecap="round"><path d="M-10 -4 Q-4 -4 -4 -10 M4 -10 Q4 -4 10 -4 M10 4 Q4 4 4 10 M-4 10 Q-4 4 -10 4"/></g>` : '')
      + (expr === 'triste' ? `<path d="M-30 22 Q-32 34 -28 40" stroke="#9fd3f5" stroke-width="4" fill="none" stroke-linecap="round" opacity="${0.5 + 0.5 * Math.sin(t * 2)}"/>` : '');
    const gafas = dp.gafas ? `<g fill="rgba(220,235,255,.18)" stroke="#3a3440" stroke-width="3"><rect x="-44" y="-18" width="38" height="30" rx="9"/><rect x="10" y="-18" width="38" height="30" rx="9"/></g><path d="M-6 -6 Q2 -10 10 -6" fill="none" stroke="#3a3440" stroke-width="3"/><path d="M-36 -12 L-24 -12" stroke="#fff" stroke-width="3" opacity=".7"/>` : '';
    const vello = dp.barba ? `<path d="M-58 0 Q-60 66 0 80 Q60 66 58 0 Q50 46 24 50 Q0 40 -24 50 Q-50 46 -58 0Z" fill="${pc}" stroke="${linea(pc)}" stroke-width="2.5"/>` : dp.bigote ? `<path d="M-18 36 Q0 26 18 36 Q4 34 0 38 Q-4 34 -18 36Z" fill="${pc}" stroke="${linea(pc)}" stroke-width="2"/>` : '';
    const arrugas = dp.edad === 'mayor' ? `<path d="M-50 -2 L-44 4 M50 -2 L44 4 M-22 54 Q-26 60 -24 66 M22 54 Q26 60 24 66" stroke="${lp}" stroke-width="2" fill="none" opacity=".6"/>` : '';
    const cabeza = `<g transform="translate(0 -652) rotate(${cab} 0 60)" style="--pielf:${piel}">
        ${peloAtras(est, pc)}
        <path d="M-12 50 L-12 98 L12 98 L12 50Z" fill="${sp}"/>
        <path d="M-60 -40 Q-63 12 -42 46 Q-18 76 6 78 Q22 74 44 46 Q63 12 60 -40 Q56 -88 0 -90 Q-56 -88 -60 -40Z" fill="${piel}" stroke="${lp}" stroke-width="3"/>
        <path d="M60 -40 Q63 12 44 46 Q30 64 14 72 Q40 30 42 -30Z" fill="${sp}" opacity=".8"/>
        <path d="M-58 -30 Q0 -6 58 -30 L58 -48 Q0 -26 -58 -48Z" fill="${sp}" opacity=".7"/>
        <ellipse cx="-62" cy="-2" rx="9" ry="15" fill="${piel}" stroke="${lp}" stroke-width="2.5"/><ellipse cx="62" cy="-2" rx="9" ry="15" fill="${piel}" stroke="${lp}" stroke-width="2.5"/>
        ${arrugas}<ellipse cx="-30" cy="26" rx="13" ry="5.5" fill="#ff7d86" opacity="${expr === 'feliz' || expr === 'risa' || expr === 'sorprendido' ? 0.45 : 0.22}"/><ellipse cx="38" cy="26" rx="13" ry="5.5" fill="#ff7d86" opacity="${expr === 'feliz' || expr === 'risa' || expr === 'sorprendido' ? 0.45 : 0.22}"/>
        <g transform="translate(-20 4) scale(-1 1)">${ojoI}</g><g transform="translate(28 4)">${ojoD}</g>
        ${ceja(-1).replace(/M(-?\d)/, 'M$1').replace(/^<path d="M/, '<path transform="translate(-6 0)" d="M')}${ceja(1).replace(/^<path d="M/, '<path transform="translate(4 0)" d="M')}
        <path d="M6 22 L9 32 L4 33" fill="none" stroke="${lp}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${vello}<g transform="translate(6 46)">${boca(expr, ap.habla, t, semilla)}</g>${gafas}
        ${peloDelante(est, pc, t + semilla)}${extras}</g>`;
    return `<g transform="translate(0 ${rebote})">
      <ellipse cx="0" cy="6" rx="110" ry="16" fill="#1b1430" opacity=".22"/>
      ${piernas}
      <g transform="translate(0 ${resp * 0.4})">${bi}${torso}${detalle}${brazos || ''}${cabeza}${bd}</g></g>`;
  }

  // ---------- objetos (estilo anime: líneas de color, brillo) ----------
  const O = (fill, d, extra = '') => `<path d="${d}" fill="${fill}" stroke="${linea(fill)}" stroke-width="3" stroke-linejoin="round"/>${extra}`;
  const OBJ = {
    camara: () => `${O('#3a3f4b', 'M-70 -44 L70 -44 L70 46 L-70 46Z')}${O('#3a3f4b', 'M-40 -60 L4 -60 L8 -44 L-44 -44Z')}<circle r="30" fill="#24324d" stroke="#141a26" stroke-width="3"/><circle r="17" fill="${radial('lente', [[0, '#bfe3ff'], [0.6, '#3a6ea8'], [1, '#14243d']])}"/><circle cx="-7" cy="-8" r="5" fill="#fff" opacity=".9"/><rect x="40" y="-36" width="18" height="10" rx="3" fill="#f2c14e"/>`,
    monedas: (t) => [0, 1, 2, 3].map((i) => `<ellipse cx="0" cy="${-i * 16}" rx="52" ry="18" fill="#f5c542" stroke="#a8761c" stroke-width="3"/><ellipse cx="-14" cy="${-i * 16 - 4}" rx="16" ry="5" fill="#fff4c2" opacity=".8"/>`).join(''),
    billete: () => `<g transform="rotate(-8)">${O('#8fd3a8', 'M-90 -42 L90 -42 L90 42 L-90 42Z')}<circle r="24" fill="none" stroke="#3f7d58" stroke-width="3"/><text y="11" text-anchor="middle" font-size="32" font-weight="800" fill="#2f6346">$</text></g>`,
    documento: () => `<g transform="rotate(4)">${O('#fffaf2', 'M-66 -88 L40 -88 L66 -62 L66 88 L-66 88Z')}${[0, 1, 2, 3, 4].map((i) => `<line x1="-44" y1="${-50 + i * 26}" x2="${i === 4 ? 10 : 44}" y2="${-50 + i * 26}" stroke="#a9a3b5" stroke-width="5" stroke-linecap="round"/>`).join('')}</g>`,
    telefono: (t) => `${O('#2c2f3a', 'M-38 -72 L38 -72 Q46 -72 46 -62 L46 62 Q46 72 38 72 L-38 72 Q-46 72 -46 62 L-46 -62 Q-46 -72 -38 -72Z')}<rect x="-36" y="-60" width="72" height="116" rx="6" fill="${grad('pantalla', [[0, '#7fd0ff'], [1, '#5b6dff']])}"/><rect x="-26" y="-48" width="${30 + Math.abs(Math.sin(t * 2)) * 20}" height="8" rx="4" fill="#fff" opacity=".8"/>`,
    laptop: () => `${O('#3a3f4b', 'M-110 -120 L110 -120 L110 20 L-110 20Z')}<rect x="-96" y="-106" width="192" height="112" fill="${grad('pantalla', [[0, '#7fd0ff'], [1, '#5b6dff']])}"/>${O('#c3c7d1', 'M-140 20 L140 20 L120 40 L-120 40Z')}`,
    tele: (t) => `${O('#8a5a3b', 'M-130 -110 L130 -110 L130 90 L-130 90Z')}<rect x="-104" y="-86" width="170" height="150" rx="26" fill="#5d6a74"/><rect x="-90" y="-72" width="142" height="122" rx="20" fill="#bfe3ff" opacity="${0.55 + 0.4 * Math.abs(Math.sin(t * 9))}"/><circle cx="96" cy="-50" r="11" fill="#2c2f3a"/><circle cx="96" cy="-12" r="11" fill="#2c2f3a"/>`,
    bombilla: (t) => { const on = clamp((t - 0.5) * 3); return `<circle cy="-30" r="${70 + on * 40}" fill="${radial('halo', [[0, '#fff2a8', 0.9], [1, '#ffd34d', 0]])}" opacity="${on}"/>${O(on > 0.5 ? '#ffe36b' : '#fffaf2', 'M-46 -30 A46 46 0 1 1 46 -30 Q40 0 22 16 L-22 16 Q-40 0 -46 -30Z')}${O('#b9bfcc', 'M-22 16 L22 16 L20 48 L-20 48Z')}`; },
    tarjeta: () => `<g transform="rotate(-10)">${O('#e8505b', 'M-94 -58 L94 -58 Q100 -58 100 -50 L100 50 Q100 58 94 58 L-94 58 Q-100 58 -100 50 L-100 -50 Q-100 -58 -94 -58Z')}<rect x="-70" y="-24" width="38" height="28" rx="5" fill="#f5c542"/><rect x="-100" y="-40" width="200" height="16" fill="#2c2f3a" opacity=".7"/><path d="M-80 -50 L20 -50" stroke="#fff" stroke-width="6" opacity=".35" stroke-linecap="round"/></g>`,
    hucha: () => `${O('#f6a6bd', 'M-110 0 A110 80 0 1 0 110 0 A110 80 0 1 0 -110 0Z')}<circle cx="96" cy="-10" r="26" fill="#f6a6bd" stroke="#b5607a" stroke-width="3"/><rect x="-24" y="-82" width="48" height="10" rx="5" fill="#7a3550"/><circle cx="60" cy="-26" r="6" fill="#2a1a1f"/><path d="M-60 -50 Q-20 -70 30 -60" stroke="#fff" stroke-width="8" fill="none" opacity=".5" stroke-linecap="round"/>`,
    reloj: (t) => `<circle r="70" fill="#fffaf2" stroke="#6b5b73" stroke-width="5"/><line x1="0" y1="0" x2="0" y2="-46" stroke="#2c2f3a" stroke-width="6" stroke-linecap="round" transform="rotate(${t * 60})"/><line x1="0" y1="0" x2="30" y2="0" stroke="#2c2f3a" stroke-width="7" stroke-linecap="round" transform="rotate(${t * 5})"/><circle r="6" fill="#e8505b"/>`,
    maletin: () => `${O('#8a5a3b', 'M-90 -58 L90 -58 L90 60 L-90 60Z')}<rect x="-30" y="-84" width="60" height="28" rx="8" fill="none" stroke="#5b3a26" stroke-width="6"/><rect x="-90" y="-10" width="180" height="10" fill="#5b3a26" opacity=".5"/>`,
    pregunta: (t) => `<g transform="translate(0 ${Math.sin(t * 3) * 8}) rotate(${Math.sin(t * 2) * 6})"><text y="50" text-anchor="middle" font-size="180" font-weight="900" fill="#ffd34d" stroke="#2a1a1f" stroke-width="8" paint-order="stroke">?</text></g>`,
    lata: (t, o = {}) => `${O(o.color || '#d8322b', 'M-50 -88 L50 -88 L50 88 L-50 88Z')}<rect x="-40" y="-102" width="80" height="18" rx="6" fill="#c7ccd6" stroke="#6b7180" stroke-width="3"/><path d="M-50 -10 Q0 -40 50 -10 L50 18 Q0 -12 -50 18Z" fill="#fffaf2"/><rect x="-34" y="-80" width="12" height="160" fill="#fff" opacity=".3"/>${o.texto ? `<text y="62" text-anchor="middle" font-size="24" font-weight="900" fill="#fffaf2">${esc(o.texto)}</text>` : ''}`,
    cartel: (t, o = {}) => `<g transform="rotate(${Math.sin(t * 3) * 5})"><rect x="-8" y="0" width="16" height="250" fill="#8a5a3b"/>${O('#fffaf2', 'M-170 -150 L170 -150 L170 10 L-170 10Z')}${String(o.texto || '').split('|').map((l, i, a) => `<text y="${-70 + (i - (a.length - 1) / 2) * 44 + 14}" text-anchor="middle" font-size="40" font-weight="900" fill="#c4283a">${esc(l)}</text>`).join('')}</g>`,
    maleta: () => '',
  };
  function grafico(dir, t, w = 520, h = 300) {
    const n = 7, pts = Array.from({ length: n }, (_, i) => { const b = dir === 'baja' ? 1 - i / (n - 1) : i / (n - 1); return [i * (w / (n - 1)), h - (b * 0.8 + hash(i + (dir === 'baja' ? 9 : 3)) * 0.2) * h]; });
    const k = ease((t - 0.2) / 1.4), corte = k * (n - 1), vis = pts.filter((_, i) => i <= corte);
    if (corte % 1 && pts[Math.ceil(corte)]) { const a = pts[Math.floor(corte)], b = pts[Math.ceil(corte)], f = corte % 1; vis.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]); }
    const col = dir === 'baja' ? '#ff5a6a' : '#3fe0a0';
    return `<rect x="-30" y="-30" width="${w + 60}" height="${h + 60}" rx="18" fill="#1e2440" opacity=".92" stroke="#7fd0ff" stroke-width="3"/>${[0.25, 0.5, 0.75].map((f) => `<line x1="0" y1="${h * f}" x2="${w}" y2="${h * f}" stroke="#7fd0ff" stroke-width="1.5" opacity=".25"/>`).join('')}
      <polyline points="${vis.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="22" opacity=".25" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${vis.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>${vis.length ? `<circle cx="${vis.at(-1)[0]}" cy="${vis.at(-1)[1]}" r="12" fill="#fff"/>` : ''}`;
  }
  const objeto = (o, t) => o.tipo === 'grafico_sube' || o.tipo === 'grafico_baja' ? `<g transform="translate(-260 -150)">${grafico(o.tipo === 'grafico_sube' ? 'sube' : 'baja', t)}</g>` : OBJ[o.tipo]?.(t, o) || '';

  // ---------- decorados pintados: [lejos, medio, cerca, delante] ----------
  const HORAS = {
    dia: { cielo: [['0', '#5aa7ea'], ['0.6', '#a9d4f5'], ['1', '#e9f4fb']], sol: '#fffbe0', luz: '#fff3c9', tinte: 0 },
    atardecer: { cielo: [['0', '#3b4f9a'], ['0.45', '#e88a7a'], ['0.8', '#ffc98a'], ['1', '#ffe6b8']], sol: '#ffe2a0', luz: '#ffb36b', tinte: 0.12 },
    noche: { cielo: [['0', '#0b1033'], ['0.6', '#1c2a63'], ['1', '#3a3f86']], sol: '#e8eeff', luz: '#7f9cff', tinte: 0.3 },
  };
  function cielo(h, t) {
    const H = HORAS[h] || HORAS.dia;
    const nubes = h === 'noche' ? Array.from({ length: 70 }, (_, i) => `<circle cx="${-400 + hash(i) * 2800}" cy="${-500 + hash(i + 7) * 900}" r="${1.5 + hash(i + 3) * 2.5}" fill="#fff" opacity="${0.4 + 0.6 * Math.abs(Math.sin(t * (1 + hash(i)) + i))}"/>`).join('')
      : [[200, 120, 1.1], [900, 40, 1.5], [1600, 150, 1.2], [2300, 60, 1.3], [-300, 60, 1]].map(([x, y, s], i) => { const dx = ((x + t * 14 * (1 + i * 0.2)) % 2900) - 500; const base = h === 'atardecer' ? '#ffd9c2' : '#ffffff', som = h === 'atardecer' ? '#c98aa8' : '#b9d3ee';
        return `<g transform="translate(${dx} ${y}) scale(${s})"><path d="M-160 40 Q-170 -10 -110 -14 Q-96 -70 -30 -62 Q10 -110 70 -70 Q140 -86 150 -20 Q200 -10 190 40Z" fill="${base}"/><path d="M-160 40 Q-100 20 -40 34 Q20 14 80 30 Q150 16 190 40Z" fill="${som}" opacity=".8"/></g>`; }).join('');
    return `<rect x="-600" y="-900" width="3200" height="2100" fill="${grad(`cielo-${h}`, H.cielo)}"/><circle cx="1500" cy="${h === 'noche' ? 160 : 260}" r="${h === 'noche' ? 70 : 110}" fill="${H.sol}"/><circle cx="1500" cy="${h === 'noche' ? 160 : 260}" r="420" fill="${radial(`resplandor-${h}`, [[0, H.sol, 0.7], [1, H.sol, 0]])}"/>${nubes}`;
  }
  const montes = (cols) => cols.map((c, i) => `<path d="M-600 ${560 + i * 70} ${Array.from({ length: 14 }, (_, j) => `L${-600 + j * 260 + 130} ${400 + i * 80 - hash(j + i * 13) * 170} L${-600 + (j + 1) * 260} ${520 + i * 60 - hash(j + i * 7) * 60}`).join(' ')} L2600 1200 L-600 1200Z" fill="${c}"/>`).join('');
  const rayos = (t, color, x0 = 1500) => Array.from({ length: 6 }, (_, i) => `<path d="M${x0 - 40 + i * 30} -200 L${x0 - 700 + i * 260} 1100 L${x0 - 560 + i * 260} 1100Z" fill="${color}" opacity="${0.05 + 0.04 * Math.sin(t * 0.8 + i * 1.3)}"/>`).join('');
  const particulas = (t, color, n = 30, tam = 4) => Array.from({ length: n }, (_, i) => { const x = (hash(i) * 2600 - 300 + Math.sin(t * 0.5 + i) * 40), y = ((hash(i + 40) * 1300 - t * (14 + hash(i + 9) * 22)) % 1300 + 1300) % 1300 - 200;
    return `<circle cx="${x}" cy="${y}" r="${tam * (0.5 + hash(i + 3))}" fill="${color}" opacity="${0.35 + 0.45 * Math.abs(Math.sin(t * 1.3 + i))}"/>`; }).join('');
  const ventana = (x, y, w, h, hora, t) => `<rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" fill="#6b4a3a"/><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${1500 - w} 0 ${w * 1.6} ${h * 1.6}" preserveAspectRatio="xMidYMid slice">${cielo(hora, t)}${montes(['#8fb3d9', '#6e93bf'])}</svg><line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="#6b4a3a" stroke-width="12"/><line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="#6b4a3a" stroke-width="12"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" opacity=".12"/>`;
  const sueloInt = (c1, c2) => `<rect x="-600" y="880" width="3200" height="500" fill="${grad(`suelo${c1.replace('#', '')}`, [[0, c1], [1, c2]])}"/><rect x="-600" y="876" width="3200" height="8" fill="${osc(c1, 0.3)}"/>`;
  const pared = (c1, c2) => `<rect x="-600" y="-900" width="3200" height="1800" fill="${grad(`pared${c1.replace('#', '')}`, [[0, c2], [1, c1]])}"/>`;
  const haz = (x, t, color = '#fff2c4') => `<path d="M${x} 60 L${x + 300} 60 L${x + 700} 900 L${x + 200} 900Z" fill="${color}" opacity="${0.16 + 0.04 * Math.sin(t)}"/>`;
  const mesa = (x, w, c = '#8a5a3b') => `<rect x="${x}" y="740" width="${w}" height="34" rx="6" fill="${c}" stroke="${linea(c)}" stroke-width="3"/><rect x="${x}" y="760" width="${w}" height="14" fill="${osc(c, 0.25)}"/><rect x="${x + 30}" y="774" width="22" height="126" fill="${osc(c, 0.3)}"/><rect x="${x + w - 52}" y="774" width="22" height="126" fill="${osc(c, 0.3)}"/>`;
  const planta = (x, s = 1) => `<g transform="translate(${x} 900) scale(${s})"><path d="M-40 0 L-50 -110 L50 -110 L40 0Z" fill="#c86b4a" stroke="#7a3a26" stroke-width="3"/>${[[-30, -200, -20], [20, -230, 15], [0, -260, 0], [-50, -170, -35], [50, -180, 30]].map(([x2, y2, r]) => `<ellipse cx="${x2}" cy="${y2}" rx="26" ry="70" transform="rotate(${r} ${x2} ${y2 + 60})" fill="#4fae6a" stroke="#2e6b41" stroke-width="3"/>`).join('')}</g>`;
  const ciudadSil = (c1, c2, ventC, t, noche) => Array.from({ length: 14 }, (_, i) => { const x = -500 + i * 230, hgt = 300 + hash(i + 20) * 380, y = 880 - hgt;
    return `<rect x="${x}" y="${y}" width="200" height="${hgt}" fill="${i % 2 ? c1 : c2}"/>${Array.from({ length: 12 }, (_, j) => { const wx = x + 20 + (j % 4) * 45, wy = y + 30 + Math.floor(j / 4) * 70; return wy < 860 ? `<rect x="${wx}" y="${wy}" width="24" height="34" fill="${ventC}" opacity="${noche ? (hash(i * 9 + j) > 0.4 ? 0.9 : 0.15) : 0.35}"/>` : ''; }).join('')}`; }).join('');
  const DEC = {
    campo: (h, t) => [cielo(h, t) + montes(h === 'noche' ? ['#2a3570', '#1f2858'] : ['#9cc3e6', '#7fa9d6', '#5f8ec0']),
      `<path d="M-600 760 Q200 660 900 740 Q1600 820 2600 700 L2600 1200 L-600 1200Z" fill="${h === 'noche' ? '#24504a' : '#6fc06a'}"/><path d="M-600 820 Q400 760 1100 820 Q1800 880 2600 800 L2600 1200 L-600 1200Z" fill="${h === 'noche' ? '#1d4038' : '#4ea65a'}"/>${[[-200, 640], [1700, 660], [2100, 700]].map(([x, y]) => `<g transform="translate(${x} ${y})"><rect x="-14" y="-10" width="28" height="160" fill="#6b4a3a"/><ellipse cx="0" cy="-60" rx="110" ry="120" fill="${h === 'noche' ? '#1d4a3a' : '#3f9a55'}"/><ellipse cx="-30" cy="-90" rx="60" ry="50" fill="${h === 'noche' ? '#2a5e4a' : '#6cc073'}"/></g>`).join('')}`,
      `<rect x="-600" y="880" width="3200" height="400" fill="${h === 'noche' ? '#173830' : '#3f9450'}"/>${Array.from({ length: 140 }, (_, i) => { const x = -500 + hash(i) * 3000, y = 870 + hash(i + 5) * 260, sw = Math.sin(t * 2 + x * 0.01) * 10; return `<path d="M${x} ${y} Q${x + sw * 0.5} ${y - 30} ${x + sw} ${y - 56}" stroke="${hash(i + 2) > 0.5 ? '#7ed27a' : '#2f7a42'}" stroke-width="5" fill="none" stroke-linecap="round"/>`; }).join('')}`,
      particulas(t, h === 'noche' ? '#e8ff8a' : '#fffbe0', 26, 4) + rayos(t, HORAS[h]?.luz || '#fff3c9')],
    ciudad: (h, t) => [cielo(h, t) + ciudadSil('#7d8fb8', '#93a3c8', '#fff4d0', t, h === 'noche'),
      `${ciudadSil(h === 'noche' ? '#2a3466' : '#53628f', h === 'noche' ? '#323d75' : '#61709c', '#ffd98a', t, true).replace(/translate/g, 'translate')}${[[-100], [700], [1500], [2300]].map(([x]) => `<rect x="${x}" y="300" width="14" height="590" fill="#3a3346"/><rect x="${x - 50}" y="320" width="114" height="10" fill="#3a3346"/>`).join('')}<path d="M-600 330 Q0 380 707 330 Q1100 380 1507 330 Q1900 380 2600 330 M-600 350 Q0 410 707 350 Q1100 410 1507 350 Q1900 410 2600 350" stroke="#2a2433" stroke-width="3" fill="none"/>`,
      `<rect x="-600" y="880" width="3200" height="400" fill="#7d7a8c"/><rect x="-600" y="880" width="3200" height="22" fill="#b3aebf"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${-500 + i * 320}" y="1000" width="160" height="12" fill="#f4f1ec" opacity=".8"/>`).join('')}`,
      particulas(t, '#fff4d0', 18, 3) + rayos(t, HORAS[h]?.luz || '#fff3c9', 1600)],
    calle_noche: (h, t) => [cielo('noche', t) + ciudadSil('#232a55', '#2a3263', '#ffd98a', t, true),
      `${[[100, '#ff4f9a', 'BAR'], [900, '#4fd6ff', '24H'], [1650, '#ffd24f', 'CAFÉ']].map(([x, c, txt]) => `<rect x="${x}" y="420" width="260" height="90" rx="12" fill="#14182e" stroke="${c}" stroke-width="6"/><rect x="${x}" y="420" width="260" height="90" rx="12" fill="none" stroke="${c}" stroke-width="22" opacity="${0.18 + 0.08 * Math.sin(t * 7 + x)}"/><text x="${x + 130}" y="482" text-anchor="middle" font-size="52" font-weight="900" fill="${c}">${txt}</text>`).join('')}<g transform="translate(1300 880)"><rect x="-8" y="-460" width="16" height="460" fill="#2a2433"/><circle cx="0" cy="-470" r="22" fill="#ffe7a0"/><path d="M-260 0 L-24 -460 L24 -460 L260 0Z" fill="#ffe7a0" opacity=".14"/></g>`,
      `<rect x="-600" y="880" width="3200" height="400" fill="#1a1c2e"/>${[[230, '#ff4f9a'], [1030, '#4fd6ff'], [1780, '#ffd24f']].map(([x, c]) => `<rect x="${x - 90}" y="900" width="180" height="${200 + Math.sin(t * 2 + x) * 10}" fill="${c}" opacity=".12"/>`).join('')}`,
      particulas(t, '#9fb8ff', 30, 2.5)],
    oficina: (h, t) => [pared('#e9dccb', '#f6eee2') + ventana(700, 120, 820, 520, h || 'atardecer', t),
      `${sueloInt('#a98a6e', '#8a6d55')}${planta(260, 1.1)}<rect x="1650" y="460" width="260" height="440" fill="#c9b49c" stroke="#7a6450" stroke-width="3"/>${[0, 1, 2].map((i) => `<line x1="1650" y1="${560 + i * 110}" x2="1910" y2="${560 + i * 110}" stroke="#7a6450" stroke-width="3"/>`).join('')}`,
      mesa(1150, 760) + `<g transform="translate(1500 740) scale(.8)">${OBJ.laptop()}</g>`,
      haz(700, t, HORAS[h || 'atardecer'].luz) + particulas(t, '#fff3c9', 20, 3)],
    despacho: (h, t) => [pared('#b98d62', '#d2ab80') + `${Array.from({ length: 12 }, (_, i) => `<line x1="${-500 + i * 260}" y1="-900" x2="${-500 + i * 260}" y2="900" stroke="#8a6440" stroke-width="5"/>`).join('')}` + ventana(820, 140, 640, 460, h || 'dia', t),
      `${sueloInt('#7d5a3f', '#5f432f')}${planta(240, 1)}<rect x="1640" y="420" width="240" height="480" fill="#8a6440" stroke="#5b3f28" stroke-width="3"/>${[0, 1, 2, 3].map((i) => `<rect x="1660" y="${440 + i * 110}" width="200" height="90" fill="#6b4a30"/>${[0, 1, 2, 3, 4].map((j) => `<rect x="${1668 + j * 38}" y="${452 + i * 110}" width="30" height="76" fill="${['#c4283a', '#2f5a9e', '#e8b04a', '#3f8a5a', '#8a3a7a'][(i + j) % 5]}"/>`).join('')}`).join('')}`,
      mesa(1100, 700, '#6e4a33') + `<g transform="translate(1380 720)"><rect x="-70" y="-26" width="140" height="40" rx="10" fill="#2c2f3a"/><path d="M-60 -26 Q0 -80 60 -26" fill="none" stroke="#2c2f3a" stroke-width="14"/></g>`,
      haz(820, t, '#fff2c4') + particulas(t, '#fff3c9', 24, 3)],
    sala_juntas: (h, t) => [pared('#d9d2c6', '#ece6dc') + `<rect x="700" y="140" width="720" height="420" rx="14" fill="#1e2440" stroke="#3a3f5c" stroke-width="10"/><g transform="translate(800 220)">${grafico('sube', 3, 520, 280)}</g>` + ventana(-300, 140, 700, 520, h || 'dia', t),
      `${sueloInt('#9a8a7a', '#7a6c5e')}${[0, 1, 2, 3].map((i) => `<path d="M${380 + i * 380} 900 L${370 + i * 380} 660 Q${430 + i * 380} 630 ${490 + i * 380} 660 L${500 + i * 380} 900Z" fill="#2f3d6b" stroke="#1b2442" stroke-width="3"/>`).join('')}`,
      `<path d="M120 820 L1980 820 L2120 900 L-20 900Z" fill="#6e4a33" stroke="#3f2a1d" stroke-width="3"/><path d="M120 820 L1980 820 L2000 834 L100 834Z" fill="#a0724f"/>`,
      haz(-300, t, '#fff2c4')],
    laboratorio: (h, t) => [pared('#cfe0e6', '#e6f1f4') + `${[0, 1, 2].map((i) => `<rect x="${200 + i * 640}" y="150" width="420" height="260" rx="8" fill="#1e2440" stroke="#7fd0ff" stroke-width="4"/>${Array.from({ length: 6 }, (_, j) => `<rect x="${230 + i * 640}" y="${180 + j * 36}" width="${120 + hash(i * 6 + j) * 220}" height="14" rx="7" fill="#7fd0ff" opacity="${0.4 + 0.4 * Math.abs(Math.sin(t * 2 + j + i))}"/>`).join('')}`).join('')}`,
      `${sueloInt('#a9bcc2', '#8ea1a8')}${[0, 1, 2, 3, 4].map((i) => `<g transform="translate(${360 + i * 300} 700)"><path d="M-22 -90 L22 -90 L22 -30 L58 60 L-58 60 L-22 -30Z" fill="#e8f6ff" stroke="#6a8fa8" stroke-width="3" opacity=".9"/><path d="M-40 20 L40 20 L58 60 L-58 60Z" fill="${['#3fe0a0', '#ff5a6a', '#7fd0ff', '#ffd34d', '#c88aff'][i]}"/><circle cx="${-10 + i}" cy="${10 - ((t * 30 + i * 20) % 60)}" r="5" fill="#fff" opacity=".7"/></g>`).join('')}`,
      `<rect x="160" y="760" width="1900" height="40" rx="8" fill="#5a6b72" stroke="#36444a" stroke-width="3"/>`,
      particulas(t, '#bfefff', 20, 2.5)],
    casa: (h, t) => [pared('#efd9c2', '#f8eadb') + ventana(1240, 150, 520, 420, h || 'dia', t) + `<rect x="240" y="200" width="300" height="220" fill="#f2c14e" stroke="#a8761c" stroke-width="4"/><rect x="262" y="222" width="256" height="176" fill="${grad('cuadro', [[0, '#7fd0ff'], [1, '#ffd2a0']])}"/>`,
      `${sueloInt('#b9906a', '#9a7454')}<g transform="translate(1500 900)"><path d="M-300 -60 L-300 -220 Q-300 -250 -270 -250 L270 -250 Q300 -250 300 -220 L300 -60Z" fill="#5f8ec0" stroke="#3a5a80" stroke-width="3"/><rect x="-330" y="-140" width="660" height="140" rx="30" fill="#6f9fd0" stroke="#3a5a80" stroke-width="3"/></g>${planta(160, 1.2)}<g transform="translate(560 900)"><rect x="-8" y="-380" width="16" height="380" fill="#3a3346"/><path d="M-80 -380 L80 -380 L50 -470 L-50 -470Z" fill="#ffd98a" stroke="#a8761c" stroke-width="3"/></g>`,
      `<ellipse cx="960" cy="1000" rx="760" ry="70" fill="#d26a4a" opacity=".55"/>`,
      haz(1240, t, '#fff2c4') + particulas(t, '#fff3c9', 22, 3)],
    tienda: (h, t) => [pared('#f4eadb', '#fffaf2') + `${[0, 1, 2].map((r) => `<rect x="100" y="${170 + r * 210}" width="2000" height="22" fill="#9a7454"/>${Array.from({ length: 15 }, (_, i) => `<rect x="${130 + i * 130}" y="${170 + r * 210 - 90 - hash(i + r * 9) * 40}" width="96" height="${90 + hash(i + r * 9) * 40}" rx="10" fill="${['#ff6b7a', '#3fc08a', '#ffd34d', '#5b7fe0', '#ff9fd0', '#ffa24f'][(i + r) % 6]}" stroke="#6b5b73" stroke-width="2.5"/>`).join('')}`).join('')}`,
      `${sueloInt('#e3dbd0', '#c9c0b4')}`,
      `<g transform="translate(1600 900)"><rect x="-190" y="-210" width="380" height="210" fill="#3d5a99" stroke="#24375f" stroke-width="3"/><rect x="-170" y="-280" width="140" height="74" rx="8" fill="#2c2f3a"/><rect x="-160" y="-270" width="120" height="40" rx="4" fill="#7fd0ff"/></g>`,
      `<rect x="-600" y="-900" width="3200" height="2100" fill="#eaffff" opacity=".05"/>`],
    banco: (h, t) => [pared('#e6dfd0', '#f4efe4') + `${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${120 + i * 340}" y="100" width="80" height="780" fill="#fbf8f2" stroke="#b9ad98" stroke-width="3"/><rect x="${120 + i * 340}" y="100" width="24" height="780" fill="#fff"/>`).join('')}`,
      `${sueloInt('#cfc6b4', '#b0a690')}<g transform="translate(1700 600)"><circle r="240" fill="#9aa6b3" stroke="#5c6670" stroke-width="5"/><circle r="180" fill="#c3ccd6" stroke="#5c6670" stroke-width="4"/>${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="0" y1="0" x2="0" y2="-160" stroke="#5c6670" stroke-width="10" stroke-linecap="round" transform="rotate(${i * 60 + t * 6})"/>`).join('')}<circle r="40" fill="#5c6670"/><path d="M-150 -120 Q-60 -200 60 -180" stroke="#fff" stroke-width="10" fill="none" opacity=".4" stroke-linecap="round"/></g>`,
      `<rect x="160" y="720" width="1140" height="200" fill="#6e4a33" stroke="#3f2a1d" stroke-width="3"/><rect x="140" y="700" width="1180" height="34" fill="#a0724f" stroke="#3f2a1d" stroke-width="3"/>`,
      haz(300, t, '#fff2c4')],
    fabrica: (h, t) => [pared('#b9b0a2', '#d6cdbf') + `${[0, 1, 2, 3].map((i) => `<rect x="${-200 + i * 620}" y="80" width="420" height="300" fill="${grad('vidrio', [[0, '#cfe6ff'], [1, '#fff3d6']])}" stroke="#5c5466" stroke-width="8"/>`).join('')}`,
      `${sueloInt('#8f8676', '#6f675a')}${[0, 1, 2].map((i) => `<g transform="translate(${460 + i * 620} 620) rotate(${t * 40 * (i % 2 ? -1 : 1)})"><circle r="110" fill="#8a96a3" stroke="#3f4650" stroke-width="5"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((j) => `<rect x="-14" y="-130" width="28" height="30" fill="#8a96a3" stroke="#3f4650" stroke-width="3" transform="rotate(${j * 45})"/>`).join('')}<circle r="32" fill="#3f4650"/></g>`).join('')}`,
      `<rect x="60" y="800" width="2100" height="50" rx="25" fill="#3a3346" stroke="#1d1924" stroke-width="3"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${((i * 170 + t * 120) % 2200)}" y="770" width="90" height="34" rx="4" fill="#ffd34d" stroke="#a8761c" stroke-width="2"/>`).join('')}`,
      haz(-200, t, '#fff2c4') + haz(1040, t + 1, '#fff2c4') + particulas(t, '#fff3c9', 30, 3)],
    estudio: (h, t) => [`<rect x="-600" y="-900" width="3200" height="2100" fill="${grad('estudio', [[0, '#2b2f6b'], [0.6, '#6b4fa0'], [1, '#e88aa8']])}"/>${Array.from({ length: 9 }, (_, i) => `<circle cx="${hash(i) * 2000}" cy="${hash(i + 4) * 900}" r="${80 + hash(i + 2) * 200}" fill="#fff" opacity=".05"/>`).join('')}`,
      `<ellipse cx="960" cy="905" rx="700" ry="60" fill="#1b1430" opacity=".25"/>${Array.from({ length: 6 }, (_, i) => `<g transform="translate(${200 + i * 300} ${300 + Math.sin(t + i) * 30}) rotate(${t * 20 + i * 40})"><rect x="-24" y="-24" width="48" height="48" rx="8" fill="none" stroke="#ffd34d" stroke-width="5" opacity=".5"/></g>`).join('')}`,
      `<rect x="-600" y="900" width="3200" height="400" fill="#1b1430" opacity=".25"/>`,
      particulas(t, '#ffe6f2', 40, 3.5)],
  };
  DEC.vacio = DEC.estudio;

  // ---------- dirección: planos ----------
  // Encuadres por altura del plano (en unidades del mundo). El ancho sale de la proporción de salida.
  function posPersonaje(e, id) { const i = (e.personajes || []).findIndex((p) => p.id === id); if (i < 0) return null; const p = e.personajes[i]; return { x: p.x ?? (i ? 1300 : 640), s: p.escala ?? 1, dir: p.mira === 'izq' ? -1 : 1, p }; }
  function posObjeto(e, id) { const m = /^obj(\d+)$/.exec(id || ''); const o = m ? (e.objetos || [])[Number(m[1])] : (e.objetos || []).find((x) => x.tipo === id); return o ? { x: o.x ?? 960, y: o.y ?? 560, s: o.escala ?? 1 } : null; }
  function autoPlanos(e, ctx) {
    const ps = e.personajes || [], h = ps.find((p) => p.habla) || ps[0], o = ps.find((p) => p !== h);
    const l = [];
    if (ctx.decoradoNuevo || !ps.length) l.push({ encuadre: ps.length > 1 ? 'conjunto' : 'general', mov: 'empuja' });
    if (h) l.push({ encuadre: 'medio', sujeto: h.id, mov: 'deriva' });
    if ((e.objetos || []).length) l.push({ encuadre: 'detalle', sujeto: 'obj0', mov: 'empuja' });
    if (o) l.push({ encuadre: 'hombro', sujeto: o.id, de: h.id, mov: 'deriva' });
    if (h) l.push({ encuadre: 'primer_plano', sujeto: h.id, mov: 'empuja' });
    return l.length ? l : [{ encuadre: 'general', mov: 'empuja' }];
  }
  function horario(e, dur, ctx) {
    const pl = (e.planos && e.planos.length ? e.planos : autoPlanos(e, ctx));
    const n = Math.max(1, Math.min(pl.length, Math.round(dur / 1.6))), usados = pl.slice(0, n);
    const pesos = usados.map((p) => p.dur ?? 1), tot = pesos.reduce((a, b) => a + b, 0);
    let t0 = 0; return usados.map((p, i) => { const d = (pesos[i] / tot) * dur, r = { ...p, t0, t1: t0 + d }; t0 += d; return r; });
  }
  function camaraPlano(p, e, k, t, ctx) {
    const A = ctx.vertical ? 9 / 16 : 16 / 9;
    const pj = p.sujeto ? posPersonaje(e, p.sujeto) : null, ob = !pj && p.sujeto ? posObjeto(e, p.sujeto) : null;
    const ps = e.personajes || [], xs = ps.map((q, i) => q.x ?? (i ? 1300 : 640)), media = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 960;
    let h = 1080, cx = 960, cy = 540, rot = 0;
    const cabeza = (q) => 900 - 652 * q.s, frente = (q) => 900 - 760 * q.s;
    switch (p.encuadre) {
      case 'conjunto': h = Math.min(1080, Math.max(760, (xs.length ? Math.max(...xs) - Math.min(...xs) + 700 : 900) / A)); cx = media; cy = 900 - h / 2 + 70; break;
      case 'medio': if (pj) { h = 640 * pj.s; cx = pj.x + pj.dir * 0.12 * h * A; cy = frente(pj) - 0.05 * h + h / 2; } break;
      case 'primer_plano': if (pj) { h = 300 * pj.s; cx = pj.x + 6 + pj.dir * 0.14 * h * A; cy = cabeza(pj) + 0.1 * h; } break;
      case 'extremo': if (pj) { h = 130 * pj.s; cx = pj.x + 10; cy = cabeza(pj) + 4; } break;
      case 'contrapicado': if (pj) { h = 820 * pj.s; cx = pj.x + pj.dir * 0.1 * h * A; cy = 900 - 470 * pj.s; rot = -4 * pj.dir; } break;
      case 'picado': if (pj) { h = 760 * pj.s; cx = pj.x; cy = 900 - 380 * pj.s; rot = 3; } break;
      case 'hombro': if (pj) { h = 560 * pj.s; cx = pj.x - pj.dir * 0.16 * h * A; cy = frente(pj) - 0.04 * h + h / 2; } break;
      case 'detalle': if (ob) { h = 380 * ob.s; cx = ob.x; cy = ob.y; } else if (pj) { h = 260 * pj.s; cx = pj.x + 120 * pj.s * pj.dir; cy = 900 - 470 * pj.s; } break;
      default: h = 1080; cx = ctx.vertical ? media : 960; cy = 540;
    }
    const m = p.mov || 'deriva', kk = easeIO(k);
    if (m === 'empuja') h *= lerp(1.08, 0.9, kk);
    else if (m === 'aleja') h *= lerp(0.9, 1.1, kk);
    else if (m === 'barrido') cx += lerp(-0.07, 0.07, kk) * h * A;
    else if (m === 'barrido_izq') cx += lerp(0.07, -0.07, kk) * h * A;
    else if (m === 'sube') cy += lerp(0.06, -0.06, kk) * h;
    else if (m === 'golpe') h *= 1 - 0.12 * Math.exp(-k * 7) * Math.cos(k * 20);
    else h *= lerp(1.02, 0.97, kk);
    const temb = (p.efecto === 'temblor' ? 0.012 * Math.exp(-((t - (p.t0 || 0)) * 2.5)) * 6 : 0) + 0.0035;
    cx += ruido(t * 1.3, 1) * temb * h; cy += ruido(t * 1.1, 5) * temb * h;
    if (p.angulo === 'holandes') rot += 5 * (pj?.dir || 1);
    return { cx, cy, h, w: h * A, rot };
  }

  // ---------- capas de pantalla ----------
  function lineasVelocidad(W, H, t, cx = W / 2, cy = H / 2) {
    const sem = Math.floor(t * 15);
    return Array.from({ length: 70 }, (_, i) => { const a = (i / 70) * Math.PI * 2 + hash(i + sem) * 0.08, r0 = Math.min(W, H) * (0.32 + hash(i * 3 + sem) * 0.12), r1 = Math.max(W, H);
      const w = 0.008 + hash(i + sem * 7) * 0.012; return `<path d="M${cx + Math.cos(a - w) * r1} ${cy + Math.sin(a - w) * r1} L${cx + Math.cos(a) * r0} ${cy + Math.sin(a) * r0} L${cx + Math.cos(a + w) * r1} ${cy + Math.sin(a + w) * r1}Z" fill="#fff" opacity=".85"/>`; }).join('');
  }
  function monedas(t, W, H) {
    return Array.from({ length: 30 }, (_, i) => { const x = hash(i) * W, v = H * (0.45 + hash(i + 50) * 0.5), t0 = hash(i + 99) * 1.6, y = -100 + (t - t0) * v; if (y < -100 || y > H + 100) return '';
      return `<g transform="translate(${x} ${y}) rotate(${(t * 220 + i * 40) % 360}) scale(${Math.abs(Math.cos(t * 4 + i))} 1)"><circle r="${H * 0.03}" fill="#f5c542" stroke="#a8761c" stroke-width="3"/><circle r="${H * 0.018}" fill="none" stroke="#fff4c2" stroke-width="3"/></g>`; }).join('');
  }
  function subtitulo(txt, t, dur, W, H, V) {
    const w = String(txt || '').replace(/\*/g, '').split(/\s+/).filter(Boolean); if (!w.length) return '';
    const pesos = w.map((p) => p.length + 2), tot = pesos.reduce((a, b) => a + b, 0), util = Math.max(0.5, dur - 0.25);
    let acc = 0; const ini = pesos.map((p) => { const s = (acc / tot) * util; acc += p; return s; });
    let cur = ini.findIndex((s, i) => t >= s && (i === w.length - 1 || t < ini[i + 1])); if (cur < 0) cur = 0;
    const tam = V ? 4 : 5, g = Math.floor(cur / tam), grupo = w.slice(g * tam, g * tam + tam), k = ease((t - ini[g * tam]) / 0.18);
    const fs = V ? H * 0.036 : H * 0.052, y = V ? H * 0.72 : H * 0.86;
    return `<g transform="translate(${W / 2} ${y}) scale(${0.85 + 0.15 * k})" font-weight="900" font-size="${fs}" text-anchor="middle" paint-order="stroke" stroke="#140c1c" stroke-width="${fs * 0.16}" stroke-linejoin="round">
      <text>${grupo.map((p, i) => `<tspan fill="${g * tam + i === cur ? '#ffd34d' : '#ffffff'}">${esc(p.toUpperCase())}</tspan>`).join(' ')}</text></g>`;
  }

  // ---------- fotograma ----------
  window.ANIME = function (e, t, dur, ctx) {
    DEFS = new Map();
    const V = !!ctx.vertical, W = V ? 1080 : 1920, H = V ? 1920 : 1080, hora = e.hora || 'dia';
    const plan = horario(e, dur, ctx), p = plan.find((q) => t >= q.t0 && t < q.t1) || plan.at(-1);
    const k = (t - p.t0) / Math.max(0.01, p.t1 - p.t0), cam = camaraPlano(p, e, k, t, ctx);
    let { cx, cy, h, w } = cam;
    cx = clamp(cx, -300 + w / 2, 2220 - w / 2); cy = clamp(cy, -500 + h / 2, 1180 - h / 2);
    const vb = [cx - w / 2, cy - h / 2, w, h];
    // transición de látigo al empezar el plano
    const dt = t - p.t0, latigo = p.transicion === 'latigo' && dt < 0.22 ? 1 - dt / 0.22 : 0;
    if (latigo) vb[0] += (p.desde_izq ? -1 : 1) * latigo * w * 0.5;
    const dec = (DEC[e.decorado] || DEC.estudio)(hora, t);
    const desenf = clamp((760 - h) / 110, 0, 5), fil = (n) => desenf > 0.3 ? `filter="url(#dof${n})"` : '';
    if (desenf > 0.3) { def('dof1', `<filter id="dof1" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(desenf * 1.2).toFixed(1)}"/></filter>`); def('dof2', `<filter id="dof2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(desenf * 0.7).toFixed(1)}"/></filter>`); }
    const par = (f) => `translate(${(cx - 960) * f} ${(cy - 540) * f * 0.5})`;
    const reparto = ctx.reparto || [];
    const actores = (e.personajes || []).map((ap, i) => {
      const dp = reparto.find((r) => r.id === ap.id) || { id: ap.id };
      let x = ap.x ?? (i ? 1300 : 640); const t0 = ap.entra ?? 0;
      if (ap.desde != null) x = lerp(ap.desde, x, easeIO((t - t0) / 1.2));
      const op = ap.entra != null ? ease((t - t0) / 0.3) : 1, s = ap.escala ?? 1, g = ap.mira === 'izq' ? -1 : 1;
      const mano = ap.sostiene ? `<g transform="scale(.42)">${objeto({ tipo: ap.sostiene }, t)}</g>` : '';
      const pose = ap.desde != null && t - t0 < 1.2 ? 'camina' : (ap.poses ? (ap.poses.filter((q) => t >= (q.t ?? 0)).at(-1)?.pose || ap.pose) : ap.pose);
      const expresion = ap.expresiones ? (ap.expresiones.filter((q) => t >= (q.t ?? 0)).at(-1)?.expresion || ap.expresion) : ap.expresion;
      return `<g opacity="${op}" transform="translate(${x} 900) scale(${g * s} ${s})">${personaje(dp, { ...ap, pose, expresion }, t, mano)}</g>`;
    }).join('');
    const objs = (e.objetos || []).map((o, i) => { const t0 = o.entra ?? 0.2 + i * 0.25, kk = ease((t - t0) / 0.35), s = (o.escala ?? 1) * (0.5 + 0.5 * kk) * (1 + Math.sin((t - t0) * 2.4) * 0.02), fl = Math.sin(t * 2 + i) * 6;
      return `<g opacity="${kk}" transform="translate(${o.x ?? 960} ${(o.y ?? 560) + fl + (1 - kk) * 40}) scale(${s})">${objeto(o, t - t0)}</g>`; }).join('');
    // primer término por encima del hombro: el otro personaje, grande y desenfocado en el borde del encuadre
    let hombro = '';
    if (p.encuadre === 'hombro' && p.de) { const q = posPersonaje(e, p.de), dp = reparto.find((r) => r.id === p.de) || { id: p.de };
      if (q) { const lado = posPersonaje(e, p.sujeto)?.x < q.x ? 1 : -1, sF = (h / 560) * 1.25, xf = cx + lado * w * 0.42, yf = cy + h * 1.05;
        def('fg', `<filter id="fg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(5 * sF).toFixed(1)}"/></filter>`);
        hombro = `<g filter="url(#fg)" transform="translate(${xf} ${yf}) scale(${-lado * sF} ${sF})">${personaje(dp, { ...(q.p), habla: false }, t)}</g>`; } }
    const efectos = (p.efecto === 'lineas' || e.efecto === 'lineas') ? lineasVelocidad(W, H, t) : '';
    const lluvia = e.efecto === 'lluvia_monedas' ? monedas(t, W, H) : '';
    const flash = p.efecto === 'flash' && dt < 0.3 ? `<rect width="${W}" height="${H}" fill="#fff" opacity="${1 - dt / 0.3}"/>` : '';
    // rótulo de lugar/fecha
    const rot = e.rotulo ? (() => { const kk = ease((t - 0.15) / 0.4), fs = V ? 42 : 36, ww = e.rotulo.length * fs * 0.56 + 70; return `<g transform="translate(${(V ? 50 : 70) - (1 - kk) * 500} ${V ? 230 : 90}) skewX(-12)" opacity="${kk}"><rect width="${ww}" height="${fs * 1.9}" fill="#140c1c" opacity=".82"/><rect width="10" height="${fs * 1.9}" fill="#ffd34d"/><text x="34" y="${fs * 1.3}" font-size="${fs}" font-weight="800" fill="#fff" letter-spacing="1">${esc(e.rotulo)}</text></g>`; })() : '';
    const dato = e.dato ? (() => { const t0 = e.dato.entra ?? 0.6, kk = ease((t - t0) / 0.3), pop = 1 + 0.25 * Math.exp(-(t - t0) * 6) * Math.sin((t - t0) * 18), fs = V ? 150 : 170;
      const m = String(e.dato.valor).match(/^(\D*)([\d.,]+)(.*)$/); let val = e.dato.valor; if (m) { const limpio = m[2].replace(/[.,](?=\d{3}\b)/g, ''), dec2 = (limpio.split(/[.,]/)[1] || '').length; val = m[1] + (parseFloat(limpio.replace(',', '.')) * ease((t - t0) / 1)).toLocaleString('es', { minimumFractionDigits: dec2, maximumFractionDigits: dec2 }) + m[3]; }
      const x = V ? W / 2 : (e.dato.lado === 'izq' ? W * 0.27 : W * 0.73), y = V ? H * 0.3 : H * 0.36;
      return t < t0 ? '' : `<g transform="translate(${x} ${y}) scale(${kk * pop}) rotate(-3)"><g opacity=".9">${Array.from({ length: 16 }, (_, i) => `<path d="M0 0 L${Math.cos(i / 16 * 6.283 - 0.08) * 420} ${Math.sin(i / 16 * 6.283 - 0.08) * 420} L${Math.cos(i / 16 * 6.283 + 0.08) * 420} ${Math.sin(i / 16 * 6.283 + 0.08) * 420}Z" fill="#ffd34d" opacity="${0.18 + 0.1 * Math.sin(t * 6 + i)}"/>`).join('')}</g>
        <text y="${fs * 0.3}" text-anchor="middle" font-size="${fs}" font-weight="900" fill="${grad('datoG', [[0, '#fff6c2'], [0.5, '#ffd34d'], [1, '#ff9a3c']])}" stroke="#140c1c" stroke-width="${fs * 0.09}" paint-order="stroke" stroke-linejoin="round">${esc(val)}</text>
        ${e.dato.etiqueta ? `<g transform="translate(0 ${fs * 0.75})"><rect x="${-e.dato.etiqueta.length * 13 - 30}" y="-36" width="${e.dato.etiqueta.length * 26 + 60}" height="56" rx="10" fill="#140c1c" opacity=".85"/><text y="4" text-anchor="middle" font-size="34" font-weight="800" fill="#fff">${esc(e.dato.etiqueta)}</text></g>` : ''}</g>`; })() : '';
    // bocadillo en pantalla, junto a la cabeza de quien habla
    const boc = e.bocadillo ? (() => { const q = posPersonaje(e, e.bocadillo.de) || posPersonaje(e, (e.personajes || [])[0]?.id); if (!q) return '';
      const t0 = e.bocadillo.entra ?? 0.4, kk = ease((t - t0) / 0.25); if (t < t0) return '';
      const sx = ((q.x - vb[0]) / vb[2]) * W, sy = ((900 - 700 * q.s - vb[1]) / vb[3]) * H, fs = V ? 44 : 40;
      const lineas = []; let cur = ''; for (const pal of e.bocadillo.texto.split(' ')) { if ((cur + ' ' + pal).length > 22) { lineas.push(cur); cur = pal; } else cur = (cur + ' ' + pal).trim(); } lineas.push(cur);
      const bw = Math.max(...lineas.map((l) => l.length)) * fs * 0.56 + 70, bh = lineas.length * fs * 1.2 + 50;
      const bx = clamp(sx + (e.bocadillo.lado === 'izq' ? -bw * 0.6 : bw * 0.6), bw / 2 + 30, W - bw / 2 - 30), by = clamp(sy - bh * 0.9, 40, H * 0.55);
      return `<g transform="translate(${bx} ${by}) scale(${0.7 + 0.3 * kk})" opacity="${kk}"><path d="M${clamp(sx - bx, -bw / 2 + 40, bw / 2 - 40) - 20} ${bh / 2 - 4} L${clamp(sx - bx, -bw / 2 + 30, bw / 2 - 30)} ${Math.min(bh / 2 + 70, sy - by)} L${clamp(sx - bx, -bw / 2 + 40, bw / 2 - 40) + 24} ${bh / 2 - 4}Z" fill="#fff" stroke="#140c1c" stroke-width="5"/><rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2.4}" fill="#fff" stroke="#140c1c" stroke-width="5"/><rect x="${-bw / 2 + 6}" y="${bh / 2 - 14}" width="${bw - 12}" height="10" fill="#fff"/>
        ${lineas.map((l, i) => `<text y="${(i - (lineas.length - 1) / 2) * fs * 1.2 + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#140c1c">${esc(l)}</text>`).join('')}</g>`; })() : '';
    const sub = e.subtitulos === false ? '' : subtitulo(ctx.narracion, t, dur, W, H, V);
    const tinte = HORAS[hora]?.tinte || 0;
    const mundo = `<g transform="rotate(${cam.rot} ${cx} ${cy})">
        <g transform="${par(0.55)}" ${fil(1)}>${dec[0]}</g><g transform="${par(0.25)}" ${fil(2)}>${dec[1]}</g>
        <g>${dec[2]}${objs}${actores}</g><g>${dec[3] || ''}</g>${hombro}</g>`;
    const defs = `<defs>${[...DEFS.values()].join('')}</defs>`;
    return `<svg xmlns="${NS}" viewBox="${vb.map((n) => n.toFixed(1)).join(' ')}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui">${defs}${mundo}</svg>
      <svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui">
        <defs><radialGradient id="vin" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#140c1c" stop-opacity="0"/><stop offset="1" stop-color="#140c1c" stop-opacity=".42"/></radialGradient>
        <linearGradient id="luzG" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HORAS[hora]?.luz || '#fff3c9'}" stop-opacity=".28"/><stop offset=".5" stop-color="${HORAS[hora]?.luz || '#fff3c9'}" stop-opacity="0"/></linearGradient>
        ${latigo ? `<filter id="lat"><feGaussianBlur stdDeviation="${60 * latigo} 0"/></filter>` : ''}</defs>
        <rect width="${W}" height="${H}" fill="url(#luzG)" style="mix-blend-mode:screen"/>${tinte ? `<rect width="${W}" height="${H}" fill="#3a2a6b" opacity="${tinte * 0.5}" style="mix-blend-mode:multiply"/>` : ''}
        ${efectos}${lluvia}<rect width="${W}" height="${H}" fill="url(#vin)"/>${rot}${dato}${boc}${sub}${flash}
        ${latigo ? `<rect width="${W}" height="${H}" fill="#fff" opacity="${latigo * 0.25}"/>` : ''}</svg>`;
  };
  // Momentos de sonido de la escena (relativos a su inicio): barridos en los látigos, golpes en los destellos, «pop» en los datos.
  window.ANIME_SONIDOS = function (e, dur, ctx) {
    const s = [];
    for (const p of horario(e, dur, ctx)) { if (p.transicion === 'latigo') s.push({ t: p.t0, tipo: 'barrido' }); if (p.efecto === 'flash' || p.mov === 'golpe') s.push({ t: p.t0, tipo: 'golpe' }); }
    if (e.dato) s.push({ t: e.dato.entra ?? 0.6, tipo: 'pop' });
    return s;
  };
  // Hoja de personajes: cuerpo entero y tres primeros planos de expresión.
  window.ANIME_REPARTO = function (reparto, t) {
    DEFS = new Map(); const n = reparto.length, col = 1920 / n;
    const cuerpo = reparto.map((r, i) => `<g transform="translate(${col * (i + 0.5)} 760) scale(.72)">${personaje(r, { pose: 'explica', expresion: 'feliz' }, t)}</g>`).join('');
    const caras = reparto.map((r, i) => ['sorprendido', 'enfadado', 'triste'].map((ex, j) => `<svg x="${col * i + col * 0.5 - 165 + j * 110}" y="820" width="100" height="100" viewBox="${-80} ${-760} 160 160"><rect x="-80" y="-760" width="160" height="160" rx="20" fill="#fff" opacity=".6"/>${personaje(r, { pose: 'de_pie', expresion: ex }, t)}</svg>`).join('')).join('');
    const nombres = reparto.map((r, i) => `<text x="${col * (i + 0.5)} " y="96" text-anchor="middle" font-size="44" font-weight="800" fill="#fff">${esc(r.nombre || r.id)}</text><text x="${col * (i + 0.5)}" y="140" text-anchor="middle" font-size="26" fill="#e9e3ff">${esc(r.papel || '')}</text>`).join('');
    const fondo = DEC.estudio('dia', t)[0], body = cuerpo + caras + nombres;
    return `<svg xmlns="${NS}" viewBox="0 0 1920 1080" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui"><defs>${[...DEFS.values()].join('')}</defs>${fondo}${body}</svg>`;
  };
})();
