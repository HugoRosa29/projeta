import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, GripVertical, Link2, ListChecks, MessageCircle, NotebookPen, Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
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
import { dependencyCandidates, nestTasks, postponeOptions, scheduleConflicts, subtaskCounts } from "../../domain/work";
import { useAssistant } from "../../app/assistantContext";
import { useSprints } from "../sprints/hooks";
import { api } from "../../services/api";
import { Comments } from "./Comments";
import { useCreateTask, useDeleteTask, useDependency, useInvalidateWork, useUpdateTask } from "./hooks";

/** Tags são comparadas sem diferenciar espaços nas pontas nem maiúsculas. */
const normTag = (label: string) => label.trim().toLocaleUpperCase("pt-BR");

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
  if (!task.due_date) return task.start_date ? <span className="badge">Início {fmtDate(task.start_date)}</span> : null;
  const late = !!today && task.status !== "done" && task.due_date < today;
  // Com início, mostra o período; atrasada, só o prazo (é o que pede ação).
  const span = task.start_date && !late ? `${fmtDate(task.start_date)} → ` : "";
  return <span className={`badge ${late ? "alerta" : task.due_date === today ? "warn" : ""}`}>{late ? "Venceu " : ""}{span}{fmtDate(task.due_date)}</span>;
}

/** Dependências na linha da lista: quanto falta para a tarefa poder andar e, para quem edita, um
 * seletor nativo para ligar ou desligar outra tarefa do projeto sem abrir a ficha. */
export function DependencyControl({ task, all, canWrite }: { task: Task; all: Task[]; canWrite: boolean }) {
  const { add, remove } = useDependency();
  const toast = useToast();
  if (!task.project_id) return null;
  const byId = new Map(all.map((t) => [t.id, t]));
  const deps = (task.depends_on_ids ?? []).map((id) => byId.get(id)).filter((d): d is Task => !!d);
  const pending = deps.filter((d) => d.status !== "done");
  const conflicts = scheduleConflicts(task, all);
  const candidates = canWrite ? dependencyCandidates(task, all) : [];
  const busy = add.isPending || remove.isPending;
  const names = pending.map((d) => d.title).join(", ");
  return (
    <>
      {pending.length > 0 && (
        <span className={`badge ${conflicts.length ? "alerta" : "info"}`} title={`Aguarda: ${names}`} aria-label={`Aguarda ${pending.length} tarefa(s): ${names}${conflicts.length ? ". Começa antes de uma delas terminar" : ""}`}>
          {conflicts.length ? <TriangleAlert size={12} aria-hidden /> : <Link2 size={12} aria-hidden />} Aguarda {pending.length === 1 ? pending[0].title : `${pending.length} tarefas`}
        </span>
      )}
      {canWrite && (candidates.length > 0 || deps.length > 0) && (
        <>
          <label className="sr-only" htmlFor={`dep-${task.id}`}>Dependências de {task.title}</label>
          <select
            id={`dep-${task.id}`}
            className="select dep-pick"
            value=""
            disabled={busy}
            onChange={(e) => {
              const [op, id] = e.target.value.split(":");
              const other = byId.get(id);
              if (!other) return;
              const vars = { taskId: task.id, dependsOnId: id };
              if (op === "add") add.mutate(vars, { onSuccess: () => toast(`${task.title} agora depende de ${other.title}`) });
              else remove.mutate(vars, { onSuccess: () => toast(`${task.title} não depende mais de ${other.title}`) });
            }}
          >
            <option value="">Depende de…</option>
            {candidates.length > 0 && (
              <optgroup label="Passa a depender de">
                {candidates.map((c) => <option key={c.id} value={`add:${c.id}`}>{c.title}</option>)}
              </optgroup>
            )}
            {deps.length > 0 && (
              <optgroup label="Deixa de depender de">
                {deps.map((d) => <option key={d.id} value={`del:${d.id}`}>{d.title}</option>)}
              </optgroup>
            )}
          </select>
        </>
      )}
    </>
  );
}

