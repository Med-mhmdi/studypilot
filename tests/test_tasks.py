import sqlite3
import io
from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app, _hash_password
from PIL import Image


def client_for(path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(path))
    client = TestClient(app)
    client.__enter__()
    return client


def register(client, email="alex@example.edu", name="Alex Student"):
    response = client.post("/api/auth/register", json={"email": email, "username": email.split("@")[0].replace("+", "."), "name": name, "password": "study-together-123"})
    assert response.status_code == 201, response.text
    return response.json()


def join_group(owner, member, project):
    code = owner.get(f"/api/projects/{project['id']}").json()["join_code"]
    requested = member.post("/api/projects/join-requests", json={"code": code})
    assert requested.status_code == 202, requested.text
    pending = owner.get(f"/api/projects/{project['id']}/join-requests").json()
    request = next(item for item in pending if item["user_id"] == member.get("/api/auth/me").json()["id"])
    approved = owner.post(f"/api/projects/{project['id']}/join-requests/{request['id']}/approve")
    assert approved.status_code == 200, approved.text
    return approved.json()


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


def test_projects_join_code_roles_chat_comments_and_notifications(tmp_path, monkeypatch):
    path = tmp_path / "planner.db"
    with client_for(path, monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Biology lab", "description": "Shared lab report"}).json()
        assert project["role"] == "owner"
        with TestClient(app) as teammate:
            register(teammate, "sam@example.edu", "Sam")
            join_group(owner, teammate, project)
            task = owner.post("/api/tasks", json={"title": "Draft methods", "due_date": "2026-10-15", "project_id": project["id"], "assignee_ids": [2]})
            assert task.status_code == 201, task.text
            assert len(teammate.get(f"/api/tasks?project_id={project['id']}").json()) == 1
            comment = teammate.post(f"/api/tasks/{task.json()['id']}/comments", json={"body": "I can review this tonight."})
            assert comment.status_code == 201
            comment_id = comment.json()["id"]
            assert owner.patch(f"/api/tasks/{task.json()['id']}/comments/{comment_id}", json={"body": "Owner cannot edit this."}).status_code == 403
            edited = teammate.patch(f"/api/tasks/{task.json()['id']}/comments/{comment_id}", json={"body": "I reviewed this tonight."})
            assert edited.status_code == 200 and edited.json()["body"] == "I reviewed this tonight."
            assert edited.json()["edited_at"]
            assert owner.delete(f"/api/tasks/{task.json()['id']}/comments/{comment_id}").status_code == 403
            assert teammate.delete(f"/api/tasks/{task.json()['id']}/comments/{comment_id}").status_code == 204
            assert owner.get(f"/api/tasks/{task.json()['id']}/comments").json() == []
            message = teammate.post(f"/api/projects/{project['id']}/messages", json={"body": "I found a useful source."})
            assert message.status_code == 201
            assert owner.get(f"/api/projects/{project['id']}/messages").json()[0]["body"] == "I found a useful source."
            assert owner.get("/api/notifications").json()
            assert owner.post("/api/notifications/read").status_code == 204
        # A stranger cannot read the shared project and the retired email route is gone.
        with TestClient(app) as outsider:
            register(outsider, "lee@example.edu", "Lee")
            assert outsider.post(f"/api/invitations/accept", json={"token":"x"*32}).status_code == 404
            assert outsider.get(f"/api/projects/{project['id']}").status_code == 404


def test_group_membership_uses_join_code_and_email_invites_are_removed(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Study group"}).json()
        with TestClient(app) as reader:
            register(reader, "reader@example.edu", "Reader")
            join_group(owner, reader, project)
            assert reader.post(f"/api/projects/{project['id']}/messages", json={"body": "hello"}).status_code == 201
            assert owner.post(f"/api/projects/{project['id']}/invites", json={"email":"other@example.edu"}).status_code == 404


def test_group_workspace_tasks_status_transitions_and_chat_timestamps(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Chemistry team"}).json()
        with TestClient(app) as teammate:
            register(teammate, "jules@example.edu", "Jules")
            joined = join_group(owner, teammate, project)
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
            assert teammate.delete(f"/api/projects/{project['id']}/milestones/{milestone.json()['id']}").status_code == 403
            assert owner.delete(f"/api/projects/{project['id']}/milestones/{milestone.json()['id']}").status_code == 204
        owned_group_tasks = owner.get(f"/api/tasks?project_id={project['id']}").json()
        assert len(owned_group_tasks) == 1 and owned_group_tasks[0]["id"] == task["id"]


def test_email_invitation_routes_are_removed_and_join_code_is_not_email_bound(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Physics study group"}).json()
        with TestClient(app) as wrong_user:
            register(wrong_user, "someone-else@example.edu", "Wrong user")
            assert wrong_user.post("/api/invitations/accept", json={"token": "x"*32}).status_code == 404
            assert wrong_user.get(f"/api/projects/{project['id']}").status_code == 404
        with TestClient(app) as invited_user:
            register(invited_user, "invited@example.edu", "Invited user")
            join_group(owner, invited_user, project)
            assert invited_user.get(f"/api/projects/{project['id']}").status_code == 200


def test_direct_messages_are_private_to_shared_group_participants(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as alice:
        register(alice, "alice@example.edu", "Alice")
        project = alice.post("/api/projects", json={"name": "Literature group"}).json()
        with TestClient(app) as ben:
            register(ben, "ben@example.edu", "Ben")
            join_group(alice, ben, project)
            contacts = ben.get("/api/people").json()
            assert contacts == [{"id": 1, "name": "Alice", "username": "alice", "avatar": "violet", "profile_photo": None, "profile_photo_version": None, "active_avatar_source":"avatar"}]
            group_search = ben.get("/api/people/search?q=alice").json()
            assert group_search[0]["relationship"] == "group_classmate"
            conversation = ben.post("/api/direct/conversations", json={"recipient_id": 1})
            assert conversation.status_code == 201
            conversation_id = conversation.json()["id"]
            sent = ben.post(f"/api/direct/conversations/{conversation_id}/messages", json={"body": "Can you review chapter two?"})
            assert sent.status_code == 201
            assert sent.json()["created_at"].endswith("Z")
            assert alice.get("/api/direct/conversations").json()[0]["unread_count"] == 1
            received = alice.get(f"/api/direct/conversations/{conversation_id}/messages")
            assert received.status_code == 200 and received.json()[0]["body"] == "Can you review chapter two?"
            assert alice.get("/api/direct/conversations").json()[0]["unread_count"] == 1
            alice.get(f"/api/direct/conversations/{conversation_id}/messages", params={"mark_read": "true"})
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


def test_photo_and_message_sync_migration_preserves_existing_data(tmp_path, monkeypatch):
    path=tmp_path / "avatar-message-migration.db"
    con=sqlite3.connect(path)
    con.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'violet', profile_photo TEXT)")
    con.execute("INSERT INTO users(id,email,name,password_hash,created_at,profile_photo) VALUES(1,'legacy@example.edu','Legacy','hash','old-user-created','legacy.webp')")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)")
    con.execute("INSERT INTO messages VALUES(1,1,1,'Keep this group message','old-message-created')")
    con.execute("CREATE TABLE direct_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)")
    con.execute("INSERT INTO direct_messages VALUES(1,1,1,'Keep this direct message','old-direct-created')")
    con.commit();con.close()
    with client_for(path,monkeypatch) as client:
        assert client.get("/health").status_code==200
        con=sqlite3.connect(path)
        user=con.execute("SELECT profile_photo,active_avatar_source FROM users WHERE id=1").fetchone()
        group_message=con.execute("SELECT body,created_at,updated_at FROM messages WHERE id=1").fetchone()
        direct_message=con.execute("SELECT body,created_at,updated_at FROM direct_messages WHERE id=1").fetchone()
        con.close()
        assert user==("legacy.webp","photo")
        assert group_message==("Keep this group message","old-message-created","old-message-created")
        assert direct_message==("Keep this direct message","old-direct-created","old-direct-created")


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
            assert search == [{"id": 2, "name": "Bobby", "username": "bobby", "avatar": "violet", "profile_photo": None, "profile_photo_version": None, "active_avatar_source":"avatar", "relationship": "not_connected"}]
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
            message=bob.post(f"/api/direct/conversations/{conversation_id}/messages", json={"body": "Study together?"}).json()
            assert any(row["kind"] == "direct_message" for row in alice.get("/api/notifications").json())
            assert alice.patch(f"/api/direct/conversations/{conversation_id}/messages/{message['id']}",json={"body":"No"}).status_code == 403
            assert bob.patch(f"/api/direct/conversations/{conversation_id}/messages/{message['id']}",json={"body":"Edited"}).json()["edited_at"]
            assert bob.delete(f"/api/direct/conversations/{conversation_id}/messages/{message['id']}").status_code == 204
            assert alice.get(f"/api/direct/conversations/{conversation_id}/messages").json()[0]["deleted_at"]
            assert alice.post(f"/api/friend-requests/{request.json()['id']}/block").json()["status"] == "blocked"
            assert alice.get(f"/api/direct/conversations/{conversation_id}/messages").status_code == 200
            assert alice.post(f"/api/direct/conversations/{conversation_id}/messages", json={"body":"blocked send"}).status_code == 403
            assert bob.post("/api/direct/conversations", json={"recipient_id": 1}).status_code == 403


def test_group_message_edit_delete_pin_authorization(tmp_path, monkeypatch):
    with client_for(tmp_path / "planner.db", monkeypatch) as owner:
        register(owner)
        project = owner.post("/api/projects", json={"name": "Study crew"}).json()
        with TestClient(app) as editor:
            register(editor, "sam@example.edu", "Sam")
            join_group(owner, editor, project)
            msg = editor.post(f"/api/projects/{project['id']}/messages", json={"body": "First draft"}).json()
            assert owner.patch(f"/api/projects/{project['id']}/messages/{msg['id']}", json={"body": "Changed by owner"}).status_code == 403
            edited = editor.patch(f"/api/projects/{project['id']}/messages/{msg['id']}", json={"body": "Revised draft"})
            assert edited.status_code == 200 and edited.json()["edited_at"]
            assert editor.post(f"/api/projects/{project['id']}/messages/{msg['id']}/pin").status_code == 403
            assert owner.post(f"/api/projects/{project['id']}/messages/{msg['id']}/pin").status_code == 200
            assert owner.get(f"/api/projects/{project['id']}/messages").json()[0]["pinned_at"]
            assert owner.get(f"/api/projects/{project['id']}/pinned-messages").json()[0]["id"] == msg["id"]
            assert editor.delete(f"/api/projects/{project['id']}/messages/{msg['id']}").status_code == 204
            tombstone = editor.get(f"/api/projects/{project['id']}/messages").json()[0]
            assert tombstone["deleted_at"] and tombstone["body"] == "Message deleted"
            assert owner.get(f"/api/projects/{project['id']}/messages").json()[0]["deleted_at"]


def test_shareable_join_code_request_approval_rotation_and_unread(tmp_path, monkeypatch):
    with client_for(tmp_path / "join.db", monkeypatch) as owner:
        register(owner, "owner@example.edu", "Owner")
        project = owner.post("/api/projects", json={"name": "Chemistry group"}).json()
        code = project["join_code"]
        updated = owner.patch(f"/api/projects/{project['id']}", json={"name":"Organic chemistry", "description":"Shared revision"})
        assert updated.status_code == 200 and updated.json()["name"] == "Organic chemistry"
        assert owner.get("/api/projects").json()[0]["name"] == "Organic chemistry"
        assert code.startswith("SP-") and len(code.removeprefix("SP-")) == 14
        with TestClient(app) as student:
            register(student, "student@example.edu", "Student")
            assert student.get(f"/api/projects/{project['id']}").status_code == 404
            request = student.post("/api/projects/join-requests", json={"code": code})
            assert request.status_code == 202 and request.json()["status"] == "pending"
            notice = owner.get("/api/notifications").json()[0]
            assert notice["kind"] == "group_join_request" and notice["project_name"] == "Organic chemistry"
            assert "Organic chemistry" in notice["detail"]
            assert student.get(f"/api/projects/{project['id']}").status_code == 404
            pending = owner.get(f"/api/projects/{project['id']}/join-requests").json()
            assert len(pending) == 1 and pending[0]["username"] == "student"
            approved = owner.post(f"/api/projects/{project['id']}/join-requests/{pending[0]['id']}/approve")
            assert approved.json()["status"] == "accepted"
            assert student.get(f"/api/projects/{project['id']}").status_code == 200
            assert student.get(f"/api/projects/{project['id']}").json()["members"][-1]["role"] == "student"
            message = owner.post(f"/api/projects/{project['id']}/messages", json={"body": "Welcome"}).json()
            assert student.get("/api/group-conversations").json()[0]["unread_count"] == 1
            assert student.get(f"/api/projects/{project['id']}/messages").json()[0]["id"] == message["id"]
            assert student.get("/api/group-conversations").json()[0]["unread_count"] == 1
            student.get(f"/api/projects/{project['id']}/messages", params={"mark_read": "true"})
            assert student.get("/api/group-conversations").json()[0]["unread_count"] == 0
            rotated = owner.post(f"/api/projects/{project['id']}/join-code/rotate").json()["code"]
            assert rotated != code
            with TestClient(app) as third:
                register(third, "third@example.edu", "Third")
                assert third.post("/api/projects/join-requests", json={"code": code}).status_code == 404
                assert third.post("/api/projects/join-requests", json={"code": rotated}).json()["status"] == "pending"
                for _ in range(8):
                    assert third.post("/api/projects/join-requests", json={"code":"SP-INVALID-CODE"}).status_code == 404
                assert third.post("/api/projects/join-requests", json={"code":"SP-INVALID-CODE"}).status_code == 429


def test_group_join_request_history_withdrawal_admin_scope_and_status(tmp_path, monkeypatch):
    with client_for(tmp_path / "join-history.db", monkeypatch) as owner:
        register(owner, "owner-history@example.edu", "Group Owner")
        chemistry = owner.post("/api/projects", json={"name":"Chemistry Circle", "avatar":"mint"}).json()
        physics = owner.post("/api/projects", json={"name":"Physics Circle", "avatar":"ocean"}).json()
        with TestClient(app) as admin, TestClient(app) as student, TestClient(app) as stranger:
            register(admin, "admin-history@example.edu", "Group Admin")
            register(student, "student-history@example.edu", "Student")
            register(stranger, "stranger-history@example.edu", "Stranger")
            join_group(owner, admin, chemistry)
            assert owner.patch(f"/api/projects/{chemistry['id']}/members/2", json={"role":"admin"}).status_code == 200

            first = student.post("/api/projects/join-requests", json={"code":chemistry["join_code"]})
            assert first.status_code == 202 and first.json()["status"] == "pending"
            again = student.post("/api/projects/join-requests", json={"code":chemistry["join_code"]})
            assert again.json() == {**first.json(),"created":False}
            mine = student.get("/api/my/group-join-requests").json()
            assert len(mine) == 1 and mine[0]["project_name"] == "Chemistry Circle" and mine[0]["project_avatar"] == "mint"
            assert mine[0]["status"] == "pending" and mine[0]["created_at"]
            assert student.get(f"/api/projects/{chemistry['id']}/join-requests").status_code == 404
            assert stranger.get(f"/api/projects/{chemistry['id']}/join-requests").status_code == 404
            assert stranger.get("/api/my/group-join-requests").json() == []
            assert stranger.delete(f"/api/my/group-join-requests/{first.json()['request_id']}").status_code == 404
            assert student.delete(f"/api/my/group-join-requests/{first.json()['request_id']}").status_code == 204
            assert owner.get(f"/api/projects/{chemistry['id']}/join-requests").json() == []
            assert student.get("/api/my/group-join-requests").json()[0]["status"] == "cancelled"

            second = student.post("/api/projects/join-requests", json={"code":chemistry["join_code"]}).json()
            requests = admin.get(f"/api/projects/{chemistry['id']}/join-requests")
            assert requests.status_code == 200 and requests.json()[0]["user_id"] == 3
            assert requests.json()[0]["project_name"] == "Chemistry Circle" and requests.json()[0]["avatar"] == "violet"
            assert admin.get(f"/api/projects/{physics['id']}/join-requests").status_code == 404
            assert owner.get("/api/projects").json()[0]["pending_join_request_count"] == 0
            assert admin.get(f"/api/projects/{chemistry['id']}").json()["pending_join_request_count"] == 1
            approved = admin.post(f"/api/projects/{chemistry['id']}/join-requests/{second['request_id']}/approve")
            assert approved.status_code == 200 and approved.json()["status"] == "accepted"
            assert admin.post(f"/api/projects/{chemistry['id']}/join-requests/{second['request_id']}/approve").status_code == 404
            assert student.get("/api/my/group-join-requests").json()[0]["status"] == "accepted"
            student_group=student.get(f"/api/projects/{chemistry['id']}").json()
            assert student_group["name"] == "Chemistry Circle" and student_group["join_code"] == chemistry["join_code"]
            assert student.get(f"/api/projects/{chemistry['id']}/join-requests").status_code == 403
            assert student.post(f"/api/projects/{chemistry['id']}/join-code/rotate").status_code == 403
            rotated=admin.post(f"/api/projects/{chemistry['id']}/join-code/rotate")
            assert rotated.status_code == 200 and rotated.json()["code"] != chemistry["join_code"]
            assert student.get(f"/api/projects/{chemistry['id']}").json()["join_code"] == rotated.json()["code"]
            assert any(item["kind"]=="group_join_response" for item in student.get("/api/notifications").json())

            third = student.post("/api/projects/join-requests", json={"code":physics["join_code"]}).json()
            declined = owner.post(f"/api/projects/{physics['id']}/join-requests/{third['request_id']}/reject")
            assert declined.status_code == 200 and declined.json()["status"] == "declined"
            statuses = {(row["project_name"],row["status"]) for row in student.get("/api/my/group-join-requests").json()}
            assert ("Chemistry Circle","accepted") in statuses and ("Physics Circle","declined") in statuses


def test_classmate_profile_privacy_block_unblock_and_photo_removal(tmp_path, monkeypatch):
    with client_for(tmp_path / "profiles-block.db", monkeypatch) as alice:
        register(alice, "alice-profile@example.edu", "Alice")
        with TestClient(app) as bob, TestClient(app) as stranger:
            register(bob, "bob-profile@example.edu", "Bob")
            register(stranger, "stranger-profile@example.edu", "Stranger")
            alice.patch("/api/profile", json={"name":"Alice","bio":"Biology student"})
            sent = alice.post("/api/friend-requests", json={"username":"bob-profile"})
            assert sent.status_code == 201
            assert bob.post(f"/api/friend-requests/{sent.json()['id']}/accept").status_code == 200
            profile = alice.get("/api/people/2")
            assert profile.status_code == 200
            assert profile.json() == {"id":2,"name":"Bob","username":"bob-profile","avatar":"violet","active_avatar_source":"avatar","bio":"","profile_photo":False,"profile_photo_version":None,"relationship":"friends","blocked_by_me":False,"blocked_me":False,"blocked":False,"needs_friend_request":False,"can_message":True}
            public_profile=stranger.get("/api/people/2")
            assert public_profile.status_code==200 and public_profile.json()["relationship"]=="not_connected" and "email" not in public_profile.json()
            conversation = alice.post("/api/direct/conversations", json={"recipient_id":2}).json()
            assert alice.post(f"/api/direct/conversations/{conversation['id']}/messages", json={"body":"hello"}).status_code == 201
            assert alice.post("/api/people/2/block").status_code == 204
            assert alice.get("/api/people/2").status_code == 200
            assert alice.get(f"/api/direct/conversations/{conversation['id']}/messages").status_code == 200
            assert alice.post(f"/api/direct/conversations/{conversation['id']}/messages",json={"body":"blocked"}).status_code == 403
            assert alice.post("/api/friend-requests", json={"username":"bob-profile"}).status_code == 403
            blocked = alice.get("/api/friend-requests").json()
            assert len(blocked) == 1 and blocked[0]["status"] == "blocked" and blocked[0]["blocked_by_me"] == 1
            assert bob.get("/api/friend-requests").json() == []
            assert alice.get("/api/people/search?q=bob-profile").json()[0]["relationship"] == "unavailable"
            assert alice.post("/api/people/1/block").status_code == 400
            assert alice.delete("/api/people/2/block").status_code == 204
            assert alice.get("/api/friend-requests").json() == []
            assert alice.post("/api/direct/conversations", json={"recipient_id":2}).status_code == 403

            photo=Image.new("RGB",(96,64),"#6543d1");stream=io.BytesIO();photo.save(stream,format="PNG")
            assert alice.post("/api/profile/photo",files={"photo":("avatar.png",stream.getvalue(),"image/png")}).status_code==200
            assert alice.delete("/api/profile/photo").status_code==204
            assert alice.get("/api/profile/photo").status_code==404


def test_block_keeps_history_and_requires_renewed_friendship(tmp_path, monkeypatch):
    with client_for(tmp_path / "block-transition.db", monkeypatch) as alice:
        register(alice, "alice-transition@example.edu", "Alice")
        project=alice.post("/api/projects",json={"name":"Shared group"}).json()
        with TestClient(app) as bob:
            register(bob,"bob-transition@example.edu","Bob")
            join_group(alice,bob,project)
            request=alice.post("/api/friend-requests",json={"username":"bob-transition"}).json()
            assert bob.post(f"/api/friend-requests/{request['id']}/accept").status_code==200
            conversation=alice.post("/api/direct/conversations",json={"recipient_id":2}).json()
            conversation_id=conversation["id"]
            old=alice.post(f"/api/direct/conversations/{conversation_id}/messages",json={"body":"Old history stays"}).json()
            assert bob.post(f"/api/direct/conversations/{conversation_id}/messages/{old['id']}/pin").status_code==200

            assert alice.post("/api/people/2/block").status_code==204
            for account, sender_id in ((alice,1),(bob,2)):
                listed=account.get("/api/direct/conversations").json()
                assert any(row["id"]==conversation_id and row["relationship_blocked"] for row in listed)
                history=account.get(f"/api/direct/conversations/{conversation_id}/messages")
                assert history.status_code==200 and history.json()[0]["body"]=="Old history stays"
                assert account.get(f"/api/direct/conversations/{conversation_id}/pinned-messages").json()[0]["id"]==old["id"]
                denied=account.post(f"/api/direct/conversations/{conversation_id}/messages",json={"body":f"blocked from {sender_id}"})
                assert denied.status_code==403 and "block" in denied.json()["detail"].lower()
                search=account.get("/api/people/search?q="+("bob-transition" if sender_id==1 else "alice-transition")).json()
                assert search and search[0]["relationship"]=="unavailable"
                assert account.post(f"/api/projects/{project['id']}/messages",json={"body":"Group chat still works"}).status_code==201
            assert alice.get("/api/people/2").json()["can_message"] is False
            assert alice.get(f"/api/projects/{project['id']}").status_code==200

            assert alice.delete("/api/people/2/block").status_code==204
            assert any(row["id"]==conversation_id for row in alice.get("/api/direct/conversations").json())
            assert alice.get("/api/people/search?q=bob-transition").json()[0]["relationship"]=="request_needed"
            assert alice.post("/api/direct/conversations",json={"recipient_id":2}).status_code==403
            assert alice.post(f"/api/direct/conversations/{conversation_id}/messages",json={"body":"still disabled"}).status_code==403
            fresh=alice.post("/api/friend-requests",json={"username":"bob-transition"})
            assert fresh.status_code==201
            assert bob.post(f"/api/friend-requests/{fresh.json()['id']}/accept").status_code==200
            assert alice.post(f"/api/direct/conversations/{conversation_id}/messages",json={"body":"Friendship restored"}).status_code==201


def test_direct_message_pins_are_private_and_jumpable_data(tmp_path, monkeypatch):
    with client_for(tmp_path / "direct-pins.db", monkeypatch) as owner:
        register(owner, "owner@example.edu", "Owner")
        project = owner.post("/api/projects", json={"name": "Study crew"}).json()
        with TestClient(app) as mate:
            register(mate, "mate@example.edu", "Mate")
            join_group(owner, mate, project)
            conversation = owner.post("/api/direct/conversations", json={"recipient_id": 2}).json()
            message = owner.post(f"/api/direct/conversations/{conversation['id']}/messages", json={"body": "Remember the lab notes"}).json()
            assert mate.post(f"/api/direct/conversations/{conversation['id']}/messages/{message['id']}/pin").json() == {"pinned": True}
            pinned = mate.get(f"/api/direct/conversations/{conversation['id']}/pinned-messages")
            assert pinned.status_code == 200 and pinned.json()[0]["id"] == message["id"]
            assert owner.get(f"/api/direct/conversations/{conversation['id']}/messages/{message['id']}").json()["pinned_at"]
            assert mate.delete(f"/api/direct/conversations/{conversation['id']}/messages/{message['id']}/pin").status_code == 204
            assert mate.get(f"/api/direct/conversations/{conversation['id']}/pinned-messages").json() == []
        with TestClient(app) as stranger:
            register(stranger, "stranger@example.edu", "Stranger")
            assert stranger.get(f"/api/direct/conversations/{conversation['id']}/pinned-messages").status_code == 404
            assert stranger.post(f"/api/direct/conversations/{conversation['id']}/messages/{message['id']}/pin").status_code == 404


def test_conversation_controls_are_private_and_preserve_shared_messages(tmp_path, monkeypatch):
    with client_for(tmp_path / "conversation-controls.db", monkeypatch) as alice:
        register(alice, "alice-controls@example.edu", "Alice")
        with TestClient(app) as bob, TestClient(app) as stranger:
            register(bob, "bob-controls@example.edu", "Bob")
            register(stranger, "stranger-controls@example.edu", "Stranger")
            project = alice.post("/api/projects", json={"name": "Study circle"}).json()
            join_group(alice, bob, project)
            group_id = project["id"]
            direct = alice.post("/api/direct/conversations", json={"recipient_id": 2}).json()
            direct_id = direct["id"]

            older = alice.post(f"/api/direct/conversations/{direct_id}/messages", json={"body": "Shared history"}).json()
            bob.post(f"/api/direct/conversations/{direct_id}/messages", json={"body": "A reply"})
            assert alice.post(f"/api/direct/conversations/{direct_id}/messages/{older['id']}/pin").status_code == 200
            group_old = bob.post(f"/api/projects/{group_id}/messages", json={"body": "Group history"}).json()

            # Names and state belong to the signed-in participant only.
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "nickname", "nickname": "Bro Med"}).status_code == 200
            assert alice.get("/api/direct/conversations").json()[0]["display_name"] == "Bro Med"
            assert bob.get("/api/direct/conversations").json()[0]["display_name"] == "Alice"
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "nickname", "nickname": "  "}).status_code == 200
            assert alice.get("/api/direct/conversations").json()[0]["display_name"] == "Bob"
            assert alice.patch(f"/api/group-conversations/{group_id}/state", json={"action": "nickname", "nickname": "Private group name"}).status_code == 400
            assert stranger.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "pin"}).status_code == 404
            assert stranger.patch(f"/api/group-conversations/{group_id}/state", json={"action": "archive"}).status_code == 404

            # Pin/unread/archive are per-user and an archived chat can be restored.
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "pin"}).status_code == 200
            assert alice.get("/api/direct/conversations").json()[0]["pinned"] == 1
            bob_unread_before = bob.get("/api/direct/conversations").json()[0]["unread_count"]
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "unread"}).status_code == 200
            assert alice.get("/api/direct/conversations").json()[0]["unread_count"] >= 1
            assert bob.get("/api/direct/conversations").json()[0]["unread_count"] == bob_unread_before
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "read"}).status_code == 200
            assert alice.get("/api/direct/conversations").json()[0]["unread_count"] == 0
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "unread"}).status_code == 200
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "archive"}).status_code == 200
            assert alice.get("/api/direct/conversations").json() == []
            assert alice.get("/api/direct/conversations?archived=true").json()[0]["archived"] == 1
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "unarchive"}).status_code == 200

            # Clearing advances only Alice's cutoff. Bob keeps all history; new incoming messages remain visible to Alice.
            assert alice.patch(f"/api/direct-conversations/{direct_id}/state", json={"action": "clear"}).status_code == 200
            assert alice.get(f"/api/direct/conversations/{direct_id}/messages").json() == []
            assert alice.get(f"/api/direct/conversations/{direct_id}/messages/{older['id']}").status_code == 404
            assert alice.get(f"/api/direct/conversations/{direct_id}/pinned-messages").json() == []
            assert bob.get(f"/api/direct/conversations/{direct_id}/messages").json()[0]["id"] == older["id"]
            assert bob.get(f"/api/direct/conversations/{direct_id}/messages/{older['id']}").status_code == 200
            bob.post(f"/api/direct/conversations/{direct_id}/messages", json={"body": "After clear", "reply_to_id": older["id"]})
            alice_after_clear = alice.get(f"/api/direct/conversations/{direct_id}/messages").json()
            assert [message["body"] for message in alice_after_clear] == ["After clear"]
            assert alice_after_clear[0]["reply_body"] is None
            assert [message["body"] for message in bob.get(f"/api/direct/conversations/{direct_id}/messages").json()] == ["Shared history", "A reply", "After clear"]

            assert alice.patch(f"/api/group-conversations/{group_id}/state", json={"action": "clear"}).status_code == 200
            assert alice.get(f"/api/projects/{group_id}/messages").json() == []
            assert alice.get(f"/api/projects/{group_id}/messages/{group_old['id']}").status_code == 404
            assert bob.get(f"/api/projects/{group_id}/messages").json()[0]["id"] == group_old["id"]
            bob.post(f"/api/projects/{group_id}/messages", json={"body": "Group after clear"})
            assert [message["body"] for message in alice.get(f"/api/projects/{group_id}/messages").json()] == ["Group after clear"]


