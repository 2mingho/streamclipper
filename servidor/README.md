# StreamClipper · servidor

Panel web, API y trabajos de fondo de StreamClipper. La guía de instalación y las variables de entorno están en el
[README principal](../README.md).

## Estructura

```
src/server.mjs              API, sesiones y archivos del panel (public/v2)
src/planificador.mjs        ciclo de 30 s: clips, Gemini, operaciones, vigía, transcripciones, recopilatorios
src/tareas/clips*.mjs       cola, recorte (OpenShorts), postproceso, editor, picos de emoción y valoraciones
src/tareas/campanas.mjs     campañas de clipping (requisitos, franja, logo)
src/tareas/youtube.mjs      subidas a YouTube (OAuth de app instalada)
src/tareas/tiktok.mjs       publicaciones en TikTok
src/tareas/autopiloto.mjs   aprobación automática, series y revisiones de rendimiento
src/estudio/                propuestas y producción de vídeos largos
src/estadisticas/           estadísticas del canal y estrategia
src/social.mjs              datos de la interfaz (historias, feed, reels, explorar, perfil)
src/ajustes-registro.mjs    registro único de ajustes (lo que enseña la pantalla Ajustes)
src/usuarios.mjs            cuentas del equipo (dueño, editor, solo ver)
acelerador/                 agente opcional para un equipo con GPU (IA y whisper)
herramientas/               detección de webcam (OpenCV), control de encuadre y logo, servicio systemd de ejemplo
```

## Desarrollo

```
npm install
SIN_PLANIFICADOR=1 npm start    # panel en http://127.0.0.1:8790 sin tareas de fondo
```

En Windows la suspensión solo se simula y queda en el registro.