export function TaskTags({ task }: { task: Pick<Task, "priority" | "labels"> }) {
  return <>
    <span className={`badge priority-tag priority-tag-${task.priority}`} aria-label={`Prioridade: ${PRIORITY_LABEL[task.priority]}`}>{PRIORITY_LABEL[task.priority].toLocaleUpperCase("pt-BR")}</span>
    {task.labels.map((label, index) => (
      <span key={`${label}-${index}`} className="badge task-tag">
        {label}
      </span>
    ))}
  </>;
}

/** `deps`: mostra (e, com `canWrite`, edita) dependências contra a lista completa do projeto.
 * `drag`/`setDrag`: a tarefa sendo arrastada; soltá-la sobre outra faz a outra depender dela. */
type DepsMode = { all: Task[]; canWrite: boolean; drag: string | null; setDrag: (id: string | null) => void };

export function TaskRow({ task, today, onOpen, subtasks, nested, quick, deps }: { task: Task; today?: string; onOpen: (id: string) => void; subtasks?: [number, number]; nested?: boolean; quick?: boolean; deps?: DepsMode }) {
  const update = useUpdateTask();
  const { add } = useDependency();
  const toast = useToast();
  const [over, setOver] = useState(false);
  const done = task.status === "done";
  // Arrastar "o que vem antes" e soltar sobre "o que vem depois".
  const dnd = deps?.canWrite && !!task.project_id;
  const dragged = dnd && deps.drag && deps.drag !== task.id ? deps.all.find((t) => t.id === deps.drag) : undefined;
  const dropOk = !!dragged && dependencyCandidates(task, deps!.all).some((c) => c.id === dragged.id);
  const dndProps = dnd
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.effectAllowed = "link";
          e.dataTransfer.setData("text/plain", task.id);
          deps.setDrag(task.id);
        },
        onDragEnd: () => deps.setDrag(null),
        onDragOver: (e: DragEvent) => {
          if (!dropOk) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "link";
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          deps.setDrag(null);
          if (dragged && dropOk) add.mutate({ taskId: task.id, dependsOnId: dragged.id }, { onSuccess: () => toast(`${task.title} agora começa depois de ${dragged.title}`) });
        },
      }
    : {};
  const dndClass = dnd ? `dep-draggable ${deps.drag === task.id ? "dep-dragging" : ""} ${over && dropOk ? "dep-over" : ""} ${dragged && !dropOk ? "dep-no" : ""}` : "";
  return (
    <li className={`task-row prio-${task.priority} ${done ? "done" : ""} ${nested ? "subtask" : ""} ${dndClass}`} {...dndProps}>
      {dnd && <span className="dep-grip" title="Arraste sobre outra tarefa: a outra passa a depender desta"><GripVertical size={16} aria-hidden /></span>}
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
          {task.sprint_status === "active" && <span className="badge ok">{task.sprint_name}</span>}
          {task.assignee_name && <span>{task.assignee_name}</span>}
          {deps && <DependencyControl task={task} all={deps.all} canWrite={deps.canWrite} />}
          {over && dropOk && <span className="dep-drop-hint">Solte: começa depois de “{dragged.title}”</span>}
        </div>
        {quick && !done && <QuickActions task={task} today={today} />}
      </div>
    </li>
  );
}

/** Atualizar sem abrir a ficha: estado, adiar o prazo e anotar o andamento, cada um em um gesto.
 * Quanto menor o custo de atualizar, mais o quadro reflete a realidade. O servidor continua
 * decidindo quem pode alterar; aqui só se encurta o caminho. */