def test_message_replies_group_avatar_and_unread_counts(tmp_path, monkeypatch):
    with client_for(tmp_path / "messages-v2.db", monkeypatch) as owner:
        register(owner, "owner@example.edu", "Owner")
        project = owner.post("/api/projects", json={"name": "Leaf team", "avatar": "mint"}).json()
        with TestClient(app) as mate:
            register(mate, "mate@example.edu", "Mate")
            join_group(owner, mate, project)
            listed = mate.get("/api/group-conversations").json()
            assert listed[0]["avatar"] == "mint"
            changed = owner.patch(f"/api/projects/{project['id']}", json={"name": "Leaf team", "description": "", "avatar": "coral"})
            assert changed.status_code == 200
            assert mate.get("/api/group-conversations").json()[0]["avatar"] == "coral"

            original = owner.post(f"/api/projects/{project['id']}/messages", json={"body": "Bring the green folder"}).json()
            assert owner.get("/api/group-conversations").json()[0]["unread_count"] == 0
            assert mate.get("/api/group-conversations").json()[0]["unread_count"] == 1
            reply = mate.post(f"/api/projects/{project['id']}/messages", json={"body": "I have it", "reply_to_id": original["id"]})
            assert reply.status_code == 201 and reply.json()["reply_to_id"] == original["id"]
            assert mate.get(f"/api/projects/{project['id']}/messages").json()[-1]["reply_body"] == "Bring the green folder"
            assert mate.post(f"/api/projects/{project['id']}/messages", json={"body": "bad reference", "reply_to_id": 987654}).status_code == 404
            assert owner.get("/api/group-conversations").json()[0]["unread_count"] == 1
            assert owner.get("/api/group-conversations").json()[0]["unread_count"] == 1
            owner.get(f"/api/projects/{project['id']}/messages", params={"mark_read": "true"})
            assert owner.get("/api/group-conversations").json()[0]["unread_count"] == 0

            direct = owner.post("/api/direct/conversations", json={"recipient_id": 2}).json()
            direct_id = direct["id"]
            direct_original = owner.post(f"/api/direct/conversations/{direct_id}/messages", json={"body": "Are we meeting at noon?"}).json()
            direct_reply = mate.post(f"/api/direct/conversations/{direct_id}/messages", json={"body": "Yes", "reply_to_id": direct_original["id"]})
            assert direct_reply.status_code == 201 and direct_reply.json()["reply_to_id"] == direct_original["id"]
            assert mate.get(f"/api/direct/conversations/{direct_id}/messages").json()[-1]["reply_body"] == "Are we meeting at noon?"
            assert mate.post(f"/api/direct/conversations/{direct_id}/messages", json={"body": "missing target", "reply_to_id": 987654}).status_code == 404
            assert owner.get("/api/direct/conversations").json()[0]["unread_count"] == 1
            assert owner.get(f"/api/direct/conversations/{direct_id}/messages").status_code == 200
            assert owner.get("/api/direct/conversations").json()[0]["unread_count"] == 1
            owner.get(f"/api/direct/conversations/{direct_id}/messages", params={"mark_read": "true"})
            assert owner.get("/api/direct/conversations").json()[0]["unread_count"] == 0


