from fastapi.testclient import TestClient

from app.main import app


def test_task_lifecycle_and_filters(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "planner.db"))
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        created = client.post("/api/tasks", json={
            "title": "Deploy the MVP", "course": "DevOps", "due_date": "2026-10-09",
            "priority": "high", "description": "Run CI before pushing",
        })
        assert created.status_code == 201
        task = created.json()
        assert task["status"] == "todo"
        assert task["title"] == "Deploy the MVP"

        assert len(client.get("/api/tasks?course=DevOps").json()) == 1
        assert client.get("/api/tasks?status=done").json() == []

        updated = client.patch(f"/api/tasks/{task['id']}", json={"status": "in_progress"})
        assert updated.status_code == 200
        assert updated.json()["status"] == "in_progress"
        assert client.get(f"/api/tasks/{task['id']}").json()["course"] == "DevOps"

        assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
        assert client.get(f"/api/tasks/{task['id']}").status_code == 404


def test_validation_and_missing_task(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "planner.db"))
    with TestClient(app) as client:
        assert client.post("/api/tasks", json={"title": "", "due_date": "2026-10-09"}).status_code == 422
        assert client.post("/api/tasks", json={"title": "Essay", "due_date": "not-a-date"}).status_code == 422
        assert client.patch("/api/tasks/444", json={"status": "done"}).status_code == 404
        assert client.delete("/api/tasks/444").status_code == 404


def test_homepage_is_served(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "planner.db"))
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "StudyPilot" in response.text
