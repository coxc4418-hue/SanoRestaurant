#!/bin/sh
# Reinicia los datos del emulador, crea 3 sedes de prueba y corre la prueba E2E.
cd "$(dirname "$0")"
curl -s -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/sano-restaurant/databases/(default)/documents" > /dev/null
curl -s -X DELETE "http://127.0.0.1:9099/emulator/v1/projects/sano-restaurant/accounts" > /dev/null
rm -f .accounts-emu.json
node provision.mjs 3 --emu > /dev/null && node e2e.mjs "http://127.0.0.1:5066" "${1:-shots}"