def test_notification_bulk_actions_are_scoped_to_the_signed_in_user(tmp_path, monkeypatch):
    path = tmp_path / "notifications.db"
    with client_for(path, monkeypatch) as alice:
        register(alice, "alice@example.edu", "Alice")
        with TestClient(app) as bob:
            register(bob, "bob@example.edu", "Bob")
            with sqlite3.connect(path) as con:
                con.execute("INSERT INTO notifications(user_id,kind,detail) VALUES(1,'test','Alice notification')")
                alice_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
                con.execute("INSERT INTO notifications(user_id,kind,detail) VALUES(2,'test','Bob notification')")
                bob_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
            assert alice.patch("/api/notifications", json={"action":"read","ids":[alice_id,bob_id]}).json()["updated"] == 1
            assert bob.get("/api/notifications").json()[0]["read_at"] is None
            assert alice.patch("/api/notifications", json={"action":"delete","ids":[bob_id]}).json()["updated"] == 0
            assert alice.patch("/api/notifications", json={"action":"unread","ids":[alice_id]}).json()["updated"] == 1
            assert alice.get("/api/notifications").json()[0]["read_at"] is None
            assert alice.delete("/api/notifications").status_code == 204
            assert alice.get("/api/notifications").json() == []
            assert bob.get("/api/notifications").json()[0]["id"] == bob_id


