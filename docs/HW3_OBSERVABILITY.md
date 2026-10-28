# HW3: StudyPilot observability

**Signals:** production FastAPI and SQLite metrics/traces → authenticated OpenTelemetry Collector → Prometheus/Grafana and Jaeger; Dokku process logs → Dokku Vector → Loki/Grafana.

## Architecture and status

The Compose app remains a disposable demo with its own SQLite volume. The real Dokku app can export to the same backends as the distinct service studypilot-production. Grafana metrics and logs have a service selector so demo data is not confused with production; Jaeger lists the service under its own name.

Production ingestion ports bind only to the Dell Docker bridge gateway. Dokku reaches the Collector using host.docker.internal mapped to Docker's host-gateway. A separate gRPC receiver requires a bearer token. The internal Compose receiver remains for the demo. Dokku's built-in Vector integration ships only the studypilot app's process logs through a token-protected, push-only Loki gateway with fixed service/source labels. Loki's query API is not published through that gateway. These host-local bridge hops use HTTP rather than TLS; the token and data stay on Dell's Docker networks. Do not use this setup if that network is shared with untrusted workloads. This Compose project does not mount the Docker socket.

The app writes JSON request logs to stdout and its existing JSONL file. Dokku can collect stdout while the demo continues using Promtail. Uvicorn's raw access log is disabled because it can include query strings; app request logs use route templates and do not include bodies, cookies, or user identifiers. FastAPI and SQLite are instrumented once in app.telemetry; do not also use opentelemetry-instrument or a second FastAPI/SQLite agent.

Prometheus and Loki retain seven days; Prometheus also caps its TSDB at 1 GB. Containers have memory caps. Jaeger memory storage is capped at 5,000 traces and is volatile. This is a single-host diagnostic stack, not durable telemetry storage.

**Production has not been connected or validated.** PR #4 is a draft. This branch has not been merged, deployed to Dokku, or applied to its configuration, database, session key, photos, or domains. GitHub Actions deploys only after a push to main and successful tests. Merge and rollout require separate approval.

## Demo stack

Use a separate checkout, never the Dokku deployment checkout:

~~~sh
ssh <your-dell-user>@dexter
mkdir -p ~/studypilot-hw3
cd ~/studypilot-hw3
free -h
df -h "$HOME"
docker info --format '{{.ServerVersion}}'
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
ss -ltn | grep -E ':(13000|13100|13101|14321|16687|18080|19090)\b' || true
~~~

Stop if this is the production checkout, no Docker bridge gateway is reported, or a port is already occupied. Investigate first.

Generate local credentials. The token is ignored by Git, but Docker administrators can read container environment values:

~~~sh
cd ~/studypilot-hw3
umask 077
BRIDGE_IP="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
printf 'GRAFANA_PASSWORD=%s\nOTEL_INGEST_TOKEN=%s\nDOCKER_HOST_BRIDGE_IP=%s\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" "$BRIDGE_IP" > .env.observability
docker compose --env-file .env.observability -f compose.observability.yml config --quiet
docker compose --env-file .env.observability -f compose.observability.yml build app
docker compose --env-file .env.observability -f compose.observability.yml up -d
docker compose --env-file .env.observability -f compose.observability.yml ps
curl --fail http://127.0.0.1:18080/health
~~~

The demo has a separate SQLite volume; no Dokku path is mounted. Dashboard/query ports remain loopback-only. Grafana is at http://127.0.0.1:13000. Remote access uses an SSH tunnel:

~~~powershell
ssh -N -L 13000:127.0.0.1:13000 -L 16687:127.0.0.1:16687 -L 19090:127.0.0.1:19090 <your-dell-user>@dexter
~~~

Run the demo check and select studypilot-demo in the Grafana service picker:

~~~sh
cd ~/studypilot-hw3
python3 scripts/verify_observability.py
~~~

It sends GET requests to the demo health route and an intentionally missing route.

## Production rollout — only after code review and separate approval

