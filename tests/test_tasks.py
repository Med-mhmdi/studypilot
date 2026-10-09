import sqlite3
from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app


def client_for(path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(path))
    client = TestClient(app)
    client.__enter__()
    return client


def register(client, email="alex@example.edu", name="Alex Student"):
    response = client.post("/api/auth/register", json={"email": email, "username": email.split("@")[0].replace("+", "."), "name": name, "password": "study-together-123"})
    assert response.status_code == 201, response.text
    return response.json()


def test_task_lifecycle_and_filters(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/api/tasks").status_code == 401
        register(client)
        created = client.post("/api/tasks", json={
            "title": "Deploy the MVP", "course": "DevOps", "due_date": "2026-10-09",
            "priority": "high", "description": "Run CI before pushing",
        })
        assert created.status_code == 201
        task = created.json()
        assert task["status"] == "todo" and task["title"] == "Deploy the MVP"
        assert len(client.get("/api/tasks?course=DevOps").json()) == 1
        assert client.get("/api/tasks?status=done").json() == []
        updated = client.patch(f"/api/tasks/{task['id']}", json={"status": "in_progress"})
        assert updated.status_code == 200 and updated.json()["status"] == "in_progress"
        assert client.get(f"/api/tasks/{task['id']}").json()["course"] == "DevOps"
        assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
        assert client.get(f"/api/tasks/{task['id']}").status_code == 404


def test_validation_profile_and_private_personal_tasks(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as alice:
        assert alice.post("/api/tasks", json={"title": "Secret", "due_date": "2026-10-09"}).status_code == 401
        register(alice)
        task = alice.post("/api/tasks", json={"title": "My notes", "due_date": "2026-10-09"}).json()
        assert alice.post("/api/auth/register", json={"email": "alex@example.edu", "username": "alex", "name": "A", "password": "study-together-123"}).status_code == 409
        assert alice.post("/api/tasks", json={"title": "", "due_date": "2026-10-09"}).status_code == 422
        assert alice.post("/api/tasks", json={"title": "Essay", "due_date": "bad-date"}).status_code == 422
        assert alice.patch("/api/tasks/444", json={"status": "done"}).status_code == 404
        assert alice.delete("/api/tasks/444").status_code == 404
        with TestClient(app) as bob:
            register(bob, "bob@example.edu", "Bob")
            assert bob.get("/api/tasks").json() == []
            assert bob.get(f"/api/tasks/{task['id']}").status_code == 404
        assert alice.patch("/api/profile", json={"name": "Alex A."}).json()["name"] == "Alex A."
        assert alice.post("/api/profile/password", json={"current_password": "wrong-password", "new_password": "a-new-strong-password"}).status_code == 400
        assert alice.post("/api/profile/password", json={"current_password": "study-together-123", "new_password": "a-new-strong-password"}).status_code == 204
        assert alice.post("/api/auth/logout").status_code == 204
        assert alice.get("/api/tasks").status_code == 401


def test_projects_invites_roles_chat_comments_and_notifications(tmp_path, monkeypatch):
    path = tmp_path / "planner.db"
    with client_for(path, monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Biology lab", "description": "Shared lab report"}).json()
        assert project["role"] == "owner"
        invite = owner.post(f"/api/projects/{project['id']}/invites", json={"email": "sam@example.edu", "role": "editor"})
        assert invite.status_code == 201
        with TestClient(app) as teammate:
            register(teammate, "sam@example.edu", "Sam")
            assert teammate.post(f"/api/invitations/{invite.json()['token']}/accept").status_code == 200
            task = owner.post("/api/tasks", json={"title": "Draft methods", "due_date": "2026-10-15", "project_id": project["id"], "assignee_ids": [2]})
            assert task.status_code == 201, task.text
            assert len(teammate.get(f"/api/tasks?project_id={project['id']}").json()) == 1
            comment = teammate.post(f"/api/tasks/{task.json()['id']}/comments", json={"body": "I can review this tonight."})
            assert comment.status_code == 201
            message = teammate.post(f"/api/projects/{project['id']}/messages", json={"body": "I found a useful source."})
            assert message.status_code == 201
            assert owner.get(f"/api/projects/{project['id']}/messages").json()[0]["body"] == "I found a useful source."
            assert owner.get("/api/notifications").json()
            assert owner.post("/api/notifications/read").status_code == 204
        # Invitation tokens are one-time; a stranger cannot read the shared project.
        with TestClient(app) as outsider:
            register(outsider, "lee@example.edu", "Lee")
            assert outsider.post(f"/api/invitations/{invite.json()['token']}/accept").status_code == 404
            assert outsider.get(f"/api/projects/{project['id']}").status_code == 404


def test_viewer_cannot_write_and_invitation_is_email_bound(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Study group"}).json()
        invite = owner.post(f"/api/projects/{project['id']}/invites", json={"email": "reader@example.edu", "role": "viewer"}).json()
        with TestClient(app) as reader:
            register(reader, "reader@example.edu", "Reader")
            assert reader.post(f"/api/invitations/{invite['token']}/accept").status_code == 200
            assert reader.post(f"/api/projects/{project['id']}/messages", json={"body": "hello"}).status_code == 403
            assert reader.post("/api/tasks", json={"title": "Nope", "due_date": "2026-10-09", "project_id": project["id"]}).status_code == 403


def test_group_workspace_tasks_status_transitions_and_chat_timestamps(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Chemistry team"}).json()
        invite = owner.post(f"/api/projects/{project['id']}/invites", json={"email": "jules@example.edu", "role": "editor"}).json()
        with TestClient(app) as teammate:
            register(teammate, "jules@example.edu", "Jules")
            joined = teammate.post("/api/invitations/accept", json={"token": invite["token"]})
            assert joined.status_code == 200
            task = owner.post("/api/tasks", json={"title": "Finish data table", "due_date": "2026-10-15", "project_id": project["id"], "assignee_ids": [2]}).json()
            assert len(owner.get(f"/api/tasks?project_id={project['id']}").json()) == 1
            assert teammate.get(f"/api/tasks?project_id={project['id']}").json()[0]["id"] == task["id"]
            for status in ("in_progress", "done", "todo"):
                changed = teammate.patch(f"/api/tasks/{task['id']}", json={"status": status})
                assert changed.status_code == 200 and changed.json()["status"] == status
            group_message = teammate.post(f"/api/projects/{project['id']}/messages", json={"body": "The table is ready."}).json()
            assert group_message["created_at"].endswith("Z")
            assert datetime.fromisoformat(group_message["created_at"].replace("Z", "+00:00")).tzinfo is not None
            assert owner.get(f"/api/projects/{project['id']}/messages").json()[0]["body"] == "The table is ready."
            milestone = owner.post(f"/api/projects/{project['id']}/milestones", json={"title": "Submit draft", "due_date": "2026-10-20"})
            assert milestone.status_code == 201
            assert teammate.get(f"/api/projects/{project['id']}/milestones").json()[0]["title"] == "Submit draft"
            assert teammate.patch(f"/api/projects/{project['id']}/milestones/{milestone.json()['id']}", json={"status": "done"}).status_code == 200
        owned_group_tasks = owner.get(f"/api/tasks?project_id={project['id']}").json()
        assert len(owned_group_tasks) == 1 and owned_group_tasks[0]["id"] == task["id"]


def test_invitation_code_is_email_bound_and_one_time(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Physics study group"}).json()
        invite = owner.post(f"/api/projects/{project['id']}/invites", json={"email": "invited@example.edu"}).json()
        with TestClient(app) as wrong_user:
            register(wrong_user, "someone-else@example.edu", "Wrong user")
            assert wrong_user.post("/api/invitations/accept", json={"token": invite["token"]}).status_code == 403
            assert wrong_user.get(f"/api/projects/{project['id']}").status_code == 404
        with TestClient(app) as invited_user:
            register(invited_user, "invited@example.edu", "Invited user")
            accepted = invited_user.post("/api/invitations/accept", json={"token": invite["token"]})
            assert accepted.status_code == 200
            assert invited_user.get(f"/api/projects/{project['id']}").status_code == 200
            assert invited_user.post("/api/invitations/accept", json={"token": invite["token"]}).status_code == 404


def test_direct_messages_are_private_to_shared_group_participants(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as alice:
        register(alice, "alice@example.edu", "Alice")
        project = alice.post("/api/projects", json={"name": "Literature group"}).json()
        invite = alice.post(f"/api/projects/{project['id']}/invites", json={"email": "ben@example.edu"}).json()
        with TestClient(app) as ben:
            register(ben, "ben@example.edu", "Ben")
            ben.post(f"/api/invitations/{invite['token']}/accept")
            contacts = ben.get("/api/people").json()
            assert contacts == [{"id": 1, "name": "Alice", "username": "alice"}]
            conversation = ben.post("/api/direct/conversations", json={"recipient_id": 1})
            assert conversation.status_code == 201
            conversation_id = conversation.json()["id"]
            sent = ben.post(f"/api/direct/conversations/{conversation_id}/messages", json={"body": "Can you review chapter two?"})
            assert sent.status_code == 201
            assert sent.json()["created_at"].endswith("Z")
            assert alice.get("/api/direct/conversations").json()[0]["unread_count"] == 1
            received = alice.get(f"/api/direct/conversations/{conversation_id}/messages")
            assert received.status_code == 200 and received.json()[0]["body"] == "Can you review chapter two?"
            assert alice.get("/api/direct/conversations").json()[0]["unread_count"] == 0
            reply = alice.post(f"/api/direct/conversations/{conversation_id}/messages", json={"body": "Yes, I will."})
            assert reply.status_code == 201
        with TestClient(app) as stranger:
            register(stranger, "stranger@example.edu", "Stranger")
            assert stranger.get("/api/people").json() == []
            assert stranger.get(f"/api/direct/conversations/{conversation_id}/messages").status_code == 404
            assert stranger.post("/api/direct/conversations", json={"recipient_id": 1}).status_code == 404


def test_additive_migration_preserves_legacy_rows(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,course TEXT NOT NULL DEFAULT '',due_date TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT 'old-created',updated_at TEXT NOT NULL DEFAULT 'old-updated')""")
    con.execute("INSERT INTO tasks(title,course,due_date,priority,status,description) VALUES('Legacy essay','History','2026-10-15','medium','todo','Keep me')")
    con.commit(); con.close()
    with client_for(path, monkeypatch) as client:
        assert client.get("/api/tasks").status_code == 401
        rows = sqlite3.connect(path).execute("SELECT id,title,description FROM tasks").fetchall()
        assert rows == [(1, "Legacy essay", "Keep me")]
        user = register(client)
        tasks = client.get("/api/tasks").json()
        assert len(tasks) == 1 and tasks[0]["title"] == "Legacy essay" and tasks[0]["owner_id"] == user["id"]


def test_homepage_is_served(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as client:
        response = client.get("/")
        assert response.status_code == 200 and "StudyPilot" in response.text
        assert "Recent Activity" not in response.text
        script = client.get("/static/app.js").text
        assert "function timestamp(value)" in script and "[+-]\\d{2}:?\\d{2}" in script



def test_login_payload_and_task_status_timestamps(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as client:
        register(client)
        assert client.post("/api/auth/logout").status_code == 204
        login = client.post("/api/auth/login", json={"email": "alex@example.edu", "password": "study-together-123"})
        assert login.status_code == 200 and login.json()["username"] == "alex"
        task = client.post("/api/tasks", json={"title": "Read chapter", "due_date": "2026-10-07"}).json()
        assert task["started_at"] is None and task["completed_at"] is None
        started = client.patch(f"/api/tasks/{task['id']}", json={"status": "in_progress"}).json()
        assert started["started_at"] and started["completed_at"] is None
        completed = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"}).json()
        assert completed["started_at"] == started["started_at"] and completed["completed_at"]
        assert len(client.get(f"/api/tasks/{task['id']}/history").json()) == 2
        reopened = client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"}).json()
        assert reopened["completed_at"] is None and reopened["started_at"] == started["started_at"]


def test_username_friend_request_accept_block_and_private_access(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as alice:
        register(alice, "alice@example.edu", "Alice")
        with TestClient(app) as bob:
            register(bob, "bobby@example.edu", "Bobby")
            search = alice.get("/api/people/search?q=bob").json()
            assert search == [{"id": 2, "name": "Bobby", "username": "bobby"}]
            assert alice.get("/api/people/search?q=%%%").json() == []
            assert "email" not in search[0]
            assert alice.patch("/api/profile", json={"name": "Alice", "username": "BOBBY"}).status_code == 409
            request = alice.post("/api/friend-requests", json={"username": "@bobby"})
            assert request.status_code == 201
            incoming = bob.get("/api/friend-requests").json()
            assert incoming[0]["direction"] == "incoming" and incoming[0]["status"] == "pending"
            assert bob.post(f"/api/friend-requests/{request.json()['id']}/accept").json()["status"] == "accepted"
            conversation = alice.post("/api/direct/conversations", json={"recipient_id": 2})
            assert conversation.status_code == 201
            conversation_id = conversation.json()["id"]
            assert bob.post(f"/api/direct/conversations/{conversation_id}/messages", json={"body": "Study together?"}).status_code == 201
            assert alice.post(f"/api/friend-requests/{request.json()['id']}/block").json()["status"] == "blocked"
            assert alice.get(f"/api/direct/conversations/{conversation_id}/messages").status_code == 404
            assert bob.post("/api/direct/conversations", json={"recipient_id": 1}).status_code == 404


def test_group_message_edit_delete_pin_authorization(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Study crew"}).json()
        invite = owner.post(f"/api/projects/{project['id']}/invites", json={"email": "sam@example.edu"}).json()
        with TestClient(app) as editor:
            register(editor, "sam@example.edu", "Sam")
            editor.post(f"/api/invitations/{invite['token']}/accept")
            msg = editor.post(f"/api/projects/{project['id']}/messages", json={"body": "First draft"}).json()
            assert owner.patch(f"/api/projects/{project['id']}/messages/{msg['id']}", json={"body": "Changed by owner"}).status_code == 403
            edited = editor.patch(f"/api/projects/{project['id']}/messages/{msg['id']}", json={"body": "Revised draft"})
            assert edited.status_code == 200 and edited.json()["edited_at"]
            assert editor.post(f"/api/projects/{project['id']}/messages/{msg['id']}/pin").status_code == 403
            assert owner.post(f"/api/projects/{project['id']}/messages/{msg['id']}/pin").status_code == 200
            assert owner.get(f"/api/projects/{project['id']}/messages").json()[0]["pinned_at"]
            assert editor.delete(f"/api/projects/{project['id']}/messages/{msg['id']}").status_code == 204
            assert owner.get(f"/api/projects/{project['id']}/messages").json() == []



def test_legacy_account_gets_unique_handle_without_fabricated_task_dates(tmp_path, monkeypatch):
    path = tmp_path / "legacy-users.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%%Y-%%m-%%dT%%H:%%M:%%SZ','now')))")
    con.execute("INSERT INTO users(email,name,password_hash,created_at) VALUES('legacy.student@example.edu','Legacy Student','legacy-hash','old-created')")
    con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,course TEXT NOT NULL DEFAULT '',due_date TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT 'old-created',updated_at TEXT NOT NULL DEFAULT 'old-updated')")
    con.execute("INSERT INTO tasks(title,due_date,priority,status) VALUES('Old assignment','2025-09-01','medium','done')")
    con.commit(); con.close()
    with client_for(path, monkeypatch) as client:
        register(client, "new.student@example.edu", "New Student")
        con = sqlite3.connect(path)
        legacy_username = con.execute("SELECT username FROM users WHERE email='legacy.student@example.edu'").fetchone()[0]
        task_columns = {row[1] for row in con.execute("PRAGMA table_info(tasks)")}
        dates = con.execute("SELECT started_at,completed_at FROM tasks WHERE id=1").fetchone()
        con.close()
        assert legacy_username == "legacy.student"
        assert {"started_at", "completed_at"}.issubset(task_columns)
        assert dates == (None, None)


def test_invitation_expiration_is_enforced(tmp_path, monkeypatch):
    path = tmp_path / "planner.db"
    with client_for(path, monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Review group"}).json()
        invite = owner.post(f"/api/projects/{project['id']}/invites", json={"email": "late@example.edu"}).json()
        con = sqlite3.connect(path)
        con.execute("UPDATE invitations SET expires_at='2000-01-01T00:00:00Z'")
        con.commit(); con.close()
        with TestClient(app) as late:
            register(late, "late@example.edu", "Late Student")
            assert late.post("/api/invitations/accept", json={"token": invite['token']}).status_code == 404