def test_notification_deletion_scope_preserves_other_tabs_and_users(tmp_path, monkeypatch):
    path = tmp_path / "notification-scopes.db"
    with client_for(path, monkeypatch) as alice:
        register(alice, "alice-scopes@example.edu", "Alice")
        with TestClient(app) as bob:
            register(bob, "bob-scopes@example.edu", "Bob")
            with sqlite3.connect(path) as con:
                con.executemany(
                    "INSERT INTO notifications(user_id,kind,detail) VALUES(1,?,?)",
                    [("direct_message", "Message one"), ("group_message", "Message two"), ("friend_request", "Other one")],
                )
                con.execute("INSERT INTO notifications(user_id,kind,detail) VALUES(2,'direct_message','Bob message')")
            records = alice.get("/api/notifications").json()
            messages = {item["id"] for item in records if "message" in item["kind"]}
            other = {item["id"] for item in records if "message" not in item["kind"]}
            assert len(messages) == 2 and len(other) == 1
            assert alice.patch("/api/notifications", json={"action":"delete","ids":list(messages),"scope":"messages"}).json()["updated"] == 2
            assert {item["id"] for item in alice.get("/api/notifications").json()} == other
            assert alice.patch("/api/notifications", json={"action":"delete","scope":"other"}).json()["updated"] == 1
            assert alice.get("/api/notifications").json() == []
            assert bob.get("/api/notifications").json()[0]["detail"] == "Bob message"