These commands are a future approved rollout plan and have not been run. App configuration requires a Dokku redeploy; expect a brief restart/downtime for the current single-container setup. Preserve the current GitHub Actions main-only deployment.

### 1. Read-only preflight

~~~sh
ssh <your-dell-user>@dexter
sudo dokku version
sudo dokku apps:list
sudo dokku ps:report studypilot
sudo dokku storage:report studypilot
sudo dokku network:report studypilot
sudo dokku docker-options:list studypilot --phase deploy
sudo dokku logs:report studypilot
sudo dokku network:exists bridge
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
docker ps --filter name=vector --format '{{.Names}} {{.Status}}'
~~~

Stop and review if app name, scheduler, storage, bind mounts, Docker options, or the per-app Vector sink differ. Never overwrite an existing sink. Confirm the host firewall does not expose the Docker bridge subnet to untrusted interfaces. Do not publish OTLP/Loki on 0.0.0.0, a LAN address, or an Internet-facing proxy.

### 2. Back up data and configuration

Verify the active container, DB path, and mounts. Profile photos are stored in SQLite, so the SQLite online backup preserves database rows and photos. Preserve the session key and Dokku config:

~~~sh
umask 077
BACKUP_DIR="$HOME/studypilot-before-observability-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$BACKUP_DIR"
APP_CID="$(docker ps --filter name=studypilot.web --format '{{.ID}}' | head -n 1)"
test -n "$APP_CID"
docker inspect "$APP_CID" --format '{{json .Mounts}}' > "$BACKUP_DIR/mounts.json"
DB_PATH="$(docker exec "$APP_CID" python -c 'import os; print(os.getenv("DB_PATH", "data/studypilot.db"))')"
docker exec "$APP_CID" python -c 'import os,sqlite3; p=os.getenv("DB_PATH", "data/studypilot.db"); src=sqlite3.connect(p); dst=sqlite3.connect("/tmp/studypilot-before-observability.db"); src.backup(dst); dst.close(); src.close()'
docker cp "$APP_CID":/tmp/studypilot-before-observability.db "$BACKUP_DIR/studypilot.db"
docker exec "$APP_CID" python -c 'import os,shutil; p=os.getenv("DB_PATH", "data/studypilot.db"); key=os.path.splitext(p)[0]+".session-key"; shutil.copy2(key,"/tmp/studypilot-session-key.backup") if os.path.isfile(key) else None'
docker cp "$APP_CID":/tmp/studypilot-session-key.backup "$BACKUP_DIR/" 2>/dev/null || true
sudo dokku config:show studypilot > "$BACKUP_DIR/dokku-config.txt"
sudo dokku storage:report studypilot > "$BACKUP_DIR/dokku-storage.txt"
~~~

The config backup contains secrets. Keep it private, never paste or commit it, and copy it off Dell using the existing encrypted backup process. If storage reports other persistent mounts, archive their exact source paths too. Verify the SQLite copy:

~~~sh
python3 - "$BACKUP_DIR/studypilot.db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
print("integrity:", con.execute("PRAGMA integrity_check").fetchone()[0])
print("users:", con.execute("SELECT COUNT(*) FROM users").fetchone()[0])
con.close()
PY
~~~

Stop if the backup is incomplete, has an integrity error, or cannot be restored using the established backup procedure.

### 3. Start the receiver services

In the separate observability checkout, verify the private .env.observability file contains GRAFANA_PASSWORD, OTEL_INGEST_TOKEN, and the exact Docker bridge gateway. Do not print or share the token. Confirm Collector port 14321 and Loki push port 13100 bind only to that gateway; the Loki query port 13101 and other query ports stay on 127.0.0.1.

~~~sh
cd ~/studypilot-hw3
docker compose --env-file .env.observability -f compose.observability.yml config --quiet
docker compose --env-file .env.observability -f compose.observability.yml up -d otel-collector loki loki-gateway prometheus grafana jaeger
docker compose --env-file .env.observability -f compose.observability.yml ps
~~~

