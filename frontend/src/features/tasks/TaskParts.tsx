import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, CornerDownRight, Diamond, Flag, Folder, GripVertical, Layers, Link2, ListChecks, MessageCircle, NotebookPen, Plus, Repeat, Tag, Timer, Trash2, TriangleAlert, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
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
import { usePhases } from "../projects/phases";
import { api } from "../../services/api";
import { Comments } from "./Comments";
import { useCreateTask, useDeleteTask, useDependency, useInvalidateWork, useUpdateTask } from "./hooks";

/** Tags são comparadas sem diferenciar espaços nas pontas nem maiúsculas. */
const normTag = (label: string) => label.trim().toLocaleUpperCase("pt-BR");

/** Criar tarefa informando só o título; prazo e prioridade são opcionais. */
type NewKind = "task" | "milestone" | "subtask";
const KIND_LABEL: Record<NewKind, string> = { task: "Tarefa", milestone: "Marco", subtask: "Subtarefa" };
const KIND_PLACEHOLDER: Record<NewKind, string> = { task: "Nova tarefa…", milestone: "Nome do marco…", subtask: "Nova subtarefa…" };

/** Criação rápida. Em projeto (`tasks` informado), escolhe o tipo: marco pede a data (sem ela não
 * aparece no cronograma nem na agenda) e subtarefa pede a tarefa-mãe (só tarefas principais,
 * porque o servidor aceita um nível só). */
