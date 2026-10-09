from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
import hashlib
import hmac
import os
import secrets
import sqlite3
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app import db
from app.schemas import (InviteCreate, Login, MessageCreate, PasswordUpdate, ProfileUpdate,
                         ProjectCreate, Priority, Register, TaskCreate, TaskStatus, TaskUpdate)
from app.telemetry import configure_telemetry, request_metrics


def _session_secret() -> str:
    configured = os.getenv("SESSION_SECRET")
    if configured:
        return configured
    path = db.database_path().with_suffix(".session-key")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        secret = secrets.token_urlsafe(48)
        try:
            with path.open("x", encoding="utf-8") as key_file:
                key_file.write(secret)
            if os.name != "nt":
                os.chmod(path, 0o600)
        except FileExistsError:
            secret = path.read_text(encoding="utf-8").strip()
        return secret


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.initialize()
    yield


app = FastAPI(title="StudyPilot", version="0.2.0", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=_session_secret(), session_cookie="studypilot_session",
                   same_site="strict", https_only=os.getenv("COOKIE_SECURE", "false").lower() == "true",
                   max_age=60 * 60 * 24 * 14)
configure_telemetry(app)
request_metrics(app)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse("static/index.html")


@app.get("/health")
def health():
    try:
        with db.connect() as connection:
            connection.execute("SELECT 1")
        return {"status": "ok"}
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc


def current_user(request: Request) -> dict:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="sign in to continue")
    with db.connect() as con:
        row = con.execute("SELECT id,email,name,created_at FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        request.session.clear()
        raise HTTPException(status_code=401, detail="sign in to continue")
    return dict(row)


User = Annotated[dict, Depends(current_user)]


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt, expected = encoded.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _profile(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "email": row["email"], "name": row["name"], "created_at": row["created_at"]}


def _membership(con: sqlite3.Connection, project_id: int, user_id: int) -> sqlite3.Row:
    row = con.execute("SELECT role FROM project_members WHERE project_id=? AND user_id=?", (project_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="project not found")
    return row


def _can_edit(role: str) -> None:
    if role == "viewer":
        raise HTTPException(status_code=403, detail="editor access is required")


def _task_access(con: sqlite3.Connection, task_id: int, user_id: int, write: bool = False) -> sqlite3.Row:
    row = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="assignment not found")
    if row["project_id"] is None:
        if row["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="assignment not found")
    else:
        member = con.execute("SELECT role FROM project_members WHERE project_id=? AND user_id=?", (row["project_id"], user_id)).fetchone()
        if member is None:
            raise HTTPException(status_code=404, detail="assignment not found")
        if write:
            _can_edit(member["role"])
    if write and row["project_id"] is None and row["owner_id"] != user_id:
        raise HTTPException(status_code=404, detail="assignment not found")
    return row


def _task_json(con: sqlite3.Connection, row: sqlite3.Row) -> dict:
    task = db.row_to_task(row)
    task["assignees"] = [dict(item) for item in con.execute(
        "SELECT u.id,u.name,u.email FROM task_assignees a JOIN users u ON u.id=a.user_id WHERE a.task_id=? ORDER BY u.name", (row["id"],)
    ).fetchall()]
    return task


def _log_activity(con: sqlite3.Connection, project_id: int | None, actor_id: int, kind: str, detail: str) -> None:
    con.execute("INSERT INTO activity(project_id,user_id,kind,detail) VALUES(?,?,?,?)", (project_id, actor_id, kind, detail))
    if project_id is not None:
        con.execute("""INSERT INTO notifications(user_id,project_id,actor_id,kind,detail)
            SELECT user_id,?,?,?,? FROM project_members WHERE project_id=? AND user_id<>?""",
            (project_id, actor_id, kind, detail, project_id, actor_id))


@app.post("/api/auth/register", status_code=201)
def register(body: Register, request: Request):
    email, name = str(body.email).strip().lower(), body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be blank")
    with db.connect() as con:
        if con.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            count = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        else:
            count = 0
        try:
            cur = con.execute("INSERT INTO users(email,name,password_hash) VALUES(?,?,?)", (email, name, _hash_password(body.password)))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="an account with this email already exists") from exc
        user_id = cur.lastrowid
        if count == 0:
            # Claim pre-authentication assignments for the first account without rebuilding the table.
            con.execute("UPDATE tasks SET owner_id=? WHERE owner_id IS NULL AND project_id IS NULL", (user_id,))
    request.session.clear()
    request.session["user_id"] = user_id
    with db.connect() as con:
        return _profile(con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())


@app.post("/api/auth/login")
def login(body: Login, request: Request):
    with db.connect() as con:
        row = con.execute("SELECT * FROM users WHERE email=? COLLATE NOCASE", (str(body.email).strip(),)).fetchone()
    if row is None or not _verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="email or password is incorrect")
    request.session.clear()
    request.session["user_id"] = row["id"]
    return _profile(row)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, _user: User):
    request.session.clear()
    return Response(status_code=204)


