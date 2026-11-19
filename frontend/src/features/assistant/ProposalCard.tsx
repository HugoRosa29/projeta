import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useSession } from "../../app/session";
import { useToast } from "../../components/ui";
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Priority, type Status } from "../../domain/types";
import { ApiError, api } from "../../services/api";
import { useInvalidateWork } from "../tasks/hooks";
import { HEALTH_LABEL, type Health } from "../../domain/formal";
import type { CommentPayload, CreatePayload, Proposal, StatusNotePayload, UpdatePayload, WbsPayload } from "./types";

/**
 * Prévia editável. As edições ficam em rascunho local; ao confirmar, o servidor recebe o
 * rascunho, revalida tudo (permissão, validade, versão) e só então grava. O sucesso mostrado
 * vem da resposta do backend, nunca do navegador.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { workspace } = useSession();
  const qc = useQueryClient();
  const invalidateWork = useInvalidateWork();
  const toast = useToast();
  const [draft, setDraft] = useState(proposal.payload);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Proposal>(proposal);
  const [notice, setNotice] = useState<string | null>(null);

  const edit = (p: Proposal["payload"]) => (setDraft(p), setDirty(true));
  const refresh = () => qc.invalidateQueries({ queryKey: ["assistant", workspace.id] });

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (dirty) {
        const edited = await api.patch<Proposal>(`/assistant/proposals/${live.id}`, { payload: draft });
        setLive(edited);
        setDraft(edited.payload);
        setDirty(false);
      }
      const r = await api.post<{ status: string; proposal: Proposal; message?: string }>(`/assistant/proposals/${live.id}/confirm`);
      if (r.status === "stale") {
        setLive(r.proposal);
        setDraft(r.proposal.payload);
        setDirty(false);
        setNotice("A tarefa mudou depois da proposta. Atualizei o antes/depois — confira e confirme de novo.");
        return;
      }
      setLive(r.proposal);
      invalidateWork();
      if (r.message) toast(r.message);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível confirmar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      setLive(await api.post<Proposal>(`/assistant/proposals/${live.id}/cancel`));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    live.kind === "apply_wbs"
      ? "Rascunho de EAP"
      : live.kind === "create_tasks"
        ? "Tarefas propostas"
        : live.kind === "status_note"
          ? "Nota de acompanhamento"
          : live.kind === "add_comment"
            ? "Comentário proposto"
            : "Alteração proposta";

  if (live.status === "confirmed")
    return (
      <div className="proposal" role="status" style={{ borderColor: "var(--verde)" }}>
        <h3>✔ {title} — confirmado</h3>
        <ResultLinks result={live.result} />
      </div>
    );
  if (live.status !== "pending")
    return <div className="proposal" role="status"><h3>{title} — {live.status === "cancelled" ? "cancelado (nada foi criado)" : "expirado"}</h3></div>;

  return (
    <div className="proposal" role="group" aria-label={title}>
      <h3>{title} <span className="badge warn">aguardando sua confirmação</span></h3>
      {notice && <p role="alert" className="diff"><strong>{notice}</strong></p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {live.kind === "update_task" && <UpdateEditor proposal={live} draft={draft as UpdatePayload} edit={edit} />}
      {live.kind === "create_tasks" && <CreateEditor draft={draft as CreatePayload} edit={edit} />}
      {live.kind === "apply_wbs" && <WbsEditor draft={draft as WbsPayload} edit={edit} />}
      {live.kind === "status_note" && <StatusNoteEditor draft={draft as StatusNotePayload} edit={edit} />}
      {live.kind === "add_comment" && <CommentEditor proposal={live} draft={draft as CommentPayload} edit={edit} />}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
          {live.kind === "apply_wbs" ? "Criar projeto e tarefas" : live.kind === "status_note" ? "Publicar nota" : live.kind === "add_comment" ? "Publicar comentário" : "Confirmar"}
        </button>
        <button className="btn btn-line btn-sm" onClick={cancel} disabled={busy}>Cancelar</button>
        {dirty && <span className="coord">editado</span>}
      </div>
      <p className="coord">Vale até {new Date(live.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
    </div>
  );
}

function ResultLinks({ result }: { result: Proposal["result"] }) {
  if (!result) return null;
  const items = result.created ?? result.updated ?? [];
  return (
    <ul>
      {result.project && <li><Link to={result.project.href}>Abrir projeto “{result.project.name}”</Link></li>}
      {items.slice(0, 6).map((i) => <li key={i.id}><Link to={i.href}>{i.title}</Link></li>)}
      {items.length > 6 && <li className="muted">e mais {items.length - 6}…</li>}
    </ul>
  );
}

type Edit = (p: Proposal["payload"]) => void;

function StatusNoteEditor({ draft, edit }: { draft: StatusNotePayload; edit: Edit }) {
  const set = (k: keyof StatusNotePayload, v: string) => edit({ ...draft, [k]: v });
  const area = (k: "delay_reason" | "done" | "pending" | "blockers", label: string) => (
    <div className="field">
      <label htmlFor={`sn-${k}`}>{label}</label>
      <textarea id={`sn-${k}`} className="textarea" value={draft[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  return (
    <>
      <div className="field">
        <label htmlFor="sn-state">Situação</label>
        <select id="sn-state" className="select" value={draft.state} onChange={(e) => set("state", e.target.value)}>
          {(Object.keys(HEALTH_LABEL) as Health[]).map((h) => <option key={h} value={h}>{HEALTH_LABEL[h]}</option>)}
        </select>
      </div>
      {draft.state === "late" && area("delay_reason", "Justificativa do atraso (obrigatória)")}
      {area("done", "O que já foi realizado")}
      {area("pending", "O que está pendente")}
      {area("blockers", "Impedimentos")}
    </>
  );
}

function UpdateEditor({ proposal, draft, edit }: { proposal: Proposal; draft: UpdatePayload; edit: Edit }) {
  const t = proposal.preview.tasks?.[0];
  const set = (k: keyof UpdatePayload["changes"], v: unknown) => edit({ ...draft, changes: { ...draft.changes, [k]: v } });
  const after = (field: string, fallback: string) => {
    const c = draft.changes;
    if (field === "status" && c.status) return STATUS_LABEL[c.status as Status];
    if (field === "progress" && c.progress != null) return `${c.progress}%`;
    if (field === "priority" && c.priority) return PRIORITY_LABEL[c.priority];
    if (field === "due_date") {
      if (c.clear_due_date) return "—";
      if (c.due_date) return c.due_date.split("-").reverse().join("/");
    }
    return fallback;
  };
  return (
    <>
      {t && (
        <p>
          <Link to={t.href}>{t.title}</Link> {t.project && <span className="muted">· {t.project}</span>}
        </p>
      )}
      <ul className="diff" aria-label="Antes e depois">
        {t?.changes.map((c) => (
          <li key={c.field + c.after}>
            {c.label}: <del>{c.before}</del> → <ins>{after(c.field, c.after)}</ins>
          </li>
        ))}
      </ul>
      <div className="row">
        {draft.changes.status != null && (
          <label className="row" style={{ gap: 6 }}>Estado
            <select className="input" value={draft.changes.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        )}
        {draft.changes.progress != null && (
          <label className="row" style={{ gap: 6 }}>Progresso %
            <input type="number" className="input" style={{ width: 90, minHeight: 36 }} min={0} max={100} value={draft.changes.progress} onChange={(e) => set("progress", Math.min(100, Math.max(0, Number(e.target.value))))} />
          </label>
        )}
        {draft.changes.priority != null && (
          <label className="row" style={{ gap: 6 }}>Prioridade
            <select className="input" value={draft.changes.priority} onChange={(e) => set("priority", e.target.value)}>
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
        )}
        {draft.changes.due_date != null && (
          <label className="row" style={{ gap: 6 }}>Prazo
            <input type="date" className="input" style={{ minHeight: 36 }} value={draft.changes.due_date ?? ""} onChange={(e) => e.target.value && set("due_date", e.target.value)} />
          </label>
        )}
      </div>
    </>
  );
}

function CommentEditor({ proposal, draft, edit }: { proposal: Proposal; draft: CommentPayload; edit: Edit }) {
  const t = proposal.preview.tasks?.[0];
  return (
    <>
      {t && (
        <p>
          <Link to={t.href}>{t.title}</Link> {t.project && <span className="muted">· {t.project}</span>}
        </p>
      )}
      <div className="field">
        <label htmlFor={`cm-${proposal.id}`}>Comentário</label>
        <textarea id={`cm-${proposal.id}`} className="textarea" value={draft.body} maxLength={5000} onChange={(e) => edit({ ...draft, body: e.target.value })} />
      </div>
    </>
  );
}

function CreateEditor({ draft, edit }: { draft: CreatePayload; edit: Edit }) {
  return (
    <ul>
      {draft.tasks.map((t, i) => (
        <li key={i} className="ptask">
          <input className="input" aria-label={`Título da tarefa ${i + 1}`} value={t.title} maxLength={200} onChange={(e) => edit({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
          <input className="input date" type="date" aria-label={`Prazo da tarefa ${i + 1}`} value={t.due_date ?? ""} onChange={(e) => edit({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, due_date: e.target.value || null } : x)) })} />
          {draft.tasks.length > 1 && (
            <button type="button" className="icon-btn" aria-label={`Remover tarefa ${i + 1}`} onClick={() => edit({ ...draft, tasks: draft.tasks.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
          )}
        </li>
      ))}
    </ul>
  );
}

function WbsEditor({ draft, edit }: { draft: WbsPayload; edit: Edit }) {
  const total = draft.phases.reduce((n, p) => n + p.tasks.length, 0);
  const removeTask = (pi: number, ref: string) =>
    edit({
      ...draft,
      phases: draft.phases
        .map((p, i) => ({ ...p, tasks: (i === pi ? p.tasks.filter((t) => t.ref !== ref) : p.tasks).map((t) => ({ ...t, depends_on: t.depends_on.filter((d) => d !== ref) })) }))
        .filter((p) => p.tasks.length > 0),
    });
  const patchTask = (pi: number, ref: string, patch: Partial<WbsPayload["phases"][0]["tasks"][0]>) =>
    edit({ ...draft, phases: draft.phases.map((p, i) => (i === pi ? { ...p, tasks: p.tasks.map((t) => (t.ref === ref ? { ...t, ...patch } : t)) } : p)) });
  const nameOf = (ref: string) => draft.phases.flatMap((p) => p.tasks).find((t) => t.ref === ref)?.title ?? ref;
  return (
    <>
      {!draft.project_id && (
        <div className="field" style={{ marginBottom: 4 }}>
          <label htmlFor="wbs-name">Nome do novo projeto</label>
          <input id="wbs-name" className="input" value={draft.project_name ?? ""} onChange={(e) => edit({ ...draft, project_name: e.target.value })} />
        </div>
      )}
      {draft.summary && <p className="muted">{draft.summary}</p>}
      <p className="coord">{draft.phases.length} fases · {total} itens</p>
      {draft.phases.map((p, pi) => (
        <div key={p.name}>
          <p className="phase">{p.name}</p>
          <ul>
            {p.tasks.map((t) => (
              <li key={t.ref}>
                <div className="ptask">
                  <span aria-hidden>{t.is_milestone ? "◆" : "•"}</span>
                  <input className="input" aria-label={`${t.is_milestone ? "Marco" : "Tarefa"}: título`} value={t.title} maxLength={200} onChange={(e) => patchTask(pi, t.ref, { title: e.target.value })} />
                  <input className="input date" type="date" aria-label={`Prazo de ${t.title}`} value={t.due_date ?? ""} onChange={(e) => patchTask(pi, t.ref, { due_date: e.target.value || null })} />
                  <button type="button" className="icon-btn" aria-label={`Remover ${t.title}`} onClick={() => removeTask(pi, t.ref)}><Trash2 size={16} /></button>
                </div>
                {t.depends_on.length > 0 && <div className="coord" style={{ paddingLeft: 20 }}>depende de: {t.depends_on.map(nameOf).join(", ")}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {draft.assumptions.length > 0 && (
        <div>
          <p className="phase">Premissas</p>
          <ul>{draft.assumptions.map((a) => <li key={a} className="muted">• {a}</li>)}</ul>
        </div>
      )}
    </>
  );
}