def test_group_role_permissions_and_ownership_transfer(tmp_path, monkeypatch):
    with client_for(tmp_path / "roles.db", monkeypatch) as owner:
        register(owner, "owner@example.edu", "Owner")
        project = owner.post("/api/projects", json={"name":"Team"}).json()
        with TestClient(app) as student:
            register(student, "student@example.edu", "Student")
            join_group(owner, student, project)
            assert student.patch(f"/api/projects/{project['id']}", json={"name":"Hijacked"}).status_code == 403
            assert student.post(f"/api/projects/{project['id']}/invites", json={"email":"other@example.edu"}).status_code == 404
            assert owner.patch(f"/api/projects/{project['id']}/members/2", json={"role":"admin"}).json()["role"] == "admin"
            assert student.patch(f"/api/projects/{project['id']}", json={"name":"Team renamed","description":"Shared goal"}).status_code == 200
            admin_update = student.patch(f"/api/projects/{project['id']}", json={"name":"Team renamed","description":"Shared goal","avatar":"ocean"})
            assert admin_update.status_code == 200 and admin_update.json()["avatar"] == "ocean"
            assert student.delete(f"/api/projects/{project['id']}/members/1").status_code == 403
            assert student.delete(f"/api/projects/{project['id']}").status_code == 403
            assert owner.post(f"/api/projects/{project['id']}/transfer-owner", json={"user_id":2}).status_code == 200
            assert owner.delete(f"/api/projects/{project['id']}").status_code == 403
        assert student.delete(f"/api/projects/{project['id']}").status_code == 204


