"""Formato validado das propostas. O texto do modelo nunca vira SQL nem define identidade."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ..errors import BadRequestError

MAX_PHASES = 12
MAX_WBS_TASKS = 80


def _date(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    try:
        if date.fromisoformat(v).isoformat() != v:
            raise ValueError
    except ValueError as e:
        raise ValueError("Data inválida (use AAAA-MM-DD)") from e
    return v


class NewTask(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: str | None = None
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    description: str | None = Field(default=None, max_length=2000)

    _d = field_validator("due_date")(_date)


class CreateTasksPayload(BaseModel):
    project_id: str | None = None  # nulo = tarefas pessoais
    tasks: list[NewTask] = Field(min_length=1, max_length=30)


class WbsTask(BaseModel):
    ref: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    due_date: str | None = None
    estimate_minutes: int | None = Field(default=None, ge=0, le=100_000)
    is_milestone: bool = False
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    depends_on: list[str] = Field(default_factory=list, max_length=10)

    _d = field_validator("due_date")(_date)


class WbsPhase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    tasks: list[WbsTask] = Field(min_length=1, max_length=40)


class WbsPayload(BaseModel):
    project_id: str | None = None  # projeto existente...
    project_name: str | None = Field(default=None, max_length=120)  # ...ou um novo
    summary: str = Field(default="", max_length=500)
    assumptions: list[str] = Field(default_factory=list, max_length=10)
    phases: list[WbsPhase] = Field(min_length=1, max_length=MAX_PHASES)

    @model_validator(mode="after")
    def _check(self) -> WbsPayload:
        if not self.project_id and not (self.project_name or "").strip():
            raise ValueError("Informe o projeto existente ou o nome do novo projeto")
        refs = [t.ref for p in self.phases for t in p.tasks]
        if len(refs) > MAX_WBS_TASKS:
            raise ValueError(f"A EAP pode ter no máximo {MAX_WBS_TASKS} tarefas")
        if len(set(refs)) != len(refs):
            raise ValueError("Há referências de tarefa repetidas na EAP")
        known = set(refs)
        graph: dict[str, list[str]] = {}
        for p in self.phases:
            for t in p.tasks:
                for d in t.depends_on:
                    if d not in known:
                        raise ValueError(f"A dependência “{d}” não existe na EAP")
                    if d == t.ref:
                        raise ValueError("Uma tarefa não pode depender dela mesma")
                graph[t.ref] = list(t.depends_on)
        # ciclos: DFS com cores
        state: dict[str, int] = {}

        def visit(n: str) -> None:
            state[n] = 1
            for m in graph[n]:
                if state.get(m) == 1:
                    raise ValueError("As dependências da EAP formam um ciclo")
                if state.get(m) is None:
                    visit(m)
            state[n] = 2

        for n in graph:
            if state.get(n) is None:
                visit(n)
        return self


class UpdateChanges(BaseModel):
    status: Literal["todo", "doing", "blocked", "done"] | None = None
    due_date: str | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    assignee_id: str | None = None
    clear_due_date: bool = False
    clear_assignee: bool = False

    _d = field_validator("due_date")(_date)


class UpdatePayload(BaseModel):
    task_id: str
    changes: UpdateChanges

    @model_validator(mode="after")
    def _nonempty(self) -> UpdatePayload:
        c = self.changes
        if (
            c.status is None
            and c.due_date is None
            and c.progress is None
            and c.priority is None
            and c.assignee_id is None
            and not c.clear_due_date
            and not c.clear_assignee
        ):
            raise ValueError(
                "Informe ao menos uma alteração (estado, prazo, progresso, prioridade ou responsável)"
            )
        return self


class CommentPayload(BaseModel):
    """Comentário na tarefa, escrito em nome da pessoa — por isso só grava após ela confirmar."""

    task_id: str
    body: str = Field(min_length=1, max_length=5000)

    @field_validator("body")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Escreva o texto do comentário")
        return v


class StatusNotePayload(BaseModel):
    """Nota semanal de acompanhamento (POP: situação, justificativa, realizado, pendente, impedimentos)."""

    project_id: str
    state: Literal["on_track", "at_risk", "late"]
    delay_reason: str = Field(default="", max_length=4000)
    done: str = Field(default="", max_length=8000)
    pending: str = Field(default="", max_length=8000)
    blockers: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def _late_needs_reason(self) -> StatusNotePayload:
        if self.state == "late" and not self.delay_reason.strip():
            raise ValueError("Projeto atrasado precisa de justificativa do atraso")
        return self


MODELS: dict[str, type[BaseModel]] = {
    "create_tasks": CreateTasksPayload,
    "apply_wbs": WbsPayload,
    "update_task": UpdatePayload,
    "status_note": StatusNotePayload,
    "add_comment": CommentPayload,
}


def parse_payload(kind: str, payload: dict) -> BaseModel:
    try:
        return MODELS[kind].model_validate(payload)
    except Exception as e:  # pydantic.ValidationError ou ValueError de modelo
        msg = "; ".join(
            str(x.get("msg", x)).removeprefix("Value error, ")
            for x in getattr(e, "errors", lambda: [])()
        ) or str(e)
        raise BadRequestError(f"Proposta inválida: {msg}") from e
