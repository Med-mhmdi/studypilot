from datetime import date
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TaskStatus(str, Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    course: str = Field(default="", max_length=80)
    due_date: date
    priority: Priority = Priority.medium
    description: str = Field(default="", max_length=2000)


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=160)
    course: str | None = Field(default=None, max_length=80)
    due_date: date | None = None
    priority: Priority | None = None
    status: TaskStatus | None = None
    description: str | None = Field(default=None, max_length=2000)