def test_assignment_scope_filters_and_group_avatar_permissions(tmp_path, monkeypatch):
    with client_for(tmp_path / "scope-avatar.db", monkeypatch) as owner:
        register(owner)
        personal = owner.post("/api/tasks", json={"title":"Personal reading", "due_date":"2026-10-21"}).json()
        project = owner.post("/api/projects", json={"name":"Study circle", "avatar":"ocean"}).json()
        assert project["avatar"] == "ocean"
        shared = owner.post("/api/tasks", json={"title":"Group notes", "due_date":"2026-10-22", "project_id":project["id"]}).json()
        assert {task["id"] for task in owner.get("/api/tasks?scope=all").json()} == {personal["id"], shared["id"]}
        assert [task["id"] for task in owner.get("/api/tasks?scope=mine").json()] == [personal["id"]]
        assert [task["id"] for task in owner.get("/api/tasks?scope=group").json()] == [shared["id"]]
        assert owner.get("/api/tasks?scope=unknown").status_code == 422
        with client_for(tmp_path / "scope-avatar.db", monkeypatch) as student:
            register(student, "student@example.edu", "Student")
            join_group(owner, student, project)
            assert student.patch(f"/api/projects/{project['id']}", json={"name":"Changed", "avatar":"sun"}).status_code == 403
        updated = owner.patch(f"/api/projects/{project['id']}", json={"name":"Study circle", "description":"Shared notes", "avatar":"sun"})
        assert updated.status_code == 200 and updated.json()["avatar"] == "sun"
        assert owner.patch(f"/api/projects/{project['id']}", json={"name":"Study circle", "avatar":"file-path"}).status_code == 422


def test_calendar_rescheduling_enforces_task_write_permissions(tmp_path, monkeypatch):
    database = tmp_path / "calendar-reschedule.db"
    with client_for(database, monkeypatch) as owner:
        register(owner, "calendar-owner@example.edu", "Calendar Owner")
        project = owner.post("/api/projects", json={"name":"Calendar group"}).json()
        task = owner.post("/api/tasks", json={
            "title":"Move the lab report", "due_date":"2026-10-21", "project_id":project["id"],
        }).json()
        with TestClient(app) as viewer:
            register(viewer, "calendar-viewer@example.edu", "Calendar Viewer")
            join_group(owner, viewer, project)
            with sqlite3.connect(database) as con:
                con.execute("UPDATE project_members SET legacy_readonly=1 WHERE project_id=? AND user_id=2", (project["id"],))
            denied = viewer.patch(f"/api/tasks/{task['id']}", json={"due_date":"2026-11-02"})
            assert denied.status_code == 403
            assert owner.patch(f"/api/tasks/{task['id']}", json={"due_date":"2026-11-02"}).json()["due_date"] == "2026-11-02"
        with TestClient(app) as stranger:
            register(stranger, "calendar-stranger@example.edu", "Calendar Stranger")
            assert stranger.patch(f"/api/tasks/{task['id']}", json={"due_date":"2026-11-03"}).status_code == 404


def test_calendar_assignment_delete_respects_existing_write_permissions(tmp_path, monkeypatch):
    database = tmp_path / "calendar-delete.db"
    with client_for(database, monkeypatch) as owner:
        register(owner, "calendar-delete-owner@example.edu", "Calendar Delete Owner")
        project = owner.post("/api/projects", json={"name": "Calendar delete permissions"}).json()
        task = owner.post("/api/tasks", json={
            "title": "Permission-protected calendar item", "due_date": "2026-10-16", "project_id": project["id"],
        }).json()
        with TestClient(app) as viewer:
            register(viewer, "calendar-delete-viewer@example.edu", "Calendar Delete Viewer")
            join_group(owner, viewer, project)
            viewer_id = viewer.get("/api/auth/me").json()["id"]
            with sqlite3.connect(database) as con:
                con.execute("UPDATE project_members SET legacy_readonly=1 WHERE project_id=? AND user_id=?", (project["id"], viewer_id))
            assert viewer.delete(f"/api/tasks/{task['id']}").status_code == 403
            assert viewer.get(f"/api/tasks/{task['id']}").status_code == 200
        assert owner.delete(f"/api/tasks/{task['id']}").status_code == 204
        assert owner.get(f"/api/tasks/{task['id']}").status_code == 404


def test_legacy_group_roles_migrate_without_granting_old_viewers_write_access(tmp_path, monkeypatch):
    path=tmp_path/"legacy-roles.db"
    with sqlite3.connect(path) as con:
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT 'old')")
        con.execute("INSERT INTO users(id,email,name,password_hash) VALUES(1,'owner@example.edu','Owner',?)",(_hash_password("study-together-123"),))
        con.execute("INSERT INTO users(id,email,name,password_hash) VALUES(2,'reader@example.edu','Reader',?)",(_hash_password("study-together-123"),))
        con.execute("CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT 'old')")
        con.execute("INSERT INTO projects(id,name,created_by) VALUES(1,'Old group',1)")
        con.execute("CREATE TABLE project_members(project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),joined_at TEXT NOT NULL DEFAULT 'old',PRIMARY KEY(project_id,user_id))")
        con.execute("INSERT INTO project_members(project_id,user_id,role) VALUES(1,1,'owner')")
        con.execute("INSERT INTO project_members(project_id,user_id,role) VALUES(1,2,'viewer')")
    monkeypatch.setenv("DB_PATH",str(path))
    with TestClient(app) as owner, TestClient(app) as reader:
        assert owner.post("/api/auth/login",json={"email":"owner@example.edu","password":"study-together-123"}).status_code==200
        assert reader.post("/api/auth/login",json={"email":"reader@example.edu","password":"study-together-123"}).status_code==200
        project=reader.get("/api/projects/1").json()
        migrated=next(item for item in project["members"] if item["id"]==2)
        assert project["role"]=="viewer" and migrated["role"]=="student" and migrated["legacy_readonly"]==1
        with sqlite3.connect(path) as con:
            assert con.execute("SELECT role,role_v6 FROM project_members WHERE project_id=1 AND user_id=2").fetchone()==("viewer","student")
            assert con.execute("SELECT COUNT(*) FROM project_members WHERE project_id=1").fetchone()[0]==2
        assert reader.post("/api/projects/1/messages",json={"body":"still read only"}).status_code==403
        assert owner.patch("/api/projects/1/members/2",json={"role":"student"}).status_code==200
        assert reader.post("/api/projects/1/messages",json={"body":"promoted by owner"}).status_code==201


