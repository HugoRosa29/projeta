from psycopg.types.json import Jsonb

from ..db import Ctx


def log_activity(
    ctx: Ctx,
    workspace_id: str,
    kind: str,
    project_id: str | None = None,
    task_id: str | None = None,
    data: dict | None = None,
    via: str = "manual",
) -> None:
    ctx.run(
        "INSERT INTO activity(workspace_id, project_id, task_id, actor_id, kind, data, via) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (workspace_id, project_id, task_id, ctx.user_id, kind, Jsonb(data or {}), via),
    )
