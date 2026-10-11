# StudyPilot

StudyPilot is a collaborative student workspace for assignments and study groups. It uses FastAPI and SQLite and runs locally or in the existing Docker/Dokku setup.

## Features

- A high-level Overview with completion progress, focus tasks, and clickable Up Next, In Progress, Completed, and Overdue counts; the searchable Assignment Board has To Do, Doing, Done, and Overdue views, Mine/Group/All scope filtering, drag-and-drop, keyboard movement, and full history search. Overdue means incomplete work due before the viewer’s local date; those tasks also remain in their current status view.
- Account registration, sign-in/out, unique case-insensitive usernames, profile photo upload, bio, theme, separate Profile and Settings views, and password settings. Photos are decoded, resized, re-encoded as WebP, and served only to the owner or connected classmates. Passwords are stored as salted scrypt hashes.
- Private personal assignments and project membership checks on every shared-data API.
- Shared group workspaces with owner, admin, and student roles; email-bound, expiring invitation links/codes; team assignment; and project milestones. Old editor memberships migrate to student; old viewer memberships remain read-only until an owner promotes them. Existing membership rows are preserved by additive migrations.
- Group discussion and private 1:1 chat share a responsive Messages workspace with grouped bubbles, date separators, scroll-position retention, three-dot message actions, edit/delete, durable tombstones, pinned-message search/jump in both group and private conversations, and unread counts.
- Separate Overview, Assignment Board, Groups, Calendar, Messages, and Classmates views; username search, compact relationship summaries, incoming/outgoing/friend/blocked lists, cancellable requests, and in-app notifications with bulk select/read/unread/delete and clear-all actions.
- Cryptographically random 70-bit group codes identify groups without granting membership. Users submit join requests, owners approve/reject/block them, and code rotation invalidates old codes. Existing one-time email invitations remain supported.
- Responsive layouts for mobile, tablet, and desktop, with loading, error, and empty states.
- Additive SQLite migrations preserve existing task rows, backfill stable unique handles for existing accounts, and add nullable started/completed timestamps plus task status history. Historical timestamps are never inferred.

## Run locally

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>. SQLite is stored at `data/studypilot.db`. The server creates a persistent signing key beside that database on first run. Back up that key with the database; changing it signs out active sessions. For a hosted deployment, set a long random `SESSION_SECRET` in the Dokku app configuration and set `COOKIE_SECURE=true` when traffic uses HTTPS. Keep the database and key in persistent private storage. The app does not expose personal or project data to anonymous requests.

For an isolated local preview on port **8765**, use a separate SQLite filename so your normal database stays untouched. If port 8765 is occupied, identify the owning process before stopping it; do not terminate an unrelated service.

```powershell
$env:DB_PATH = "data/studypilot-v6-preview.db"
$env:SESSION_SECRET = "local-preview-key-change-before-hosting"
$env:COOKIE_SECURE = "false"
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Open <http://127.0.0.1:8765>, create two accounts with different email addresses, create a group, copy its `SP-...` code, submit it from the second account, then approve it as the owner. Search for the second account by username, send and accept a friend request, and test private/group chat, message actions, pinned messages, and profile preferences. Group codes expire only when rotated/replaced and never grant membership; pending legacy email invitations remain email-bound and expire after seven days. Stop the server with Ctrl+C. The preview database and its signing-key file remain in `data/`.

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
- `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/{id}`, `GET /api/tasks/{id}/history`
- `GET/POST/PATCH/DELETE /api/projects`, `GET /api/projects/{id}`, join-code request/review/rotation endpoints, member-role/removal/ownership-transfer endpoints, and pinned group-message endpoints
- `POST /api/projects/{id}/invites`, `POST /api/invitations/{token}/accept`, `POST /api/invitations/accept`
- `GET/POST /api/projects/{id}/milestones`, `PATCH /api/projects/{id}/milestones/{milestone_id}`
- `GET/POST /api/projects/{id}/messages` (poll with `after_id`), `PATCH/DELETE /api/projects/{id}/messages/{message_id}`, owner-only pin/unpin
- `GET /api/people`, `GET /api/people/search?q=handle`, private connected-classmate photo access, friend request create/list/respond endpoints, `GET/POST /api/direct/conversations`, direct message CRUD and pin/unpin endpoints
- `GET/POST /api/tasks/{id}/comments`
- `GET /api/activity`, `GET/PATCH/DELETE /api/notifications`, `POST /api/notifications/read`
- `PATCH /api/profile`, `GET/POST /api/profile/photo`, `POST /api/profile/password`

All account, assignment, project, chat, comment, activity, and notification APIs require a signed-in session. Private conversations are limited to their two participants, and can be started by accepted friends or current group classmates. Blocking revokes access to direct conversations. Username lookup returns names and handles only, never email addresses. `GET /health` reports service readiness only. Password reset by email, outbound invitation email, external calendar sync, and WebSocket push are not included in this MVP; chat refreshes by polling.

## Task 2 observability — postponed until October 30

The pre-existing optional observability files are unchanged in this upgrade. Task 2 work remains postponed until October 30; the stack was not started or modified here. The existing local setup binds its dashboards to loopback; it is a learning stack, not hardened production monitoring. Do not publish its ports to the internet.
