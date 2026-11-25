from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["todo", "doing", "blocked", "done"]
Priority = Literal["low", "medium", "high", "urgent"]
RoleName = Literal["admin", "manager", "member", "viewer"]


class LoginIn(BaseModel):
    matricula: str = Field(max_length=40)
    password: str = Field(max_length=200)


class LocalLoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class RegisterIn(LocalLoginIn):
    name: str = Field(max_length=120)


class WorkspaceIn(BaseModel):
    name: str
    timezone: str = "America/Sao_Paulo"


class WorkspacePatch(BaseModel):
    name: str | None = None
    timezone: str | None = None


class PrefsIn(BaseModel):
    notify_email: bool | None = None
    notify_inapp: bool | None = None


class TimezoneIn(BaseModel):
    timezone: str


class InviteIn(BaseModel):
    email: str
    role: RoleName = "member"


class RoleIn(BaseModel):
    role: RoleName


class AcceptIn(BaseModel):
    token: str


class AttributeIn(BaseModel):
    name: str = Field(max_length=200)
    value: str = Field(max_length=1000)


class ProjectIn(BaseModel):
    workspace_id: str
    name: str
    description: str = ""
    summary: str = ""
    responsible: str = ""
    requester: str = ""
    external_ref: str = ""
    attributes: list[AttributeIn] | None = Field(default=None, max_length=50)


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    status: Literal["active", "archived"] | None = None
    phase: Literal["initiation", "planning", "execution", "monitoring", "closing"] | None = None
    approach: Literal["agile", "waterfall"] | None = None
    sei_process: str | None = Field(default=None, max_length=60)
    summary: str | None = None
    responsible: str | None = None
    requester: str | None = None
    external_ref: str | None = None
    attributes: list[AttributeIn] | None = Field(default=None, max_length=50)
    # null explícito = voltar a calcular pelas tarefas; ausente = não mexer.
    progress: int | None = Field(default=None, ge=0, le=100)


class MemberIn(BaseModel):
    user_id: str


class TaskCreate(BaseModel):
    workspace_id: str
    project_id: str | None = None
    title: str
    description: str | None = None
    status: Status | None = None
    priority: Priority | None = None
    assignee_id: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    estimate_minutes: int | None = None
    phase: str | None = None
    is_milestone: bool | None = None
    labels: list[str] | None = None
    parent_id: str | None = None
    sprint_id: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Status | None = None
    priority: Priority | None = None
    assignee_id: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    estimate_minutes: int | None = None
    progress: int | None = None
    phase: str | None = None
    is_milestone: bool | None = None
    labels: list[str] | None = None
    position: float | None = None
    parent_id: str | None = None
    sprint_id: str | None = None
    expected_version: int | None = None


class CommentIn(BaseModel):
    body: str = Field(max_length=20000)


class DependencyIn(BaseModel):
    depends_on_id: str


class ProjectRolesIn(BaseModel):
    roles: list[str] = Field(max_length=8)


class InviteMatriculaIn(BaseModel):
    matricula: str = Field(max_length=40)


class StatusNoteIn(BaseModel):
    state: Literal["on_track", "at_risk", "late"]
    delay_reason: str = Field(default="", max_length=4000)
    done: str = Field(default="", max_length=8000)
    pending: str = Field(default="", max_length=8000)
    blockers: str = Field(default="", max_length=4000)


class TermIn(BaseModel):
    content: dict
    expected_version: int


class PermissionsIn(BaseModel):
    permissions: dict[str, list[str]]


class ShareIn(BaseModel):
    project_id: str = Field(max_length=64)


class DirectShareIn(BaseModel):
    project_id: str = Field(max_length=64)
    unit: str = Field(min_length=1, max_length=40)


Confidence = Literal["on_track", "at_risk", "off_track"]


class ObjectiveIn(BaseModel):
    workspace_id: str = Field(max_length=64)
    title: str = Field(max_length=400)
    period: str = Field(max_length=10)
    description: str = Field(default="", max_length=4000)
    owner_id: str | None = Field(default=None, max_length=64)


class ObjectivePatch(BaseModel):
    title: str | None = Field(default=None, max_length=400)
    period: str | None = Field(default=None, max_length=10)
    description: str | None = Field(default=None, max_length=4000)
    owner_id: str | None = Field(default=None, max_length=64)


class KeyResultIn(BaseModel):
    title: str | None = Field(default=None, max_length=400)
    owner_id: str | None = Field(default=None, max_length=64)
    kind: Literal["number", "project"] | None = None
    start_value: float | None = None
    target_value: float | None = None
    unit: str | None = Field(default=None, max_length=40)
    project_id: str | None = Field(default=None, max_length=64)
    objective_id: str | None = Field(default=None, max_length=64)
    cost: float | None = None


class CheckInIn(BaseModel):
    value: float | None = None
    confidence: Confidence
    note: str = Field(default="", max_length=4000)


class SprintIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    goal: str | None = Field(default=None, max_length=2000)
    start_date: str | None = Field(default=None, max_length=10)
    end_date: str | None = Field(default=None, max_length=10)
    capacity_minutes: int | None = None


class SprintPatch(SprintIn):
    expected_version: int | None = None


class SprintCloseIn(BaseModel):
    carry_to: Literal["next", "backlog"]
