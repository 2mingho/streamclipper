#!/bin/bash
# Reinicia cuando no haya nada procesándose dentro del propio servidor (postproceso, descarga o clip corto).
cd "$(dirname "$0")/.."
# Con el servidor separado, los trabajos viven en streamclipper-trabajos (la web se reinicia con reiniciar-web.sh, sin esperar).
U=streamclipper; systemctl --user is-enabled -q streamclipper-trabajos 2>/dev/null && U=streamclipper-trabajos
for i in $(seq 1 120); do
  P=$(sqlite3 "${DATOS_DIR:-datos}/app.db" "select group_concat(paso||'|'||ifnull(job,'')) from clip_videos where estado='procesando'")
  case "$P" in *gancho*|*Añadiendo*|*Descargando*|*Transcribiendo\ el*|*corto-*) ;; *) systemctl --user restart $U && echo "$(date +%T) reiniciado ($U)"; exit 0;; esac
  sleep 15
done; echo sin hueco
