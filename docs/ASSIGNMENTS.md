# Assignment plan

## Task 1 — due October 9, 2026

**Goal:** demonstrate a working student assignment planner and a repeatable CI/CD path without changing the existing Dokku apps.

### MVP scope

- Create assignments with title, course, due date, priority, and notes.
- List, filter, edit, mark complete, and delete assignments.
- Persist the data in SQLite across container restarts.
- Provide a browser UI, a documented JSON API, `/health`, and FastAPI's `/docs` page.
- Package the app in a Docker image.
- Run automated tests on every push and pull request.
- On pushes to `main`, deploy only after tests pass, using the Dell's self-hosted runner and a separate Dokku app called `studypilot`.

### Architecture

```text
Browser (static HTML/CSS/JS)
        │ JSON over HTTP
        ▼
FastAPI application ───── SQLite file in persistent data volume
        │
        ├── /health
        └── /docs

GitHub push → hosted CI tests → Dell self-hosted runner → Dokku app `studypilot`
```

The first version is intentionally single-user and does not include accounts, a shared database, or external services. Give the app a unique Dokku hostname (for a LAN-only demo, `studypilot.test` can map to `192.168.1.105` in the Huawei's hosts file). It listens on the container's port 8000; Dokku routes by hostname through its existing web proxy. Portainer's host port 8000 and the existing demo app on port 80 are left alone.

### Task 1 demo sequence

1. Add a DevOps assignment due tomorrow with high priority.
2. Edit its notes and move it to In progress.
3. Filter to DevOps and mark the item complete.
4. Refresh the page to show persistence; open `/docs` to show the API.
5. Show the passing GitHub Actions test run. Demonstrate deployment after Dell runner and repository settings have been configured.

## Task 2 — due October 30, 2026

**Goal:** extend the app with OpenTelemetry traces and metrics, Prometheus/Grafana dashboards, Loki log search, and Jaeger trace inspection.

### Included foundation

- The app can export FastAPI and SQLite spans and a bounded-cardinality HTTP request counter and duration histogram using OTLP when `OTEL_ENABLED=true`.
- The Collector receives OTLP and routes traces to Jaeger and metrics to a Prometheus scrape endpoint.
- The app writes structured request logs to a JSON Lines file; Promtail ships those logs to Loki.
- A local Docker Compose stack provides Grafana, Prometheus, Loki, Promtail, the Collector, and Jaeger.
- All host-published observability ports bind to loopback and are distinct from the known server ports.

### Suggested implementation order

1. Run the local stack and check that app health remains green with telemetry enabled.
2. Generate a few requests; find the HTTP metrics in Prometheus and the spans in Jaeger.
3. Open Grafana and configure the bundled services as data sources; build a request-rate/latency panel and a logs panel.
4. Add screenshots and a short explanation of each signal to the assignment report.
5. Only if Dell capacity and network exposure have been reviewed, plan the observability services as a separate Dokku/server deployment. Do not put these dashboards on public ports.

The Compose stack is a local learning setup. It is not configured for authenticated remote access, long-term retention policy, alerting, or production-grade resource limits.

## What needs the user's accounts or server access

- Create the GitHub repository and push the `studypilot` folder from GitHub Desktop.
- Register a repository-scoped self-hosted Actions runner on the Dell with labels `linux`, `x64`, and `dokku`.
- Create the `studypilot` Dokku app and attach a domain if desired.
- Add a dedicated Dokku deploy public key and enter the host, private key, and verified host key as GitHub Actions secrets. Keep private keys out of Git, chat, screenshots, and workflow output.
- Observe the first Actions run and confirm that the new app deploys at the chosen domain. This workspace cannot access the user's GitHub or Dell account.
