# StudyPilot

A small student assignment planner built with FastAPI and SQLite. It is designed as the Task 1 DevOps MVP and leaves an opt-in OpenTelemetry stack for Task 2.

## What works

- Add, edit, complete, filter, and delete assignments.
- Keep assignment data in a local SQLite database.
- Health check at `/health` and API documentation at `/docs`.
- Run locally with Python, or build and run the same app with Docker.
- CI runs tests on GitHub-hosted runners. Deploys from `main` to the separate Dokku app `studypilot` using the Dell's repository self-hosted runner.

## Run on Windows with VS Code

1. Open this `studypilot` folder in VS Code.
2. In the VS Code terminal, create and activate an environment:

   ```powershell
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   ```

   Python 3.11 or newer is supported; Python 3.12 is the version used in CI. If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal, then activate again.
3. Start the app:

   ```powershell
   uvicorn app.main:app --reload
   ```

4. Open <http://127.0.0.1:8000>. The SQLite file is created at `data/studypilot.db`.

## Verify locally

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

## Docker

```powershell
docker build -t studypilot .
docker run --rm -p 8080:8000 -v studypilot-data:/app/data studypilot
```

Then open <http://127.0.0.1:8080>. The named volume preserves assignments when the container is replaced.

## GitHub Desktop and Actions

Use GitHub Desktop to add this folder as an existing local repository after creating the empty GitHub repository. Commit and push the project from GitHub Desktop. The workflow at `.github/workflows/ci-cd.yml` tests every push and pull request on GitHub-hosted Ubuntu. Only a push to `main` triggers deployment, and that job is restricted to a runner labeled `self-hosted`, `linux`, `x64`, `dokku`.

Before enabling deployment:

1. Install or update the GitHub Actions runner on the Dell and add the custom `dokku` label. Register it for this repository only. Keep it updated and do not allow untrusted pull-request code to run on it. Tests run on GitHub-hosted runners; only trusted pushes to `main` reach the Dell.
2. Create a **new** Dokku app named `studypilot`; do not change `demo-app` or Portainer. On the Dell, run `dokku apps:create studypilot`. The workflow sets its deploy branch to `main`. Assign this app a **unique hostname**; don't reuse the demo app's hostname. For a LAN-only test you can use `dokku domains:add studypilot studypilot.test`, then add `192.168.1.105 studypilot.test` to the Huawei's Windows hosts file as administrator. Dokku routes this hostname through the existing web proxy, so it does not need a new host port and does not replace the app on port 80.
3. As the runner's Linux user on the Dell, generate a dedicated SSH key (`ssh-keygen -t ed25519 -f ~/.ssh/studypilot-deploy -C studypilot-actions`). Add the public key using `dokku ssh-keys:add studypilot-actions ~/.ssh/studypilot-deploy.pub`. Put the private key only in the GitHub secret. In the GitHub repository's `Settings → Secrets and variables → Actions`, set these secrets:
   - `DOKKU_HOST`: hostname or IP reachable from the Dell runner (often `localhost` when the runner and Dokku are on the same server).
   - `DOKKU_SSH_PRIVATE_KEY`: private half of the dedicated deployment key.
   - `DOKKU_KNOWN_HOSTS`: the verified SSH host-key line for `DOKKU_HOST`.
4. In `Settings → Environments`, create `production` and optionally require approval. Protect `main` so only reviewed commits can deploy.

Do not put keys, tokens, or real passwords in this repository. The deployment job pushes to `dokku@DOKKU_HOST:studypilot`; it does not bind a new host port or modify the existing Dokku apps. The first deploy requires the runner, Dokku app, key, host-key secret, and GitHub settings above. I cannot complete those account/server steps from this workspace.

## Task 2: observability extension

The app has optional OpenTelemetry instrumentation controlled by `OTEL_ENABLED`. `compose.observability.yml` starts an OpenTelemetry Collector, Prometheus, Grafana, Loki, and Jaeger locally. Its dashboards are intentionally private to the local machine via loopback-only host bindings and use ports that avoid Portainer's 8000 and the existing site's 80. Start with:

```powershell
docker compose -f compose.observability.yml up --build
```

Use `http://localhost:13000` for Grafana, `http://localhost:19090` for Prometheus, and `http://localhost:16687` for Jaeger. Grafana's local demo login is `admin` / `change-me-local`; change it through `GRAFANA_PASSWORD` before running the stack on any shared machine. Prometheus, Loki, and Jaeger are provisioned as Grafana data sources. This is a learning/demo stack, not a hardened production monitoring deployment. Do not publish these ports to the internet. For Dokku, deploy this stack separately after reviewing memory and storage capacity on the Dell.

## API quick reference

- `GET /api/tasks?status=todo&course=DevOps` — list and filter.
- `POST /api/tasks` — create a task with JSON fields `title`, `course`, `due_date` (`YYYY-MM-DD`), `priority` (`low`, `medium`, `high`), `description`.
- `GET /api/tasks/{id}` — read one task.
- `PATCH /api/tasks/{id}` — update provided fields.
- `DELETE /api/tasks/{id}` — delete one task.
- `GET /health` — health/readiness response.

All sample data should be fictional. This MVP has no accounts or multi-user access control; do not expose it publicly with personal assignment data until authentication is added.