@app.get("/api/auth/me")
def me(user: User):
    return user


@app.patch("/api/profile")
def update_profile(body: ProfileUpdate, user: User):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be blank")
    with db.connect() as con:
        con.execute("UPDATE users SET name=? WHERE id=?", (name, user["id"]))
        return _profile(con.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())


@app.post("/api/profile/password", status_code=204)
def update_password(body: PasswordUpdate, user: User):
    with db.connect() as con:
        row = con.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        if not _verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="current password is incorrect")
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (_hash_password(body.new_password), user["id"]))
    return Response(status_code=204)


@app.get("/api/projects")
def list_projects(user: User):
    with db.connect() as con:
        return [dict(row) for row in con.execute("""SELECT p.*,m.role,
            (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id=p.id) AS member_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count
            FROM projects p JOIN project_members m ON m.project_id=p.id
            WHERE m.user_id=? ORDER BY p.created_at DESC,p.id DESC""", (user["id"],)).fetchall()]


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectCreate, user: User):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="project name cannot be blank")
    with db.connect() as con:
        cur = con.execute("INSERT INTO projects(name,description,created_by) VALUES(?,?,?)", (name, body.description.strip(), user["id"]))
        project_id = cur.lastrowid
        con.execute("INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,'owner')", (project_id, user["id"]))
        _log_activity(con, project_id, user["id"], "project_created", f"created {name}")
        return dict(con.execute("SELECT p.*,m.role,1 AS member_count,0 AS task_count FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND m.user_id=?", (project_id, user["id"])).fetchone())


@app.get("/api/projects/{project_id}")
def get_project(project_id: int, user: User):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        project = dict(con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())
        project["members"] = [dict(row) for row in con.execute("SELECT u.id,u.name,u.email,m.role,m.joined_at FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.name", (project_id,)).fetchall()]
        return project


@app.post("/api/projects/{project_id}/invites", status_code=201)
def invite(project_id: int, body: InviteCreate, user: User):
    email = str(body.email).strip().lower()
    token = secrets.token_urlsafe(32)
    with db.connect() as con:
        role = _membership(con, project_id, user["id"])["role"]
        if role != "owner":
            raise HTTPException(status_code=403, detail="only project owners can invite members")
        target = con.execute("SELECT id FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone()
        if target and con.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (project_id, target["id"])).fetchone():
            raise HTTPException(status_code=409, detail="this person is already a member")
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        con.execute("INSERT INTO invitations(project_id,email,token_hash,role,invited_by,expires_at) VALUES(?,?,?,?,?,?)", (project_id, email, token_hash, body.role, user["id"], expires))
        return {"email": email, "role": body.role, "token": token, "expires_at": expires}


