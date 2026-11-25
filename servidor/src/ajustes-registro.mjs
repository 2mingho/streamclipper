// Registro único de ajustes (fase 2 del rediseño, 22-nov-2026).
// Cada ajuste dice dónde vive (categoría › sección), qué es, su tipo, su valor por defecto y si es básico o «Avanzado».
// Lo que no está aquí no se enseña en la app (rutas, tokens internos). No importa db.mjs: db.mjs lo importa a él.
//
// tipo: bool · num {min,max,paso,unidad} · hora (HH:MM) · horas (lista «HH:MM, HH:MM») · dias (1=lunes…7=domingo)
//       texto · largo (varias líneas) · secreto (no se devuelve) · opcion {opciones:[[valor, etiqueta]]} · url
// nivel: basico (se ve a la primera) · avanzado (plegado)

export const CATEGORIAS = [
  { id: 'clips', titulo: 'Clips', sub: 'Qué se recorta, cómo se ve y cuándo caduca', icono: 'reels' },
  { id: 'publicacion', titulo: 'Publicación', sub: 'YouTube, TikTok, horarios y cantidades', icono: 'enviar' },
  { id: 'streamers', titulo: 'Streamers', sub: 'De quién se sacan clips y cómo se trata a cada uno', icono: 'directo' },
  { id: 'campanas', titulo: 'Campañas', sub: 'Requisitos, franja y logo de cada campaña', icono: 'estrella' },
  { id: 'ia', titulo: 'IA', sub: 'Tu propio modelo, Groq, Gemini y la transcripción', icono: 'robot' },
  { id: 'estudio', titulo: 'Estudio', sub: 'Producción de vídeos largos', icono: 'estudio' },
  { id: 'avisos', titulo: 'Avisos al móvil', sub: 'ntfy: qué te llega y adónde', icono: 'campana' },
  { id: 'servidor', titulo: 'Servidor', sub: 'Horario, laptop y zona horaria', icono: 'grafica' },
];

const ZONAS = [['UTC', 'UTC'], ['America/Santo_Domingo', 'Santo Domingo'], ['America/New_York', 'Nueva York (EE. UU. este)'], ['America/Chicago', 'Chicago (EE. UU. centro)'],
  ['America/Los_Angeles', 'Los Ángeles (EE. UU. oeste)'], ['Europe/London', 'Londres'], ['Europe/Madrid', 'Madrid'], ['America/Mexico_City', 'Ciudad de México'],
  ['America/Bogota', 'Bogotá'], ['America/Argentina/Buenos_Aires', 'Buenos Aires'], ['America/Sao_Paulo', 'São Paulo'], ['Australia/Sydney', 'Sídney']];
export const ZONAS_HORARIAS = ZONAS;

const A = (clave, categoria, seccion, titulo, tipo, defecto, extra = {}) => ({ clave, categoria, seccion, titulo, tipo, defecto, nivel: 'basico', ...extra });
const avz = { nivel: 'avanzado' };

