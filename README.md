# StudyPilot

StudyPilot is a student assignment planner with accounts and shared study groups. It uses FastAPI and SQLite and runs locally or in the existing Docker/Dokku setup.

## Features

- Personal assignments with due dates, courses, priority, status, notes, and filters.
- Account registration, sign-in/out, display name and password settings. Passwords are stored as salted scrypt hashes.
- Private personal assignments and project membership checks on every shared-data API.
- Shared projects with owner, editor, and viewer roles; email-bound, expiring invitations; and multi-user task assignments.
- Project chat with four-second polling, assignment comments, recent activity, and in-app notifications.
- Responsive layouts for mobile, tablet, and desktop.
- Additive SQLite migration: the existing task table and rows are retained. The first account created claims legacy tasks that do not yet have an owner.

## Run locally

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>. SQLite is stored at `data/studypilot.db`. The server creates a persistent signing key beside that database on first run. Back up that key with the database; changing it signs out active sessions. For a hosted deployment, set a long random `SESSION_SECRET` in the Dokku app configuration and set `COOKIE_SECURE=true` when traffic uses HTTPS. Keep the database and key in persistent private storage. The app does not expose personal or project data to anonymous requests.

The first account created in a fresh database becomes the first user. For an existing database, the first registered account claims legacy unowned tasks, so register the existing owner before sharing the app address with classmates. New users only see their own assignments and projects to which they have been invited. Invitations are created in the app and returned as a link to share through the group’s usual channel; StudyPilot does not send email.

## Run tests

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Docker

```powershell
docker build -t studypilot .
docker run --rm -p 8080:8000 -v studypilot-data:/app/data `
  -e SESSION_SECRET="replace-with-a-long-random-secret" studypilot
```

Open <http://127.0.0.1:8080>. Keep the named volume and `SESSION_SECRET` private and persistent. When serving over HTTPS, also set `COOKIE_SECURE=true`; browsers require HTTPS for secure cookies.

## GitHub Actions and Dokku

The existing `.github/workflows/ci-cd.yml` remains intact: GitHub-hosted runners run tests, then trusted pushes to `main` deploy to the separate `studypilot` Dokku app through the existing self-hosted runner. No deployment was run as part of this upgrade.

Before enabling deployment:

1. Register the Dell's Actions runner for this repository only, with labels `self-hosted`, `linux`, `x64`, and `dokku`. Keep it updated and restrict untrusted pull-request code from running on it.
2. Use the existing separate Dokku app named `studypilot`. Give it its own hostname; do not change `demo-app`, Portainer, or the existing site. Dokku routes through its current proxy.
3. Configure the deploy secrets in GitHub repository settings: `DOKKU_HOST`, `DOKKU_SSH_PRIVATE_KEY`, and the verified `DOKKU_KNOWN_HOSTS` line. Use a dedicated deployment key.
4. Set a persistent random `SESSION_SECRET` and, for an HTTPS hostname, `COOKIE_SECURE=true` in the Dokku app environment. Keep the existing SQLite volume persistent so assignments and accounts survive deploys.
5. Protect `main` and review the first GitHub Actions and Dokku deployment.

The workflow uses strict SSH host-key checking and deploys only after tests pass. Keep private keys and real passwords out of the repository and workflow output.

## HTTP API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/{id}`
- `GET/POST /api/projects`, `GET /api/projects/{id}`
- `POST /api/projects/{id}/invites`, `POST /api/invitations/{token}/accept`
- `GET/POST /api/projects/{id}/messages` (poll with `after_id`)
- `GET/POST /api/tasks/{id}/comments`
- `GET /api/activity`, `GET /api/notifications`, `POST /api/notifications/read`
- `PATCH /api/profile`, `POST /api/profile/password`

All account, assignment, project, chat, comment, activity, and notification APIs require a signed-in session. `GET /health` reports service readiness only. Password reset by email and outbound invitation email are not included in this MVP.

## Task 2 observability — postponed until October 30

The pre-existing optional observability files are unchanged in this upgrade. Task 2 work remains postponed until October 30; the stack was not started or modified here. The existing local setup binds its dashboards to loopback; it is a learning stack, not hardened production monitoring. Do not publish its ports to the internet.
