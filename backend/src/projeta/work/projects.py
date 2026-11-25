from psycopg.types.json import Jsonb

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import (
    IN_WORKSPACE_OR_RECEIVED,
    SHARED_FROM,
    VISIBLE_PROJECT,
    membership,
    project_access,
    role_in,
)
from ..identity.policy import assert_can
from .activity import log_activity
from .formal import PHASES

# Campos de texto curto da ficha do projeto: limite em caracteres e rótulo para a mensagem de erro.
DETAIL_FIELDS = {
    "summary": (280, "O resumo"),
    "responsible": (120, "O responsável"),
    "requester": (120, "O demandante"),
    "external_ref": (80, "A origem"),
}


MAX_ATTRIBUTES = 20
ATTR_NAME_MAX = 40
ATTR_VALUE_MAX = 200


def clean_attributes(items: list[dict] | None) -> list[dict] | None:
    """Campos livres do portfólio: lista ordenada de {name, value}; nulo = não mexer.

    Linhas sem nome e sem valor são descartadas (linha vazia no formulário). O nome não se repete
    no mesmo projeto, sem diferenciar maiúsculas, para o filtro do portfólio não ficar ambíguo.
    """
    if items is None:
        return None
    out: list[dict] = []
    seen: set[str] = set()
    for item in items:
        name = " ".join(str(item.get("name") or "").split())
        value = " ".join(str(item.get("value") or "").split())
        if not name and not value:
            continue
        if not name:
            raise BadRequestError(f"O valor “{value[:40]}” está sem nome. Dê um nome ao campo.")
        if not value:
            raise BadRequestError(f"O campo “{name[:40]}” está sem valor. Preencha ou remova.")
        if len(name) > ATTR_NAME_MAX:
            raise BadRequestError(
                f"O nome de campo “{name[:40]}…” passa de {ATTR_NAME_MAX} caracteres."
            )
        if len(value) > ATTR_VALUE_MAX:
            raise BadRequestError(
                f"O valor de “{name}” passa de {ATTR_VALUE_MAX} caracteres. Encurte."
            )
        key = name.casefold()
        if key in seen:
            raise BadRequestError(
                f"O campo “{name}” aparece duas vezes. Junte os valores em um só."
            )
        seen.add(key)
        out.append({"name": name, "value": value})
    if len(out) > MAX_ATTRIBUTES:
        raise BadRequestError(f"Use no máximo {MAX_ATTRIBUTES} campos por projeto.")
    return out


def _details(values: dict[str, str | None]) -> dict[str, str | None]:
    """Normaliza os campos da ficha; nulo = não mexer, texto vazio = limpar."""
    out: dict[str, str | None] = {}
    for key, (limit, label) in DETAIL_FIELDS.items():
        v = values.get(key)
        if v is None:
            out[key] = None
            continue
        v = v.strip()
        if len(v) > limit:
            raise BadRequestError(f"{label} passa de {limit} caracteres. Encurte o texto.")
        out[key] = v
    return out


def create_project(
    ctx: Ctx,
    workspace_id: str,
    name: str,
    description: str = "",
    summary: str = "",
    responsible: str = "",
    requester: str = "",
    external_ref: str = "",
    attributes: list[dict] | None = None,
) -> dict:
    assert_can(membership(ctx, workspace_id), "project.create")
    attrs = clean_attributes(attributes) or []
    name = name.strip()
    if len(name) < 2:
        raise BadRequestError("Dê um nome ao projeto")
    d = _details(
        {
            "summary": summary,
            "responsible": responsible,
            "requester": requester,
            "external_ref": external_ref,
        }
    )
    p = ctx.one(
        """INSERT INTO projects(workspace_id, name, description, summary, responsible, requester,
             external_ref, attributes, created_by)
           VALUES (%(ws)s, %(name)s, %(description)s, %(summary)s, %(responsible)s, %(requester)s,
             %(external_ref)s, %(attributes)s, %(uid)s) RETURNING *""",
        {
            **d,
            "ws": workspace_id,
            "name": name,
            "description": description.strip(),
            "attributes": Jsonb(attrs),
            "uid": ctx.user_id,
        },
    )
    assert p
    ctx.run(
        "INSERT INTO project_members(project_id,user_id) VALUES (%s,%s)", (p["id"], ctx.user_id)
    )
    log_activity(ctx, workspace_id, "project.created", p["id"], data={"name": name})
    return p


def list_projects(ctx: Ctx, workspace_id: str, include_archived: bool = False) -> list[dict]:
    role_in(ctx, workspace_id)
    return ctx.all(
        f"""SELECT p.id, p.workspace_id, p.name, p.description, p.status, p.created_at,
          p.phase, p.approach, p.sei_process, p.summary, p.responsible, p.requester, p.external_ref,
          p.attributes, p.progress,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
          (SELECT max(a.created_at) FROM activity a WHERE a.project_id = p.id) AS last_activity,
          (SELECT c.updated_at FROM project_covers c WHERE c.project_id = p.id) AS cover_version,
          {SHARED_FROM}
        FROM projects p WHERE {IN_WORKSPACE_OR_RECEIVED} AND {VISIBLE_PROJECT}
        {"" if include_archived else "AND p.status = 'active'"} ORDER BY p.status, p.name""",
        {"ws": workspace_id, "uid": ctx.user_id},
    )