export function QuickActions({ task, today }: { task: Task; today?: string }) {
  const update = useUpdateTask();
  const invalidate = useInvalidateWork();
  const qc = useQueryClient();
  const toast = useToast();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  // Leva o foco ao campo quando a pessoa pede para anotar (equivale a autoFocus, só nesse gesto).
  useEffect(() => {
    if (noting) noteRef.current?.focus();
  }, [noting]);
  const comment = useMutation({
    mutationFn: (body: string) => api.post(`/tasks/${task.id}/comments`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", task.id] });
      invalidate();
      setNote("");
      setNoting(false);
      toast("Andamento registrado");
    },
    onError: (e) => toast((e as Error).message),
  });
  const saveNote = (e: FormEvent) => {
    e.preventDefault();
    const body = note.trim();
    if (body && !comment.isPending) comment.mutate(body);
  };
  const busy = update.isPending;

  return (
    <div className="task-quick">
      <label className="sr-only" htmlFor={`qs-${task.id}`}>Estado de {task.title}</label>
      <select
        id={`qs-${task.id}`}
        className="select"
        value={task.status}
        disabled={busy}
        onChange={(e) => {
          const status = e.target.value as Status;
          update.mutate({ task, patch: { status } }, { onSuccess: () => toast(`${task.title}: ${STATUS_LABEL[status]}`) });
        }}
      >
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      {today && (
        <>
          <label className="sr-only" htmlFor={`qp-${task.id}`}>Adiar o prazo de {task.title}</label>
          {/* Seletor nativo como menu de ação: no celular abre o seletor do sistema, sem janela extra. */}
          <select
            id={`qp-${task.id}`}
            className="select"
            value=""
            disabled={busy}
            onChange={(e) => {
              const due_date = e.target.value;
              if (due_date) update.mutate({ task, patch: { due_date } }, { onSuccess: () => toast(`Novo prazo: ${fmtDate(due_date)}`) });
            }}
          >
            <option value="">Adiar…</option>
            {postponeOptions(today).map((o) => <option key={o.label} value={o.date}>{o.label} ({fmtDate(o.date)})</option>)}
          </select>
        </>
      )}
      {!noting && (
        <button type="button" className="btn btn-line btn-sm" aria-label={`Anotar andamento de ${task.title}`} onClick={() => setNoting(true)}>
          <NotebookPen size={15} aria-hidden /> Anotar
        </button>
      )}
      {noting && (
        <form className="task-quick-note" onSubmit={saveNote}>
          <label className="sr-only" htmlFor={`qn-${task.id}`}>Andamento de {task.title}</label>
          <input
            id={`qn-${task.id}`}
            className="input"
            ref={noteRef}
            value={note}
            maxLength={2000}
            placeholder="O que andou? (vira comentário na tarefa)"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setNoting(false), setNote(""))}
          />
          <button className="btn btn-primary btn-sm" disabled={comment.isPending || !note.trim()}>Registrar</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setNoting(false), setNote(""))}>Cancelar</button>
        </form>
      )}
    </div>
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
export function TaskList({ tasks, today, onOpen, all, quick, dependencies }: { tasks: Task[]; today?: string; onOpen: (id: string) => void; all?: Task[]; quick?: boolean; dependencies?: { canWrite: boolean } }) {
  const counts = subtaskCounts(all ?? tasks);
  const [drag, setDrag] = useState<string | null>(null);
  const deps = dependencies && { all: all ?? tasks, canWrite: dependencies.canWrite, drag, setDrag };
  return (
    <ul className="task-list">
      {nestTasks(tasks).map(({ task, children }) => [
        <TaskRow key={task.id} task={task} today={today} onOpen={onOpen} subtasks={counts.get(task.id)} quick={quick} deps={deps} />,
        ...children.map((c) => <TaskRow key={c.id} task={c} today={today} onOpen={onOpen} nested quick={quick} deps={deps} />),
      ])}
    </ul>
  );
}

interface Detail {
  task: Task;
  can_write: boolean;
  can_comment: boolean;
  depends_on: { id: string; title: string; status: Status; due_date: string | null }[];
  /** Tarefas que esperam por esta. */
  blocks: { id: string; title: string; status: Status }[];
  subtasks: Task[];
}

