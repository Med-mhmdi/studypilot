"""SQLite persistence and additive, backward-compatible schema migration."""

from __future__ import annotations

import os
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
        con.execute("""CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
            description TEXT NOT NULL DEFAULT '',
            created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_members (
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
            joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            PRIMARY KEY(project_id,user_id)
        )""")
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


def row_to_task(row: sqlite3.Row) -> dict:
    task = dict(row)
    return task
