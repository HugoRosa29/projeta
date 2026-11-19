import { useQuery } from "@tanstack/react-query";
import { CornerDownRight, ListChecks, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Dialog, ErrorBox, useToast } from "../../components/ui";
import {
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  fmtDate,
  type Member,
  type Priority,
  type Status,
  type Task,
} from "../../domain/types";
import { nestTasks, subtaskCounts } from "../../domain/work";
import { api } from "../../services/api";
import { Comments } from "./Comments";
import { useCreateTask, useDeleteTask, useUpdateTask } from "./hooks";

const URGENT = "URGENTE";
/** Tags são comparadas sem diferenciar espaços nas pontas nem maiúsculas. */
const normTag = (label: string) => label.trim().toLocaleUpperCase("pt-BR");
const isUrgent = (label: string) => normTag(label) === URGENT;

/** Criar tarefa informando só o título; prazo e prioridade são opcionais. */
export function QuickAdd({ workspaceId, projectId, placeholder }: { workspaceId: string; projectId?: string; placeholder?: string }) {
  const [title, setTitle] = useState("");
  const create = useCreateTask();
  const toast = useToast();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    create.mutate(
      { workspace_id: workspaceId, project_id: projectId ?? null, title: t },
      { onSuccess: () => (setTitle(""), toast("Tarefa criada")), onError: (er) => toast((er as Error).message) },
    );
  };
  return (
    <form className="quick-add" onSubmit={submit}>
      <label className="sr-only" htmlFor="quick-title">
        Título da nova tarefa
      </label>
      <input id="quick-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder ?? "Nova tarefa… (Enter para criar)"} maxLength={200} />
      <button className="btn btn-primary" disabled={create.isPending || !title.trim()}>
        <Plus size={18} aria-hidden /> Criar
      </button>
    </form>
  );
}

export function DueBadge({ task, today }: { task: Task; today?: string }) {
  if (!task.due_date) return null;
  const late = !!today && task.status !== "done" && task.due_date < today;
  return <span className={`badge ${late ? "alerta" : task.due_date === today ? "warn" : ""}`}>{late ? "Venceu " : ""}{fmtDate(task.due_date)}</span>;
}

export function TaskTags({ task }: { task: Pick<Task, "priority" | "labels"> }) {
  return <>
    <span className={`badge priority-tag priority-tag-${task.priority}`} aria-label={`Prioridade: ${PRIORITY_LABEL[task.priority]}`}>{PRIORITY_LABEL[task.priority].toLocaleUpperCase("pt-BR")}</span>
    {task.labels.map((label, index) => (
      <span key={`${label}-${index}`} className={`badge task-tag ${isUrgent(label) ? "task-tag-urgent" : ""}`}>
        {label}
      </span>
    ))}
  </>;
}

export function TaskRow({ task, today, onOpen, subtasks, nested }: { task: Task; today?: string; onOpen: (id: string) => void; subtasks?: [number, number]; nested?: boolean }) {
  const update = useUpdateTask();
  const done = task.status === "done";
  return (
    <li className={`task-row prio-${task.priority} ${done ? "done" : ""} ${nested ? "subtask" : ""}`}>
      <input
        type="checkbox"
        className="check"
        checked={done}
        aria-label={`Concluir: ${task.title}`}
        onChange={() => update.mutate({ task, patch: { status: done ? "todo" : "done" } })}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button className="title" onClick={() => onOpen(task.id)}>
          {task.title}
        </button>
        <div className="task-meta">
          {subtasks && <SubtaskBadge counts={subtasks} />}
          {!nested && task.parent_title && <span className="badge" title="Tarefa-mãe"><CornerDownRight size={12} aria-hidden /> {task.parent_title}</span>}
          <TaskTags task={task} />
          <DueBadge task={task} today={today} />
          {task.project_name ? <Link to={`/projetos/${task.project_id}`}>{task.project_name}</Link> : <span className="badge">Pessoal</span>}
          {task.status !== "todo" && <span className="badge info">{STATUS_LABEL[task.status]}</span>}
          {task.assignee_name && <span>{task.assignee_name}</span>}
        </div>
      </div>
    </li>
  );
}

export function SubtaskBadge({ counts: [done, total] }: { counts: [number, number] }) {
  return (
    <span className={`badge ${done === total ? "ok" : ""}`} aria-label={`${done} de ${total} subtarefas concluídas`}>
      <ListChecks size={12} aria-hidden /> {done}/{total}
    </span>
  );
}

/** Lista com subtarefas logo abaixo da mãe. `all` = lista completa, para contar subtarefas
 * mesmo quando um filtro esconde parte delas. */