def get_project(ctx: Ctx, project_id: str) -> dict:
    a = project_access(ctx, project_id)
    members = ctx.all(
        "SELECT u.id, u.name, u.email, wm.role, pm.roles AS project_roles FROM project_members pm JOIN users u ON u.id = pm.user_id "
        "JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = %s "
        "WHERE pm.project_id = %s ORDER BY u.name",
        (a.project["workspace_id"], project_id),
    )
    stats = ctx.all(
        "SELECT status, count(*)::int AS n FROM tasks WHERE project_id = %s GROUP BY status",
        (project_id,),
    )
    activity = ctx.all(
        "SELECT a.id, a.kind, a.data, a.via, a.created_at, a.task_id, u.name AS actor_name "
        "FROM activity a LEFT JOIN users u ON u.id = a.actor_id WHERE a.project_id = %s "
        "ORDER BY a.created_at DESC LIMIT 20",
        (project_id,),
    )
    cover = ctx.one("SELECT updated_at FROM project_covers WHERE project_id = %s", (project_id,))
    return {
        "project": {**a.project, "cover_version": cover["updated_at"] if cover else None},
        "can_write": a.can_write,
        "can_manage": a.can_manage,
        "can_comment": a.can_comment,
        "members": members,
        "stats": {r["status"]: r["n"] for r in stats},
        "activity": activity,
    }


def update_project(
    ctx: Ctx,
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    status: str | None = None,
    phase: str | None = None,
    approach: str | None = None,
    sei_process: str | None = None,
    summary: str | None = None,
    responsible: str | None = None,
    requester: str | None = None,
    external_ref: str | None = None,
    attributes: list[dict] | None = None,
    progress: int | None = None,
    clear_progress: bool = False,
) -> dict:
    """Campos nulos não mudam. `clear_progress` volta o percentual a ser calculado pelas tarefas."""
    a = project_access(ctx, project_id, lock=True)
    # Reativar um projeto arquivado também é gestão: não depende de can_manage (exige ativo).
    assert_can(a.member, "project.manage")
    if not a.linked:
        raise ForbiddenError()
    if status is not None and status not in ("active", "archived"):
        raise BadRequestError("Status inválido")
    if phase is not None and phase not in PHASES:
        raise BadRequestError(
            "Fase inválida. Use initiation, planning, execution, monitoring ou closing."
        )
    if approach is not None and approach not in ("agile", "waterfall"):
        raise BadRequestError("Abordagem inválida. Use agile ou waterfall.")
    # Processo SEI: texto vazio limpa o campo; nulo mantém.
    sei = None if sei_process is None else (sei_process.strip()[:60] or "")
    d = _details(
        {
            "summary": summary,
            "responsible": responsible,
            "requester": requester,
            "external_ref": external_ref,
        }
    )
    attrs = clean_attributes(attributes)
    if progress is not None and not (isinstance(progress, int) and 0 <= progress <= 100):
        raise BadRequestError("O percentual concluído deve ficar entre 0 e 100.")
    # Parâmetros nomeados: cada coluna aparece ao lado do seu valor, sem depender da ordem.
    p = ctx.one(
        """UPDATE projects SET
             name = COALESCE(%(name)s, name),
             description = COALESCE(%(description)s, description),
             status = COALESCE(%(status)s, status),
             phase = COALESCE(%(phase)s, phase),
             approach = COALESCE(%(approach)s, approach),
             sei_process = CASE WHEN %(sei)s::text IS NULL THEN sei_process
                                ELSE NULLIF(%(sei)s::text, '') END,
             summary = COALESCE(%(summary)s, summary),
             responsible = COALESCE(%(responsible)s, responsible),
             requester = COALESCE(%(requester)s, requester),
             external_ref = COALESCE(%(external_ref)s, external_ref),
             attributes = COALESCE(%(attributes)s, attributes),
             progress = CASE WHEN %(clear_progress)s THEN NULL
                             ELSE COALESCE(%(progress)s, progress) END,
             updated_at = now()
           WHERE id = %(id)s RETURNING *""",
        {
            **d,
            "name": (name or "").strip() or None,
            "description": description,
            "status": status,
            "phase": phase,
            "approach": approach,
            "sei": sei,
            "attributes": None if attrs is None else Jsonb(attrs),
            "clear_progress": clear_progress,
            "progress": progress,
            "id": project_id,
        },
    )
    assert p
    if phase and phase != a.project["phase"]:
        log_activity(
            ctx,
            a.project["workspace_id"],
            "project.phase_changed",
            project_id,
            data={"phase": phase},
        )
    if p["progress"] != a.project["progress"]:
        log_activity(
            ctx,
            a.project["workspace_id"],
            "project.progress_set",
            project_id,
            data={"progress": p["progress"]},
        )
    if status and status != a.project["status"]:
        log_activity(
            ctx,
            a.project["workspace_id"],
            "project.archived" if status == "archived" else "project.restored",
            project_id,
        )
    return p


def add_project_member(ctx: Ctx, project_id: str, user_id: str) -> None:
    a = project_access(ctx, project_id)
    if not a.can_manage:
        raise ForbiddenError()
    if not ctx.one(
        "SELECT 1 AS x FROM workspace_members WHERE workspace_id=%s AND user_id=%s",
        (a.project["workspace_id"], user_id),
    ):
        raise BadRequestError("A pessoa precisa ser membro do espaço")
    ctx.run(
        "INSERT INTO project_members(project_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
        (project_id, user_id),
    )
    log_activity(
        ctx,
        a.project["workspace_id"],
        "project.member_added",
        project_id,
        data={"user_id": user_id},
    )


def remove_project_member(ctx: Ctx, project_id: str, user_id: str) -> None:
    a = project_access(ctx, project_id)
    if not a.can_manage:
        raise ForbiddenError()
    ctx.run("DELETE FROM project_members WHERE project_id=%s AND user_id=%s", (project_id, user_id))
    ctx.run(
        "UPDATE tasks SET assignee_id=NULL, version=version+1 WHERE project_id=%s AND assignee_id=%s",
        (project_id, user_id),
    )
