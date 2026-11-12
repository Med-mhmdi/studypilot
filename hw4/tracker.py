"""Assignment tracker for the StudyPilot Kubernetes homework."""

import os
from contextlib import contextmanager
from typing import Annotated
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, StringConstraints

app = FastAPI(
    title="StudyPilot Assignment Tracker · Kubernetes HW4",
    description="Coursework demo. Use the API below to add and complete assignments.",
)


class AssignmentInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


class AssignmentStatus(BaseModel):
    completed: bool


@contextmanager
def connect():
    try:
        # Fresh connections resolve the CNPG read-write Service after promotion.
        with psycopg.connect(
            os.environ["DATABASE_URL"],
            connect_timeout=2,
            sslmode="verify-full",
            sslrootcert=os.environ["DATABASE_CA_FILE"],
            target_session_attrs="read-write",
            options="-c statement_timeout=2000 -c lock_timeout=1500",
            row_factory=dict_row,
        ) as conn:
            yield conn
    except (psycopg.OperationalError, psycopg.errors.QueryCanceled, psycopg.errors.LockNotAvailable):
        raise HTTPException(503, "Database temporarily unavailable") from None


@app.get("/", include_in_schema=False)
def home():
    return Response(status_code=307, headers={"Location": "/docs"})


@app.get("/livez", include_in_schema=False)
def live():
    return {"status": "ok"}


@app.get("/readyz", include_in_schema=False)
def ready():
    with connect() as conn:
        try:
            conn.execute("SELECT id FROM public.assignments LIMIT 1")
        except psycopg.errors.UndefinedTable:
            raise HTTPException(503, "Database schema not ready") from None
    return {"status": "ready"}


@app.get("/instance")
def instance(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"pod": os.getenv("POD_NAME", "local")}


@app.get("/assignments")
def list_assignments():
    with connect() as conn:
        return conn.execute(
            "SELECT id, title, completed FROM public.assignments ORDER BY created_at DESC, id LIMIT 100"
        ).fetchall()


@app.post("/assignments", status_code=201)
def create_assignment(assignment: AssignmentInput):
    with connect() as conn:
        return conn.execute(
            """
            INSERT INTO public.assignments (id, title) VALUES (%s, %s)
            RETURNING id, title, completed
            """,
            (uuid4(), assignment.title),
        ).fetchone()


@app.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: UUID, status: AssignmentStatus):
    with connect() as conn:
        row = conn.execute(
            """
            UPDATE public.assignments SET completed = %s WHERE id = %s
            RETURNING id, title, completed
            """,
            (status.completed, assignment_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Assignment not found")
        return row