@app.post("/api/invitations/{token}/accept")
def accept_invite(token: str, user: User):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db.connect() as con:
        row = con.execute("SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL", (token_hash,)).fetchone()
        if row is None or row["expires_at"] < datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
            raise HTTPException(status_code=404, detail="invitation is invalid or expired")
        if row["email"].lower() != user["email"].lower():
            raise HTTPException(status_code=403, detail="sign in with the invited email address")
        con.execute("INSERT OR IGNORE INTO project_members(project_id,user_id,role) VALUES(?,?,?)", (row["project_id"], user["id"], row["role"]))
        con.execute("UPDATE invitations SET accepted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (row["id"],))
        _log_activity(con, row["project_id"], user["id"], "member_joined", f"{user['name']} joined the project")
        return dict(con.execute("SELECT * FROM projects WHERE id=?", (row["project_id"],)).fetchone())


@app.get("/api/tasks")
def list_tasks(user: User, status: Annotated[TaskStatus | None, Query()] = None,
               course: Annotated[str | None, Query(max_length=80)] = None,
               project_id: int | None = None):
    clauses = ["(t.owner_id=? AND t.project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.user_id=?))"]
    values: list[object] = [user["id"], user["id"]]
    if status:
        clauses.append("t.status=?"); values.append(status.value)
    if course:
        clauses.append("t.course=?"); values.append(course)
    if project_id is not None:
        clauses.append("t.project_id=?"); values.append(project_id)
    where = " WHERE " + " AND ".join(clauses)
    with db.connect() as con:
        rows = con.execute(f"SELECT t.* FROM tasks t{where} ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END,t.due_date,t.id", values).fetchall()
        return [_task_json(con, row) for row in rows]


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate, user: User):
    title = task.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title cannot be blank")
    with db.connect() as con:
        if task.project_id is not None:
            role = _membership(con, task.project_id, user["id"])["role"]
            _can_edit(role)
        cur = con.execute("INSERT INTO tasks(title,course,due_date,priority,status,description,owner_id,project_id) VALUES(?,?,?,?, 'todo', ?,?,?)",
                          (title, task.course.strip(), task.due_date.isoformat(), task.priority.value, task.description.strip(), user["id"], task.project_id))
        task_id = cur.lastrowid
        assignees = set(task.assignee_ids) | {user["id"]}
        for assignee_id in assignees:
            if task.project_id is None and assignee_id != user["id"]:
                raise HTTPException(status_code=400, detail="personal assignments cannot be shared")
            if task.project_id is not None and not con.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (task.project_id, assignee_id)).fetchone():
                raise HTTPException(status_code=400, detail="assignees must be project members")
            con.execute("INSERT OR IGNORE INTO task_assignees(task_id,user_id,assigned_by) VALUES(?,?,?)", (task_id, assignee_id, user["id"]))
        _log_activity(con, task.project_id, user["id"], "assignment_created", f"created {title}")
        return _task_json(con, con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.get("/api/tasks/{task_id}")
def get_task(task_id: int, user: User):
    with db.connect() as con:
        return _task_json(con, _task_access(con, task_id, user["id"]))


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, task: TaskUpdate, user: User):
    changes = task.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="provide at least one field")
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="updated fields cannot be null")
    with db.connect() as con:
        row = _task_access(con, task_id, user["id"], write=True)
        assignee_ids = changes.pop("assignee_ids", None)
        if "title" in changes:
            changes["title"] = changes["title"].strip()
            if not changes["title"]:
                raise HTTPException(status_code=422, detail="title cannot be blank")
        for key in ("course", "description"):
            if key in changes:
                changes[key] = changes[key].strip()
        for key, value in list(changes.items()):
            if isinstance(value, (date, Priority, TaskStatus)):
                changes[key] = value.value if isinstance(value, (Priority, TaskStatus)) else value.isoformat()
        if changes:
            assignments = ", ".join(f"{key}=?" for key in changes)
            con.execute(f"UPDATE tasks SET {assignments},updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", [*changes.values(), task_id])
        if assignee_ids is not None:
            ids = set(assignee_ids) | {row["owner_id"]}
            for assignee_id in ids:
                if row["project_id"] is None and assignee_id != row["owner_id"]:
                    raise HTTPException(status_code=400, detail="personal assignments cannot be shared")
                if row["project_id"] is not None and not con.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (row["project_id"], assignee_id)).fetchone():
                    raise HTTPException(status_code=400, detail="assignees must be project members")
            con.execute("DELETE FROM task_assignees WHERE task_id=?", (task_id,))
            con.executemany("INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(?,?,?)", [(task_id, i, user["id"]) for i in ids])
        _log_activity(con, row["project_id"], user["id"], "assignment_updated", f"updated {row['title']}")
        return _task_json(con, con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: User):
    with db.connect() as con:
        row = _task_access(con, task_id, user["id"], write=True)
        con.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        _log_activity(con, row["project_id"], user["id"], "assignment_deleted", f"deleted {row['title']}")
    return Response(status_code=204)