export const REGISTRO = [
  // ---------- Clips ----------
  A('clips.activo', 'clips', 'General', 'Clips', 'bool', true, { maestro: true, ayuda: 'Apagado, no se recorta nada nuevo.' }),
  A('clips.solo_ia', 'clips', 'Recorte', 'Solo los momentos que marque Gemini', 'bool', true, { ayuda: 'Los vídeos esperan a la pasada de Gemini y se recortan exactamente sus momentos. Los clips de Twitch y lo añadido a mano pasan siempre.' }),
  A('clips.revisar_min', 'clips', 'Recorte', 'Mirar los streamers cada', 'num', 60, { min: 10, max: 1440, unidad: 'min' }),
  A('clips.momentos_por_video', 'clips', 'Recorte', 'Clips por vídeo largo', 'num', 5, { min: 1, max: 20, unidad: 'clips', ayuda: 'De cada vídeo de más de un minuto se recortan los mejores momentos: los que marque una IA, lo más reproducido de YouTube o los picos de voz.' }),
  A('clips.motor', 'clips', 'Recorte', 'Motor de recorte de vídeos largos', 'opcion', 'propio', { opciones: [['propio', 'Propio (solo FFmpeg y yt-dlp)'], ['openshorts', 'OpenShorts (servicio aparte)']], ayuda: 'OpenShorts es opcional: hay que instalarlo aparte y poner su dirección abajo.', nivel: 'avanzado' }),
  A('clips.api', 'clips', 'Recorte', 'Dirección de OpenShorts', 'url', 'http://127.0.0.1:8000', { nivel: 'avanzado' }),
  A('clips.tramo_min', 'clips', 'Recorte', 'Directos: cortar un tramo cada', 'num', 30, { min: 5, max: 120, unidad: 'min', ...avz }),
  A('clips.desde', 'clips', 'Recorte', 'Sin Gemini: recortar desde', 'hora', '21:00', { ayuda: 'Solo cuenta si «Solo los momentos de Gemini» está apagado.', ...avz }),
  A('clips.hasta', 'clips', 'Recorte', 'Sin Gemini: recortar hasta', 'hora', '03:00', avz),
  A('editor.precalentar', 'clips', 'Editor', 'Preparar de noche los clips para editarlos al instante', 'bool', true, { ayuda: 'Con el servidor libre, deja hechos el vídeo de edición y la medida de la webcam de los clips recientes sin publicar. Se borran a los 4 días.' }),
  A('editor.precalentar_desde', 'clips', 'Editor', 'Prepararlos desde las', 'hora', '23:00', avz),
  A('editor.precalentar_hasta', 'clips', 'Editor', 'Hasta las', 'hora', '07:00', avz),
  A('clips.gancho', 'clips', 'Diseño del clip', 'Arranque fuerte', 'bool', true, { ayuda: 'La frase más fuerte del clip, delante (1–5 s).' }),
  A('clips.zoom_pausa', 'clips', 'Diseño del clip', 'Cara a pantalla completa en las pausas', 'bool', true, { ayuda: 'En reacciones, cuando el contenido se para.' }),
  A('clips.horizontal_auto', 'clips', 'Diseño del clip', 'Versión horizontal de cada clip', 'bool', true, { ayuda: 'Se hace en segundo plano para recopilatorios.' }),
  A('clips.caducan_dias', 'clips', 'Caducidad', 'Los clips sin publicar caducan a los', 'num', 14, { min: 3, max: 90, unidad: 'días' }),
  A('clips.autopiloto', 'clips', 'Aprobación automática', 'Aprobar solos los clips buenos', 'bool', false, { ayuda: 'Pasan a la cola de subida sin que los valores, si superan la nota y las revisiones de encuadre y textos.' }),
  A('clips.auto_nota_pct', 'clips', 'Aprobación automática', 'Nota mínima', 'num', 55, { min: 0, max: 100, unidad: '%', ayuda: 'Nota combinada de emoción y puntos del clip.' }),
  A('clips.auto_por_dia', 'clips', 'Aprobación automática', 'Clips al día como máximo', 'num', 5, { min: 1, max: 30, unidad: 'clips', ayuda: 'Cuentan también los que apruebas tú ese día. Las campañas tienen su propio número (Ajustes › Campañas).' }),
  A('prefiltro.activo', 'clips', 'Prefiltro', 'Apartar los clips que seguramente descartarías', 'bool', true, { ayuda: 'Groq juzga cada clip nuevo con tus motivos y ejemplos. Los muy flojos van a Explorar › «Descartados por la app»: se recuperan con un toque o valorándolos. No cuentan como valoración tuya.' }),
  A('prefiltro.confianza', 'clips', 'Prefiltro', 'Seguridad mínima para apartar', 'num', 0.7, { min: 0.5, max: 1, ayuda: 'Probado con 35 valoraciones tuyas: 0,7 apartó 15 de 18 descartes y 1 de 17 que sí te servían; 0,9 apartó 6 y ninguno bueno.' }),
  A('prefiltro.dias', 'clips', 'Prefiltro', 'Borrar los descartados por la app a los', 'num', 3, { min: 1, max: 14, unidad: 'días' }),
  A('prefiltro.modelo', 'clips', 'Prefiltro', 'Modelo de Groq del prefiltro', 'texto', 'openai/gpt-oss-120b', avz),
  A('clips.encuadre_aprendido', 'clips', 'Encuadre', 'Usar el encuadre que dejé al editar cada streamer', 'bool', true, { ayuda: 'Al renderizar un clip en el editor, la cámara que dejaste queda como encuadre de ese canal para sus clips nuevos.' }),
  A('clips.borrar_descartes_h', 'clips', 'Limpieza', 'Borrar del disco los «No sirve» a las', 'num', 24, { min: 1, max: 336, unidad: 'h', ayuda: 'La valoración se conserva como lección para las IA; solo se borran los archivos.' }),
  A('recop.min_clips', 'clips', 'Recopilatorios', 'Clips mínimos para un recopilatorio', 'num', 6, { min: 3, max: 30 }),
  A('recop.antelacion_h', 'clips', 'Recopilatorios', 'Montarlo con antelación de', 'num', 30, { min: 6, max: 96, unidad: 'h', ...avz }),

  // ---------- Publicación ----------
  A('publicacion.activa', 'publicacion', 'General', 'Publicación automática', 'bool', true, { maestro: true, ayuda: 'Apagada, no se sube nada a YouTube ni a TikTok (lo programado espera).' }),
  A('youtube.max_dia', 'publicacion', 'YouTube', 'Shorts al día como máximo', 'num', 6, { min: 0, max: 50, ayuda: 'La cuota de la API de YouTube da para unas 6 subidas al día.' }),
  A('youtube.max_clip', 'publicacion', 'Cantidad al día por tipo', 'Shorts de streamers', 'num', 0, { min: 0, max: 50, ayuda: '0 = sin límite propio (cuenta el tope total). Las campañas usan su propio «clips al día».' }),
  A('youtube.max_estudio', 'publicacion', 'Cantidad al día por tipo', 'Shorts del Estudio', 'num', 0, { min: 0, max: 50 }),
  A('youtube.max_recop', 'publicacion', 'Cantidad al día por tipo', 'Recopilatorios', 'num', 0, { min: 0, max: 10 }),
  A('youtube.espacio_min', 'publicacion', 'YouTube', 'Tiempo entre subidas', 'num', 120, { min: 15, max: 1440, unidad: 'min' }),
  A('youtube.privacidad', 'publicacion', 'YouTube', 'Visibilidad', 'opcion', 'public', { opciones: [['public', 'Público'], ['unlisted', 'Oculto'], ['private', 'Privado']] }),
  A('youtube.largos_dias', 'publicacion', 'YouTube', 'Días de los vídeos largos', 'dias', '1,4', { comoTexto: true }),
  A('youtube.recop_dias', 'publicacion', 'YouTube', 'Días de los recopilatorios', 'dias', '2,5', { comoTexto: true }),
  A('youtube.largos_hora_utc', 'publicacion', 'YouTube', 'Hora de los vídeos largos (UTC)', 'hora', '15:00'),
  A('tiktok.max_dia', 'publicacion', 'TikTok', 'Publicaciones al día como máximo', 'num', 10, { min: 0, max: 30 }),
  A('tiktok.espacio_min', 'publicacion', 'TikTok', 'Tiempo entre publicaciones', 'num', 120, { min: 15, max: 1440, unidad: 'min' }),
  A('tiktok.privacidad', 'publicacion', 'TikTok', 'Visibilidad', 'opcion', 'SELF_ONLY', { opciones: [['SELF_ONLY', 'Solo yo (hasta que TikTok apruebe la app)'], ['PUBLIC_TO_EVERYONE', 'Público'], ['MUTUAL_FOLLOW_FRIENDS', 'Amigos'], ['FOLLOWER_OF_CREATOR', 'Seguidores']] }),

  // ---------- Campañas ----------
  A('campanas.activo', 'campanas', 'General', 'Campañas', 'bool', true, { maestro: true, ayuda: 'Apagado, todas las campañas quedan en pausa (cada una conserva su estado).' }),

  // ---------- IA ----------
  A('ia.activa', 'ia', 'General', 'IA en la nube (Gemini)', 'bool', true, { maestro: true, ayuda: 'Apagada, no se espera a Gemini (se recorta con señales propias) y el servidor no le pide textos.' }),
  A('gemini.pasadas', 'ia', 'Gemini', 'Horas de las pasadas de Gemini', 'horas', '02:00, 08:00, 14:00, 20:00', { ayuda: 'Las que tienes programadas en la app de Gemini (en la zona horaria de la app).' }),
  A('gemini.espera_min', 'ia', 'Gemini', 'Si no ha marcado nada a los', 'num', 10, { min: 5, max: 120, unidad: 'min', ayuda: 'Pasado ese tiempo te llega un aviso con tres botones: intentar en 10 min, recortar con señales propias o descartar.' }),
  A('gemini.al_vencer', 'ia', 'Gemini', 'Si no contestas al aviso', 'opcion', 'esperar', { opciones: [['esperar', 'Esperar a la próxima pasada'], ['propias', 'Recortar con señales propias'], ['descartar', 'Descartar los vídeos']] }),
  A('servidor.autoprueba', 'servidor', 'Autoprueba', 'Probar la app sola tras cada arranque', 'bool', true, { ayuda: 'A los 2 minutos de arrancar, el servidor recorre su API y abre cada pantalla en ordenador y móvil. Lo que falle sale en Sistema y te llega al móvil.' }),
  A('gemini.transcribir', 'ia', 'Gemini', 'Transcribir para Gemini', 'bool', true, { ayuda: 'Los tramos que Gemini no puede leer (sin subtítulos en YouTube) los transcribe el servidor y Gemini los lee con leer_transcripcion.' }),
  A('gemini.max_pasadas', 'ia', 'Gemini', 'Dejar de ofrecer a Gemini un vídeo tras', 'num', 2, { min: 0, max: 10, unidad: 'pasadas', ayuda: 'Si Gemini no lo marca en ese número de pasadas, deja de gastar su tiempo en él (0 = nunca).' }),
  A('gemini.atascados', 'ia', 'Gemini', 'Y entonces', 'opcion', 'propias', { opciones: [['propias', 'Recortarlo con las señales propias del servidor'], ['descartar', 'Descartarlo'], ['esperar', 'Seguir esperando a Gemini']] }),
  A('gemini.contestar_h', 'ia', 'Gemini', 'Tiempo para contestar al aviso', 'num', 2, { min: 1, max: 6, unidad: 'h', ...avz }),
  A('ia.propio_url', 'ia', 'Tu modelo', 'Dirección de tu modelo (API compatible con OpenAI)', 'texto', '', { nivel: 'oculto' }),
  A('ia.propio_modelo', 'ia', 'Tu modelo', 'Nombre de tu modelo', 'texto', '', { nivel: 'oculto' }),
  A('ia.propio_vision', 'ia', 'Tu modelo', 'Tu modelo entiende imágenes', 'bool', false, { nivel: 'oculto' }),
  A('groq.modelo_texto', 'ia', 'Groq', 'Modelo de Groq para textos', 'texto', '', { nivel: 'oculto' }),
  A('groq.modelo_vision', 'ia', 'Groq', 'Modelo de Groq con visión', 'texto', '', { nivel: 'oculto' }),
  A('ia.gemini_max_dia', 'ia', 'Gemini', 'Llamadas a Gemini al día desde la app', 'num', 80, { min: 0, max: 1000, ayuda: 'Textos y revisiones que pide el servidor (no cuenta la tarea de la app de Gemini).' }),
  A('llm.url', 'ia', 'Modelos locales', 'Servidor de modelos (LM Studio, llama-server)', 'url', 'http://127.0.0.1:1234', avz),
  A('whisper.binario', 'ia', 'Transcripción', 'Programa de whisper.cpp', 'texto', 'whisper-cli', { ayuda: 'Ruta a whisper-cli (whisper.cpp). Se usa para transcribir los vídeos sin subtítulos.', ...avz }),
  A('whisper.modelo', 'ia', 'Transcripción', 'Modelo de whisper', 'texto', '', { ayuda: 'Ruta al archivo ggml del modelo (p. ej. ggml-small-q5_1.bin).', ...avz }),
  A('whisper.hilos', 'ia', 'Transcripción', 'Hilos de whisper', 'num', 4, { min: 1, max: 32, ...avz }),

  // ---------- Estudio ----------
  A('estudio.activo', 'estudio', 'General', 'Estudio', 'bool', true, { maestro: true, ayuda: 'Apagado, no se produce ni se programa nada del Estudio.' }),
  A('estudio.auto_producir', 'estudio', 'Producción', 'Producir solo lo aprobado', 'bool', true),
  A('estudio.render_desde', 'estudio', 'Producción', 'Renderizar desde', 'hora', '22:00'),
  A('estudio.render_hasta', 'estudio', 'Producción', 'Renderizar hasta', 'hora', '03:00'),
  A('estudio.shorts', 'estudio', 'Producción', 'Shorts de cada vídeo largo', 'bool', false),

  // ---------- Avisos ----------
  A('avisos.activo', 'avisos', 'General', 'Avisos al móvil', 'bool', false, { maestro: true }),
  A('avisos.url', 'avisos', 'Avisos', 'Tema de ntfy', 'url', '', { ayuda: 'Como http://servidor:8080/mi-tema' }),
  A('avisos.token', 'avisos', 'Avisos', 'Clave de ntfy', 'secreto', ''),
  A('avisos.panel', 'avisos', 'Avisos', 'Dirección de la app desde el móvil', 'url', '', { ayuda: 'Se abre al tocar un aviso y la usan sus botones.' }),
  A('avisos.gemini', 'avisos', 'Qué me llega', 'Gemini no marcó nada en su pasada', 'bool', true),
  A('avisos.servidor', 'avisos', 'Qué me llega', 'Problemas del servidor', 'bool', true, { ayuda: 'Un servicio caído, poco disco, mucha temperatura o sin corriente. Y «resuelto» cuando se arregla.' }),

  // ---------- Servidor ----------
  A('app.zona', 'servidor', 'General', 'Zona horaria de la app', 'opcion', 'UTC', { opciones: ZONAS, ayuda: 'Las franjas de cada campaña usan la zona de su país objetivo.' }),
  A('horario.suspender', 'servidor', 'Horario', 'Suspender fuera de horario', 'bool', false, { ayuda: 'Apagado, el servidor está siempre encendido y recorta todo el día.' }),
  A('horario.dias', 'servidor', 'Horario', 'Días de trabajo', 'dias', [1, 2, 3, 4, 5, 6, 7]),
  A('horario.despertar', 'servidor', 'Horario', 'Despertar a las', 'hora', '00:00'),
  A('horario.dormir', 'servidor', 'Horario', 'Suspender a las', 'hora', '23:59'),
  A('servidor.disco_min_pct', 'servidor', 'Vigilancia', 'Avisar si a un disco le queda menos de', 'num', 10, { min: 2, max: 50, unidad: '% libre', ...avz }),
  A('servidor.temp_max', 'servidor', 'Vigilancia', 'Avisar si la temperatura pasa de', 'num', 88, { min: 60, max: 100, unidad: '°C', ...avz }),
  A('telemetria.activa', 'servidor', 'Privacidad', 'Enviar datos anónimos de uso', 'bool', false, { ayuda: 'Versión, sistema, qué herramientas hay, qué pasos de «Primeros pasos» se completan y códigos de error. Nunca títulos, enlaces, nombres ni rutas. Detalle en TELEMETRY.md del repositorio. STREAMCLIPPER_TELEMETRIA=0 o DO_NOT_TRACK=1 la apagan siempre.' }),
  A('acelerador.activo', 'servidor', 'Laptop', 'Usar la laptop con GPU cuando esté encendida', 'bool', false),
];

