# HW3: StudyPilot observability

**Due:** October 30, 2026  
**Signals:** FastAPI metrics → Prometheus → Grafana; FastAPI/SQLite traces → OpenTelemetry Collector → Jaeger; JSON request logs → Promtail → Loki → Grafana.

This is a separate Compose project named `studypilot-observability`. It builds a demo copy of the app and gives it a new `studypilot-observability_studypilot-data` volume. It does not use the Dokku app, its database, its signing key, or its environment. The existing Dokku service is left running and unchanged. To monitor that service itself later, first review a separate plan for adding telemetry settings to Dokku.

All published ports bind to the Dell's `127.0.0.1`. Do not change them to `0.0.0.0` or add router port forwarding. Prometheus retains up to seven days/1 GB; Loki retains seven days. Container memory caps total about 2.5 GB, leaving most of the Dell's 11 GB available for its existing services.

Traces keep route templates and status codes but the Collector removes raw URL/query attributes before sending spans to Jaeger. The app does not add request bodies or cookies to its own logs.

## 1. Connect to Dell and check capacity

From Windows PowerShell, connect with the same SSH account normally used on the Dell:

```powershell
ssh <your-dell-user>@dexter
```

On Dell, locate the existing StudyPilot checkout and confirm it is not the path you will use for this stack. Pick a separate directory (the examples use `~/studypilot-hw3`) and check free memory, disk, Docker, and port availability before starting anything:

```sh
free -h
df -h "$HOME"
docker info --format '{{.ServerVersion}}'
ss -ltn | grep -E ':(13000|13100|14317|14318|14319|14320|16687|18080|19090)\b' || true
```

If a port is already in use, stop and investigate before proceeding. These commands do not stop or modify any existing service.

## 2. Get the reviewed feature branch

After reviewing this branch/PR, fetch it on Dell. Use a separate checkout so the existing Dokku deploy checkout and files are not changed:

```sh
mkdir -p ~/studypilot-hw3
cd ~/studypilot-hw3
git clone --branch feature/hw3-observability https://github.com/Med-mhmdi/studypilot.git .
```

If the directory is already a checkout of this branch, update it with `git pull --ff-only`. Use your normal authenticated GitHub transport if the repository asks you to sign in. Do not run Git commands in the Dokku application's server directory.

## 3. Preflight, set a Grafana password, and start

Make a private local environment file. The password is required and is not stored in Git:

```sh
cd ~/studypilot-hw3
umask 077
printf 'GRAFANA_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env.observability
docker compose --env-file .env.observability -f compose.observability.yml config --quiet
docker compose --env-file .env.observability -f compose.observability.yml build app
```

The `config --quiet` step is the Compose preflight; it checks the merged configuration without starting containers. If the build succeeds, start only this isolated stack:

```sh
docker compose --env-file .env.observability -f compose.observability.yml up -d
docker compose --env-file .env.observability -f compose.observability.yml ps
curl --fail http://127.0.0.1:18080/health
```

Expected health response: `{"status":"ok"}`. Check logs if a service is not `Up`:

```sh
docker compose --env-file .env.observability -f compose.observability.yml logs --tail=80
```

## 4. Open the dashboards safely from your laptop

Leave the SSH connection above open. In a second PowerShell window, open a local tunnel to the Dell:

```powershell
ssh -N -L 13000:127.0.0.1:13000 -L 16687:127.0.0.1:16687 -L 19090:127.0.0.1:19090 <your-dell-user>@dexter
```

Then use these addresses on your laptop:

- Grafana: <http://127.0.0.1:13000> (user `admin`; use the password from Dell's `.env.observability`)
- Jaeger: <http://127.0.0.1:16687>
- Prometheus (optional): <http://127.0.0.1:19090>

The browser reaches the loopback-bound services through SSH; nothing needs to be opened to the LAN or internet.

## 5. Verify all signals

On Dell, run the end-to-end smoke check. It sends ordinary health and 404 requests to the demo copy, then waits for Prometheus, Jaeger, and Loki to receive them:

```sh
cd ~/studypilot-hw3
python3 scripts/verify_observability.py
```

It should print PASS for Prometheus scraping and the four HTTP metrics, Jaeger traces for `studypilot`, and request logs in Loki. The first run may take up to two minutes while the collector exports and Prometheus scrapes. Investigate any FAIL before the demo.

You can also show the live data manually:

- In Prometheus, query `studypilot_http_requests_total`, `studypilot_http_duration_seconds_count`, `studypilot_http_errors_total`, and `studypilot_http_requests_in_flight`.
- In Jaeger, select service `studypilot`, click **Find Traces**, and open a `/health` trace. Its spans include the FastAPI server span and SQLite query spans.
- In Grafana, open **Dashboards → StudyPilot overview**. It has request rate, p95 latency, error rate, in-flight requests, and recent JSON logs.
- In Grafana **Explore**, select Loki and run `{job="studypilot"}`.

## 6. Short live demo (simple English)

1. “This is a separate demo copy. The real Dokku app and its database are not connected.”
2. Generate a successful and a failed request on Dell:
   ```sh
   curl -s http://127.0.0.1:18080/health
   curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:18080/not-a-real-page
   ```
3. “Prometheus collects four measurements: how many requests arrive, how long they take, how many fail, and how many are happening now.” Show the StudyPilot overview dashboard.
4. “Jaeger shows the path of one request through FastAPI and SQLite.” Open a `/health` trace.
5. “Loki lets us search the request log.” In Grafana Explore, show `{job="studypilot"}` and the 404 line.
6. “Grafana brings the measurements and logs together. The dashboards are available through my SSH connection only.”

**ملاحظات بالعربية:** هذه نسخة تجريبية منفصلة عن تطبيق Dokku وقاعدة بياناته. افتح Grafana عبر نفق SSH، ثم اعرض المقاييس الأربعة، وتتبع `/health` في Jaeger، وسجلّات الطلبات في Loki. لا نفتح المنافذ للإنترنت.

## Stop and clean up

To stop containers while keeping the demo database and dashboards for a later run:

```sh
docker compose --env-file .env.observability -f compose.observability.yml down
```

Do not add `-v`: that would delete this demo stack's volumes. The existing Dokku app is unaffected either way, but retaining the demo data makes the next presentation quicker.
