from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
import hashlib
import hmac
import io
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile, File
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app import db
from app.schemas import (DirectConversationCreate, FriendRequestCreate, JoinCodeSubmit, InviteAccept, InviteCreate, Login, MessageCreate, MessageUpdate, NotificationAction, ProjectUpdate, MemberRoleUpdate, OwnershipTransfer,
                         MilestoneCreate, MilestoneUpdate, PasswordUpdate, ProfileUpdate,
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


app = FastAPI(title="StudyPilot", version="0.5.0", lifespan=lifespan)
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
        row = con.execute("SELECT id,email,name,username,created_at,avatar,bio,theme,profile_photo FROM users WHERE id=?", (user_id,)).fetchone()
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
    return {"id": row["id"], "email": row["email"], "username": row["username"], "name": row["name"], "created_at": row["created_at"], "avatar": row["avatar"], "profile_photo": bool(row["profile_photo"]), "bio": row["bio"], "theme": row["theme"]}


def _membership(con: sqlite3.Connection, project_id: int, user_id: int) -> sqlite3.Row:
    row = con.execute("SELECT role,role_v6,legacy_readonly FROM project_members WHERE project_id=? AND user_id=?", (project_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="project not found")
    # Legacy viewers retain their former read-only access until an admin promotes them.
    effective_role = row["role_v6"] or {"owner":"owner","editor":"student","viewer":"student"}.get(row["role"], "student")
    return {"role": "viewer" if row["legacy_readonly"] else effective_role, "legacy_readonly": bool(row["legacy_readonly"])}


def _can_edit(role: str, legacy_readonly: bool = False) -> None:
    if role == "viewer" or legacy_readonly:
        raise HTTPException(status_code=403, detail="editor access is required")


def _task_access(con: sqlite3.Connection, task_id: int, user_id: int, write: bool = False) -> sqlite3.Row:
    row = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="assignment not found")
    if row["project_id"] is None:
        if row["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="assignment not found")
    else:
        member = con.execute("SELECT role,role_v6,legacy_readonly FROM project_members WHERE project_id=? AND user_id=?", (row["project_id"], user_id)).fetchone()
        if member is None:
            raise HTTPException(status_code=404, detail="assignment not found")
        if write:
            effective = member["role_v6"] or {"owner":"owner","editor":"student","viewer":"student"}.get(member["role"], "student")
            _can_edit(effective, bool(member["legacy_readonly"]))
    if write and row["project_id"] is None and row["owner_id"] != user_id:
        raise HTTPException(status_code=404, detail="assignment not found")
    return row


def _task_json(con: sqlite3.Connection, row: sqlite3.Row) -> dict:
    task = db.row_to_task(row)
    task["assignees"] = [dict(item) for item in con.execute(
        "SELECT u.id,u.name,u.username FROM task_assignees a JOIN users u ON u.id=a.user_id WHERE a.task_id=? ORDER BY u.name", (row["id"],)
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
    email, name, username = str(body.email).strip().lower(), body.name.strip(), body.username.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be blank")
    with db.connect() as con:
        if con.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            count = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        else:
            count = 0
        try:
            cur = con.execute("INSERT INTO users(email,name,username,password_hash) VALUES(?,?,?,?)", (email, name, username, _hash_password(body.password)))
        except sqlite3.IntegrityError as exc:
            if con.execute("SELECT 1 FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone():
                raise HTTPException(status_code=409, detail="an account with this email already exists") from exc
            if con.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone():
                raise HTTPException(status_code=409, detail="that username is already taken") from exc
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
    username = body.username.strip() if body.username is not None else None
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be blank")
    with db.connect() as con:
        try:
            changes = {"name": name}
            if username is not None: changes["username"] = username
            for key in ("avatar", "bio", "theme"):
                value = getattr(body, key)
                if value is not None: changes[key] = value.strip() if key == "bio" else value
            con.execute("UPDATE users SET " + ",".join(f"{key}=?" for key in changes) + " WHERE id=?", [*changes.values(), user["id"]])
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="that username is already taken") from exc
        return _profile(con.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())


@app.post("/api/profile/photo")
async def upload_profile_photo(user: User, photo: UploadFile = File(...)):
    raw = await photo.read(5 * 1024 * 1024 + 1)
    await photo.close()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="photo must be 5 MB or smaller")
    if photo.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="choose a JPEG, PNG, or WebP image")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(status_code=415, detail="choose a JPEG, PNG, or WebP image")
            if source.width * source.height > 20_000_000:
                raise HTTPException(status_code=413, detail="photo dimensions are too large")
            source.load()
            image = source.convert("RGB")
            image.thumbnail((512, 512), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="WEBP", quality=85, method=6)
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=415, detail="the uploaded file is not a valid supported image") from exc
    filename = f"{secrets.token_hex(24)}.webp"
    folder = db.database_path().parent / "profile-photos"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(output.getvalue())
    with db.connect() as con:
        previous = con.execute("SELECT profile_photo FROM users WHERE id=?", (user["id"],)).fetchone()[0]
        con.execute("UPDATE users SET profile_photo=? WHERE id=?", (filename, user["id"]))
    if previous:
        (folder / previous).unlink(missing_ok=True)
    return {"profile_photo": True}


@app.get("/api/profile/photo")
def get_profile_photo(user: User):
    with db.connect() as con:
        filename = con.execute("SELECT profile_photo FROM users WHERE id=?", (user["id"],)).fetchone()[0]
    if not filename or Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="no profile photo")
    path = db.database_path().parent / "profile-photos" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no profile photo")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


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
        return [dict(row) for row in con.execute("""SELECT p.*,CASE WHEN m.legacy_readonly=1 THEN 'viewer' ELSE COALESCE(m.role_v6,CASE m.role WHEN 'owner' THEN 'owner' ELSE 'student' END) END AS role,
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
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        code = ""
        for _ in range(5):
            code = "SP-" + "".join(secrets.choice(alphabet) for _ in range(14))
            try:
                cur = con.execute("INSERT INTO projects(name,description,created_by,join_code) VALUES(?,?,?,?)", (name, body.description.strip(), user["id"], code))
                break
            except sqlite3.IntegrityError:
                if _ == 4: raise HTTPException(status_code=503, detail="could not create a unique group code")
        project_id = cur.lastrowid
        con.execute("INSERT INTO project_members(project_id,user_id,role,role_v6) VALUES(?,?,'owner','owner')", (project_id, user["id"]))
        _log_activity(con, project_id, user["id"], "project_created", f"created {name}")
        return dict(con.execute("SELECT p.*,m.role_v6 AS role,1 AS member_count,0 AS task_count FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND m.user_id=?", (project_id, user["id"])).fetchone())


@app.patch("/api/projects/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, user: User):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="group name cannot be blank")
    with db.connect() as con:
        role = _membership(con, project_id, user["id"])["role"]
        if role not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="admin access is required")
        con.execute("UPDATE projects SET name=?,description=? WHERE id=?", (name, body.description.strip(), project_id))
        _log_activity(con, project_id, user["id"], "project_updated", f"updated group details")
        return dict(con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: int, user: User):
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] != "owner":
            raise HTTPException(status_code=403, detail="only the owner can delete a group")
        con.execute("DELETE FROM projects WHERE id=?", (project_id,))
    return Response(status_code=204)


@app.patch("/api/projects/{project_id}/members/{member_id}")
def update_member_role(project_id: int, member_id: int, body: MemberRoleUpdate, user: User):
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] != "owner":
            raise HTTPException(status_code=403, detail="only the owner can change member roles")
        target = con.execute("SELECT role_v6 FROM project_members WHERE project_id=? AND user_id=?", (project_id, member_id)).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="group member not found")
        if target["role_v6"] == "owner":
            raise HTTPException(status_code=409, detail="transfer ownership before changing the owner's role")
        con.execute("UPDATE project_members SET role='editor',role_v6=?,legacy_readonly=0 WHERE project_id=? AND user_id=?", (body.role, project_id, member_id))
        return {"user_id": member_id, "role": body.role}


@app.delete("/api/projects/{project_id}/members/{member_id}", status_code=204)
def remove_member(project_id: int, member_id: int, user: User):
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] != "owner":
            raise HTTPException(status_code=403, detail="only the owner can remove members")
        target = con.execute("SELECT role_v6 FROM project_members WHERE project_id=? AND user_id=?", (project_id, member_id)).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="group member not found")
        if target["role_v6"] == "owner":
            raise HTTPException(status_code=409, detail="transfer ownership before removing the owner")
        con.execute("DELETE FROM project_members WHERE project_id=? AND user_id=?", (project_id, member_id))
        con.execute("DELETE FROM task_assignees WHERE user_id=? AND task_id IN (SELECT id FROM tasks WHERE project_id=?)", (member_id, project_id))
    return Response(status_code=204)


@app.post("/api/projects/{project_id}/transfer-owner")
def transfer_owner(project_id: int, body: OwnershipTransfer, user: User):
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] != "owner":
            raise HTTPException(status_code=403, detail="only the owner can transfer ownership")
        target = con.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (project_id, body.user_id)).fetchone()
        if not target or body.user_id == user["id"]:
            raise HTTPException(status_code=404, detail="choose another current group member")
        con.execute("UPDATE project_members SET role='editor',role_v6='admin' WHERE project_id=? AND user_id=?", (project_id, user["id"]))
        con.execute("UPDATE project_members SET role='owner',role_v6='owner',legacy_readonly=0 WHERE project_id=? AND user_id=?", (project_id, body.user_id))
        return {"owner_id": body.user_id}


@app.post("/api/projects/join-requests", status_code=202)
def request_group_membership(body: JoinCodeSubmit, user: User, request: Request):
    code = body.code.strip().upper().replace(" ", "")
    with db.connect() as con:
        attempts = con.execute("SELECT COUNT(*) FROM join_code_attempts WHERE user_id=? AND attempted_at>strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 minutes')", (user["id"],)).fetchone()[0]
        if attempts >= 10: raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
        con.execute("INSERT INTO join_code_attempts(user_id) VALUES(?)", (user["id"],))
        con.commit()
        project = con.execute("SELECT id,created_by FROM projects WHERE join_code=?", (code,)).fetchone()
        if project is None: raise HTTPException(status_code=404, detail="No group matches that code.")
        if con.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (project["id"], user["id"])).fetchone():
            return {"status": "already_member"}
        existing = con.execute("SELECT id,status FROM project_join_requests WHERE project_id=? AND user_id=? ORDER BY id DESC LIMIT 1", (project["id"], user["id"])).fetchone()
        if existing and existing["status"] == "pending": return {"status": "pending"}
        if existing and existing["status"] == "blocked": raise HTTPException(status_code=403, detail="you cannot request access to this group")
        cur = con.execute("INSERT INTO project_join_requests(project_id,user_id) VALUES(?,?)", (project["id"], user["id"]))
        con.execute("INSERT INTO notifications(user_id,project_id,actor_id,kind,detail) VALUES(?,?,?,'group_join_request','A classmate asked to join your group.')", (project["created_by"], project["id"], user["id"]))
        return {"status": "pending", "request_id": cur.lastrowid}


@app.post("/api/projects/{project_id}/join-code/rotate")
def rotate_join_code(project_id: int, user: User):
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] != "owner": raise HTTPException(status_code=403, detail="only group owners can change the join code")
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for attempt in range(5):
            code = "SP-" + "".join(secrets.choice(alphabet) for _ in range(14))
            try:
                con.execute("UPDATE projects SET join_code=? WHERE id=?", (code, project_id)); break
            except sqlite3.IntegrityError:
                if attempt == 4: raise HTTPException(status_code=503, detail="could not create a unique group code")
        _log_activity(con, project_id, user["id"], "join_code_rotated", "rotated the group join code")
        return {"code": code}


@app.get("/api/projects/{project_id}/join-requests")
def list_group_join_requests(project_id: int, user: User):
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] not in {"owner", "admin"}: raise HTTPException(status_code=403, detail="admin access is required to review requests")
        return [dict(r) for r in con.execute("SELECT r.id,r.status,r.created_at,u.id user_id,u.name,u.username FROM project_join_requests r JOIN users u ON u.id=r.user_id WHERE r.project_id=? AND r.status='pending' ORDER BY r.created_at", (project_id,)).fetchall()]


@app.post("/api/projects/{project_id}/join-requests/{request_id}/{action}")
def review_group_join_request(project_id: int, request_id: int, action: str, user: User):
    if action not in {"approve", "reject", "block"}: raise HTTPException(status_code=404, detail="action not found")
    with db.connect() as con:
        if _membership(con, project_id, user["id"])["role"] not in {"owner", "admin"}: raise HTTPException(status_code=403, detail="admin access is required to review requests")
        item = con.execute("SELECT * FROM project_join_requests WHERE id=? AND project_id=? AND status='pending'", (request_id, project_id)).fetchone()
        if item is None: raise HTTPException(status_code=404, detail="pending request not found")
        if item["user_id"] == user["id"]: raise HTTPException(status_code=403, detail="you cannot approve your own request")
        status = {"approve":"accepted", "reject":"declined", "block":"blocked"}[action]
        con.execute("UPDATE project_join_requests SET status=?,reviewed_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND status='pending'", (status, user["id"], request_id))
        if action == "approve":
            con.execute("INSERT OR IGNORE INTO project_members(project_id,user_id,role,role_v6) VALUES(?,?,'editor','student')", (project_id, item["user_id"]))
            _log_activity(con, project_id, user["id"], "member_joined", "approved a group membership request")
        con.execute("INSERT INTO notifications(user_id,project_id,actor_id,kind,detail) VALUES(?,?,?,'group_join_response',?)", (item["user_id"], project_id, user["id"], "Your group request was approved." if action == "approve" else "Your group request was not approved."))
        return {"status": status}


@app.get("/api/projects/{project_id}/pinned-messages")
def pinned_messages(project_id: int, user: User):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        return [dict(r) for r in con.execute("SELECT m.id,m.body,m.created_at,m.edited_at,m.deleted_at,m.user_id,u.name,u.username,u.avatar,u.profile_photo FROM messages m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC", (project_id,)).fetchall()]


@app.get("/api/projects/{project_id}/messages/{message_id}")
def get_group_message(project_id: int, message_id: int, user: User):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        row=con.execute("SELECT m.id,m.project_id,m.body,m.created_at,m.edited_at,m.pinned_at,m.pinned_by,m.deleted_at,u.id user_id,u.name,u.avatar,u.profile_photo FROM messages m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.id=?",(project_id,message_id)).fetchone()
        if row is None: raise HTTPException(status_code=404, detail="message not found")
        return dict(row)


@app.get("/api/group-conversations")
def group_conversations(user: User):
    with db.connect() as con:
        return [dict(r) for r in con.execute("""SELECT p.id project_id,p.name,
            (SELECT m.body FROM messages m WHERE m.project_id=p.id ORDER BY id DESC LIMIT 1) last_message,
            (SELECT m.created_at FROM messages m WHERE m.project_id=p.id ORDER BY id DESC LIMIT 1) last_message_at,
            (SELECT COUNT(*) FROM messages m WHERE m.project_id=p.id AND m.user_id<>? AND m.id>COALESCE((SELECT last_read_message_id FROM group_message_reads r WHERE r.project_id=p.id AND r.user_id=?),0)) unread_count
            FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE pm.user_id=? ORDER BY COALESCE(last_message_at,p.created_at) DESC""", (user["id"],user["id"],user["id"])).fetchall()]


@app.get("/api/projects/{project_id}")
def get_project(project_id: int, user: User):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        project = dict(con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())
        project["role"] = _membership(con, project_id, user["id"])["role"]
        project["members"] = [dict(row) for row in con.execute("SELECT u.id,u.name,u.username,u.avatar,u.profile_photo,COALESCE(m.role_v6,CASE m.role WHEN 'owner' THEN 'owner' ELSE 'student' END) AS role,m.legacy_readonly,m.joined_at FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY CASE COALESCE(m.role_v6,m.role) WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name", (project_id,)).fetchall()]
        return project


@app.get("/api/projects/{project_id}/milestones")
def list_milestones(project_id: int, user: User):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        return [dict(row) for row in con.execute("SELECT * FROM milestones WHERE project_id=? ORDER BY due_date,id", (project_id,)).fetchall()]


@app.post("/api/projects/{project_id}/milestones", status_code=201)
def create_milestone(project_id: int, body: MilestoneCreate, user: User):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="milestone title cannot be blank")
    with db.connect() as con:
        _can_edit(_membership(con, project_id, user["id"])["role"])
        cursor = con.execute("INSERT INTO milestones(project_id,title,due_date,created_by) VALUES(?,?,?,?)", (project_id, title, body.due_date.isoformat(), user["id"]))
        _log_activity(con, project_id, user["id"], "milestone_created", f"added milestone {title}")
        return dict(con.execute("SELECT * FROM milestones WHERE id=?", (cursor.lastrowid,)).fetchone())


@app.patch("/api/projects/{project_id}/milestones/{milestone_id}")
def update_milestone(project_id: int, milestone_id: int, body: MilestoneUpdate, user: User):
    changes = body.model_dump(exclude_unset=True)
    if not changes or any(value is None for value in changes.values()):
        raise HTTPException(status_code=400, detail="provide milestone fields to update")
    with db.connect() as con:
        _can_edit(_membership(con, project_id, user["id"])["role"])
        row = con.execute("SELECT * FROM milestones WHERE id=? AND project_id=?", (milestone_id, project_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="milestone not found")
        for key, value in changes.items():
            changes[key] = value.isoformat() if isinstance(value, date) else value.strip() if key == "title" else value
        if "title" in changes and not changes["title"]:
            raise HTTPException(status_code=422, detail="milestone title cannot be blank")
        fields = ",".join(f"{key}=?" for key in changes)
        con.execute(f"UPDATE milestones SET {fields} WHERE id=? AND project_id=?", [*changes.values(), milestone_id, project_id])
        _log_activity(con, project_id, user["id"], "milestone_updated", f"updated milestone {row['title']}")
        return dict(con.execute("SELECT * FROM milestones WHERE id=?", (milestone_id,)).fetchone())


@app.post("/api/projects/{project_id}/invites", status_code=201)
def invite(project_id: int, body: InviteCreate, user: User):
    email = str(body.email).strip().lower()
    token = secrets.token_urlsafe(32)
    with db.connect() as con:
        role = _membership(con, project_id, user["id"])["role"]
        if role not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="admin access is required to invite members")
        target = con.execute("SELECT id FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone()
        if target and con.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (project_id, target["id"])).fetchone():
            raise HTTPException(status_code=409, detail="this person is already a member")
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stored_role = "viewer" if body.role == "viewer" else "editor"
        public_role = "viewer" if body.role == "viewer" else "student"
        con.execute("INSERT INTO invitations(project_id,email,token_hash,role,invited_by,expires_at) VALUES(?,?,?,?,?,?)", (project_id, email, token_hash, stored_role, user["id"], expires))
        return {"email": email, "role": public_role, "token": token, "expires_at": expires}


def _accept_invite(token: str, user: dict):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db.connect() as con:
        row = con.execute("SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL", (token_hash,)).fetchone()
        if row is None or row["expires_at"] < datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
            raise HTTPException(status_code=404, detail="invitation is invalid or expired")
        if row["email"].lower() != user["email"].lower():
            raise HTTPException(status_code=403, detail="sign in with the invited email address")
        con.execute("INSERT OR IGNORE INTO project_members(project_id,user_id,role,role_v6,legacy_readonly) VALUES(?,?,'editor','student',?)", (row["project_id"], user["id"], int(row["role"] == "viewer")))
        con.execute("UPDATE invitations SET accepted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (row["id"],))
        _log_activity(con, row["project_id"], user["id"], "member_joined", f"{user['name']} joined the project")
        return dict(con.execute("SELECT * FROM projects WHERE id=?", (row["project_id"],)).fetchone())


@app.post("/api/invitations/{token}/accept")
def accept_invite(token: str, user: User):
    return _accept_invite(token, user)


@app.post("/api/invitations/accept")
def accept_invite_code(body: InviteAccept, user: User):
    """Accept an owner-issued high-entropy invitation code; existing email binding still applies."""
    return _accept_invite(body.token, user)


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
        old_status = row["status"]
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
        new_status = changes.get("status", old_status)
        if new_status != old_status:
            now = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
            if new_status == "in_progress":
                con.execute(f"UPDATE tasks SET started_at=COALESCE(started_at,{now}) WHERE id=?", (task_id,))
            if new_status == "done":
                con.execute(f"UPDATE tasks SET completed_at={now} WHERE id=?", (task_id,))
            elif old_status == "done":
                con.execute("UPDATE tasks SET completed_at=NULL WHERE id=?", (task_id,))
            con.execute("INSERT INTO task_status_history(task_id,user_id,from_status,to_status) VALUES(?,?,?,?)",
                        (task_id, user["id"], old_status, new_status))
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


@app.get("/api/tasks/{task_id}/history")
def task_history(task_id: int, user: User):
    with db.connect() as con:
        _task_access(con, task_id, user["id"])
        return [dict(row) for row in con.execute("""SELECT h.from_status,h.to_status,h.changed_at,u.name AS changed_by
            FROM task_status_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.task_id=? ORDER BY h.id""", (task_id,)).fetchall()]


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
        latest = con.execute("SELECT COALESCE(MAX(id),0) FROM messages WHERE project_id=?", (project_id,)).fetchone()[0]
        con.execute("INSERT INTO group_message_reads(project_id,user_id,last_read_message_id) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET last_read_message_id=MAX(last_read_message_id,excluded.last_read_message_id)", (project_id,user["id"],latest))
        if after_id:
            rows = con.execute("SELECT m.id,m.project_id,m.body,m.created_at,m.edited_at,m.pinned_at,m.pinned_by,m.deleted_at,u.id AS user_id,u.name,u.avatar,u.profile_photo FROM messages m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.id>? ORDER BY m.id LIMIT 100", (project_id, after_id)).fetchall()
        else:
            rows = con.execute("SELECT m.id,m.project_id,m.body,m.created_at,m.edited_at,m.pinned_at,m.pinned_by,m.deleted_at,u.id AS user_id,u.name,u.avatar,u.profile_photo FROM messages m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.id DESC LIMIT 100", (project_id,)).fetchall()
            rows = list(reversed(rows))
        return [dict(row) for row in rows]


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
        return dict(con.execute("SELECT m.id,m.project_id,m.body,m.created_at,m.edited_at,m.pinned_at,m.pinned_by,u.id AS user_id,u.name,u.avatar,u.profile_photo FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?", (cur.lastrowid,)).fetchone())


@app.patch("/api/projects/{project_id}/messages/{message_id}")
def edit_group_message(project_id: int, message_id: int, body: MessageUpdate, user: User):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="message cannot be blank")
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        message = con.execute("SELECT * FROM messages WHERE id=? AND project_id=?", (message_id, project_id)).fetchone()
        if message is None:
            raise HTTPException(status_code=404, detail="message not found")
        _can_edit(_membership(con, project_id, user["id"])["role"])
        if message["user_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="you can only edit your own messages")
        if message["deleted_at"] is not None: raise HTTPException(status_code=409, detail="message is deleted")
        con.execute("UPDATE messages SET body=?,edited_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (text, message_id))
        _log_activity(con, project_id, user["id"], "message_edited", "edited a group message")
        return dict(con.execute("SELECT m.id,m.project_id,m.body,m.created_at,m.edited_at,m.pinned_at,m.pinned_by,u.id AS user_id,u.name,u.avatar,u.profile_photo FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?", (message_id,)).fetchone())


@app.delete("/api/projects/{project_id}/messages/{message_id}", status_code=204)
def delete_group_message(project_id: int, message_id: int, user: User):
    with db.connect() as con:
        _membership(con, project_id, user["id"])
        message = con.execute("SELECT user_id,deleted_at FROM messages WHERE id=? AND project_id=?", (message_id, project_id)).fetchone()
        if message is None:
            raise HTTPException(status_code=404, detail="message not found")
        _can_edit(_membership(con, project_id, user["id"])["role"])
        if message["user_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="you can only delete your own messages")
        if message["deleted_at"] is not None: raise HTTPException(status_code=409, detail="message is already deleted")
        con.execute("UPDATE messages SET body='Message deleted',deleted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),edited_at=NULL WHERE id=?", (message_id,))
        _log_activity(con, project_id, user["id"], "message_deleted", "deleted a group message")
    return Response(status_code=204)


@app.post("/api/projects/{project_id}/messages/{message_id}/pin")
def pin_group_message(project_id: int, message_id: int, user: User):
    with db.connect() as con:
        role = _membership(con, project_id, user["id"])["role"]
        if role != "owner":
            raise HTTPException(status_code=403, detail="only group owners can pin messages")
        row = con.execute("SELECT id,deleted_at FROM messages WHERE id=? AND project_id=?", (message_id, project_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="message not found")
        if row["deleted_at"] is not None: raise HTTPException(status_code=409, detail="message is deleted")
        con.execute("UPDATE messages SET pinned_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),pinned_by=? WHERE id=?", (user["id"], message_id))
        _log_activity(con, project_id, user["id"], "message_pinned", "pinned a group message")
        return {"pinned": True}


@app.delete("/api/projects/{project_id}/messages/{message_id}/pin", status_code=204)
def unpin_group_message(project_id: int, message_id: int, user: User):
    with db.connect() as con:
        role = _membership(con, project_id, user["id"])["role"]
        if role != "owner":
            raise HTTPException(status_code=403, detail="only group owners can unpin messages")
        if not con.execute("SELECT 1 FROM messages WHERE id=? AND project_id=?", (message_id, project_id)).fetchone():
            raise HTTPException(status_code=404, detail="message not found")
        con.execute("UPDATE messages SET pinned_at=NULL,pinned_by=NULL WHERE id=?", (message_id,))
        _log_activity(con, project_id, user["id"], "message_unpinned", "unpinned a group message")
    return Response(status_code=204)


def _direct_conversation(con: sqlite3.Connection, conversation_id: int, user_id: int) -> sqlite3.Row:
    row = con.execute("SELECT * FROM direct_conversations WHERE id=? AND (user_a=? OR user_b=?)", (conversation_id, user_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    other = row["user_b"] if row["user_a"] == user_id else row["user_a"]
    blocked = con.execute("SELECT 1 FROM friend_requests WHERE status='blocked' AND ((requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?))", (user_id, other, other, user_id)).fetchone()
    allowed = con.execute("""SELECT 1 WHERE EXISTS(SELECT 1 FROM project_members mine JOIN project_members theirs ON mine.project_id=theirs.project_id WHERE mine.user_id=? AND theirs.user_id=?)
        OR EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='accepted' AND ((f.requester_id=? AND f.recipient_id=?) OR (f.requester_id=? AND f.recipient_id=?)))""",
        (user_id, other, user_id, other, other, user_id)).fetchone()
    if blocked or not allowed:
        raise HTTPException(status_code=404, detail="conversation not found")
    return row


@app.get("/api/people")
def list_people(user: User):
    """Return accepted friends and existing group classmates without exposing email addresses."""
    with db.connect() as con:
        return [dict(row) for row in con.execute("""SELECT DISTINCT u.id,u.name
            ,u.username,u.avatar,u.profile_photo FROM users u WHERE u.id<>? AND (
            EXISTS(SELECT 1 FROM project_members mine JOIN project_members other ON mine.project_id=other.project_id WHERE mine.user_id=? AND other.user_id=u.id)
            OR EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='accepted' AND ((f.requester_id=? AND f.recipient_id=u.id) OR (f.recipient_id=? AND f.requester_id=u.id)))) ORDER BY u.name""", (user["id"], user["id"], user["id"], user["id"])).fetchall()]


@app.get("/api/people/search")
def search_people(user: User, q: str = Query(min_length=3, max_length=24)):
    term = q.strip().lstrip("@").lower()
    if len(term) < 3:
        return []
    term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    with db.connect() as con:
        return [dict(row) for row in con.execute("""SELECT u.id,u.name,u.username,u.avatar,u.profile_photo,
            CASE WHEN EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='accepted' AND ((f.requester_id=? AND f.recipient_id=u.id) OR (f.recipient_id=? AND f.requester_id=u.id))) THEN 'friends'
                 WHEN EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='pending' AND f.requester_id=? AND f.recipient_id=u.id) THEN 'request_sent'
                 WHEN EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='pending' AND f.recipient_id=? AND f.requester_id=u.id) THEN 'incoming_request'
                 WHEN EXISTS(SELECT 1 FROM project_members mine JOIN project_members theirs ON mine.project_id=theirs.project_id WHERE mine.user_id=? AND theirs.user_id=u.id) THEN 'group_classmate'
                 ELSE 'not_connected' END AS relationship FROM users u
            WHERE u.id<>? AND u.username LIKE ? ESCAPE '\\' COLLATE NOCASE
            AND NOT EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='blocked' AND
              ((f.requester_id=? AND f.recipient_id=u.id) OR (f.recipient_id=? AND f.requester_id=u.id)))
            ORDER BY u.username LIMIT 10""", (user["id"],user["id"],user["id"],user["id"],user["id"], user["id"], f"{term}%", user["id"], user["id"])).fetchall()]


@app.get("/api/friend-requests")
def list_friend_requests(user: User):
    with db.connect() as con:
        return [dict(row) for row in con.execute("""SELECT f.id,f.status,f.created_at,f.requester_id,f.recipient_id,
            u.name,u.username,u.avatar,u.profile_photo,CASE WHEN f.recipient_id=? THEN 'incoming' ELSE 'outgoing' END AS direction
            FROM friend_requests f JOIN users u ON u.id=CASE WHEN f.recipient_id=? THEN f.requester_id ELSE f.recipient_id END
            WHERE (f.requester_id=? OR f.recipient_id=?) AND f.status IN ('pending','accepted','blocked') ORDER BY f.id DESC""",
            (user["id"], user["id"], user["id"], user["id"])).fetchall()]


@app.get("/api/people/{person_id}/photo")
def get_person_photo(person_id: int, user: User):
    with db.connect() as con:
        blocked = con.execute("SELECT 1 FROM friend_requests WHERE status='blocked' AND ((requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?))", (user["id"], person_id, person_id, user["id"])).fetchone()
        connected = person_id == user["id"] or con.execute("""SELECT 1 WHERE EXISTS(SELECT 1 FROM project_members a JOIN project_members b ON a.project_id=b.project_id WHERE a.user_id=? AND b.user_id=?)
            OR EXISTS(SELECT 1 FROM friend_requests WHERE status='accepted' AND ((requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?)))""", (user["id"], person_id, user["id"], person_id, person_id, user["id"])).fetchone()
        if blocked or not connected:
            raise HTTPException(status_code=404, detail="profile photo not found")
        photo = con.execute("SELECT profile_photo FROM users WHERE id=?", (person_id,)).fetchone()
    if photo is None or not photo[0] or Path(photo[0]).name != photo[0]:
        raise HTTPException(status_code=404, detail="profile photo not found")
    path = db.database_path().parent / "profile-photos" / photo[0]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="profile photo not found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.post("/api/friend-requests", status_code=201)
def send_friend_request(body: FriendRequestCreate, user: User):
    with db.connect() as con:
        target = con.execute("SELECT id FROM users WHERE username=? COLLATE NOCASE", (body.username.strip().lstrip("@"),)).fetchone()
        if target is None or target["id"] == user["id"]:
            raise HTTPException(status_code=404, detail="classmate not found")
        a, b = sorted((user["id"], target["id"]))
        existing = con.execute("SELECT * FROM friend_requests WHERE (requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?)", (a, b, b, a)).fetchone()
        if existing and existing["status"] == "blocked":
            raise HTTPException(status_code=404, detail="classmate not found")
        if existing and existing["status"] == "accepted":
            raise HTTPException(status_code=409, detail="you are already connected")
        if existing and existing["status"] == "pending":
            if existing["recipient_id"] == user["id"]:
                con.execute("UPDATE friend_requests SET status='accepted',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (existing["id"],))
                con.execute("INSERT INTO notifications(user_id,actor_id,kind,detail) VALUES(?,?, 'friend_request_accepted','Your classmate request was accepted.')", (existing["requester_id"],user["id"]))
                return {"status": "accepted", "id": existing["id"]}
            raise HTTPException(status_code=409, detail="a request is already waiting")
        if existing and existing["status"] == "declined":
            con.execute("UPDATE friend_requests SET requester_id=?,recipient_id=?,status='pending',created_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (user["id"], target["id"], existing["id"]))
            return {"id": existing["id"], "status": "pending"}
        cur = con.execute("INSERT INTO friend_requests(requester_id,recipient_id) VALUES(?,?)", (user["id"], target["id"]))
        con.execute("INSERT INTO notifications(user_id,actor_id,kind,detail) VALUES(?,?,'friend_request','You received a classmate request.')", (target["id"], user["id"]))
        return {"id": cur.lastrowid, "status": "pending"}


@app.post("/api/friend-requests/{request_id}/{action}")
def respond_friend_request(request_id: int, action: str, user: User):
    if action not in {"accept", "decline", "block"}:
        raise HTTPException(status_code=404, detail="action not found")
    with db.connect() as con:
        row = con.execute("SELECT * FROM friend_requests WHERE id=? AND (requester_id=? OR recipient_id=?)", (request_id, user["id"], user["id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="request not found")
        if action in {"accept", "decline"} and (row["recipient_id"] != user["id"] or row["status"] != "pending"):
            raise HTTPException(status_code=403, detail="only the recipient can respond to a pending request")
        status = {"accept": "accepted", "decline": "declined", "block": "blocked"}[action]
        con.execute("UPDATE friend_requests SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (status, request_id))
        if action in {"accept", "decline"}:
            con.execute("INSERT INTO notifications(user_id,actor_id,kind,detail) VALUES(?,?,?,?)", (row["requester_id"], user["id"], f"friend_request_{status}", "Your classmate request was accepted." if action == "accept" else "Your classmate request was declined."))
        return {"id": request_id, "status": status}


@app.delete("/api/friend-requests/{request_id}", status_code=204)
def cancel_friend_request(request_id: int, user: User):
    with db.connect() as con:
        row = con.execute("SELECT * FROM friend_requests WHERE id=? AND requester_id=? AND status='pending'", (request_id,user["id"])).fetchone()
        if row is None: raise HTTPException(status_code=404, detail="pending outgoing request not found")
        con.execute("UPDATE friend_requests SET status='declined',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (request_id,))
        con.execute("INSERT INTO notifications(user_id,actor_id,kind,detail) VALUES(?,?, 'friend_request_cancelled','A pending classmate request was cancelled.')", (row["recipient_id"],user["id"]))
    return Response(status_code=204)


@app.get("/api/direct/conversations")
def list_direct_conversations(user: User):
    with db.connect() as con:
        rows = con.execute("""SELECT c.id,c.created_at,
            CASE WHEN c.user_a=? THEN b.id ELSE a.id END AS person_id,
            CASE WHEN c.user_a=? THEN b.name ELSE a.name END AS person_name,
            CASE WHEN c.user_a=? THEN b.avatar ELSE a.avatar END AS person_avatar,
            CASE WHEN c.user_a=? THEN b.profile_photo ELSE a.profile_photo END AS person_profile_photo,
            (SELECT body FROM direct_messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM direct_messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last_message_at,
            (SELECT COUNT(*) FROM direct_messages dm WHERE dm.conversation_id=c.id AND dm.sender_id<>? AND dm.read_at IS NULL) AS unread_count
            FROM direct_conversations c JOIN users a ON a.id=c.user_a JOIN users b ON b.id=c.user_b
            WHERE (c.user_a=? OR c.user_b=?)
            AND NOT EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='blocked' AND ((f.requester_id=c.user_a AND f.recipient_id=c.user_b) OR (f.requester_id=c.user_b AND f.recipient_id=c.user_a)))
            AND (EXISTS(SELECT 1 FROM project_members mine JOIN project_members theirs ON mine.project_id=theirs.project_id WHERE mine.user_id=? AND theirs.user_id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END)
              OR EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='accepted' AND ((f.requester_id=c.user_a AND f.recipient_id=c.user_b) OR (f.requester_id=c.user_b AND f.recipient_id=c.user_a))))
            ORDER BY COALESCE(last_message_at,c.created_at) DESC""",
            (user["id"], user["id"], user["id"], user["id"], user["id"], user["id"], user["id"], user["id"], user["id"])).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/direct/conversations", status_code=201)
def start_direct_conversation(body: DirectConversationCreate, user: User):
    recipient_id = body.recipient_id
    if recipient_id == user["id"]:
        raise HTTPException(status_code=400, detail="choose another classmate")
    lower, upper = sorted((user["id"], recipient_id))
    with db.connect() as con:
        allowed = con.execute("""SELECT 1 WHERE EXISTS(SELECT 1 FROM project_members mine JOIN project_members other
            ON mine.project_id=other.project_id WHERE mine.user_id=? AND other.user_id=?)
            OR EXISTS(SELECT 1 FROM friend_requests f WHERE f.status='accepted' AND
              ((f.requester_id=? AND f.recipient_id=?) OR (f.recipient_id=? AND f.requester_id=?)))""",
            (user["id"], recipient_id, user["id"], recipient_id, user["id"], recipient_id)).fetchone()
        blocked = con.execute("SELECT 1 FROM friend_requests WHERE status='blocked' AND ((requester_id=? AND recipient_id=?) OR (recipient_id=? AND requester_id=?))", (user["id"], recipient_id, user["id"], recipient_id)).fetchone()
        if not allowed or blocked:
            raise HTTPException(status_code=404, detail="classmate not found")
        con.execute("INSERT OR IGNORE INTO direct_conversations(user_a,user_b) VALUES(?,?)", (lower, upper))
        row = con.execute("SELECT id,created_at FROM direct_conversations WHERE user_a=? AND user_b=?", (lower, upper)).fetchone()
        return {**dict(row), "person_id": recipient_id}


@app.get("/api/direct/conversations/{conversation_id}/messages")
def list_direct_messages(conversation_id: int, user: User, after_id: int = Query(default=0, ge=0)):
    with db.connect() as con:
        _direct_conversation(con, conversation_id, user["id"])
        con.execute("UPDATE direct_messages SET read_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL", (conversation_id, user["id"]))
        if after_id:
            rows=con.execute("""SELECT dm.id,dm.conversation_id,dm.sender_id,dm.body,dm.read_at,dm.created_at,dm.edited_at,dm.deleted_at,dm.pinned_at,dm.pinned_by,u.name AS sender_name,u.avatar,u.profile_photo
                FROM direct_messages dm JOIN users u ON u.id=dm.sender_id WHERE dm.conversation_id=? AND dm.id>? ORDER BY dm.id LIMIT 100""",(conversation_id,after_id)).fetchall()
        else:
            rows=con.execute("""SELECT dm.id,dm.conversation_id,dm.sender_id,dm.body,dm.read_at,dm.created_at,dm.edited_at,dm.deleted_at,dm.pinned_at,dm.pinned_by,u.name AS sender_name,u.avatar,u.profile_photo
                FROM direct_messages dm JOIN users u ON u.id=dm.sender_id WHERE dm.conversation_id=? ORDER BY dm.id DESC LIMIT 100""",(conversation_id,)).fetchall()
            rows=list(reversed(rows))
        return [dict(row) for row in rows]


@app.post("/api/direct/conversations/{conversation_id}/messages", status_code=201)
def send_direct_message(conversation_id: int, body: MessageCreate, user: User):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="message cannot be blank")
    with db.connect() as con:
        _direct_conversation(con, conversation_id, user["id"])
        cursor = con.execute("INSERT INTO direct_messages(conversation_id,sender_id,body) VALUES(?,?,?)", (conversation_id, user["id"], text))
        conversation = con.execute("SELECT user_a,user_b FROM direct_conversations WHERE id=?", (conversation_id,)).fetchone()
        recipient = conversation["user_b"] if conversation["user_a"] == user["id"] else conversation["user_a"]
        con.execute("INSERT INTO notifications(user_id,actor_id,kind,detail) VALUES(?,?, 'direct_message','You received a new message.')", (recipient,user["id"]))
        return dict(con.execute("""SELECT dm.id,dm.conversation_id,dm.sender_id,dm.body,dm.read_at,dm.created_at,dm.edited_at,dm.deleted_at,dm.pinned_at,dm.pinned_by,u.name AS sender_name,u.avatar,u.profile_photo
            FROM direct_messages dm JOIN users u ON u.id=dm.sender_id WHERE dm.id=?""", (cursor.lastrowid,)).fetchone())


@app.patch("/api/direct/conversations/{conversation_id}/messages/{message_id}")
def edit_direct_message(conversation_id: int, message_id: int, body: MessageUpdate, user: User):
    text=body.body.strip()
    if not text: raise HTTPException(status_code=422, detail="message cannot be blank")
    with db.connect() as con:
        _direct_conversation(con,conversation_id,user["id"])
        row=con.execute("SELECT sender_id,deleted_at FROM direct_messages WHERE id=? AND conversation_id=?",(message_id,conversation_id)).fetchone()
        if row is None: raise HTTPException(status_code=404,detail="message not found")
        if row["sender_id"]!=user["id"]: raise HTTPException(status_code=403,detail="you can only edit your own messages")
        if row["deleted_at"] is not None: raise HTTPException(status_code=409,detail="message is deleted")
        con.execute("UPDATE direct_messages SET body=?,edited_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",(text,message_id))
        return dict(con.execute("SELECT dm.id,dm.conversation_id,dm.sender_id,dm.body,dm.created_at,dm.edited_at,dm.deleted_at,u.name sender_name,u.avatar,u.profile_photo FROM direct_messages dm JOIN users u ON u.id=dm.sender_id WHERE dm.id=?",(message_id,)).fetchone())


@app.delete("/api/direct/conversations/{conversation_id}/messages/{message_id}",status_code=204)
def delete_direct_message(conversation_id: int, message_id: int, user: User):
    with db.connect() as con:
        _direct_conversation(con,conversation_id,user["id"])
        row=con.execute("SELECT sender_id,deleted_at FROM direct_messages WHERE id=? AND conversation_id=?",(message_id,conversation_id)).fetchone()
        if row is None: raise HTTPException(status_code=404,detail="message not found")
        if row["sender_id"]!=user["id"]: raise HTTPException(status_code=403,detail="you can only delete your own messages")
        if row["deleted_at"] is not None: raise HTTPException(status_code=409,detail="message is already deleted")
        con.execute("UPDATE direct_messages SET body='Message deleted',deleted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),edited_at=NULL WHERE id=?",(message_id,))
    return Response(status_code=204)


@app.get("/api/direct/conversations/{conversation_id}/pinned-messages")
def pinned_direct_messages(conversation_id: int, user: User):
    with db.connect() as con:
        _direct_conversation(con, conversation_id, user["id"])
        return [dict(row) for row in con.execute("""SELECT dm.id,dm.conversation_id,dm.body,dm.created_at,dm.edited_at,dm.deleted_at,dm.pinned_at,dm.sender_id,u.name AS sender_name,u.avatar
            FROM direct_messages dm JOIN users u ON u.id=dm.sender_id WHERE dm.conversation_id=? AND dm.pinned_at IS NOT NULL ORDER BY dm.pinned_at DESC""", (conversation_id,)).fetchall()]


@app.get("/api/direct/conversations/{conversation_id}/messages/{message_id}")
def get_direct_message(conversation_id: int, message_id: int, user: User):
    with db.connect() as con:
        _direct_conversation(con, conversation_id, user["id"])
        row = con.execute("""SELECT dm.id,dm.conversation_id,dm.sender_id,dm.body,dm.created_at,dm.edited_at,dm.deleted_at,dm.pinned_at,dm.pinned_by,u.name AS sender_name,u.avatar
            FROM direct_messages dm JOIN users u ON u.id=dm.sender_id WHERE dm.conversation_id=? AND dm.id=?""", (conversation_id, message_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="message not found")
        return dict(row)


@app.post("/api/direct/conversations/{conversation_id}/messages/{message_id}/pin")
def pin_direct_message(conversation_id: int, message_id: int, user: User):
    with db.connect() as con:
        _direct_conversation(con, conversation_id, user["id"])
        row = con.execute("SELECT id,deleted_at FROM direct_messages WHERE id=? AND conversation_id=?", (message_id, conversation_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="message not found")
        if row["deleted_at"] is not None:
            raise HTTPException(status_code=409, detail="message is deleted")
        con.execute("UPDATE direct_messages SET pinned_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),pinned_by=? WHERE id=?", (user["id"], message_id))
        return {"pinned": True}


@app.delete("/api/direct/conversations/{conversation_id}/messages/{message_id}/pin", status_code=204)
def unpin_direct_message(conversation_id: int, message_id: int, user: User):
    with db.connect() as con:
        _direct_conversation(con, conversation_id, user["id"])
        if not con.execute("SELECT 1 FROM direct_messages WHERE id=? AND conversation_id=?", (message_id, conversation_id)).fetchone():
            raise HTTPException(status_code=404, detail="message not found")
        con.execute("UPDATE direct_messages SET pinned_at=NULL,pinned_by=NULL WHERE id=?", (message_id,))
    return Response(status_code=204)


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


@app.patch("/api/notifications")
def update_notifications(body: NotificationAction, user: User):
    if not body.ids:
        raise HTTPException(status_code=422, detail="select at least one notification")
    placeholders = ",".join("?" for _ in body.ids)
    with db.connect() as con:
        if body.action == "delete":
            cursor = con.execute(f"DELETE FROM notifications WHERE user_id=? AND id IN ({placeholders})", [user["id"], *body.ids])
        else:
            read_expr = "strftime('%Y-%m-%dT%H:%M:%SZ','now')" if body.action == "read" else "NULL"
            cursor = con.execute(f"UPDATE notifications SET read_at={read_expr} WHERE user_id=? AND id IN ({placeholders})", [user["id"], *body.ids])
        return {"updated": cursor.rowcount}


@app.delete("/api/notifications", status_code=204)
def clear_notifications(user: User):
    with db.connect() as con:
        con.execute("DELETE FROM notifications WHERE user_id=?", (user["id"],))
    return Response(status_code=204)