export const POR_CLAVE = Object.fromEntries(REGISTRO.map((r) => [r.clave, r]));
export const DEFECTOS_REGISTRO = Object.fromEntries(REGISTRO.map((r) => [r.clave, r.defecto]));

// Convierte lo que llega del formulario al tipo del ajuste; lanza si no vale.
export function normalizar(clave, v) {
  const r = POR_CLAVE[clave]; if (!r) return v;
  switch (r.tipo) {
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1';
    case 'num': {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) throw new Error(`«${r.titulo}»: tiene que ser un número`);
      if (r.min != null && n < r.min) throw new Error(`«${r.titulo}»: mínimo ${r.min}`);
      if (r.max != null && n > r.max) throw new Error(`«${r.titulo}»: máximo ${r.max}`);
      return n;
    }
    case 'hora': { const s = String(v).trim(); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Error(`«${r.titulo}»: hora como 08:30`); return s; }
    case 'horas': {
      const l = (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map((h) => String(h).trim()).filter(Boolean);
      for (const h of l) if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(h)) throw new Error(`«${r.titulo}»: «${h}» no es una hora`);
      const u = [...new Set(l.map((h) => h.padStart(5, '0')))].sort();
      if (u.length > 8) throw new Error(`«${r.titulo}»: como mucho 8 horas`);
      return u.join(', ');
    }
    case 'dias': { const l = [...new Set((Array.isArray(v) ? v : String(v).split(',')).map(Number).filter((d) => d >= 1 && d <= 7))].sort(); if (!l.length) throw new Error(`«${r.titulo}»: marca al menos un día`); return r.comoTexto ? l.join(',') : l; }
    case 'opcion': if (!r.opciones.some(([o]) => o === v)) throw new Error(`«${r.titulo}»: opción no válida`); return v;
    default: return String(v ?? '').trim();
  }
}

