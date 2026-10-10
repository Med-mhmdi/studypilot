"""SQLite persistence and additive, backward-compatible schema migration."""

from __future__ import annotations

import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


def database_path() -> Path:
    return Path(os.getenv("DB_PATH", "data/studypilot.db"))


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize() -> None:
    """Create new tables and add nullable task ownership without touching rows."""
    with connect() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        user_columns = {row["name"] for row in con.execute("PRAGMA table_info(users)")}
        if "username" not in user_columns:
            con.execute("ALTER TABLE users ADD COLUMN username TEXT")
            # Existing users get a deterministic, private handle; users can change it in settings.
            for row in con.execute("SELECT id,email FROM users WHERE username IS NULL").fetchall():
                base = row["email"].split("@", 1)[0].lower()
                handle = "".join(c for c in base if c.isalnum() or c in "._-")[:24] or f"student{row['id']}"
                if len(handle) < 3:
                    handle = f"student{row['id']}"
                candidate = handle
                suffix = 2
                while con.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (candidate,)).fetchone():
                    candidate = f"{handle[:20]}{suffix}"; suffix += 1
                con.execute("UPDATE users SET username=? WHERE id=?", (candidate, row["id"]))
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)")
        user_columns = {row["name"] for row in con.execute("PRAGMA table_info(users)")}
        for column, definition in (("avatar", "TEXT NOT NULL DEFAULT 'violet'"), ("bio", "TEXT NOT NULL DEFAULT ''"), ("theme", "TEXT NOT NULL DEFAULT 'light'"), ("profile_photo", "TEXT")):
            if column not in user_columns:
                con.execute(f"ALTER TABLE users ADD COLUMN {column} {definition}")
        con.execute("""CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
            description TEXT NOT NULL DEFAULT '',
            created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        project_columns = {row["name"] for row in con.execute("PRAGMA table_info(projects)")}
        if "join_code" not in project_columns:
            con.execute("ALTER TABLE projects ADD COLUMN join_code TEXT")
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        existing_codes = {row[0] for row in con.execute("SELECT join_code FROM projects WHERE join_code IS NOT NULL")}
        for row in con.execute("SELECT id FROM projects WHERE join_code IS NULL").fetchall():
            while True:
                code = "SP-" + "".join(secrets.choice(alphabet) for _ in range(14))
                if code not in existing_codes:
                    con.execute("UPDATE projects SET join_code=? WHERE id=?", (code, row["id"]))
                    existing_codes.add(code)
                    break
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_join_code ON projects(join_code)")
        con.execute("""CREATE TABLE IF NOT EXISTS project_join_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled','blocked')),
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_join_pending ON project_join_requests(project_id,user_id) WHERE status='pending'")
        con.execute("CREATE INDEX IF NOT EXISTS idx_project_join_owner ON project_join_requests(project_id,status,created_at)")
        con.execute("""CREATE TABLE IF NOT EXISTS join_code_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_join_code_attempts_user ON join_code_attempts(user_id,attempted_at)")
        con.execute("""CREATE TABLE IF NOT EXISTS group_message_reads (
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_read_message_id INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(project_id,user_id)
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_members (
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
            role_v6 TEXT CHECK(role_v6 IN ('owner','admin','student')),
            legacy_readonly INTEGER NOT NULL DEFAULT 0 CHECK(legacy_readonly IN (0,1)),
            joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            PRIMARY KEY(project_id,user_id)
        )""")
        # Add the new permission model in place. Keep the legacy role column and all membership rows.
        member_columns = {row["name"] for row in con.execute("PRAGMA table_info(project_members)")}
        if "role_v6" not in member_columns:
            con.execute("ALTER TABLE project_members ADD COLUMN role_v6 TEXT CHECK(role_v6 IN ('owner','admin','student'))")
        if "legacy_readonly" not in member_columns:
            con.execute("ALTER TABLE project_members ADD COLUMN legacy_readonly INTEGER NOT NULL DEFAULT 0 CHECK(legacy_readonly IN (0,1))")
        con.execute("UPDATE project_members SET role_v6=CASE role WHEN 'owner' THEN 'owner' ELSE 'student' END,legacy_readonly=CASE WHEN role='viewer' THEN 1 ELSE legacy_readonly END WHERE role_v6 IS NULL")
        con.execute("""CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
            due_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
            created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            email TEXT NOT NULL COLLATE NOCASE,
            token_hash TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
            invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            accepted_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        comment_columns = {row["name"] for row in con.execute("PRAGMA table_info(comments)")}
        if "edited_at" not in comment_columns: con.execute("ALTER TABLE comments ADD COLUMN edited_at TEXT")
        con.execute("""CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS direct_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            CHECK(user_a < user_b),
            UNIQUE(user_a,user_b)
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS direct_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
            sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
            read_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        direct_columns = {row["name"] for row in con.execute("PRAGMA table_info(direct_messages)")}
        if "edited_at" not in direct_columns: con.execute("ALTER TABLE direct_messages ADD COLUMN edited_at TEXT")
        if "deleted_at" not in direct_columns: con.execute("ALTER TABLE direct_messages ADD COLUMN deleted_at TEXT")
        if "pinned_at" not in direct_columns: con.execute("ALTER TABLE direct_messages ADD COLUMN pinned_at TEXT")
        if "pinned_by" not in direct_columns: con.execute("ALTER TABLE direct_messages ADD COLUMN pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL")
        con.execute("""CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            kind TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            read_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        columns = {row["name"] for row in con.execute("PRAGMA table_info(tasks)")}
        if not columns:
            con.execute("""CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
                course TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL,
                priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
                status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done')),
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            )""")
            columns = {row["name"] for row in con.execute("PRAGMA table_info(tasks)")}
        if "owner_id" not in columns:
            con.execute("ALTER TABLE tasks ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
        if "project_id" not in columns:
            con.execute("ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE")
        for column in ("started_at", "completed_at"):
            if column not in columns:
                con.execute(f"ALTER TABLE tasks ADD COLUMN {column} TEXT")
        con.execute("""CREATE TABLE IF NOT EXISTS task_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            from_status TEXT, to_status TEXT NOT NULL,
            changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        message_columns = {row["name"] for row in con.execute("PRAGMA table_info(messages)")}
        if "edited_at" not in message_columns:
            con.execute("ALTER TABLE messages ADD COLUMN edited_at TEXT")
        if "pinned_at" not in message_columns:
            con.execute("ALTER TABLE messages ADD COLUMN pinned_at TEXT")
        if "pinned_by" not in message_columns:
            con.execute("ALTER TABLE messages ADD COLUMN pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL")
        if "deleted_at" not in message_columns:
            con.execute("ALTER TABLE messages ADD COLUMN deleted_at TEXT")
        con.execute("""CREATE TABLE IF NOT EXISTS task_assignees (
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            assigned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY(task_id,user_id)
        )""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id, due_date)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, due_date)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id,id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id,due_date)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(conversation_id,id)")
        con.execute("""CREATE TABLE IF NOT EXISTS friend_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','blocked')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            CHECK(requester_id<>recipient_id), UNIQUE(requester_id,recipient_id)
        )""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_friend_requests_pair ON friend_requests(requester_id,recipient_id,status)")


def row_to_task(row: sqlite3.Row) -> dict:
    task = dict(row)
    return task