export function QuickAdd({ workspaceId, projectId, placeholder, tasks }: { workspaceId: string; projectId?: string; placeholder?: string; tasks?: Task[] }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<NewKind>("task");
  const [date, setDate] = useState("");
  const [parent, setParent] = useState("");
  const create = useCreateTask();
  const toast = useToast();
  const kinds = !!projectId && !!tasks;
  const parents = (tasks ?? []).filter((t) => !t.parent_id && !t.is_milestone);
  const ready = !!title.trim() && (kind !== "milestone" || !!date) && (kind !== "subtask" || !!parent);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || !ready) return;
    const extra = kind === "milestone" ? { is_milestone: true, due_date: date } : kind === "subtask" ? { parent_id: parent } : {};
    create.mutate(
      { workspace_id: workspaceId, project_id: projectId ?? null, title: t, ...extra },
      { onSuccess: () => (setTitle(""), setDate(""), toast(`${KIND_LABEL[kind]} criad${kind === "milestone" ? "o" : "a"}`)), onError: (er) => toast((er as Error).message) },
    );
  };
  return (
    <form className={`quick-add${kinds ? " quick-add-kinds" : ""}`} onSubmit={submit}>
      {kinds && (
        <>
          <label className="sr-only" htmlFor="quick-kind">Tipo do item</label>
          <select id="quick-kind" className="input quick-kind" value={kind} onChange={(e) => setKind(e.target.value as NewKind)}>
            {(Object.keys(KIND_LABEL) as NewKind[]).map((k) => (
              <option key={k} value={k} disabled={k === "subtask" && !parents.length}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </>
      )}
      <label className="sr-only" htmlFor="quick-title">
        {kinds ? `Título: ${KIND_LABEL[kind].toLowerCase()}` : "Título da nova tarefa"}
      </label>
      <input id="quick-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kinds ? KIND_PLACEHOLDER[kind] : placeholder ?? "Nova tarefa… (Enter para criar)"} maxLength={200} />
      {kinds && kind === "milestone" && (
        <>
          <label className="sr-only" htmlFor="quick-date">Data do marco</label>
          <input id="quick-date" className="input quick-extra" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </>
      )}
      {kinds && kind === "subtask" && (
        <>
          <label className="sr-only" htmlFor="quick-parent">Tarefa-mãe</label>
          <select id="quick-parent" className="input quick-extra" value={parent} onChange={(e) => setParent(e.target.value)} required>
            <option value="">Tarefa-mãe…</option>
            {parents.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </>
      )}
      <button className="btn btn-primary" disabled={create.isPending || !ready}>
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
export function DependencyControl({ task, all, canWrite, onOpen }: { task: Task; all: Task[]; canWrite: boolean; onOpen?: (id: string) => void }) {
  const { add, remove } = useDependency();
  const toast = useToast();
  if (!task.project_id) return null;
  const byId = new Map(all.map((t) => [t.id, t]));
  const deps = (task.depends_on_ids ?? []).map((id) => byId.get(id)).filter((d): d is Task => !!d);
  // O servidor já manda o que falta (com título), mesmo quando a anterior não está nesta lista.
  const pending = task.waiting_on ?? deps.filter((d) => d.status !== "done");
  const blocking = task.blocking_count ?? 0;
  const conflicts = scheduleConflicts(task, all);
  const candidates = canWrite ? dependencyCandidates(task, all) : [];
  const busy = add.isPending || remove.isPending;
  const names = pending.map((d) => d.title).join(", ");
  return (
    <>
      {pending.length > 0 && (
        <button
          type="button"
          className={`badge badge-btn ${conflicts.length ? "alerta" : "info"}`}
          title={`Aguarda: ${pending.map((d) => `${d.title}${d.due_date ? ` (prazo ${fmtDate(d.due_date)})` : ""}`).join(", ")}`}
          aria-label={`Aguarda ${pending.length} tarefa(s): ${names}${conflicts.length ? ". Começa antes de uma delas terminar" : ""}. Abrir ${pending[0].title}`}
          disabled={!onOpen}
          onClick={() => onOpen?.(pending[0].id)}
        >
          {conflicts.length ? <TriangleAlert size={12} aria-hidden /> : <Link2 size={12} aria-hidden />} Aguarda {pending.length === 1 ? pending[0].title : `${pending.length} tarefas`}
          {pending.length === 1 && pending[0].due_date ? ` · ${fmtDate(pending[0].due_date)}` : ""}
        </button>
      )}
      {blocking > 0 && (
        <span className="badge warn" title="Tarefas que só começam quando esta terminar">
          Libera {blocking === 1 ? "1 tarefa" : `${blocking} tarefas`}
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
          {deps && <DependencyControl task={task} all={deps.all} canWrite={deps.canWrite} onOpen={onOpen} />}
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
 * mesmo quando um filtro esconde parte delas. Várias listas na mesma tela (uma por fase) passam
 * `drag`/`setDrag` em comum, para arrastar de uma para outra. */
export function TaskList({ tasks, today, onOpen, all, quick, dependencies, label }: { tasks: Task[]; today?: string; onOpen: (id: string) => void; all?: Task[]; quick?: boolean; dependencies?: { canWrite: boolean; drag?: string | null; setDrag?: (id: string | null) => void }; label?: string }) {
  const counts = subtaskCounts(all ?? tasks);
  const [ownDrag, setOwnDrag] = useState<string | null>(null);
  const deps = dependencies && {
    all: all ?? tasks,
    canWrite: dependencies.canWrite,
    drag: dependencies.setDrag ? (dependencies.drag ?? null) : ownDrag,
    setDrag: dependencies.setDrag ?? setOwnDrag,
  };
  return (
    <ul className="task-list" aria-label={label}>
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

const FORM_ID = "task-form";
const STATUS_TONE: Record<Status, string> = { todo: "neutral", doing: "info", blocked: "alerta", done: "ok" };
const PRIORITY_ORDER: Priority[] = ["low", "medium", "high", "urgent"];
const DAY_MS = 86_400_000;
const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Resumo das datas em linguagem de gente: duração e quanto falta para o prazo. */
function scheduleSummary(start: string | null | undefined, due: string | null | undefined, status: Status | undefined, today: string) {
  const parts: { text: string; tone?: string }[] = [];
  if (start && due && start <= due) parts.push({ text: `Duração: ${plural(daysBetween(start, due) + 1, "dia", "dias")}` });
  if (due && status !== "done") {
    const left = daysBetween(today, due);
    if (left < 0) parts.push({ text: `Venceu há ${plural(-left, "dia", "dias")}`, tone: "alerta" });
    else if (left === 0) parts.push({ text: "Vence hoje", tone: "warn" });
    else parts.push({ text: `Vence em ${plural(left, "dia", "dias")}`, tone: left <= 3 ? "warn" : undefined });
  }
  return parts;
}

/** Tags como fichas: vírgula ou Enter cria a ficha; Backspace no campo vazio tira a última.
 * O texto ainda não confirmado fica com quem chama, para entrar no salvamento. */
function TagInput({ id, tags, text, disabled, onTags, onText }: { id: string; tags: string[]; text: string; disabled: boolean; onTags: (t: string[]) => void; onText: (s: string) => void }) {
  const commit = (raw: string[]) => {
    const fresh = raw.map(normTag).filter(Boolean);
    if (fresh.length) onTags([...new Set([...tags.map(normTag), ...fresh])]);
  };
  return (
    <div className={`tag-input${disabled ? " is-disabled" : ""}`}>
      {tags.filter((x) => x.trim()).map((tag) => (
        <span key={tag} className="badge task-tag tag-chip">
          {tag}
          {!disabled && (
            <button type="button" aria-label={`Remover tag ${tag}`} onClick={() => onTags(tags.filter((x) => x !== tag))}>
              <X size={12} aria-hidden />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        className="tag-input-field"
        value={text}
        disabled={disabled}
        form={FORM_ID}
        placeholder={tags.length ? "Adicionar…" : "Ex.: DOCUMENTAÇÃO, REVISÃO"}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          const parts = e.target.value.split(",");
          if (parts.length > 1) commit(parts.slice(0, -1));
          onText(parts[parts.length - 1]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            e.preventDefault();
            commit([text]);
            onText("");
          } else if (e.key === "Backspace" && !text && tags.length) onTags(tags.slice(0, -1));
        }}
        onBlur={() => text.trim() && (commit([text]), onText(""))}
      />
    </div>
  );
}

/** Linha de propriedade da coluna lateral: rótulo com ícone em cima, controle embaixo. */
function Prop({ icon, label, htmlFor, children }: { icon: ReactNode; label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="task-prop">
      {htmlFor ? <label htmlFor={htmlFor}>{icon} {label}</label> : <span className="label">{icon} {label}</span>}
      {children}
    </div>
  );
}

export function TaskDialog({ taskId, members, onClose }: { taskId: string; members?: Member[]; onClose: () => void }) {
  const q = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<Detail>(`/tasks/${taskId}`) });
  const update = useUpdateTask();
  const del = useDeleteTask();
  const toast = useToast();
  const { openAssistant } = useAssistant();
  const [draft, setDraft] = useState<Partial<Task>>({});
  const [tagText, setTagText] = useState("");

  const d = q.data;
  const t = d?.task;
  const val = <K extends keyof Task>(k: K): Task[K] | undefined => (k in draft ? (draft[k] as Task[K]) : t?.[k]);
  const set = (patch: Partial<Task>) => setDraft((cur) => ({ ...cur, ...patch }));
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
  // Sprint: só tarefa principal de projeto (subtarefa acompanha a mãe, regra do servidor).
  const sprintsQ = useSprints(t?.project_id, !!t?.project_id && !t?.parent_id);
  const sprintOptions = (sprintsQ.data?.sprints ?? []).filter((s) => s.status !== "closed" || s.id === t?.sprint_id);
  const phaseOptions = usePhases(t?.project_id, !!t?.project_id).data?.phases ?? [];

  // Excluir a mãe não apaga as subtarefas (migração 011): o aviso diz isso em vez de "não pode ser desfeito".
  const confirmDelete = (id: string) => {
    const msg = subtasks.length
      ? `Excluir esta tarefa? As ${subtasks.length} subtarefas continuam, como tarefas principais.`
      : "Excluir esta tarefa? Isso não pode ser desfeito.";
    if (confirm(msg)) del.mutate(id, { onSuccess: () => (toast("Tarefa excluída"), onClose()) });
  };

  // Com dependência datada, o início é calculado pelo servidor (dia seguinte ao prazo da anterior).
  const linkedBy = (d?.depends_on ?? []).filter((x) => x.due_date).sort((a, b) => b.due_date!.localeCompare(a.due_date!))[0];
  const startVal = val("start_date");
  const dueVal = val("due_date");
  const datesInverted = !!startVal && !!dueVal && startVal > dueVal;
  const summary = scheduleSummary(startVal, dueVal, val("status"), localToday());

  const dirty = Object.keys(draft).length > 0 || !!tagText.trim();
  // Fechar sem querer (Esc, clique fora, X) descartava o que a pessoa digitou sem avisar.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const close = useCallback(() => {
    if (dirtyRef.current && !confirm("Descartar as alterações não salvas desta tarefa?")) return false;
    onClose();
    return true;
  }, [onClose]);

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (!t || datesInverted || update.isPending) return;
    const patch = { ...draft };
    const pending = tagText.split(",").map(normTag).filter(Boolean);
    if (pending.length) patch.labels = [...(patch.labels ?? t.labels), ...pending];
    if (patch.labels) {
      patch.labels = [...new Set(patch.labels.map(normTag).filter(Boolean))];
      if (patch.labels.join("\n") === t.labels.join("\n")) delete patch.labels;
    }
    if (!Object.keys(patch).length) return onClose();
    update.mutate({ task: t, patch }, { onSuccess: () => (toast("Tarefa salva"), onClose()) });
  };

  const ro = !d?.can_write;
  return (
    <Dialog title="Tarefa" onClose={close} className="task-dialog">
      {q.isError && <div className="task-dialog-body"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>}
      {!t && !q.isError && <div className="task-dialog-body"><p className="muted">Carregando tarefa…</p></div>}
      {t && d && (
        <>
          {/* Ctrl/⌘+Enter salva de qualquer campo, inclusive da descrição. */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div className="task-dialog-body" onKeyDown={(e) => {
            // Comentários e subtarefas têm envio próprio; o atalho vale só para os campos da ficha.
            if (!d.can_write || e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest(".task-section")) return;
            e.preventDefault();
            save();
          }}>
            <div className="task-context">
              {t.project_name ? <span className="badge"><Folder size={12} aria-hidden /> {t.project_name}</span> : <span className="badge">Pessoal</span>}
              {t.is_milestone && <span className="badge warn"><Diamond size={12} aria-hidden /> Marco</span>}
              {t.parent_id && (
                <span className="subtask-of muted"><CornerDownRight size={14} aria-hidden /> Subtarefa de <strong>{t.parent_title}</strong></span>
              )}
            </div>
            <label className="sr-only" htmlFor="t-title">Título</label>
            <input id="t-title" data-autofocus className="task-title-input" form={FORM_ID} value={val("title") ?? ""} disabled={ro} maxLength={200} placeholder="Título da tarefa" onChange={(e) => set({ title: e.target.value })} />

            <fieldset className="segmented segmented-status" disabled={ro}>
              <legend className="sr-only">Estado</legend>
              {STATUSES.map((s) => (
                <label key={s} className={`seg seg-${STATUS_TONE[s]}`}>
                  <input type="radio" name="t-status" value={s} checked={val("status") === s} onChange={() => set({ status: s })} />
                  <span>{s === "done" && <Check size={14} aria-hidden />}{STATUS_LABEL[s]}</span>
                </label>
              ))}
            </fieldset>

            <div className="task-columns">
              <div className="task-main">
                <div className="field">
                  <label htmlFor="t-desc">Descrição</label>
                  <textarea id="t-desc" className="textarea task-desc" value={val("description") ?? ""} disabled={ro} placeholder={ro ? "Sem descrição." : "Contexto, critério de pronto, links úteis…"} onChange={(e) => set({ description: e.target.value })} />
                </div>
                {!t.parent_id && <Subtasks parent={t} items={subtasks} canWrite={d.can_write} />}
                {t.project_id && <Dependencies detail={d} start={startVal ?? dueVal ?? null} projectTasks={siblings.data?.tasks} />}
                <Comments taskId={t.id} canWrite={d.can_comment} />
              </div>

              <aside className="task-aside" aria-label="Propriedades da tarefa">
                {t.project_id && members && (
                  <Prop icon={<UserRound size={14} aria-hidden />} label="Responsável" htmlFor="t-assignee">
                    <select id="t-assignee" className="select" value={val("assignee_id") ?? ""} disabled={ro} onChange={(e) => set({ assignee_id: e.target.value || null })}>
                      <option value="">Sem responsável</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </Prop>
                )}

                <Prop icon={<Flag size={14} aria-hidden />} label="Prioridade">
                  <fieldset className="segmented segmented-prio" disabled={ro}>
                    <legend className="sr-only">Prioridade</legend>
                    {PRIORITY_ORDER.map((p) => (
                      <label key={p} className={`seg seg-prio-${p}`}>
                        <input type="radio" name="t-prio" value={p} checked={val("priority") === p} onChange={() => set({ priority: p })} />
                        <span>{PRIORITY_LABEL[p]}</span>
                      </label>
                    ))}
                  </fieldset>
                </Prop>

                <Prop icon={<CalendarDays size={14} aria-hidden />} label="Datas">
                  <div className="task-dates">
                    <div className="field">
                      <label htmlFor="t-start">Início</label>
                      <input id="t-start" type="date" className="input" value={startVal ?? ""} max={dueVal ?? undefined} disabled={ro || !!linkedBy} aria-describedby={[linkedBy && "t-start-linked", datesInverted && "t-dates-error"].filter(Boolean).join(" ") || undefined} onChange={(e) => set({ start_date: e.target.value || null })} />
                    </div>
                    <ArrowRight size={16} aria-hidden className="task-dates-arrow" />
                    <div className="field">
                      <label htmlFor="t-due">Prazo</label>
                      <input id="t-due" type="date" className="input" value={dueVal ?? ""} min={startVal ?? undefined} disabled={ro} aria-describedby={datesInverted ? "t-dates-error" : undefined} onChange={(e) => set({ due_date: e.target.value || null })} />
                    </div>
                  </div>
                  {summary.length > 0 && !datesInverted && (
                    <p className="task-dates-summary">{summary.map((s) => <span key={s.text} className={`badge ${s.tone ?? ""}`}>{s.text}</span>)}</p>
                  )}
                  {datesInverted && <p id="t-dates-error" className="form-error" role="alert">O início fica depois do prazo. Antecipe o início ou adie o prazo.</p>}
                  {linkedBy && (
                    <p id="t-start-linked" className="start-linked muted">
                      <Link2 size={13} aria-hidden /> <span>Início automático: no dia seguinte ao prazo de <strong>{linkedBy.title}</strong> ({fmtDate(linkedBy.due_date)}). Se esse prazo mudar, esta tarefa anda junto e mantém a duração.</span>
                    </p>
                  )}
                </Prop>

                {t.project_id && (phaseOptions.length > 0 || t.phase) && (
                  <Prop icon={<Layers size={14} aria-hidden />} label="Fase" htmlFor={t.parent_id ? undefined : "t-phase"}>
                    {t.parent_id ? (
                      <p className="muted task-prop-fixed">{t.phase ?? "Sem fase"} · acompanha a tarefa-mãe</p>
                    ) : (
                      <select id="t-phase" className="select" value={val("phase") ?? ""} disabled={ro} onChange={(e) => set({ phase: e.target.value || null })}>
                        <option value="">Sem fase</option>
                        {t.phase && !phaseOptions.some((p) => p.name === t.phase) && <option value={t.phase}>{t.phase}</option>}
                        {phaseOptions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                      </select>
                    )}
                  </Prop>
                )}

                {t.project_id && (
                  <Prop icon={<Repeat size={14} aria-hidden />} label="Sprint" htmlFor={t.parent_id ? undefined : "t-sprint"}>
                    {t.parent_id ? (
                      <p className="muted task-prop-fixed">{t.sprint_name ?? "Backlog"} · acompanha a tarefa-mãe</p>
                    ) : (
                      <select id="t-sprint" className="select" value={val("sprint_id") ?? ""} disabled={ro} onChange={(e) => set({ sprint_id: e.target.value || null })}>
                        <option value="">Backlog (sem sprint)</option>
                        {t.sprint_id && !sprintOptions.some((s) => s.id === t.sprint_id) && <option value={t.sprint_id}>{t.sprint_name}</option>}
                        {sprintOptions.map((s) => <option key={s.id} value={s.id} disabled={s.status === "closed"}>{s.name}{s.status === "active" ? " (em andamento)" : s.status === "closed" ? " (encerrada)" : ""}</option>)}
                      </select>
                    )}
                  </Prop>
                )}

                <Prop icon={<Timer size={14} aria-hidden />} label="Estimativa (horas)" htmlFor="t-est">
                  <input id="t-est" type="number" min={0} step={0.5} inputMode="decimal" className="input" form={FORM_ID} disabled={ro} placeholder="Ex.: 4" value={estimateHours ?? ""} onChange={(e) => set({ estimate_minutes: e.target.value === "" ? null : Math.round(Number(e.target.value) * 60) })} />
                </Prop>

                {canNest && (
                  <Prop icon={<CornerDownRight size={14} aria-hidden />} label="Tarefa-mãe" htmlFor="t-parent">
                    <select id="t-parent" className="select" value={val("parent_id") ?? ""} onChange={(e) => set({ parent_id: e.target.value || null })}>
                      <option value="">Nenhuma (tarefa principal)</option>
                      {t.parent_id && !parents.some((x) => x.id === t.parent_id) && <option value={t.parent_id}>{t.parent_title}</option>}
                      {parents.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                    </select>
                  </Prop>
                )}

                <Prop icon={<Tag size={14} aria-hidden />} label="Tags" htmlFor="t-labels">
                  <TagInput id="t-labels" tags={val("labels") ?? []} text={tagText} disabled={ro} onTags={(labels) => set({ labels })} onText={setTagText} />
                  <small id="t-labels-help" className="muted">Vírgula ou Enter adiciona. A prioridade já aparece como etiqueta.</small>
                </Prop>
              </aside>
            </div>
          </div>

          <form id={FORM_ID} className="task-dialog-footer" onSubmit={save}>
            {ro ? (
              <p className="muted task-footer-note">Você tem acesso somente de leitura a esta tarefa.</p>
            ) : (
              <p className={`task-footer-note ${dirty ? "is-dirty" : "muted"}`} aria-live="polite">{dirty ? "Alterações não salvas" : "Nenhuma alteração"}</p>
            )}
            {d.can_comment && (
              // Para quem prefere escrever: o assistente prepara o comentário e só publica após confirmação.
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => close() && openAssistant(`Comente na tarefa ${t.title}: `)}>
                <MessageCircle size={15} aria-hidden /> Contar ao assistente
              </button>
            )}
            {d.can_write && (
              <button type="button" className="btn btn-ghost btn-sm task-delete" onClick={() => confirmDelete(t.id)}>
                <Trash2 size={15} aria-hidden /> Excluir
              </button>
            )}
            <span className="task-footer-spacer" />
            <button type="button" className="btn btn-line" onClick={() => close()}>{d.can_write ? "Cancelar" : "Fechar"}</button>
            {d.can_write && (
              <button className="btn btn-primary" disabled={update.isPending || datesInverted || !dirty} title="Ctrl+Enter">
                {update.isPending ? "Salvando…" : "Salvar"}
              </button>
            )}
          </form>
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