// Ajustes de cada campaña (columna `config` de la tabla campanas; `ruta` = camino dentro del JSON).
// El estado (Activa / Pausada) une las columnas activa y publicar: no hay «Muestra» (decisión del 22-nov-2026).
const C = (ruta, seccion, titulo, tipo, extra = {}) => ({ ruta, seccion, titulo, tipo, nivel: 'basico', ...extra });
export const CAMPANA_CAMPOS = [
  C('estado', 'Estado', 'Estado de la campaña', 'opcion', { opciones: [['activa', 'Activa: recorta y publica sola'], ['pausada', 'Pausada: no recorta ni publica']] }),
  C('nombre', 'Estado', 'Nombre', 'texto'),
  C('enfoque', 'Requisitos', 'Qué clips quiere la campaña', 'largo', { ayuda: 'La IA lo usa al elegir momentos y al escribir textos: qué buscar, qué evitar, a quién va dirigido.' }),
  C('idioma', 'Requisitos', 'Idioma de los textos', 'opcion', { opciones: [['en', 'Inglés'], ['es', 'Español'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán'], ['it', 'Italiano']] }),
  C('juego.nombre', 'Requisitos', 'Juego o tema', 'texto', { ayuda: 'Se nombra en el título y los textos de cada clip.' }),
  C('juego.regex', 'Requisitos', 'Filtro de títulos (expresión regular)', 'texto', { nivel: 'avanzado', ayuda: 'Solo entran los vídeos cuyo título lo cumple.' }),
  C('juego.twitch', 'Requisitos', 'Categoría en Twitch', 'texto', { nivel: 'avanzado' }),
  C('hashtags', 'Requisitos', 'Hashtags obligatorios', 'lista', { ayuda: 'Separados por espacios o comas; van en el título y la descripción.' }),
  C('min_dias_publicado', 'Requisitos', 'Días mínimos publicado', 'num', { min: 0, max: 365, unidad: 'días' }),
  C('horario.zona', 'Franja de publicación', 'Zona del país objetivo', 'opcion', { opciones: ZONAS }),
  C('horario.desde', 'Franja de publicación', 'Desde', 'hora'),
  C('horario.hasta', 'Franja de publicación', 'Hasta', 'hora'),
  C('por_dia', 'Franja de publicación', 'Clips al día', 'num', { min: 1, max: 30 }),
  C('categoria', 'Franja de publicación', 'Categoría de YouTube', 'opcion', { nivel: 'avanzado', opciones: [['20', 'Videojuegos'], ['24', 'Entretenimiento'], ['22', 'Gente y blogs'], ['23', 'Humor'], ['17', 'Deportes']] }),
  C('logo.ancho', 'Logo', 'Ancho del logo', 'num', { min: 100, max: 1080, unidad: 'px', ayuda: 'Se pone entre el juego y la cara y se revisa que no tape nada.' }),
  C('logo.margen', 'Logo', 'Margen', 'num', { min: 0, max: 100, unidad: 'px', nivel: 'avanzado' }),
  C('nota_min', 'Calidad', 'Nota mínima para publicar', 'num', { min: 0, max: 1, paso: 0.05, ayuda: 'De 0 a 1 (emoción y puntos del clip).' }),
  C('tramos.minutos', 'Calidad', 'Vídeos largos: minutos por tramo', 'num', { min: 5, max: 60, unidad: 'min', nivel: 'avanzado' }),
  C('tramos.cuantos', 'Calidad', 'Vídeos largos: tramos por vídeo', 'num', { min: 1, max: 10, nivel: 'avanzado' }),
  C('twitch.horas', 'Clips de Twitch', 'Buscar clips de las últimas', 'num', { min: 1, max: 168, unidad: 'h', nivel: 'avanzado' }),
  C('twitch.min_vistas', 'Clips de Twitch', 'Vistas mínimas', 'num', { min: 0, max: 100000, nivel: 'avanzado' }),
  C('twitch.min_seg', 'Clips de Twitch', 'Duración mínima', 'num', { min: 5, max: 60, unidad: 's', nivel: 'avanzado' }),
  C('twitch.max_por_canal', 'Clips de Twitch', 'Máximo por streamer y vuelta', 'num', { min: 1, max: 20, nivel: 'avanzado' }),
  C('enlace', 'Pago', 'Enlace de la campaña', 'url'),
  C('pago', 'Pago', 'Condiciones de pago', 'texto'),
];

// Interruptores generales: si están apagados, ajustes() devuelve estos valores (lo guardado no se toca).
export const APAGA = {
  'ia.activa': { 'clips.solo_ia': false, 'ia.gemini_max_dia': 0 },
  'estudio.activo': { 'estudio.auto_producir': false, 'estudio.shorts': false },
};

// Ajustes de cada streamer (columnas de clip_canales).
const K = (col, seccion, titulo, tipo, extra = {}) => ({ ruta: col, seccion, titulo, tipo, nivel: 'basico', ...extra });
export const CANAL_CAMPOS = [
  K('activo', 'General', 'Sacar clips de este streamer', 'bool'),
  K('nombre', 'General', 'Nombre', 'texto', { ayuda: 'Se nombra en los títulos y textos de sus clips.' }),
  K('url', 'General', 'Canal', 'url', { ayuda: 'YouTube (pestaña Vídeos o Directos) o Twitch.' }),
  K('campana', 'General', 'Campaña', 'opcion', { opciones: [], ayuda: 'Sus clips van a esa campaña con sus requisitos.' }),
  K('tipo', 'Sus vídeos', 'Tipo de vídeo', 'opcion', { opciones: [['gaming', 'Directo de videojuegos'], ['reaccion', 'Reacción'], ['conversacion', 'Podcast / entrevista'], ['formativo', 'Formativo / consejos'], ['general', 'General']] }),
  K('sin_cara', 'Sus vídeos', 'No sale su cara', 'bool', { ayuda: 'Plantilla juego + zoom en lugar de juego + cara.' }),
  K('esperar_ia', 'Sus vídeos', 'Esperar a Gemini', 'opcion', { opciones: [['', 'Como en Ajustes › Clips'], ['1', 'Sí'], ['0', 'No: recortar con señales propias']] }),
  K('aprobar', 'Sus vídeos', 'Pedirme aprobación de sus vídeos nuevos', 'bool', { ayuda: 'Los que Gemini marca se aprueban solos igualmente.' }),
  K('prioridad', 'Sus vídeos', 'Prioridad', 'opcion', { opciones: [['1', '1 · la más alta'], ['2', '2'], ['3', '3 · normal'], ['4', '4'], ['5', '5 · la más baja']] }),
  K('vivo', 'Sus vídeos', 'Grabar sus directos', 'bool'),
  K('enfoque', 'Sus vídeos', 'Indicaciones para la IA', 'largo', { ayuda: 'Qué buscar o evitar en sus vídeos, además de lo del tipo.' }),
  K('min_min', 'Sus vídeos', 'Duración mínima del vídeo', 'num', { min: 1, max: 600, unidad: 'min', nivel: 'avanzado' }),
  K('max_min', 'Sus vídeos', 'Duración máxima del vídeo', 'num', { min: 1, max: 1440, unidad: 'min', nivel: 'avanzado' }),
  K('horizontal', 'Sus vídeos', 'Clips también en 16:9', 'bool', { nivel: 'avanzado' }),
  K('cierre', 'Sus vídeos', 'Texto de cierre', 'texto', { nivel: 'avanzado' }),
];
