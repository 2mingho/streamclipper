#!/bin/bash
# Reinicia solo la web (panel, API y app). No toca descargas, recortes ni renders: esos viven en streamclipper-trabajos.
systemctl --user restart streamclipper
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8790/api/app/version && { echo "$(date +%T) web reiniciada"; exit 0; }; sleep 0.5; done
echo "la web no responde"; exit 1
