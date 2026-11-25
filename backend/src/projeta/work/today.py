from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from ..db import Ctx
from .tasks import list_my_tasks


def today_in(timezone: str, now: datetime | None = None) -> str:
    """Data de calendário de hoje no fuso informado (AAAA-MM-DD)."""
    return (now or datetime.now(UTC)).astimezone(ZoneInfo(timezone)).date().isoformat()


def add_days(d: str, days: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=days)).isoformat()


def get_today(ctx: Ctx, workspace_id: str, timezone: str, now: datetime | None = None) -> dict:
    today = today_in(timezone, now)
    open_tasks = list_my_tasks(ctx, workspace_id, today)
    limit = add_days(today, 7)
    overdue = [t for t in open_tasks if t["due_date"] and t["due_date"] < today]
    due_today = [t for t in open_tasks if t["due_date"] == today]
    upcoming = [t for t in open_tasks if t["due_date"] and today < t["due_date"] <= limit]
    seen = {t["id"] for t in overdue + due_today}
    # Urgente antes de alta; dentro de cada uma, a ordem de list_my_tasks (prazo).
    top = [t for t in open_tasks if t["priority"] in ("urgent", "high") and t["id"] not in seen]
    top.sort(key=lambda t: t["priority"] != "urgent")
    priorities = top[:5]
    # Sem prazo e sem prioridade alta/urgente: aparece aqui para a tarefa recém-criada (só título) não "sumir".
    shown = seen | {t["id"] for t in priorities}
    inbox = [t for t in open_tasks if not t["due_date"] and t["id"] not in shown]
    inbox.sort(key=lambda t: t["created_at"], reverse=True)
    return {
        "today": today,
        "inbox": inbox[:8],
        "overdue": overdue,
        "due_today": due_today,
        "upcoming": upcoming,
        "priorities": priorities,
    }
