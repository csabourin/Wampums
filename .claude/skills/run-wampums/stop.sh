#!/usr/bin/env bash
# Stop whatever listens on the API and Vite ports. Killing the listener, not
# the npx wrapper: npx does not forward SIGTERM to the server it spawned.
for port in 5000 5173; do
  lsof -ti:"$port" -sTCP:LISTEN | xargs -r kill
done
sleep 1
echo "stopped"