Do not run compose down, down -v, or start the Compose app as part of production rollout. Keep the authenticated receiver on Collector port 4319, published only as gateway port 14321. The demo uses the separate internal receiver on 4317.

### 4. Configure Dokku (triggers redeploy)

Check the app has no conflicting host mapping. The alias is required because localhost inside a Dokku container is that container:

~~~sh
sudo dokku docker-options:add studypilot deploy "--add-host=host.docker.internal:host-gateway"
read -rsp 'Paste the OTEL ingest token from .env.observability: ' OTEL_TOKEN
printf '\n'
sudo dokku config:set --no-restart studypilot \
  OTEL_ENABLED=true \
  OTEL_SERVICE_NAME=studypilot-production \
  DEPLOYMENT_ENVIRONMENT=production \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:14321 \
  "OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20$OTEL_TOKEN"
unset OTEL_TOKEN
~~~

The token is stored in Dokku config and visible to Docker/Dokku administrators. Keep the endpoint on Dell's private Docker bridge. The receiver checks the bearer token. Do not add a second OTel agent or instrument FastAPI twice.

For actual Dokku process logs, first confirm there is no existing app Vector sink. Then configure this app only and start Dokku's existing Vector shipper if needed. The same random token protects OTLP and Loki ingestion. Replace the gateway placeholder with the discovered IP:

~~~sh
read -rsp 'Paste the OTEL ingest token from .env.observability: ' OTEL_TOKEN
printf '\n'
sudo dokku logs:set studypilot vector-sink \
  "loki://?endpoint=http%3A//<DOCKER_BRIDGE_GATEWAY_IP>%3A13100&auth%5Bstrategy%5D=bearer&auth%5Btoken%5D=$OTEL_TOKEN&labels%5Bservice%5D=studypilot-production&labels%5Bsource%5D=dokku"
unset OTEL_TOKEN
sudo dokku logs:vector-start
sudo dokku logs:vector-logs --num 30
~~~

Do not change global Vector networks, sinks, or Docker log retention. App stdout includes JSON request lines from app.telemetry; Vector also ships ordinary process output.

### 5. Validate the real app

After the approved deploy, confirm the normal domain responds and compare current DB, photo, session, and domain settings with preflight/backup records. Then run read-only checks from Dell, replacing the URL with the actual HTTPS domain:

~~~sh
cd ~/studypilot-hw3
APP_URL=https://<studypilot-domain> \
OTEL_SERVICE_NAME=studypilot-production \
LOKI_SELECTOR='{service="studypilot-production",source="dokku"}' \
python3 scripts/verify_observability.py
~~~

The script sends four read-only /health GETs and one GET to a nonexistent path, then checks production-only metrics, a Jaeger trace for studypilot-production, and a Loki log with the Dokku label. This proves the deployed endpoint emitted signals; demo traffic is not counted. Open the production service in Grafana and confirm test timestamps. A normal browser GET to / can then be shown in metrics, Jaeger, and Loki.

If validation fails, do not claim production observability works. Check Dokku process logs, Vector logs, and Collector logs. Fix connectivity, auth, or labels before relying on dashboards.

### 6. Rollback

If the app is unhealthy after an approved deploy, remove telemetry settings without restarting, remove the host mapping, and restore the previous release through the approved GitHub Actions path. The production database, photos, session key, and domains remain in place:

~~~sh
sudo dokku config:unset --no-restart studypilot \
  OTEL_ENABLED OTEL_SERVICE_NAME DEPLOYMENT_ENVIRONMENT \
  OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_HEADERS
sudo dokku docker-options:remove studypilot deploy "--add-host=host.docker.internal:host-gateway"
~~~

Revert through the existing main/GitHub Actions deployment process after approval; do not push directly to Dokku. Clear the Vector sink only if this rollout added it:

~~~sh
sudo dokku logs:set studypilot vector-sink
~~~

Retain Compose demo volumes. Never use compose down -v; production is not part of this Compose project.
