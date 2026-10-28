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

The original planner was single-user. The current app adds account registration and login, private personal assignments, shared study groups, roles, invitations, task assignees, comments, project chat, activity, and notifications. SQLite changes are additive: existing task rows are preserved and assigned to the first account registered after the upgrade. All assignment and collaboration APIs now require a signed-in session. Give the app a unique Dokku hostname (for a LAN-only demo, `studypilot.test` can map to `192.168.1.105` in the Huawei's hosts file). It listens on the container's port 8000; Dokku routes by hostname through its existing web proxy. Portainer's host port 8000 and the existing demo app on port 80 are left alone.

Set a persistent random `SESSION_SECRET` in the Dokku app configuration and `COOKIE_SECURE=true` when serving over HTTPS. Back up the existing SQLite file before the first deployment of this upgrade. The automatic migration only adds schema and preserves rows; the first account claims rows with no owner. No deployment or database migration was run from this workspace.

### Task 1 demo sequence

1. Add a DevOps assignment due tomorrow with high priority.
2. Edit its notes and move it to In progress.
3. Filter to DevOps and mark the item complete.
4. Refresh the page to show persistence; open `/docs` to show the API.
5. Show the passing GitHub Actions test run. Demonstrate deployment after Dell runner and repository settings have been configured.

## Task 2 — due October 30, 2026

Task 2 is due October 30, 2026. The complete local learning stack and verification steps are in [the HW3 observability runbook](HW3_OBSERVABILITY.md).

**Goal:** extend the app with OpenTelemetry traces and metrics, Prometheus/Grafana dashboards, Loki log search, and Jaeger trace inspection.

### Included implementation

- Four bounded-cardinality HTTP metrics: request count, request duration, failed request count, and requests in progress.
- FastAPI and SQLite spans sent over OTLP to Jaeger through the OpenTelemetry Collector.
- Structured JSON Lines request logs shipped by Promtail to Loki and shown in Grafana.
- A provisioned Grafana dashboard and Prometheus, Loki, and Jaeger data sources.
- Loopback-only host ports, capped container memory, seven-day Prometheus/Loki retention, and a Compose project name and database volume separate from Dokku.

The runbook includes the Dell SSH setup, preflight checks, end-to-end signal verification, and live demo script. This Compose app is an isolated demo instance; monitoring the already deployed Dokku process would require a separate reviewed configuration change and is not done here.

## What needs the user's accounts or server access

- Create the GitHub repository and push the `studypilot` folder from GitHub Desktop.
- Register a repository-scoped self-hosted Actions runner on the Dell with labels `linux`, `x64`, and `dokku`.
- Create the `studypilot` Dokku app and attach a domain if desired.
- Add a dedicated Dokku deploy public key and enter the host, private key, and verified host key as GitHub Actions secrets. Keep private keys out of Git, chat, screenshots, and workflow output.
- Observe the first Actions run and confirm that the new app deploys at the chosen domain. This workspace cannot access the user's GitHub or Dell account.
