import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, CheckCircle2, Eye, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useSession } from "../../app/session";
import { useToast } from "../../components/ui";
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Priority, type Status } from "../../domain/types";
import { ApiError, api } from "../../services/api";
import { useInvalidateWork } from "../tasks/hooks";
import { HEALTH_LABEL, type Health } from "../../domain/formal";
import type { ActionField, ActionsPayload, CommentPayload, CreatePayload, Link as LinkItem, Proposal, StatusNotePayload, UpdatePayload, WbsPayload } from "./types";

/** Próximos passos depois de confirmar: mantêm o ritmo da conversa sem a pessoa redigir. */
function nextSteps(p: Proposal): string[] {
  const r = p.result;
  const projectName =
    r?.project?.name ??
    ((p.payload as ActionsPayload).steps?.find((s) => s.action === "project.create")?.params.name as string | undefined);
  if (projectName && (p.kind === "apply_wbs" || p.kind === "actions"))
    return [
      `Monte a equipe do projeto “${projectName}”`,
      `Liste os principais riscos do projeto “${projectName}”`,
      `Planeje a primeira sprint do projeto “${projectName}”`,
      `Escreva o TAP do projeto “${projectName}”`,
    ];
  if (p.kind === "create_tasks") return ["Defina responsáveis e prazos para essas tarefas"];
  const actions = new Set(((p.payload as ActionsPayload).steps ?? []).map((s) => s.action));
  if (actions.has("risk.create")) return ["Sugira planos de resposta para esses riscos"];
  if (actions.has("sprint.create")) return ["Distribua as tarefas do backlog na nova sprint"];
  if (actions.has("objective.create")) return ["Ligue projetos aos resultados-chave desse objetivo"];
  return [];
}

const PRIMARY: Partial<Record<Proposal["kind"], string>> = {
  apply_wbs: "Criar projeto",
  status_note: "Publicar nota",
  add_comment: "Publicar",
};

/**
 * Prévia da proposta. Abre como resumo de leitura; "Ajustar" mostra os campos, e "diga o que
 * mudar" pede um novo rascunho ao assistente. As edições ficam em rascunho local; ao confirmar,
 * o servidor recebe o rascunho, revalida tudo (permissão, validade, versão) e só então grava. O
 * sucesso mostrado vem da resposta do backend, nunca do navegador.
 */