@app.get("/api/tasks/{task_id}/comments")
def list_comments(task_id: int, user: User):
    with db.connect() as con:
        _task_access(con, task_id, user["id"])
        return [dict(row) for row in con.execute("SELECT c.id,c.task_id,c.body,c.created_at,u.id AS user_id,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE task_id=? ORDER BY c.id", (task_id,)).fetchall()]


@app.post("/api/tasks/{task_id}/comments", status_code=201)
def create_comment(task_id: int, body: MessageCreate, user: User):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="comment cannot be blank")
    with db.connect() as con:
        task = _task_access(con, task_id, user["id"], write=True)
        cur = con.execute("INSERT INTO comments(task_id,user_id,body) VALUES(?,?,?)", (task_id, user["id"], text))
        _log_activity(con, task["project_id"], user["id"], "comment_added", f"commented on {task['title']}")
        return dict(con.execute("SELECT c.id,c.task_id,c.body,c.created_at,u.id AS user_id,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?", (cur.lastrowid,)).fetchone())


@app.get("/api/projects/{project_id}/messages")
def list_messages(project_id: int, user: User, after_id: int = Query(default=0, ge=0)):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        return [dict(row) for row in con.execute("SELECT m.id,m.project_id,m.body,m.created_at,u.id AS user_id,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.id>? ORDER BY m.id LIMIT 100", (project_id, after_id)).fetchall()]


@app.post("/api/projects/{project_id}/messages", status_code=201)
def send_message(project_id: int, body: MessageCreate, user: User):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="message cannot be blank")
    with db.connect() as con:
        role = _membership(con, project_id, user["id"])["role"]
        _can_edit(role)
        cur = con.execute("INSERT INTO messages(project_id,user_id,body) VALUES(?,?,?)", (project_id, user["id"], text))
        _log_activity(con, project_id, user["id"], "message_sent", "sent a project message")
        return dict(con.execute("SELECT m.id,m.project_id,m.body,m.created_at,u.id AS user_id,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?", (cur.lastrowid,)).fetchone())


@app.get("/api/activity")
def activity(user: User, limit: int = Query(default=30, ge=1, le=100)):
    with db.connect() as con:
        return [dict(row) for row in con.execute("""SELECT a.id,a.project_id,a.kind,a.detail,a.created_at,u.name AS actor
            FROM activity a JOIN users u ON u.id=a.user_id
            WHERE a.project_id IS NULL AND a.user_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=a.project_id AND m.user_id=?)
            ORDER BY a.id DESC LIMIT ?""", (user["id"], user["id"], limit)).fetchall()]


@app.get("/api/notifications")
def notifications(user: User):
    with db.connect() as con:
        return [dict(row) for row in con.execute("""SELECT n.id,n.project_id,n.kind,n.detail,n.read_at,n.created_at,u.name AS actor
            FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.id DESC LIMIT 50""", (user["id"],)).fetchall()]


@app.post("/api/notifications/read", status_code=204)
def mark_notifications_read(user: User):
    with db.connect() as con:
        con.execute("UPDATE notifications SET read_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id=? AND read_at IS NULL", (user["id"],))
    return Response(status_code=204)
