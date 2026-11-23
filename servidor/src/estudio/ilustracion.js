// Escenas ilustradas del Estudio (estilo «risografía»: papel cálido, trazo de tinta, tintas planas y grano).
// Personajes paramétricos (piel, pelo, ropa, gafas, edad) con poses, expresiones, parpadeo, respiración y boca que habla;
// decorados en capas con cámara (acercamiento, paneo) y paralaje; objetos animados; rótulos, bocadillos y datos.
// Todo depende solo del tiempo t: el mismo t da el mismo fotograma. Mundo de 1920×1080; el suelo está en y = 900.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (strings, ...v) => strings.reduce((a, s, i) => a + s + (i < v.length ? v[i] : ''), '');
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeIO = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const lerp = (a, b, k) => a + (b - a) * k;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const T = 'stroke="var(--ink)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';

  // ---------- personajes ----------
  const PIEL = { clara: '#f1c9a5', media: '#d9a07a', morena: '#b07650', oscura: '#7a4b31' };
  const oscurecer = (hex, k = 0.25) => { const n = parseInt(hex.slice(1), 16); const f = (c) => Math.round(((n >> c) & 255) * (1 - k)); return `rgb(${f(16)},${f(8)},${f(0)})`; };
  // Brazos: [hombro, codo] en grados (0 = colgando hacia abajo; positivo = hacia delante/arriba por el lado del brazo).
  const POSES = {
    de_pie: { i: [8, 6], d: [8, 6] }, senala: { i: [10, 8], d: [115, 10] }, manos_arriba: { i: [155, 20], d: [155, 20] },
    piensa: { i: [10, 8], d: [40, 125] }, brazos_cruzados: { i: [55, 110], d: [55, 110], cruzados: true }, saluda: { i: [8, 6], d: [150, 35] },
    sostiene: { i: [8, 6], d: [55, 50] }, explica: { i: [45, 40], d: [45, 40] }, camina: { i: [8, 6], d: [8, 6], camina: true }, celebra: { i: [165, 0], d: [165, 0] },
  };
  const CEJAS = { neutral: [0, 0], feliz: [5, 7], preocupado: [14, 4], sorprendido: [6, 16], enfadado: [-16, 0], triste: [16, 0], pensativo: [8, -4] }; // [inclinación, altura]
  function boca(expr, habla, t, semilla) {
    if (habla) { const a = Math.abs(Math.sin(t * 11 + semilla)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.7 + semilla))); return `<ellipse cx="0" cy="-520" rx="${14 + a * 4}" ry="${3 + a * 13}" fill="#5a1f1a" ${T} stroke-width="4"/>`; }
    return {
      feliz: '<path d="M-22 -526 Q0 -500 22 -526" fill="none" ' + T + '/>', sorprendido: '<ellipse cx="0" cy="-518" rx="11" ry="15" fill="#5a1f1a" ' + T + ' stroke-width="4"/>',
      preocupado: '<path d="M-18 -512 Q0 -526 18 -512" fill="none" ' + T + '/>', triste: '<path d="M-20 -510 Q0 -528 20 -510" fill="none" ' + T + '/>',
      enfadado: '<path d="M-20 -514 L20 -514" fill="none" ' + T + '/>', pensativo: '<path d="M-14 -516 Q6 -522 18 -512" fill="none" ' + T + '/>',
    }[expr] || '<path d="M-16 -518 Q0 -510 16 -518" fill="none" ' + T + '/>';
  }
  function pelo(p, color) {
    const c = color || '#2b211c';
    return {
      corto: `<path d="M-74 -585 Q-70 -660 0 -664 Q70 -660 74 -585 Q60 -628 0 -630 Q-60 -628 -74 -585Z" fill="${c}" ${T}/>`,
      largo: `<path d="M-80 -580 Q-82 -668 0 -668 Q82 -668 80 -580 L86 -470 Q70 -480 66 -560 Q50 -628 0 -630 Q-50 -628 -66 -560 Q-70 -480 -86 -470Z" fill="${c}" ${T}/>`,
      rizado: `<path d="M-84 -590 q-14 -40 18 -62 q8 -34 46 -30 q22 -24 52 -4 q36 -6 44 30 q34 22 12 62 q-30 -40 -86 -40 q-56 0 -86 44Z" fill="${c}" ${T}/>`,
      moño: `<circle cx="0" cy="-690" r="30" fill="${c}" ${T}/><path d="M-74 -585 Q-72 -662 0 -664 Q72 -662 74 -585 Q58 -630 0 -632 Q-58 -630 -74 -585Z" fill="${c}" ${T}/>`,
      calvo: `<path d="M-74 -560 Q-80 -600 -64 -610 M74 -560 Q80 -600 64 -610" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`,
      canas: `<path d="M-74 -585 Q-70 -660 0 -664 Q70 -660 74 -585 Q60 -628 0 -630 Q-60 -628 -74 -585Z" fill="#d8d4cc" ${T}/>`,
      gorra: `<path d="M-76 -592 Q-72 -666 0 -668 Q72 -666 76 -592Z" fill="${c}" ${T}/><path d="M40 -600 L130 -596 L40 -582Z" fill="${c}" ${T}/>`,
    }[p] || '';
  }
  function brazo(lado, [a1, a2], ropa, piel, objeto) {
    const s = lado === 'i' ? -1 : 1, x = s * 82;
    const mano = objeto ? `<g transform="translate(0 112) rotate(${s * (a1 + a2)})">${objeto}</g>` : '';
    return `<g transform="translate(${x} -452) rotate(${-s * a1})">
      <rect x="-19" y="-6" width="38" height="112" rx="19" fill="${ropa}" ${T}/>
      <g transform="translate(0 98) rotate(${-s * a2})"><rect x="-17" y="-8" width="34" height="100" rx="17" fill="${ropa}" ${T}/><circle cx="0" cy="98" r="21" fill="${piel}" ${T}/>${mano}</g></g>`;
  }
  function personaje(def, ap, t) {
    const piel = PIEL[def.piel] || def.piel || PIEL.media, ropa = def.ropa?.color || '#1d3b6e', pant = def.ropa?.pantalon || '#2a2a33';
    const pose = POSES[ap.pose] || POSES.de_pie, expr = ap.expresion || 'neutral', semilla = (def.id || 'x').length * 1.7;
    const resp = Math.sin(t * 2.2 + semilla) * 4, parpadeo = ((t + semilla) % 3.7) < 0.13 ? 0.12 : 1;
    const paso = pose.camina ? Math.sin(t * 8) * 22 : 0;
    const [ci, ch] = CEJAS[expr] || CEJAS.neutral;
    const tipo = def.ropa?.tipo || 'camisa';
    const largoTorso = tipo === 'vestido' ? 330 : tipo === 'bata' ? 300 : 230;
    const torso = tipo === 'vestido' ? `<path d="M-92 -470 Q0 -488 92 -470 L130 -150 L-130 -150Z" fill="${ropa}" ${T}/>`
      : `<rect x="-95" y="-472" width="190" height="${largoTorso}" rx="34" fill="${ropa}" ${T}/>`;
    const detalle = {
      traje: `<path d="M-30 -470 L0 -400 L30 -470" fill="#f3efe6" ${T}/><path d="M0 -440 L-12 -360 L0 -330 L12 -360Z" fill="${def.ropa?.corbata || '#f0624d'}" ${T}/>`,
      bata: `<path d="M-24 -470 L0 -380 L24 -470" fill="${def.ropa?.debajo || '#3a9a7a'}" ${T}/><line x1="0" y1="-380" x2="0" y2="-180" ${T}/>`,
      sudadera: `<path d="M-40 -470 Q0 -430 40 -470" fill="none" ${T}/><rect x="-46" y="-330" width="92" height="44" rx="14" fill="none" ${T}/>`,
      camisa: `<path d="M-26 -470 L0 -440 L26 -470" fill="none" ${T}/><circle cx="0" cy="-410" r="4" fill="var(--ink)"/><circle cx="0" cy="-370" r="4" fill="var(--ink)"/>`,
    }[tipo] || '';
    const piernas = tipo === 'vestido' ? `<rect x="-46" y="-150" width="30" height="150" rx="14" fill="${piel}" ${T}/><rect x="16" y="-150" width="30" height="150" rx="14" fill="${piel}" ${T}/>`
      : `<g transform="rotate(${paso} -30 -250)"><rect x="-58" y="-260" width="44" height="260" rx="20" fill="${pant}" ${T}/></g><g transform="rotate(${-paso} 30 -250)"><rect x="14" y="-260" width="44" height="260" rx="20" fill="${pant}" ${T}/></g>`;
    const objeto = ap.sostiene ? OBJ[ap.sostiene]?.(t, 0.45) : '';
    const gafas = def.gafas ? `<circle cx="-27" cy="-562" r="18" fill="rgba(255,255,255,.25)" ${T} stroke-width="4"/><circle cx="27" cy="-562" r="18" fill="rgba(255,255,255,.25)" ${T} stroke-width="4"/><line x1="-9" y1="-562" x2="9" y2="-562" ${T} stroke-width="4"/>` : '';
    const vello = def.bigote ? `<path d="M-24 -532 Q0 -548 24 -532 Q0 -538 -24 -532Z" fill="${def.pelo?.color || '#2b211c'}" ${T} stroke-width="3"/>` : def.barba ? `<path d="M-64 -560 Q-66 -478 0 -470 Q66 -478 64 -560 Q50 -520 0 -514 Q-50 -520 -64 -560Z" fill="${def.pelo?.color || '#2b211c'}" ${T}/>` : '';
    const arrugas = def.edad === 'mayor' ? `<path d="M-48 -598 Q-36 -604 -24 -598 M24 -598 Q36 -604 48 -598" fill="none" stroke="var(--ink)" stroke-width="3"/>` : '';
    const brazos = pose.cruzados
      ? `<rect x="-110" y="-410" width="220" height="56" rx="28" fill="${ropa}" ${T}/><circle cx="-100" cy="-382" r="21" fill="${piel}" ${T}/><circle cx="100" cy="-382" r="21" fill="${piel}" ${T}/>`
      : brazo('i', pose.i, ropa, piel) + brazo('d', pose.d, ropa, piel, objeto);
    return `<g>
      <ellipse cx="0" cy="6" rx="120" ry="18" fill="var(--ink)" opacity=".12"/>
      ${piernas}<ellipse cx="-36" cy="0" rx="38" ry="16" fill="var(--ink)"/><ellipse cx="36" cy="0" rx="38" ry="16" fill="var(--ink)"/>
      <g transform="translate(0 ${resp * 0.4})">${pose.cruzados ? torso + detalle + brazos : brazos + torso + detalle}
        <rect x="-20" y="-500" width="40" height="40" fill="${piel}" ${T}/>
        <g transform="translate(0 ${resp * 0.6}) rotate(${expr === 'pensativo' ? -6 : expr === 'triste' ? 4 : 0} 0 -540)">
          <ellipse cx="0" cy="-560" rx="74" ry="84" fill="${piel}" ${T}/>
          <ellipse cx="-74" cy="-556" rx="12" ry="18" fill="${piel}" ${T}/><ellipse cx="74" cy="-556" rx="12" ry="18" fill="${piel}" ${T}/>
          ${pelo(def.pelo?.estilo || 'corto', def.pelo?.color)}${arrugas}
          <g transform="translate(-27 -564) scale(1 ${parpadeo})"><ellipse rx="8" ry="${expr === 'sorprendido' ? 12 : 9}" fill="var(--ink)"/></g>
          <g transform="translate(27 -564) scale(1 ${parpadeo})"><ellipse rx="8" ry="${expr === 'sorprendido' ? 12 : 9}" fill="var(--ink)"/></g>
          <line x1="-42" y1="${-592 - ch + ci * 0.4}" x2="-14" y2="${-592 - ch - ci * 0.6}" ${T} stroke-width="6"/><line x1="14" y1="${-592 - ch - ci * 0.6}" x2="42" y2="${-592 - ch + ci * 0.4}" ${T} stroke-width="6"/>
          ${gafas}${vello}${boca(expr, ap.habla, t, semilla)}
          ${expr === 'feliz' || expr === 'sorprendido' ? '<circle cx="-46" cy="-530" r="10" fill="#f0624d" opacity=".35"/><circle cx="46" cy="-530" r="10" fill="#f0624d" opacity=".35"/>' : ''}
        </g></g></g>`;
  }

  // ---------- objetos ----------
  const OBJ = {
    camara: (t, s = 1) => `<g transform="scale(${s})"><rect x="-70" y="-46" width="140" height="92" rx="12" fill="#2a2a33" ${T}/><rect x="-40" y="-60" width="44" height="18" rx="4" fill="#2a2a33" ${T}/><circle cx="0" cy="0" r="30" fill="#1d3b6e" ${T}/><circle cx="0" cy="0" r="12" fill="#9fc3e8"/></g>`,
    monedas: (t, s = 1) => `<g transform="scale(${s})">${[0, 1, 2, 3].map((i) => `<ellipse cx="0" cy="${-i * 18}" rx="56" ry="20" fill="#f2c14e" ${T}/>`).join('')}</g>`,
    billete: (t, s = 1) => `<g transform="scale(${s}) rotate(-8)"><rect x="-90" y="-44" width="180" height="88" rx="8" fill="#7cc49f" ${T}/><circle r="26" fill="none" ${T}/><text y="10" text-anchor="middle" font-size="34" font-weight="800" fill="var(--ink)">$</text></g>`,
    documento: (t, s = 1) => `<g transform="scale(${s}) rotate(4)"><rect x="-70" y="-90" width="140" height="180" rx="6" fill="#fffaf0" ${T}/>${[0, 1, 2, 3, 4].map((i) => `<line x1="-46" y1="${-56 + i * 26}" x2="${i === 4 ? 10 : 46}" y2="${-56 + i * 26}" ${T} stroke-width="4"/>`).join('')}</g>`,
    telefono: (t, s = 1) => `<g transform="scale(${s})"><rect x="-38" y="-70" width="76" height="140" rx="14" fill="#2a2a33" ${T}/><rect x="-28" y="-56" width="56" height="104" rx="6" fill="#9fc3e8"/></g>`,
    laptop: (t, s = 1) => `<g transform="scale(${s})"><rect x="-110" y="-120" width="220" height="140" rx="10" fill="#2a2a33" ${T}/><rect x="-96" y="-106" width="192" height="112" fill="#9fc3e8"/><path d="M-140 20 L140 20 L120 40 L-120 40Z" fill="#b9b2a6" ${T}/></g>`,
    tele: (t, s = 1) => `<g transform="scale(${s})"><rect x="-130" y="-110" width="260" height="200" rx="26" fill="#8a5a3b" ${T}/><rect x="-104" y="-86" width="170" height="150" rx="30" fill="#5c6670" ${T}/><rect x="-84" y="-66" width="130" height="110" rx="20" fill="#9aa3ad" opacity="${0.6 + 0.4 * Math.abs(Math.sin(t * 9))}"/><circle cx="96" cy="-50" r="12" fill="#2a2a33"/><circle cx="96" cy="-10" r="12" fill="#2a2a33"/><path d="M-60 90 L-80 130 M60 90 L80 130" ${T}/></g>`,
    lata: (t, s = 1, o = {}) => `<g transform="scale(${s})"><rect x="-50" y="-90" width="100" height="180" rx="16" fill="${o.color || '#d8322b'}" ${T}/><rect x="-40" y="-104" width="80" height="20" rx="6" fill="#b9c0c8" ${T}/><path d="M-50 -10 Q0 -40 50 -10 L50 20 Q0 -10 -50 20Z" fill="#fffaf0"/>${o.texto ? `<text y="62" text-anchor="middle" font-size="26" font-weight="800" fill="#fffaf0">${esc(o.texto)}</text>` : ''}</g>`,
    cartel: (t, s = 1, o = {}) => `<g transform="scale(${s}) rotate(${Math.sin(t * 3) * 4})"><rect x="-8" y="0" width="16" height="260" fill="#8a5a3b" ${T}/><rect x="-170" y="-150" width="340" height="160" rx="8" fill="#fffaf0" ${T}/>${String(o.texto || '').split('|').map((l, i, arr) => `<text y="${-70 + (i - (arr.length - 1) / 2) * 44 + 14}" text-anchor="middle" font-size="40" font-weight="800" fill="var(--ink)">${esc(l)}</text>`).join('')}</g>`,
    bombilla: (t, s = 1) => { const on = clamp((t - 0.6) * 3); return `<g transform="scale(${s})"><circle cy="-30" r="${60 + on * 30}" fill="#f2c14e" opacity="${on * 0.35}"/><circle cy="-30" r="50" fill="${on > 0.5 ? '#f2c14e' : '#fffaf0'}" ${T}/><rect x="-22" y="16" width="44" height="34" rx="6" fill="#b9b2a6" ${T}/></g>`; },
    tarjeta: (t, s = 1) => `<g transform="scale(${s}) rotate(-10)"><rect x="-96" y="-60" width="192" height="120" rx="14" fill="#f0624d" ${T}/><rect x="-70" y="-24" width="40" height="30" rx="4" fill="#f2c14e" ${T} stroke-width="3"/><line x1="-70" y1="34" x2="40" y2="34" ${T} stroke-width="4"/></g>`,
    hucha: (t, s = 1) => `<g transform="scale(${s})"><ellipse cx="0" cy="0" rx="110" ry="80" fill="#f4a3b4" ${T}/><circle cx="96" cy="-10" r="26" fill="#f4a3b4" ${T}/><rect x="-24" y="-82" width="48" height="12" rx="6" fill="var(--ink)"/><rect x="-70" y="60" width="26" height="40" rx="8" fill="#f4a3b4" ${T}/><rect x="40" y="60" width="26" height="40" rx="8" fill="#f4a3b4" ${T}/><circle cx="60" cy="-26" r="6" fill="var(--ink)"/></g>`,
    reloj: (t, s = 1) => `<g transform="scale(${s})"><circle r="70" fill="#fffaf0" ${T}/><line x1="0" y1="0" x2="0" y2="-44" ${T} stroke-width="6" transform="rotate(${t * 40})"/><line x1="0" y1="0" x2="30" y2="0" ${T} stroke-width="6" transform="rotate(${t * 4})"/></g>`,
    maletin: (t, s = 1) => `<g transform="scale(${s})"><rect x="-90" y="-60" width="180" height="120" rx="12" fill="#8a5a3b" ${T}/><rect x="-30" y="-84" width="60" height="28" rx="8" fill="none" ${T}/></g>`,
    pregunta: (t, s = 1) => `<g transform="scale(${s}) translate(0 ${Math.sin(t * 3) * 8})"><text y="40" text-anchor="middle" font-size="160" font-weight="800" fill="#f0624d" stroke="var(--ink)" stroke-width="5">?</text></g>`,
  };
  // Gráfico de línea que se dibuja (sube o baja).
  function grafico(dir, t, w = 520, h = 300) {
    const n = 7, pts = Array.from({ length: n }, (_, i) => { const base = dir === 'baja' ? 1 - i / (n - 1) : i / (n - 1); return [i * (w / (n - 1)), h - (base * 0.8 + hash(i + (dir === 'baja' ? 9 : 3)) * 0.2) * h]; });
    const k = ease((t - 0.3) / 1.6), corte = k * (n - 1), vis = pts.filter((_, i) => i <= corte);
    if (corte % 1 && pts[Math.ceil(corte)]) { const a = pts[Math.floor(corte)], b = pts[Math.ceil(corte)], f = corte % 1; vis.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]); }
    const col = dir === 'baja' ? '#f0624d' : '#3a9a7a';
    return `<rect x="-30" y="-30" width="${w + 60}" height="${h + 60}" rx="16" fill="#fffaf0" ${T}/><line x1="0" y1="${h}" x2="${w}" y2="${h}" ${T} stroke-width="3"/>
      <polyline points="${vis.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>${vis.length ? `<circle cx="${vis.at(-1)[0]}" cy="${vis.at(-1)[1]}" r="14" fill="${col}" ${T}/>` : ''}`;
  }
  // Monedas que caen (partículas deterministas).
  function lluvia(t, cuantas = 26) {
    return Array.from({ length: cuantas }, (_, i) => { const x = hash(i) * 1920, v = 500 + hash(i + 50) * 500, t0 = hash(i + 99) * 1.6, y = -120 + (t - t0) * v; if (y < -120 || y > 1150) return '';
      return `<g transform="translate(${x} ${y}) rotate(${(t * 200 + i * 40) % 360})"><ellipse rx="34" ry="34" fill="#f2c14e" ${T}/><text y="13" text-anchor="middle" font-size="36" font-weight="800" fill="var(--ink)">$</text></g>`; }).join('');
  }

  // ---------- decorados (tres capas: fondo, medio, delante) ----------
  const papel = '#efe9df';
  const DEC = {
    oficina: () => [
      `<rect width="2400" height="1100" fill="#e3dccf"/><rect x="900" y="120" width="620" height="420" fill="#9fc3e8" ${T}/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${930 + i * 118}" y="${300 - hash(i) * 120}" width="90" height="${240 + hash(i) * 120}" fill="#5f86b8"/>`).join('')}<line x1="1210" y1="120" x2="1210" y2="540" ${T}/><line x1="900" y1="330" x2="1520" y2="330" ${T}/>`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#c9bfae"/><g transform="translate(300 900)"><rect x="-30" y="-180" width="60" height="180" fill="#8a5a3b" ${T}/><ellipse cx="0" cy="-230" rx="90" ry="70" fill="#3a9a7a" ${T}/></g><g transform="translate(1700 900)"><rect x="-110" y="-360" width="220" height="360" fill="#d6cdbd" ${T}/>${[0, 1, 2].map((i) => `<line x1="-110" y1="${-260 + i * 100}" x2="110" y2="${-260 + i * 100}" ${T}/>`).join('')}</g>`,
      `<rect x="1150" y="760" width="760" height="40" rx="8" fill="#8a5a3b" ${T}/><rect x="1180" y="800" width="30" height="140" fill="#8a5a3b" ${T}/><rect x="1850" y="800" width="30" height="140" fill="#8a5a3b" ${T}/><g transform="translate(1500 760)">${OBJ.laptop(0, 0.8)}</g>`,
    ],
    despacho: () => { const o = DEC.oficina(); return [o[0].replace(/#9fc3e8/g, '#c9dcc0'), o[1], `<rect x="1150" y="760" width="760" height="40" rx="8" fill="#6e4a33" ${T}/><rect x="1180" y="800" width="30" height="140" fill="#6e4a33" ${T}/><rect x="1850" y="800" width="30" height="140" fill="#6e4a33" ${T}/><g transform="translate(1420 735)"><rect x="-70" y="-30" width="140" height="40" rx="10" fill="#2a2a33" ${T}/><path d="M-60 -30 Q0 -80 60 -30" fill="none" ${T} stroke-width="14"/></g><g transform="translate(1700 700) scale(.5)">${OBJ.documento(0, 1)}</g>`]; },
    sala_juntas: () => [
      `<rect width="2400" height="1100" fill="#ddd4c4"/><rect x="760" y="140" width="700" height="400" rx="10" fill="#2a2a33" ${T}/><g transform="translate(850 210)">${grafico('sube', 3, 520, 280).replace(/#fffaf0/g, '#3a3f4a')}</g>`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#b9ad98"/>${[0, 1, 2, 3].map((i) => `<rect x="${380 + i * 380}" y="640" width="120" height="260" rx="20" fill="#1d3b6e" ${T}/>`).join('')}`,
      `<path d="M220 820 L2000 820 L2120 900 L100 900Z" fill="#8a5a3b" ${T}/>`,
    ],
    laboratorio: () => [
      `<rect width="2400" height="1100" fill="#dfe6e3"/>${[0, 1, 2].map((i) => `<rect x="${200 + i * 640}" y="160" width="420" height="260" fill="#f6f2ea" ${T}/>`).join('')}`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#b8c3bf"/>${[0, 1, 2, 3, 4].map((i) => `<g transform="translate(${360 + i * 300} 700)"><path d="M-24 -90 L24 -90 L24 -30 L60 60 L-60 60 L-24 -30Z" fill="${['#7cc49f', '#f0624d', '#9fc3e8', '#f2c14e', '#f4a3b4'][i]}" ${T}/></g>`).join('')}`,
      `<rect x="160" y="760" width="1900" height="40" rx="8" fill="#5a6b66" ${T}/>`,
    ],
    ciudad: () => [
      `<rect width="2400" height="1100" fill="#f3d9b8"/><circle cx="1500" cy="300" r="120" fill="#f2c14e" opacity=".8"/>${Array.from({ length: 12 }, (_, i) => `<rect x="${i * 200}" y="${380 - hash(i) * 200}" width="170" height="800" fill="#c9a98a"/>`).join('')}`,
      `${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 270 - 40}" y="${480 - hash(i + 20) * 160}" width="230" height="700" fill="#1d3b6e" ${T}/>${Array.from({ length: 6 }, (_, j) => `<rect x="${i * 270 - 10}" y="${520 - hash(i + 20) * 160 + j * 70}" width="34" height="40" fill="${hash(i * 7 + j) > 0.5 ? '#f2c14e' : '#9fc3e8'}"/><rect x="${i * 270 + 60}" y="${520 - hash(i + 20) * 160 + j * 70}" width="34" height="40" fill="${hash(i * 5 + j) > 0.6 ? '#f2c14e' : '#9fc3e8'}"/>`).join('')}`).join('')}`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#5c5866"/><rect x="-50" y="890" width="2500" height="16" fill="#b9b2a6"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${i * 420}" y="990" width="200" height="14" fill="#f3efe6"/>`).join('')}`,
    ],
    calle_noche: () => [
      `<rect width="2400" height="1100" fill="#1b2340"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${hash(i) * 2400}" cy="${hash(i + 7) * 500}" r="${2 + hash(i + 3) * 3}" fill="#f3efe6" opacity=".7"/>`).join('')}<circle cx="1700" cy="200" r="70" fill="#f3efe6"/>`,
      `${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 300 - 40}" y="${460 - hash(i + 40) * 160}" width="260" height="700" fill="#2d3a63" ${T}/>${Array.from({ length: 5 }, (_, j) => `<rect x="${i * 300}" y="${500 - hash(i + 40) * 160 + j * 80}" width="40" height="44" fill="${hash(i * 3 + j) > 0.55 ? '#f2c14e' : '#3d4c7a'}"/>`).join('')}`).join('')}`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#20202a"/><g transform="translate(1500 900)"><rect x="-8" y="-420" width="16" height="420" fill="#3a3a44" ${T}/><circle cx="0" cy="-430" r="26" fill="#f2c14e"/><path d="M-200 0 L-26 -420 L26 -420 L200 0Z" fill="#f2c14e" opacity=".12"/></g>`,
    ],
    casa: () => [
      `<rect width="2400" height="1100" fill="#ead7c3"/><rect x="1300" y="160" width="420" height="360" fill="#9fc3e8" ${T}/><line x1="1510" y1="160" x2="1510" y2="520" ${T}/><rect x="300" y="200" width="260" height="200" fill="#f0624d" ${T}/>`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#a8876b"/><g transform="translate(1600 900)"><rect x="-260" y="-220" width="520" height="160" rx="40" fill="#3a9a7a" ${T}/><rect x="-300" y="-150" width="600" height="150" rx="30" fill="#3a9a7a" ${T}/></g><g transform="translate(420 900)"><rect x="-10" y="-380" width="20" height="380" fill="#2a2a33"/><path d="M-80 -380 L80 -380 L50 -470 L-50 -470Z" fill="#f2c14e" ${T}/></g>`,
      `<ellipse cx="960" cy="1010" rx="700" ry="60" fill="#c9653f" opacity=".5"/>`,
    ],
    banco: () => [
      `<rect width="2400" height="1100" fill="#e6e0d2"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${160 + i * 340}" y="120" width="70" height="700" fill="#f6f2ea" ${T}/>`).join('')}<path d="M100 120 L2300 120 L2300 60 L100 60Z" fill="#d6cdbd" ${T}/>`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#c2b8a5"/><g transform="translate(1700 620)"><circle r="230" fill="#9aa3ad" ${T}/><circle r="170" fill="#b9c0c8" ${T}/><circle r="40" fill="#5c6670" ${T}/>${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="0" y1="0" x2="0" y2="-150" ${T} transform="rotate(${i * 60})"/>`).join('')}</g>`,
      `<rect x="200" y="740" width="1100" height="180" fill="#8a5a3b" ${T}/><rect x="180" y="720" width="1140" height="40" fill="#a06b48" ${T}/>`,
    ],
    tienda: () => [
      `<rect width="2400" height="1100" fill="#f1e6d2"/>${[0, 1, 2].map((r) => `<rect x="200" y="${180 + r * 210}" width="1900" height="20" fill="#8a5a3b"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${230 + i * 130}" y="${180 + r * 210 - 90 - hash(i + r * 9) * 40}" width="90" height="${90 + hash(i + r * 9) * 40}" rx="8" fill="${['#f0624d', '#3a9a7a', '#f2c14e', '#1d3b6e', '#f4a3b4'][(i + r) % 5]}" ${T}/>`).join('')}`).join('')}`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#c9bfae"/>`,
      `<g transform="translate(1600 900)"><rect x="-180" y="-200" width="360" height="200" fill="#1d3b6e" ${T}/><rect x="-160" y="-260" width="140" height="70" rx="8" fill="#2a2a33" ${T}/></g>`,
    ],
    fabrica: () => [
      `<rect width="2400" height="1100" fill="#d9d2c4"/>${[0, 1, 2, 3].map((i) => `<path d="M${i * 600} 500 L${i * 600 + 300} 300 L${i * 600 + 300} 500 L${i * 600 + 600} 300 L${i * 600 + 600} 520 L${i * 600} 520Z" fill="#b9ad98" ${T}/>`).join('')}`,
      `<rect x="-50" y="900" width="2500" height="200" fill="#a99f8c"/>${[0, 1, 2].map((i) => `<g transform="translate(${500 + i * 600} 620)"><circle r="110" fill="#9aa3ad" ${T}/><circle r="34" fill="#5c6670" ${T}/></g>`).join('')}`,
      `<rect x="100" y="800" width="2000" height="50" rx="25" fill="#3a3a44" ${T}/>`,
    ],
    vacio: () => [`<rect width="2400" height="1100" fill="${papel}"/><circle cx="960" cy="540" r="520" fill="#f6f1e8"/>`, '', ''],
  };

  // ---------- encuadre y cámara ----------
  function camara(tipo, t, dur) {
    const k = easeIO(t / Math.max(1, dur));
    return ({ zoom_in: { s: lerp(1, 1.14, k), x: 0, y: 0 }, zoom_out: { s: lerp(1.16, 1, k), x: 0, y: 0 }, pan_der: { s: 1.1, x: lerp(70, -70, k), y: 0 },
      pan_izq: { s: 1.1, x: lerp(-70, 70, k), y: 0 }, sube: { s: 1.1, x: 0, y: lerp(50, -30, k) } }[tipo]) || { s: lerp(1.02, 1.06, k), x: 0, y: 0 };
  }

  // Construye el SVG de un fotograma de la escena ilustrada.
  window.ILU = function (e, t, dur, ctx) {
    const dec = (DEC[e.decorado] || DEC.vacio)();
    const cam = camara(e.camara, t, dur);
    const capa = (contenido, prof) => `<g transform="translate(${960 + cam.x * prof} ${540 + cam.y * prof}) scale(${1 + (cam.s - 1) * prof}) translate(-960 -540)">${contenido}</g>`;
    const reparto = ctx.reparto || [];
    const actores = (e.personajes || []).map((ap, i) => {
      const def = reparto.find((r) => r.id === ap.id) || { id: ap.id };
      const t0 = ap.entra ?? (ap.desde != null ? 0 : 0.1 + i * 0.25);
      let x = ap.x ?? (i ? 1300 : 640), op = ap.entra == null && ap.desde == null ? 1 : ease((t - t0) / 0.45), dy = (1 - op) * 40;
      if (ap.desde != null) x = lerp(ap.desde, x, ease((t - t0) / 1.2));
      const escala = ap.escala ?? 0.95, giro = ap.mira === 'izq' ? -1 : 1;
      return `<g opacity="${op}" transform="translate(${x} ${900 + dy}) scale(${giro * escala} ${escala})">${personaje(def, { ...ap, pose: ap.desde != null && t - t0 < 1.2 ? 'camina' : ap.pose }, t)}</g>`;
    }).join('');
    const objetos = (e.objetos || []).map((o, i) => {
      const t0 = o.entra ?? 0.6 + i * 0.3, k = ease((t - t0) / 0.4), s = (o.escala ?? 1) * (0.6 + 0.4 * k) * (1 + Math.sin((t - t0) * 2.4) * 0.015);
      const cont = o.tipo === 'grafico_sube' || o.tipo === 'grafico_baja' ? `<g transform="translate(-260 -150)">${grafico(o.tipo === 'grafico_sube' ? 'sube' : 'baja', t - t0)}</g>` : OBJ[o.tipo]?.(t - t0, 1, o) || '';
      return `<g opacity="${k}" transform="translate(${o.x ?? 960} ${(o.y ?? 560) + (1 - k) * 30}) scale(${s})">${cont}</g>`;
    }).join('');
    const efectos = e.efecto === 'lluvia_monedas' ? lluvia(t) : '';
    const V = !!ctx.vertical;
    const rotulo = e.rotulo ? (() => { const k = ease((t - 0.3) / 0.5); return `<g opacity="${k}" transform="translate(${(V ? 60 : 80) - (1 - k) * 60} ${V ? 230 : 110}) scale(${V ? 1.25 : 1})"><rect width="${Math.max(260, e.rotulo.length * 22 + 60)}" height="70" rx="6" fill="var(--ink)"/><text x="30" y="47" font-size="34" font-weight="600" fill="${papel}">${esc(e.rotulo)}</text></g>`; })() : '';
    const dato = e.dato ? (() => { const k = ease((t - (e.dato.entra ?? 0.8)) / 0.4); return `<g opacity="${k}" transform="translate(${V ? 540 : e.dato.x ?? 1560} ${V ? 520 : e.dato.y ?? 300}) scale(${(0.7 + 0.3 * k) * (V ? 1.35 : 1)}) rotate(-4)"><rect x="-230" y="-110" width="460" height="220" rx="18" fill="#f2c14e" ${T}/><text y="10" text-anchor="middle" font-size="96" font-weight="800" fill="var(--ink)">${esc(e.dato.valor)}</text><text y="70" text-anchor="middle" font-size="30" font-weight="600" fill="var(--ink)">${esc(e.dato.etiqueta || '')}</text></g>`; })() : '';
    const bocadillo = e.bocadillo ? (() => {
      const quien = (e.personajes || []).find((p) => p.id === e.bocadillo.de) || e.personajes?.[0] || { x: 960 };
      const k = ease((t - (e.bocadillo.entra ?? 0.7)) / 0.35), lado = e.bocadillo.lado === 'izq' ? -1 : 1, w = Math.min(680, Math.max(320, e.bocadillo.texto.length * 17));
      const lineas = []; let cur = ''; for (const p of e.bocadillo.texto.split(' ')) { if ((cur + ' ' + p).length > w / 19) { lineas.push(cur); cur = p; } else cur = (cur + ' ' + p).trim(); } lineas.push(cur);
      const cabeza = 900 - 680 * (quien.escala ?? 0.95), alto = lineas.length * 46 + 64, hx = quien.x ?? 640, cx = hx + lado * (w / 2 - 60), cy = cabeza - 70 - alto;
      return `<g opacity="${k}" transform="translate(${cx} ${cy}) scale(${0.85 + 0.15 * k})"><rect x="${-w / 2}" y="0" width="${w}" height="${alto}" rx="30" fill="#fffaf0" ${T}/>
        <path d="M${hx - cx - lado * 20} ${alto - 3} L${hx - cx + lado * 6} ${alto + 56} L${hx - cx + lado * 46} ${alto - 3}Z" fill="#fffaf0" ${T}/><rect x="${Math.min(hx - cx - lado * 20, hx - cx + lado * 46) + 4}" y="${alto - 9}" width="58" height="12" fill="#fffaf0"/>
        ${lineas.map((l, i) => `<text y="${i * 46 + 50}" text-anchor="middle" font-size="36" font-weight="600" fill="var(--ink)">${esc(l)}</text>`).join('')}</g>`;
    })() : '';
    // Horizontal: el mundo entero. Vertical: una ventana 9:16 que sigue a los personajes (y a los objetos), con el cielo prolongado hacia arriba.
    let vb = '0 0 1920 1080', cielo = '';
    if (V) {
      const xs = [...(e.personajes || []).map((p) => p.x ?? 640), ...(e.objetos || []).map((o) => o.x ?? 960)];
      const izq = xs.length ? Math.min(...xs) : 960, der = xs.length ? Math.max(...xs) : 960, w = Math.max(820, der - izq + 520), h = (w * 16) / 9;
      vb = `${(izq + der) / 2 - w / 2} ${1060 - h} ${w} ${h}`;
      cielo = `<rect x="-2000" y="-4000" width="6000" height="4100" fill="${(dec[0].match(/fill="(#[0-9a-f]{3,6})"/i) || [])[1] || papel}"/>`;
    }
    return `<svg xmlns="${NS}" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui">
      ${cielo}${capa(dec[0], 0.35)}${capa(dec[1], 0.7)}${capa(actores + objetos, 1)}${capa(dec[2] || '', 1.25)}${efectos}${bocadillo}</svg>
    <svg xmlns="${NS}" viewBox="0 0 ${V ? '1080 1920' : '1920 1080'}" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui">${rotulo}${dato}
      <rect width="100%" height="100%" filter="url(#grano)" opacity=".16" style="mix-blend-mode:multiply"/><rect width="100%" height="100%" fill="url(#vineta)"/></svg>`;
  };

  // Hoja de personajes (para las propuestas): cada personaje con tres expresiones.
  window.ILU_REPARTO = function (reparto, t) {
    const cols = reparto.length;
    return `<svg xmlns="${NS}" viewBox="0 0 1920 1080" width="100%" height="100%" style="position:absolute;inset:0;font-family:Geist,system-ui"><defs><clipPath id="cabeza"><rect x="-110" y="-720" width="220" height="250"/></clipPath></defs><rect width="1920" height="1080" fill="${papel}"/>
      ${reparto.map((r, i) => { const cx = (1920 / cols) * (i + 0.5); return `<g transform="translate(${cx} 800) scale(.8)">${personaje(r, { pose: 'explica', expresion: 'feliz' }, t)}</g>
        ${['sorprendido', 'preocupado', 'enfadado'].map((ex, j) => `<g transform="translate(${cx - 140 + j * 140} 990) scale(.42)"><g transform="translate(0 560)" clip-path="url(#cabeza)">${personaje(r, { pose: 'de_pie', expresion: ex }, t)}</g></g>`).join('')}
        <text x="${cx}" y="120" text-anchor="middle" font-size="44" font-weight="700" fill="var(--ink)">${esc(r.nombre || r.id)}</text><text x="${cx}" y="168" text-anchor="middle" font-size="28" fill="#5e5a54">${esc(r.papel || '')}</text>`; }).join('')}
      <rect width="1920" height="1080" filter="url(#grano)" opacity=".09"/></svg>`;
  };
})();
