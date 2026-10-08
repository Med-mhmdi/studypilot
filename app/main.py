from contextlib import asynccontextmanager
from datetime import date
import sqlite3
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import db
from app.schemas import Priority, TaskCreate, TaskStatus, TaskUpdate
from app.telemetry import configure_telemetry, request_metrics


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.initialize()
    yield


app = FastAPI(title="StudyPilot", version="0.1.0", lifespan=lifespan)
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


@app.get("/api/tasks")
def list_tasks(
    status: Annotated[TaskStatus | None, Query()] = None,
    course: Annotated[str | None, Query(max_length=80)] = None,
):
    clauses: list[str] = []
    values: list[str] = []
    if status:
        clauses.append("status = ?")
        values.append(status.value)
    if course:
        clauses.append("course = ?")
        values.append(course)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with db.connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM tasks{where} ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, due_date, id",
            values,
        ).fetchall()
    return [db.row_to_task(row) for row in rows]


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate):
    title = task.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title cannot be blank")
    with db.connect() as connection:
        cursor = connection.execute(
            "INSERT INTO tasks (title, course, due_date, priority, status, description) VALUES (?, ?, ?, ?, 'todo', ?)",
            (title, task.course.strip(), task.due_date.isoformat(), task.priority.value, task.description.strip()),
        )
        row = connection.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return db.row_to_task(row)


@app.get("/api/tasks/{task_id}")
def get_task(task_id: int):
    with db.connect() as connection:
        row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="assignment not found")
    return db.row_to_task(row)


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, task: TaskUpdate):
    changes = task.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="provide at least one field")
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="updated fields cannot be null")
    if "title" in changes:
        changes["title"] = changes["title"].strip()
        if not changes["title"]:
            raise HTTPException(status_code=422, detail="title cannot be blank")
    if "course" in changes and changes["course"] is not None:
        changes["course"] = changes["course"].strip()
    if "description" in changes and changes["description"] is not None:
        changes["description"] = changes["description"].strip()
    for key, value in list(changes.items()):
        if isinstance(value, (date, Priority, TaskStatus)):
            changes[key] = value.value if isinstance(value, (Priority, TaskStatus)) else value.isoformat()
    assignments = ", ".join(f"{key} = ?" for key in changes)
    values = list(changes.values())
    with db.connect() as connection:
        cursor = connection.execute(
            f"UPDATE tasks SET {assignments}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            [*values, task_id],
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="assignment not found")
        row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return db.row_to_task(row)


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int):
    with db.connect() as connection:
        cursor = connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="assignment not found")
    return Response(status_code=204)
