#!/bin/bash
# Vuelta atrás: todo en un solo proceso, como antes de separar.
rm -f ~/.config/systemd/user/streamclipper.service.d/rol.conf
systemctl --user disable --now streamclipper-trabajos
systemctl --user daemon-reload
systemctl --user restart streamclipper
echo "$(date +%T) vuelto a un solo proceso"