def test_profile_photo_is_reencoded_and_svg_or_invalid_images_are_rejected(tmp_path, monkeypatch):
    path = tmp_path / "photos.db"
    with client_for(path, monkeypatch) as alice:
        register(alice, "alice@example.edu", "Alice")
        image = Image.new("RGB", (1200, 800), "#6c5ce7")
        exif=Image.Exif(); exif[270]="private metadata"
        stream = io.BytesIO(); image.save(stream, format="JPEG", exif=exif)
        uploaded = alice.post("/api/profile/photo", files={"photo":("face.jpg",stream.getvalue(),"image/jpeg")})
        assert uploaded.status_code == 200 and uploaded.json()["profile_photo"] is True
        response = alice.get("/api/profile/photo")
        assert response.status_code == 200 and response.headers["content-type"] == "image/webp"
        decoded = Image.open(io.BytesIO(response.content))
        assert decoded.format == "WEBP" and max(decoded.size) <= 512 and not decoded.getexif()
        assert alice.post("/api/profile/photo", files={"photo":("face.svg",b"<svg xmlns='http://www.w3.org/2000/svg'/>","image/svg+xml")}).status_code == 415
        assert alice.post("/api/profile/photo", files={"photo":("fake.jpg",b"not an image","image/jpeg")}).status_code == 415
        assert alice.post("/api/profile/photo", files={"photo":("large.jpg",b"x"*(8*1024*1024+1),"image/jpeg")}).status_code == 413
        project=alice.post("/api/projects",json={"name":"Photo access group"}).json()
        with TestClient(app) as bob:
            register(bob, "bob@example.edu", "Bob")
            assert bob.get("/api/profile/photo").status_code == 404
            join_group(alice, bob, project)
            peer_photo=bob.get("/api/people/1/photo")
            assert peer_photo.status_code == 200 and peer_photo.headers["content-type"] == "image/webp"
        with TestClient(app) as stranger:
            register(stranger,"stranger@example.edu","Stranger")
            assert stranger.get("/api/people/1/photo").status_code == 200


def test_profile_preferences_friend_cancel_and_notifications(tmp_path, monkeypatch):
    with client_for(tmp_path / "people-v5.db", monkeypatch) as alice:
        register(alice, "alice-v5@example.edu", "Alice")
        with TestClient(app) as bob:
            register(bob, "bob-v5@example.edu", "Bob")
            updated = alice.patch("/api/profile", json={"name":"Alice", "avatar":"ocean", "bio":"Biology student", "theme":"dark"})
            assert updated.status_code == 200
            assert (updated.json()["avatar"], updated.json()["bio"], updated.json()["theme"]) == ("ocean", "Biology student", "dark")
            sent = alice.post("/api/friend-requests", json={"username":"bob-v5"})
            assert sent.status_code == 201
            assert alice.get("/api/people/search?q=bob-v5").json()[0]["relationship"] == "request_sent"
            assert bob.get("/api/notifications").json()[0]["kind"] == "friend_request"
            assert bob.post("/api/notifications/read").status_code == 204
            assert bob.get("/api/notifications").json()[0]["read_at"]
            assert bob.get("/api/people/search?q=alice-v5").json()[0]["relationship"] == "incoming_request"
            assert alice.delete(f"/api/friend-requests/{sent.json()['id']}").status_code == 204
            assert bob.get("/api/friend-requests").json() == []
            assert bob.get("/api/notifications").json()[0]["kind"] == "friend_request_cancelled"



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


def test_leave_group_and_owner_cannot_orphan_members(tmp_path, monkeypatch):
    with client_for(tmp_path / "leave.db", monkeypatch) as owner:
        register(owner, "owner@example.edu", "Owner")
        project = owner.post("/api/projects", json={"name":"Team"}).json()
        with TestClient(app) as student:
            register(student, "student@example.edu", "Student")
            join_group(owner, student, project)
            assert owner.post(f"/api/projects/{project['id']}/leave").status_code == 409
            assert owner.get(f"/api/projects/{project['id']}").status_code == 200
            assert student.post(f"/api/projects/{project['id']}/leave").status_code == 204
            assert student.get(f"/api/projects/{project['id']}").status_code == 404
        assert owner.post(f"/api/projects/{project['id']}/leave").status_code == 204
        assert owner.get("/api/projects").json() == []


def test_milestone_optional_date_title_limit_and_migration_cleanup(tmp_path, monkeypatch):
    path = tmp_path / "milestones.db"
    with sqlite3.connect(path) as con:
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT 'old')")
        con.execute("INSERT INTO users(id,email,name,password_hash) VALUES(1,'legacy@example.edu','Legacy','hash')")
        con.execute("CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT 'old')")
        con.execute("INSERT INTO projects(id,name,created_by) VALUES(1,'Legacy group',1)")
        con.execute("CREATE TABLE milestones(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT 'old')")
        con.execute("INSERT INTO milestones VALUES(1,1,'Keep this milestone','2026-10-20','open',1,'old')")
        con.execute("CREATE TABLE invitations(id INTEGER PRIMARY KEY,project_id INTEGER,email TEXT,token_hash TEXT)")
        con.execute("INSERT INTO invitations VALUES(1,1,'unused@example.edu','token-hash')")
    with client_for(path, monkeypatch) as owner:
        register(owner, "owner2@example.edu", "Owner")
        project = owner.post("/api/projects", json={"name":"Fresh group"}).json()
        without_date=owner.post(f"/api/projects/{project['id']}/milestones",json={"title":"Checkpoint"})
        assert without_date.status_code==201 and without_date.json()["due_date"] is None
        assert owner.post(f"/api/projects/{project['id']}/milestones",json={"title":"x"*41}).status_code==422
        con=sqlite3.connect(path)
        row=con.execute("SELECT title,due_date FROM milestones WHERE id=1").fetchone()
        invitation_exists=con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='invitations'").fetchone()
        nullable=next(column[3] for column in con.execute("PRAGMA table_info(milestones)") if column[1]=='due_date')
        con.close()
        assert row==("Keep this milestone","2026-10-20")
        assert invitation_exists is None and nullable==0


