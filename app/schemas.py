from datetime import date
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Register(RequestModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=200)


class Login(RequestModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ProfileUpdate(RequestModel):
    name: str = Field(min_length=1, max_length=80)
    username: str | None = Field(default=None, min_length=3, max_length=24, pattern=r"^[A-Za-z0-9._-]+$")


class PasswordUpdate(RequestModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=10, max_length=200)


class ProjectCreate(RequestModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class InviteCreate(RequestModel):
    email: EmailStr
    role: str = Field(default="editor", pattern="^(editor|viewer)$")


class MessageCreate(RequestModel):
    body: str = Field(min_length=1, max_length=2000)


class MessageUpdate(RequestModel):
    body: str = Field(min_length=1, max_length=2000)


class FriendRequestCreate(RequestModel):
    username: str = Field(min_length=3, max_length=24)


class InviteAccept(RequestModel):
    token: str = Field(min_length=20, max_length=200)


class DirectConversationCreate(RequestModel):
    recipient_id: int = Field(gt=0)


class MilestoneCreate(RequestModel):
    title: str = Field(min_length=1, max_length=160)
    due_date: date


class MilestoneUpdate(RequestModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    due_date: date | None = None
    status: str | None = Field(default=None, pattern="^(open|done)$")


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TaskStatus(str, Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class TaskCreate(RequestModel):
    title: str = Field(min_length=1, max_length=160)
    course: str = Field(default="", max_length=80)
    due_date: date
    priority: Priority = Priority.medium
    description: str = Field(default="", max_length=2000)
    project_id: int | None = None
    assignee_ids: list[int] = Field(default_factory=list, max_length=30)


class TaskUpdate(RequestModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=160)
    course: str | None = Field(default=None, max_length=80)
    due_date: date | None = None
    priority: Priority | None = None
    status: TaskStatus | None = None
    description: str | None = Field(default=None, max_length=2000)
    assignee_ids: list[int] | None = Field(default=None, max_length=30)
