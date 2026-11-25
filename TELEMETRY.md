# Telemetry / Telemetría

**English** · [Español](#español)

StreamClipper can send a few anonymous usage events so we can see whether installs work and where people get stuck. It is **off by default**. The owner is asked once, inside the «Primeros pasos» checklist («Sí, ayudar» / «No, gracias»), and can change it any time in **Ajustes › Servidor › Privacidad**.

The whole implementation is one file: [`servidor/src/telemetria.mjs`](servidor/src/telemetria.mjs).

## What is sent

Only these events, with only these fields. Anything else is dropped before sending.

| Event | Fields | When |
|---|---|---|
| `app_iniciada` | `version`, `os` (platform and major release, e.g. `linux 6`), `node` (major version), `herramientas` (`ffmpeg`, `yt_dlp`, `whisper`: true/false) | Each time the server starts, and when you turn telemetry on |
| `primeros_pasos` | `paso` (1–7; 7 = an AI connected), `estado` (`hecho`) | Once per checklist step, when it is completed |
| `clip_creado` | `fuente` (`youtube`, `twitch`, `kick` or `archivo`), `duracion_bucket` (`<1m`, `1-10m`, `10-60m`, `60m+`), `con_subtitulos` (true/false) | Only for the first 3 clips of the install |
| `uso_diario` | `clips_bucket` (`0`, `1-5`, `6-20`, `21+`) | At most once a day |
| `error` | `tipo` (`descarga`, `duracion`, `sin_momentos`, `postproceso`, `transcripcion`, `openshorts`, `otro`), `paso` (`recorte`, `corto`, `largo`, `subida`) | When a video fails to process |

Every event also carries a random install id (a UUID created on this machine, not derived from your user, hardware or network) and the library name and version.

**Never sent:** video titles, links, channel or streamer names, file paths, error messages, usernames, emails, IP addresses (events go out with `$ip: null`), or any content.

## Where it goes

[PostHog](https://posthog.com) EU cloud (`https://eu.i.posthog.com`). Events are sent with `$process_person_profile: false`, so no person profiles are created. Sending is fire-and-forget with a timeout: if it fails, the event is dropped and StreamClipper keeps working.

## How to turn it off

- In the app: **Ajustes › Servidor › Privacidad › Enviar datos anónimos de uso**.
- Always off, whatever the setting says: start the server with `STREAMCLIPPER_TELEMETRIA=0` or `DO_NOT_TRACK=1`.
- To see what would be sent: `STREAMCLIPPER_TELEMETRIA_LOG=1` prints each event name and the HTTP result in the server log.

## Reporting a problem

**Más › Reportar un problema** (and the error state in «Primeros pasos») opens a pre-filled GitHub issue with the version, OS, Node.js, tool status, onboarding step and the last error **code**. Nothing is sent until you review it and press Submit on GitHub.

---

## Español

StreamClipper puede enviar unos pocos eventos anónimos de uso para saber si las instalaciones funcionan y dónde se atasca la gente. Está **apagado por defecto**. Al dueño se le pregunta una vez, dentro de la lista «Primeros pasos» («Sí, ayudar» / «No, gracias»), y puede cambiarlo cuando quiera en **Ajustes › Servidor › Privacidad**.

Todo está en un solo archivo: [`servidor/src/telemetria.mjs`](servidor/src/telemetria.mjs).

## Qué se envía

Solo estos eventos, con solo estos campos. Cualquier otro campo se descarta antes de enviar.

| Evento | Campos | Cuándo |
|---|---|---|
| `app_iniciada` | `version`, `os` (sistema y versión principal, p. ej. `linux 6`), `node` (versión principal), `herramientas` (`ffmpeg`, `yt_dlp`, `whisper`: sí/no) | Cada arranque del servidor y al activar la telemetría |
| `primeros_pasos` | `paso` (1–7; 7 = IA conectada), `estado` (`hecho`) | Una vez por paso de la lista, al completarlo |
| `clip_creado` | `fuente` (`youtube`, `twitch`, `kick` o `archivo`), `duracion_bucket` (`<1m`, `1-10m`, `10-60m`, `60m+`), `con_subtitulos` (sí/no) | Solo los 3 primeros clips de la instalación |
| `uso_diario` | `clips_bucket` (`0`, `1-5`, `6-20`, `21+`) | Como mucho una vez al día |
| `error` | `tipo` (`descarga`, `duracion`, `sin_momentos`, `postproceso`, `transcripcion`, `openshorts`, `otro`), `paso` (`recorte`, `corto`, `largo`, `subida`) | Cuando un vídeo no se puede procesar |

Cada evento lleva además un identificador aleatorio de la instalación (un UUID creado en este equipo, sin relación con tu usuario, tu equipo ni tu red) y el nombre y la versión de la librería.

**Nunca se envía:** títulos de vídeos, enlaces, nombres de canales o streamers, rutas de archivos, mensajes de error, usuarios, correos, direcciones IP (los eventos salen con `$ip: null`) ni ningún contenido.

## Adónde va

A [PostHog](https://posthog.com), en su nube de la UE (`https://eu.i.posthog.com`), con `$process_person_profile: false`: no se crean perfiles de personas. El envío es en segundo plano y con tiempo límite: si falla, el evento se pierde y StreamClipper sigue funcionando.

## Cómo apagarla

- En la app: **Ajustes › Servidor › Privacidad › Enviar datos anónimos de uso**.
- Siempre apagada, diga lo que diga el ajuste: arranca el servidor con `STREAMCLIPPER_TELEMETRIA=0` o `DO_NOT_TRACK=1`.
- Para ver qué se enviaría: `STREAMCLIPPER_TELEMETRIA_LOG=1` escribe en el registro del servidor el nombre de cada evento y la respuesta HTTP.

## Reportar un problema

**Más › Reportar un problema** (y el estado de error de «Primeros pasos») abre una incidencia de GitHub ya rellenada con la versión, el sistema, Node.js, las herramientas, el paso de «Primeros pasos» y el **código** del último error. No se envía nada hasta que la revisas y pulsas «Submit» en GitHub.