export function TaskDialog({ taskId, members, onClose }: { taskId: string; members?: Member[]; onClose: () => void }) {
  const q = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<Detail>(`/tasks/${taskId}`) });
  const update = useUpdateTask();
  const del = useDeleteTask();
  const toast = useToast();
  const { openAssistant } = useAssistant();
  const [draft, setDraft] = useState<Partial<Task> & { moreOpen?: boolean }>({});

  const d = q.data;
  const t = d?.task;
  const val = <K extends keyof Task>(k: K): Task[K] | undefined => (k in draft ? (draft[k] as Task[K]) : t?.[k]);
  // Candidatas a tarefa-mãe: tarefas principais do mesmo projeto (só carrega ao abrir os detalhes).
  const subtasks = d?.subtasks ?? [];
  const canNest = !!t?.project_id && !!d?.can_write && !subtasks.length;
  // Tarefas do projeto: candidatas a tarefa-mãe e a dependência (na página do projeto já estão em cache).
  const siblings = useQuery({
    queryKey: ["tasks", "project", t?.project_id],
    queryFn: () => api.get<{ tasks: Task[] }>(`/projects/${t!.project_id}/tasks`),
    enabled: !!t?.project_id && !!d?.can_write,
  });
  const parents = (siblings.data?.tasks ?? []).filter((x) => x.id !== t?.id && !x.parent_id);
  // A tela mostra horas; o servidor guarda minutos.
  const minutes = val("estimate_minutes");
  const estimateHours = minutes == null ? null : minutes / 60;
  const setEstimateHours = (v: string) =>
    setDraft({ ...draft, estimate_minutes: v === "" ? null : Math.round(Number(v) * 60) });
  // Sprint: só tarefa principal de projeto (subtarefa acompanha a mãe, regra do servidor).
  const sprintsQ = useSprints(t?.project_id, !!t?.project_id && !t?.parent_id);
  const sprintOptions = (sprintsQ.data?.sprints ?? []).filter((s) => s.status !== "closed" || s.id === t?.sprint_id);

  // Excluir a mãe não apaga as subtarefas (migração 011): o aviso diz isso em vez de "não pode ser desfeito".
  const confirmDelete = (id: string) => {
    const msg = subtasks.length
      ? `Excluir esta tarefa? As ${subtasks.length} subtarefas continuam, como tarefas principais.`
      : "Excluir esta tarefa? Isso não pode ser desfeito.";
    if (confirm(msg)) del.mutate(id, { onSuccess: () => (toast("Tarefa excluída"), onClose()) });
  };

  const startVal = val("start_date");
  const dueVal = val("due_date");
  const datesInverted = !!startVal && !!dueVal && startVal > dueVal;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!t || datesInverted) return;
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
              <label htmlFor="t-start">Início</label>
              <input id="t-start" type="date" className="input" value={val("start_date") ?? ""} max={val("due_date") ?? undefined} disabled={!d.can_write} aria-describedby={datesInverted ? "t-dates-error" : undefined} onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })} />
            </div>
            <div className="field grow">
              <label htmlFor="t-due">Prazo</label>
              <input id="t-due" type="date" className="input" value={val("due_date") ?? ""} min={val("start_date") ?? undefined} disabled={!d.can_write} aria-describedby={datesInverted ? "t-dates-error" : undefined} onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })} />
            </div>
          </div>
          {datesInverted && <p id="t-dates-error" className="form-error" role="alert">O início fica depois do prazo. Antecipe o início ou adie o prazo.</p>}
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
            {t.project_id && (
              <div className="field grow">
                {t.parent_id ? <span className="label">Sprint</span> : <label htmlFor="t-sprint">Sprint</label>}
                {t.parent_id ? (
                  <p className="muted">{t.sprint_name ?? "Backlog"} (acompanha a tarefa-mãe)</p>
                ) : (
                  <select id="t-sprint" className="select" value={val("sprint_id") ?? ""} disabled={!d.can_write} onChange={(e) => setDraft({ ...draft, sprint_id: e.target.value || null })}>
                    <option value="">Backlog (sem sprint)</option>
                    {t.sprint_id && !sprintOptions.some((s) => s.id === t.sprint_id) && <option value={t.sprint_id}>{t.sprint_name}</option>}
                    {sprintOptions.map((s) => <option key={s.id} value={s.id} disabled={s.status === "closed"}>{s.name}{s.status === "active" ? " (em andamento)" : s.status === "closed" ? " (encerrada)" : ""}</option>)}
                  </select>
                )}
              </div>
            )}
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
            </div>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            {d.can_write && (
              <button className="btn btn-primary" disabled={update.isPending || datesInverted}>
                Salvar
              </button>
            )}
            <button type="button" className="btn btn-line" onClick={onClose}>
              {d.can_write ? "Cancelar" : "Fechar"}
            </button>
            <span style={{ flex: 1 }} />
            {d.can_comment && (
              // Para quem prefere escrever: o assistente prepara o comentário e só publica após confirmação.
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (onClose(), openAssistant(`Comente na tarefa ${t.title}: `))}>
                <MessageCircle size={15} aria-hidden /> Contar ao assistente
              </button>
            )}
            {d.can_write && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => confirmDelete(t.id)}>
                Excluir
              </button>
            )}
          </div>
          {!d.can_write && <p className="muted" style={{ marginTop: 10 }}>Você tem acesso somente de leitura a esta tarefa.</p>}
        </form>
        {t.project_id && <Dependencies detail={d} start={val("start_date") ?? val("due_date") ?? null} projectTasks={siblings.data?.tasks} />}
        {!t.parent_id && <Subtasks parent={t} items={subtasks} canWrite={d.can_write} />}
        <Comments taskId={t.id} canWrite={d.can_comment} />
        </>
      )}
    </Dialog>
  );
}