def test_group_assignment_reassignment_is_authorized_and_persisted(tmp_path, monkeypatch):
    with client_for(tmp_path / "assignees.db", monkeypatch) as owner:
        register(owner,"owner@example.edu","Owner")
        project=owner.post("/api/projects",json={"name":"Shared work"}).json()
        with TestClient(app) as mate:
            register(mate,"mate@example.edu","Mate")
            join_group(owner,mate,project)
            task=owner.post("/api/tasks",json={"title":"Shared task","due_date":"2026-10-21","project_id":project["id"],"assignee_ids":[]}).json()
            assert [item["id"] for item in task["assignees"]]==[1]
            updated=owner.patch(f"/api/tasks/{task['id']}",json={"assignee_ids":[2]})
            assert updated.status_code==200 and {item["id"] for item in updated.json()["assignees"]}=={1,2}
            assert mate.patch(f"/api/tasks/{task['id']}",json={"assignee_ids":[999]}).status_code==400
            cleared=owner.patch(f"/api/tasks/{task['id']}",json={"assignee_ids":[]})
            assert cleared.status_code==200 and [item["id"] for item in cleared.json()["assignees"]]==[1]


def test_v11_group_and_bounded_text_limits_are_enforced_on_create_and_edit(tmp_path, monkeypatch):
    with client_for(tmp_path / "v11-limits.db", monkeypatch) as client:
        register(client)
        group = client.post("/api/projects", json={"name": "Modern Biology Study Team"})
        assert group.status_code == 201
        assert len(group.json()["name"]) <= 50
        forty_char_name = "One Two Three abcdefghijklmnopqrstuvwxyz"
        assert len(forty_char_name) == 40
        assert client.post("/api/projects", json={"name": forty_char_name}).status_code == 201
        assert client.post("/api/projects", json={"name": "One Two Three Four Five"}).status_code == 201
        assert client.post("/api/projects", json={"name": "x" * 51}).status_code == 422
        assert client.patch(f"/api/projects/{group.json()['id']}", json={"name": "One Two Three Four Five"}).status_code == 200
        assert client.patch(f"/api/projects/{group.json()['id']}", json={"name": "x" * 51}).status_code == 422
        assert client.patch("/api/profile", json={"name": "Alex Student", "bio": "b" * 160}).status_code == 200
        assert client.patch("/api/profile", json={"name": "Alex Student", "bio": "b" * 161}).status_code == 422
        created = client.post("/api/tasks", json={"title": "t" * 80, "due_date": "2026-10-25"})
        assert created.status_code == 201
        assert client.post("/api/tasks", json={"title": "t" * 81, "due_date": "2026-10-25"}).status_code == 422
        assert client.patch(f"/api/tasks/{created.json()['id']}", json={"title": "u" * 80}).status_code == 200
        assert client.patch(f"/api/tasks/{created.json()['id']}", json={"title": "u" * 81}).status_code == 422


def test_v12_group_ui_limits_copy_feedback_and_shared_board_contract():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    html = (root / "static" / "index.html").read_text(encoding="utf-8")
    script = (root / "static" / "app.js").read_text(encoding="utf-8")
    styles = (root / "static" / "styles.css").read_text(encoding="utf-8")
    stabilization = (root / "static" / "stabilization.css").read_text(encoding="utf-8")
    favicon = root / "static" / "favicon.png"
    assert 'maxlength="40"' in html
    assert "Milestone title (max 40 characters)" in html
    assert 'href="/static/favicon.ico?v=12"' in html and favicon.is_file()
    assert "renderBoard(board,filtered,project" in script
    assert "setIcon(button,'check')" in script and "button.classList.add('is-copied')" in script
    assert "group-plan .board-lanes{grid-template-columns:repeat(4,minmax(0,1fr))" in styles
    assert "-webkit-line-clamp:2" in styles
    assert "#1684FF" in (root / "static" / "favicon.svg").read_text(encoding="utf-8")
    assert "progress-legend" in html and "progress-track .progress-segment" in stabilization
    assert "background-image: none" in stabilization and "linear-gradient(90deg,#8175e9,#48b592)" not in styles
    assert "message-bubble-row" in stabilization and "pinned-heading" in stabilization
    assert "requestConfirmation" in script and "function renderPinnedMessages" in script
    assert "confirm(" not in script and "alert(" not in script


def test_task_title_limit_and_overview_detail_hotfix_contract(tmp_path, monkeypatch):
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    html = (root / "static" / "index.html").read_text(encoding="utf-8")
    script = (root / "static" / "app.js").read_text(encoding="utf-8")
    styles = (root / "static" / "styles.css").read_text(encoding="utf-8")
    stabilization = (root / "static" / "stabilization.css").read_text(encoding="utf-8")
    assert 'id="title" name="title" maxlength="80"' in html
    assert "['done','Done',done],['doing','Doing',activeDoing],['todo','To do',activeTodo],['overdue','Overdue',overdueCount]" in script
    assert "flex-direction:row;overflow:hidden;min-height:11px" in styles
    assert "height: 340px; min-height: 340px; max-height: 340px" in stabilization
    assert "payload.title.length > 80" in script and "delete payload.title" in script
    assert ".task-details-body { min-width:0; overflow-x:hidden; overflow-y:auto" in stabilization

    database = tmp_path / "existing-long-title.db"
    with client_for(database, monkeypatch) as client:
        register(client)
        task = client.post("/api/tasks", json={"title": "Original title", "due_date": "2026-10-25"}).json()
        legacy_title = "legacy" * 20
        with sqlite3.connect(database) as con:
            con.execute("UPDATE tasks SET title=? WHERE id=?", (legacy_title, task["id"]))
        edited = client.patch(f"/api/tasks/{task['id']}", json={"description": "Updated notes"})
        assert edited.status_code == 200
        assert edited.json()["title"] == legacy_title
        assert edited.json()["description"] == "Updated notes"
        assert client.patch(f"/api/tasks/{task['id']}", json={"title": "x" * 81}).status_code == 422
def test_favicon_fallback_serves_the_mark_only_icon_without_stale_caching(tmp_path, monkeypatch):
    with client_for(tmp_path / "favicon.db", monkeypatch) as client:
        response = client.get("/favicon.ico")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/vnd.microsoft.icon")
        assert response.headers["cache-control"] == "no-cache, must-revalidate"
        assert response.content[:4] == b"\x00\x00\x01\x00"


def test_group_character_boundaries_and_line_breaks(tmp_path, monkeypatch):
    with client_for(tmp_path / "group-limits.db", monkeypatch) as client:
        register(client)
        description = "First line\n" + "d" * 389
        assert len(description) == 400
        created = client.post("/api/projects", json={"name": "n" * 50, "description": description})
        assert created.status_code == 201
        group_id = created.json()["id"]
        assert created.json()["description"] == description
        for method, url in [(client.post, "/api/projects"), (client.patch, f"/api/projects/{group_id}")]:
            assert method(url, json={"name": "n" * 51}).status_code == 422
            assert method(url, json={"name": "Valid", "description": "d" * 401}).status_code == 422
            valid = method(url, json={"name": "One Two Three Four Five Six", "description": description})
            assert valid.status_code in (200, 201)
            assert valid.json()["description"] == description
        assert client.get(f"/api/projects/{group_id}").json()["description"] == description