export function ProposalCard({ proposal, onSend }: { proposal: Proposal; onSend?: (text: string) => void }) {
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
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState("");
  // Link de convite: o servidor manda só nesta resposta e não o guarda no histórico.
  const [once, setOnce] = useState<LinkItem[]>([]);

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
      const r = await api.post<{ status: string; proposal: Proposal; message?: string; once?: LinkItem[] }>(`/assistant/proposals/${live.id}/confirm`);
      if (r.status === "stale") {
        setLive(r.proposal);
        setDraft(r.proposal.payload);
        setDirty(false);
        setNotice("A tarefa mudou depois da proposta. Atualizei o antes/depois — confira e confirme de novo.");
        return;
      }
      setLive(r.proposal);
      setOnce(r.once ?? []);
      invalidateWork();
      qc.invalidateQueries();
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
  // Ajuste por conversa: descarta este rascunho e pede um novo, já ajustado.
  const refine = async (e: FormEvent) => {
    e.preventDefault();
    const t = ask.trim();
    if (!t || !onSend) return;
    setAsk("");
    await cancel();
    onSend(`Ajuste a proposta: ${t}`);
  };

  const steps = live.preview.steps ?? [];
  const title =
    live.kind === "actions"
      ? steps.length > 1 ? `Plano com ${steps.length} passos` : (steps[0]?.label ?? "Ação proposta")
      : live.kind === "apply_wbs"
        ? (draft as WbsPayload).project_id
          ? `Fases e tarefas no projeto ${live.preview.project ? `“${live.preview.project}”` : "aberto"}`
          : `Novo projeto: ${(draft as WbsPayload).project_name ?? ""}`
        : live.kind === "create_tasks"
          ? "Tarefas novas"
          : live.kind === "status_note"
            ? "Nota de acompanhamento"
            : live.kind === "add_comment"
              ? "Comentário"
              : "Alteração na tarefa";

  if (live.status === "confirmed") {
    const next = onSend ? nextSteps(live) : [];
    return (
      <div className="proposal done" role="status">
        <h3><CheckCircle2 size={18} aria-hidden /> Feito — {title}</h3>
        <ResultLinks result={live.result} />
        {once.length > 0 && (
          <div>
            <p className="coord">Copie agora — este link não fica salvo na conversa:</p>
            <ul>{once.map((l) => <li key={l.href}><code>{window.location.origin}{l.href}</code></li>)}</ul>
          </div>
        )}
        {next.length > 0 && (
          <div className="p-next" role="group" aria-label="Próximos passos">
            <span className="coord">E agora?</span>
            {next.map((t) => <button key={t} type="button" className="chip" onClick={() => onSend!(t)}>{t}</button>)}
          </div>
        )}
      </div>
    );
  }
  if (live.status !== "pending")
    return <div className="proposal closed" role="status"><h3>{title} — {live.status === "cancelled" ? "descartado, nada foi feito" : "expirou"}</h3></div>;

  const danger = live.kind === "actions" && live.preview.danger;
  const intoExisting = live.kind === "apply_wbs" && Boolean((draft as WbsPayload).project_id);
  const primary = danger ? "Fazer mesmo assim" : intoExisting ? "Criar tarefas" : (PRIMARY[live.kind] ?? "Pode fazer");
  return (
    <div className={`proposal ${danger ? "danger" : ""}`} role="group" aria-label={title}>
      <div className="p-head">
        <h3>{title}</h3>
        <span className="p-tag">{dirty ? "rascunho editado" : "rascunho"}</span>
      </div>
      {notice && <p role="alert" className="diff"><strong>{notice}</strong></p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {editing ? (
          <>
            {live.kind === "update_task" && <UpdateEditor proposal={live} draft={draft as UpdatePayload} edit={edit} />}
            {live.kind === "create_tasks" && <CreateEditor draft={draft as CreatePayload} edit={edit} />}
            {live.kind === "apply_wbs" && <WbsEditor draft={draft as WbsPayload} edit={edit} />}
            {live.kind === "status_note" && <StatusNoteEditor draft={draft as StatusNotePayload} edit={edit} />}
            {live.kind === "add_comment" && <CommentEditor proposal={live} draft={draft as CommentPayload} edit={edit} />}
            {live.kind === "actions" && <ActionsEditor proposal={live} draft={draft as ActionsPayload} edit={edit} />}
          </>
        ) : (
          <Summary proposal={live} draft={draft} />
        )}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="p-actions">
        <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
          <Check size={16} aria-hidden /> {primary}
        </button>
        <button className="btn btn-line btn-sm" onClick={() => setEditing((v) => !v)} disabled={busy} aria-pressed={editing}>
          {editing ? <><Eye size={16} aria-hidden /> Ver resumo</> : <><Pencil size={16} aria-hidden /> Ajustar</>}
        </button>
        <button className="p-discard" onClick={cancel} disabled={busy}>Descartar</button>
      </div>
      {onSend && (
        <form className="p-refine" onSubmit={refine}>
          <label className="sr-only" htmlFor={`refine-${live.id}`}>Pedir ajuste ao assistente</label>
          <input id={`refine-${live.id}`} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="ou diga o que mudar… (ex.: tire a fase de testes)" maxLength={500} disabled={busy} />
          <button type="submit" aria-label="Pedir ajuste" disabled={busy || !ask.trim()}><ArrowUp size={14} aria-hidden /></button>
        </form>
      )}
    </div>
  );
}

const fmtDate = (d?: string | null) => (d ? d.split("-").reverse().slice(0, 2).join("/") : null);

/** Tarefas de uma edição em lote: contagem sempre visível, lista ao abrir. */
function Targets({ targets }: { targets: { title: string; due: string | null }[] }) {
  return (
    <details className="p-targets" open={targets.length <= 5}>
      <summary>{targets.length} {targets.length === 1 ? "tarefa" : "tarefas"}</summary>
      <ul className="p-list">
        {targets.map((t, i) => (
          <li key={i}><span aria-hidden>•</span><span className="t">{t.title}</span>{t.due && <span className="d">{fmtDate(t.due)}</span>}</li>
        ))}
      </ul>
    </details>
  );
}

/** Resumo de leitura: o que vai acontecer, sem campos de formulário. */
function Summary({ proposal, draft }: { proposal: Proposal; draft: Proposal["payload"] }) {
  switch (proposal.kind) {
    case "apply_wbs": {
      const w = draft as WbsPayload;
      const all = w.phases.flatMap((p) => p.tasks);
      const last = all.map((t) => t.due_date).filter(Boolean).sort().at(-1);
      return (
        <div className="p-sum">
          {w.summary && <p className="muted">{w.summary}</p>}
          <p className="p-stats">
            <span><b>{w.phases.length}</b> fases</span>
            <span><b>{all.filter((t) => !t.is_milestone).length}</b> tarefas</span>
            <span><b>{all.filter((t) => t.is_milestone).length}</b> marcos</span>
            {last && <span>até <b>{fmtDate(last)}</b></span>}
          </p>
          {w.phases.map((ph, i) => (
            <details key={ph.name + i} className="p-phase" open={w.phases.length <= 3}>
              <summary><span>{ph.name}</span><span className="coord">{ph.tasks.length}</span></summary>
              <ul>
                {ph.tasks.map((t) => (
                  <li key={t.ref} className={t.is_milestone ? "ms" : undefined}>
                    <span aria-hidden>{t.is_milestone ? "◆" : "•"}</span>
                    <span className="t">{t.title}</span>
                    {t.due_date && <span className="d">{fmtDate(t.due_date)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {w.assumptions.length > 0 && <p className="coord">Premissas: {w.assumptions.join(" · ")}</p>}
        </div>
      );
    }
    case "create_tasks":
      return (
        <ul className="p-list">
          {(draft as CreatePayload).tasks.map((t, i) => (
            <li key={i}><span aria-hidden>•</span><span className="t">{t.title}</span>{t.due_date && <span className="d">{fmtDate(t.due_date)}</span>}</li>
          ))}
        </ul>
      );
    case "update_task": {
      const t = proposal.preview.tasks?.[0];
      return (
        <>
          {t && <p><Link to={t.href}>{t.title}</Link>{t.project && <span className="muted"> · {t.project}</span>}</p>}
          <ul className="diff" aria-label="Antes e depois">
            {t?.changes.map((c) => <li key={c.field + c.after}>{c.label}: <del>{c.before}</del> → <ins>{c.after}</ins></li>)}
          </ul>
        </>
      );
    }
    case "add_comment": {
      const t = proposal.preview.tasks?.[0];
      return (
        <>
          {t && <p className="muted">em <Link to={t.href}>{t.title}</Link></p>}
          <blockquote className="p-quote">{(draft as CommentPayload).body}</blockquote>
        </>
      );
    }
    case "status_note": {
      const n = draft as StatusNotePayload;
      return (
        <div className="p-sum">
          <p><span className={`badge ${n.state === "on_track" ? "ok" : "warn"}`}>{HEALTH_LABEL[n.state as Health]}</span></p>
          {n.delay_reason && <p><b>Atraso:</b> {n.delay_reason}</p>}
          {n.done && <p><b>Realizado:</b> {n.done}</p>}
          {n.pending && <p><b>Pendente:</b> {n.pending}</p>}
          {n.blockers && <p><b>Impedimentos:</b> {n.blockers}</p>}
        </div>
      );
    }
    case "actions": {
      const steps = proposal.preview.steps ?? [];
      return (
        <ol className="p-steps">
          {steps.map((st, i) => {
            const detail = st.fields.filter((f) => f.display && f.display !== "—").slice(0, 3).map((f) => f.display).join(" · ");
            return (
              <li key={i} className={st.danger ? "danger" : undefined}>
                <span className="n" aria-hidden>{st.danger ? "⚠" : i + 1}</span>
                <span>
                  <b>{st.label}</b>{detail && <span className="muted"> — {detail}</span>}
                  {st.targets && <Targets targets={st.targets} />}
                </span>
              </li>
            );
          })}
        </ol>
      );
    }
    default:
      return null;
  }
}

function ResultLinks({ result }: { result: Proposal["result"] }) {
  if (!result) return null;
  if (result.done)
    return (
      <ul>
        {result.done.map((d, i) => <li key={i}>{d.href ? <Link to={d.href}>{d.label}</Link> : d.label}</li>)}
      </ul>
    );
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

/** Valor do campo no rascunho; "content.objetivos" = campo dentro de `content` (termos TAP/TEP). */
function getParam(params: Record<string, unknown>, key: string): unknown {
  const [head, sub] = key.split(".");
  return sub ? (params[head] as Record<string, unknown> | undefined)?.[sub] : params[head];
}
function setParam(params: Record<string, unknown>, key: string, v: unknown): Record<string, unknown> {
  const [head, sub] = key.split(".");
  return sub ? { ...params, [head]: { ...(params[head] as Record<string, unknown>), [sub]: v } } : { ...params, [head]: v };
}

function FieldInput({ field, value, id, onChange }: { field: ActionField; value: unknown; id: string; onChange: (v: unknown) => void }) {
  switch (field.input) {
    case "textarea":
      return <textarea id={id} className="textarea" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <input id={id} type="date" className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} />;
    case "number":
      return <input id={id} type="number" className="input" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "checkbox":
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select id={id} className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case "multi": {
      const set = new Set((value as string[] | undefined) ?? []);
      return (
        <div id={id} className="row" role="group" aria-label={field.label}>
          {field.options?.map((o) => (
            <label key={o.value} className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={set.has(o.value)} onChange={(e) => onChange(field.options!.map((x) => x.value).filter((x) => (x === o.value ? e.target.checked : set.has(x))))} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "tags":
      return <input id={id} className="input" value={((value as string[] | undefined) ?? []).join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />;
    case "text":
      return <input id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    default:
      return null;
  }
}

/**
 * Plano de ações: um bloco por passo. Referências (projeto, tarefa, pessoa…) aparecem pelo nome e
 * não se editam aqui — para trocar, peça ao assistente. Os demais campos se editam no rascunho.
 */
function ActionsEditor({ proposal, draft, edit }: { proposal: Proposal; draft: ActionsPayload; edit: Edit }) {
  const steps = proposal.preview.steps ?? [];
  const setField = (i: number, key: string, v: unknown) =>
    edit({ steps: draft.steps.map((s, j) => (j === i ? { ...s, params: setParam(s.params, key, v) } : s)) });
  return (
    <>
      {proposal.preview.danger && (
        <p role="alert" className="diff"><strong>Atenção: este plano tem ação irreversível ou que muda quem acessa o quê (marcada com ⚠).</strong></p>
      )}
      <ol className="action-steps">
        {steps.map((step, i) => (
          <li key={i} className={step.danger ? "danger" : undefined}>
            <p className="phase">{steps.length > 1 ? `${i + 1}. ` : ""}{step.danger ? "⚠ " : ""}{step.label}</p>
            {step.targets && <Targets targets={step.targets} />}
            <dl>
              {step.fields.map((f) => {
                const id = `ac-${proposal.id}-${i}-${f.key}`;
                return f.input ? (
                  <div key={f.key} className="field">
                    <label htmlFor={id}>{f.label}</label>
                    <FieldInput field={f} id={id} value={getParam(draft.steps[i]?.params ?? {}, f.key)} onChange={(v) => setField(i, f.key, v)} />
                  </div>
                ) : (
                  <div key={f.key} className="row" style={{ gap: 6 }}>
                    <dt className="muted">{f.label}:</dt>
                    <dd style={{ margin: 0 }}>{f.display}</dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}
