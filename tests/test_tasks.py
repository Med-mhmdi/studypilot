import sqlite3

from fastapi.testclient import TestClient

from app.main import app


def client_for(path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(path))
    client = TestClient(app)
    client.__enter__()
    return client


def register(client, email="alex@example.edu", name="Alex Student"):
    response = client.post("/api/auth/register", json={"email": email, "name": name, "password": "study-together-123"})
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
        assert alice.post("/api/auth/register", json={"email": "alex@example.edu", "name": "A", "password": "study-together-123"}).status_code == 409
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