export function TaskList({ tasks, today, onOpen, all }: { tasks: Task[]; today?: string; onOpen: (id: string) => void; all?: Task[] }) {
  const counts = subtaskCounts(all ?? tasks);
  return (
    <ul className="task-list">
      {nestTasks(tasks).map(({ task, children }) => [
        <TaskRow key={task.id} task={task} today={today} onOpen={onOpen} subtasks={counts.get(task.id)} />,
        ...children.map((c) => <TaskRow key={c.id} task={c} today={today} onOpen={onOpen} nested />),
      ])}
    </ul>
  );
}

interface Detail {
  task: Task;
  can_write: boolean;
  can_comment: boolean;
  depends_on: { id: string; title: string; status: Status }[];
  subtasks: Task[];
}

export function TaskDialog({ taskId, members, onClose }: { taskId: string; members?: Member[]; onClose: () => void }) {
  const q = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<Detail>(`/tasks/${taskId}`) });
  const update = useUpdateTask();
  const del = useDeleteTask();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Task> & { moreOpen?: boolean }>({});

  const d = q.data;
  const t = d?.task;
  const val = <K extends keyof Task>(k: K): Task[K] | undefined => (k in draft ? (draft[k] as Task[K]) : t?.[k]);
  // Candidatas a tarefa-mãe: tarefas principais do mesmo projeto (só carrega ao abrir os detalhes).
  const subtasks = d?.subtasks ?? [];
  const canNest = !!t?.project_id && !!d?.can_write && !subtasks.length;
  const siblings = useQuery({
    queryKey: ["tasks", "project", t?.project_id],
    queryFn: () => api.get<{ tasks: Task[] }>(`/projects/${t!.project_id}/tasks`),
    enabled: !!draft.moreOpen && canNest,
  });
  const parents = (siblings.data?.tasks ?? []).filter((x) => x.id !== t?.id && !x.parent_id);
  // A tela mostra horas; o servidor guarda minutos.
  const minutes = val("estimate_minutes");
  const estimateHours = minutes == null ? null : minutes / 60;
  const setEstimateHours = (v: string) =>
    setDraft({ ...draft, estimate_minutes: v === "" ? null : Math.round(Number(v) * 60) });
  const urgent = (val("labels") ?? []).some(isUrgent);
  const toggleUrgent = () => {
    const labels = val("labels") ?? [];
    setDraft({ ...draft, labels: urgent ? labels.filter((label) => !isUrgent(label)) : [...labels, URGENT] });
  };

  // Excluir a mãe não apaga as subtarefas (migração 011): o aviso diz isso em vez de "não pode ser desfeito".
  const confirmDelete = (id: string) => {
    const msg = subtasks.length
      ? `Excluir esta tarefa? As ${subtasks.length} subtarefas continuam, como tarefas principais.`
      : "Excluir esta tarefa? Isso não pode ser desfeito.";
    if (confirm(msg)) del.mutate(id, { onSuccess: () => (toast("Tarefa excluída"), onClose()) });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!t) return;
    const { moreOpen, ...patch } = draft;
    void moreOpen;
    if (patch.labels) patch.labels = [...new Set(patch.labels.map(normTag).filter(Boolean))];
    if (!Object.keys(patch).length) return onClose();
    update.mutate({ task: t, patch }, { onSuccess: () => (toast("Tarefa salva"), onClose()) });
  };

  return (
    <Dialog title="Tarefa" onClose={onClose}>
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {t && d && (
        <>
        <form onSubmit={save}>
          {t.parent_id && (
            <p className="muted subtask-of"><CornerDownRight size={14} aria-hidden /> Subtarefa de <strong>{t.parent_title}</strong></p>
          )}
          <div className="field">
            <label htmlFor="t-title">Título</label>
            <input id="t-title" data-autofocus className="input" value={val("title") ?? ""} disabled={!d.can_write} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor="t-status">Estado</label>
              <select id="t-status" className="select" value={val("status")} disabled={!d.can_write} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="t-due">Prazo</label>
              <input id="t-due" type="date" className="input" value={val("due_date") ?? ""} disabled={!d.can_write} onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })} />
            </div>
          </div>
          {t.project_id && members && (
            <div className="field">
              <label htmlFor="t-assignee">Responsável</label>
              <select id="t-assignee" className="select" value={val("assignee_id") ?? ""} disabled={!d.can_write} onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value || null })}>
                <option value="">Sem responsável</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="row">
            <div className="field grow">
              <label htmlFor="t-prio">Prioridade</label>
              <select id="t-prio" className="select" value={val("priority")} disabled={!d.can_write} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
                {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field grow">
              <span className="label">Destaque</span>
              <button
                type="button"
                className={`btn btn-line ${urgent ? "task-tag-urgent" : ""}`}
                aria-pressed={urgent}
                disabled={!d.can_write}
                onClick={toggleUrgent}
              >
                {URGENT}
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-labels">Tags</label>
            <input id="t-labels" className="input" value={(val("labels") ?? []).join(",")} disabled={!d.can_write} placeholder="Ex.: DOCUMENTAÇÃO, REVISÃO" aria-describedby="t-labels-help" onChange={(e) => setDraft({ ...draft, labels: e.target.value.split(",") })} />
            <small id="t-labels-help" className="muted">Separe por vírgulas. A prioridade aparece automaticamente como etiqueta.</small>
          </div>
          <button type="button" className="btn btn-ghost" aria-expanded={!!draft.moreOpen} onClick={() => setDraft({ ...draft, moreOpen: !draft.moreOpen })}>
            {draft.moreOpen ? "Menos detalhes" : "Mais detalhes (descrição, estimativa, tarefa-mãe)"}
          </button>
          {draft.moreOpen && (
            <div style={{ marginTop: 12 }}>
              <div className="row">
                <div className="field grow">
                  <label htmlFor="t-est">Estimativa (horas)</label>
                  <input
                    id="t-est"
                    type="number"
                    min={0}
                    step={0.5}
                    className="input"
                    disabled={!d.can_write}
                    value={estimateHours ?? ""}
                    onChange={(e) => setEstimateHours(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="t-desc">Descrição</label>
                <textarea id="t-desc" className="textarea" value={val("description") ?? ""} disabled={!d.can_write} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              {canNest && (
                <div className="field">
                  <label htmlFor="t-parent">Tarefa-mãe</label>
                  <select id="t-parent" className="select" value={val("parent_id") ?? ""} onChange={(e) => setDraft({ ...draft, parent_id: e.target.value || null })}>
                    <option value="">Nenhuma (tarefa principal)</option>
                    {t.parent_id && !parents.some((x) => x.id === t.parent_id) && <option value={t.parent_id}>{t.parent_title}</option>}
                    {parents.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </div>
              )}
              {d.depends_on.length > 0 && (
                <div className="field">
                  <span className="label">Depende de</span>
                  <ul className="task-list">
                    {d.depends_on.map((x) => (
                      <li key={x.id} className="task-row">
                        {x.title} <span className="badge">{STATUS_LABEL[x.status]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            {d.can_write && (
              <button className="btn btn-primary" disabled={update.isPending}>
                Salvar
              </button>
            )}
            <button type="button" className="btn btn-line" onClick={onClose}>
              {d.can_write ? "Cancelar" : "Fechar"}
            </button>
            <span style={{ flex: 1 }} />
            {d.can_write && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => confirmDelete(t.id)}>
                Excluir
              </button>
            )}
          </div>
          {!d.can_write && <p className="muted" style={{ marginTop: 10 }}>Você tem acesso somente de leitura a esta tarefa.</p>}
        </form>
        {!t.parent_id && <Subtasks parent={t} items={subtasks} canWrite={d.can_write} />}
        <Comments taskId={t.id} canWrite={d.can_comment} />
        </>
      )}
    </Dialog>
  );
}

function Subtasks({ parent, items, canWrite }: { parent: Task; items: Task[]; canWrite: boolean }) {
  const [title, setTitle] = useState("");
  const create = useCreateTask();
  const update = useUpdateTask();
  const toast = useToast();
  if (!items.length && !canWrite) return null;
  const done = items.filter((x) => x.status === "done").length;
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { workspace_id: parent.workspace_id, project_id: parent.project_id, title: title.trim(), parent_id: parent.id },
      { onSuccess: () => setTitle(""), onError: (er) => toast((er as Error).message) },
    );
  };
  return (
    <section className="task-section" aria-labelledby="subtasks-title">
      <h3 id="subtasks-title">Subtarefas {items.length > 0 && <SubtaskBadge counts={[done, items.length]} />}</h3>
      {items.length > 0 && (
        <ul className="checklist">
          {items.map((x) => (
            <li key={x.id} className={x.status === "done" ? "done" : ""}>
              <label>
                <input type="checkbox" className="check" checked={x.status === "done"} disabled={!canWrite} onChange={() => update.mutate({ task: x, patch: { status: x.status === "done" ? "todo" : "done" } })} />
                <span>{x.title}</span>
              </label>
              {x.status !== "done" && x.status !== "todo" && <span className="badge info">{STATUS_LABEL[x.status]}</span>}
              {x.assignee_name && <span className="muted">{x.assignee_name}</span>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form className="row" onSubmit={add}>
          <label className="sr-only" htmlFor="subtask-title">Nova subtarefa</label>
          <input id="subtask-title" className="input grow" value={title} maxLength={200} placeholder="Nova subtarefa… (Enter)" onChange={(e) => setTitle(e.target.value)} />
          <button className="btn btn-line btn-sm" disabled={create.isPending || !title.trim()}><Plus size={16} aria-hidden /> Adicionar</button>
        </form>
      )}
    </section>
  );
}