/** Ordem de execução: do que esta tarefa precisa e quem espera por ela. Liga e desliga na hora,
 * como as subtarefas; o servidor recusa ciclo e tarefa de outro projeto. */
function Dependencies({ detail, start, projectTasks }: { detail: Detail; start: string | null; projectTasks?: Task[] }) {
  const { task, can_write: canWrite, depends_on: deps, blocks } = detail;
  const { add, remove } = useDependency();
  const candidates = canWrite && projectTasks ? dependencyCandidates(task, projectTasks) : [];
  if (!deps.length && !blocks.length && !canWrite) return null;
  const busy = add.isPending || remove.isPending;
  return (
    <section className="task-section" aria-labelledby="deps-title">
      <h3 id="deps-title"><Link2 size={16} aria-hidden /> Dependências</h3>
      {deps.length > 0 ? (
        <ul className="checklist" aria-label="Depende de">
          {deps.map((x) => {
            // Mesma regra de scheduleConflicts: prazo da anterior depois do início desta.
            const late = x.status !== "done" && task.status !== "done" && !!start && !!x.due_date && x.due_date > start;
            return (
              <li key={x.id}>
                <span className="grow">Depende de <strong>{x.title}</strong></span>
                <span className={`badge ${x.status === "done" ? "ok" : ""}`}>{STATUS_LABEL[x.status]}</span>
                {x.due_date && <span className={`badge ${late ? "alerta" : ""}`}>{late && <TriangleAlert size={12} aria-hidden />} termina {fmtDate(x.due_date)}</span>}
                {canWrite && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remover dependência de ${x.title}`} onClick={() => remove.mutate({ taskId: task.id, dependsOnId: x.id })}>
                    <X size={15} aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Esta tarefa não espera por nenhuma outra.</p>
      )}
      {deps.some((x) => x.status !== "done" && task.status !== "done" && !!start && !!x.due_date && x.due_date > start) && (
        <p className="form-error" role="status">Uma tarefa anterior termina depois do início desta. Ajuste as datas para o cronograma fechar.</p>
      )}
      {canWrite && (
        <div className="field">
          <label htmlFor="dep-add">Adicionar dependência</label>
          <select id="dep-add" className="select" value="" disabled={busy || !projectTasks} onChange={(e) => e.target.value && add.mutate({ taskId: task.id, dependsOnId: e.target.value })}>
            <option value="">{candidates.length ? "Escolher tarefa que precisa terminar antes…" : "Nenhuma outra tarefa disponível"}</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}{c.due_date ? ` (prazo ${fmtDate(c.due_date)})` : ""}</option>)}
          </select>
        </div>
      )}
      {blocks.length > 0 && (
        <p className="muted">Espera por esta: {blocks.map((b) => b.title).join(", ")}</p>
      )}
    </section>
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
