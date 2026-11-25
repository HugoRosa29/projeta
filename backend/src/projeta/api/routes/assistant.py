import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...assistant import proposals, service
from ...db import uow
from ..deps import current_user

router = APIRouter(tags=["assistant"], prefix="/assistant")


class ChatIn(BaseModel):
    workspace_id: str
    project_id: str | None = None
    message: str = Field(max_length=10_000)


class ResolveIn(BaseModel):
    workspace_id: str
    project_id: str | None = None
    pending_action: dict
    task_id: str


class EditIn(BaseModel):
    payload: dict


@router.post("/chat")
def chat(body: ChatIn, user: dict = Depends(current_user)) -> dict:
    return service.chat(user, body.workspace_id, body.project_id, body.message)


@router.post("/chat/stream")
def chat_stream(body: ChatIn, user: dict = Depends(current_user)) -> StreamingResponse:
    """Mesma rodada de /chat, entregue como NDJSON: uma linha JSON por evento.

    Validação, permissão e limite rodam antes do stream abrir, então falham com o HTTP de sempre.
    """
    turn = service.start_chat(user, body.workspace_id, body.project_id, body.message)

    def lines() -> Iterator[str]:
        for ev in service.stream_reply(turn):
            yield json.dumps(jsonable_encoder(ev), ensure_ascii=False) + "\n"

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        # Sem buffer no caminho (nginx) e sem cache: cada linha chega quando é gerada.
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/resolve")
def resolve(body: ResolveIn, user: dict = Depends(current_user)) -> dict:
    return service.resolve_candidate(
        user, body.workspace_id, body.project_id, body.pending_action, body.task_id
    )


@router.get("/conversation")
def conversation(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return service.load_conversation(ctx, workspace_id)


@router.delete("/conversation", status_code=204)
def delete_conversation(workspace_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        service.delete_history(ctx, workspace_id)


@router.patch("/proposals/{proposal_id}")
def edit(proposal_id: str, body: EditIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return proposals.edit_proposal(ctx, proposal_id, body.payload)


@router.post("/proposals/{proposal_id}/confirm")
def confirm(proposal_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return proposals.confirm_proposal(ctx, proposal_id)


@router.post("/proposals/{proposal_id}/cancel")
def cancel(proposal_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return proposals.cancel_proposal(ctx, proposal_id)
