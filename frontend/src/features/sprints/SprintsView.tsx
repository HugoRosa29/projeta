import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarRange, CheckCircle2, GripVertical, Pencil, Play, Plus, Trash2, Undo2 } from "lucide-react";
import { useState, type DragEvent } from "react";
import { Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import {
  SPRINT_STATUS_LABEL,
  capacityOf,
  daysLeftLabel,
  deliveryOf,
  fmtHours,
  groupSprints,
  paceOf,
  positionBetween,
  tasksIn,
  type Sprint,
} from "../../domain/sprint";
import { STATUS_LABEL, fmtDate, type Task } from "../../domain/types";
import { api } from "../../services/api";
import { useInvalidateWork, useUpdateTask } from "../tasks/hooks";
import { TaskTags } from "../tasks/TaskParts";
import { CloseSprintDialog, SprintDialog } from "./SprintDialogs";
import { useSprints } from "./hooks";


const DRAG = "text/plain";

interface DropZone {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}
interface Draggable {
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
}

/** Planejamento: backlog ordenado (a ordem é a prioridade) ao lado das sprints abertas. Arrastar
 * é atalho; cada gesto também tem botão ou seletor, para teclado e telas pequenas. */
export function SprintsView({ projectId, tasks, onOpen }: { projectId: string; tasks: Task[]; onOpen: (id: string) => void }) {
  const q = useSprints(projectId);
  const update = useUpdateTask();
  const toast = useToast();
  const invalidate = useInvalidateWork();
  const [editing, setEditing] = useState<Sprint | "new" | null>(null);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (s: Sprint) => api.post<Sprint>(`/sprints/${s.id}/start`, {}),
    onSuccess: (s) => (invalidate(), toast(`${s.name} iniciada`)),
    onError: (e) => toast((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (s: Sprint) => api.del<void>(`/sprints/${s.id}`),
    onSuccess: () => (invalidate(), toast("Sprint excluída. As tarefas voltaram ao backlog.")),
    onError: (e) => toast((e as Error).message),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const { open, closed } = groupSprints(d.sprints);
  const backlog = tasksIn(tasks, null);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const moveTo = (t: Task, sprintId: string | null) => {
    if ((t.sprint_id ?? null) === sprintId) return;
    update.mutate({ task: t, patch: { sprint_id: sprintId } });
  };
  const reorder = (t: Task, beforeId: string | null) => {
    const position = positionBetween(backlog, t.id, beforeId);
    update.mutate({ task: t, patch: { position, ...(t.sprint_id ? { sprint_id: null } : {}) } });
  };
  const dropZone = (key: string, onDrop: (t: Task) => void): DropZone => ({
    onDragOver: (e: DragEvent) => {
      if (!d.can_write) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const t = byId.get(e.dataTransfer.getData(DRAG));
      if (t && d.can_write) onDrop(t);
    },
  });
  const drag = (t: Task): Draggable => ({
    draggable: d.can_write,
    onDragStart: (e: DragEvent) => e.dataTransfer.setData(DRAG, t.id),
  });

  return (
    <>
      <div className="sprint-plan">
        <section className={`card pane sprint-backlog ${over === "backlog" ? "over" : ""}`} aria-labelledby="backlog-title" {...dropZone("backlog", (t) => reorder(t, null))}>
          <div className="card-head">
            <h2 id="backlog-title">Backlog <span className="badge">{backlog.length}</span></h2>
          </div>
          <p className="muted sprint-hint">A ordem é a prioridade: o que está no topo entra primeiro na próxima sprint.</p>
          <div className="pane-body">
          {backlog.length === 0 ? (
            <Empty title="Backlog vazio">Crie tarefas no campo acima. Elas chegam aqui antes de entrar numa sprint.</Empty>
          ) : (
            <ol className="sprint-list">
              {backlog.map((t, i) => (
                <li key={t.id} className={`sprint-item prio-${t.priority} ${over === t.id ? "over" : ""}`} {...drag(t)} {...dropZone(t.id, (x) => x.id !== t.id && reorder(x, t.id))}>
                  {d.can_write && <GripVertical size={16} className="sprint-grip" aria-hidden />}
                  <div className="sprint-item-main">
                    <button className="title" onClick={() => onOpen(t.id)}>{t.title}</button>
                    <div className="task-meta">
                      <TaskTags task={t} />
                      {t.estimate_minutes != null && <span>{fmtHours(t.estimate_minutes)}</span>}
                      {t.assignee_name && <span>{t.assignee_name}</span>}
                      {t.status !== "todo" && <span className="badge info">{STATUS_LABEL[t.status]}</span>}
                    </div>
                  </div>
                  {d.can_write && (
                    <div className="sprint-item-actions">
                      <button className="icon-btn" aria-label={`Subir “${t.title}”`} disabled={i === 0} onClick={() => reorder(t, backlog[i - 1].id)}><ArrowUp size={16} /></button>
                      <button className="icon-btn" aria-label={`Descer “${t.title}”`} disabled={i === backlog.length - 1} onClick={() => reorder(t, backlog[i + 2]?.id ?? null)}><ArrowDown size={16} /></button>
                      {open.length > 0 && (
                        <select className="select select-sm" aria-label={`Colocar “${t.title}” numa sprint`} value="" onChange={(e) => e.target.value && moveTo(t, e.target.value)}>
                          <option value="">Para a sprint…</option>
                          {open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          </div>
        </section>

        <div className="sprint-col">
          {d.can_manage && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={18} aria-hidden /> Planejar sprint
            </button>
          )}
          {open.length === 0 && (
            <Empty title="Nenhuma sprint planejada">
              {d.can_manage
                ? "Planeje a primeira: uma meta em uma frase, datas fixas (2 semanas é um bom começo) e as tarefas do topo do backlog."
                : "Quem gere o projeto planeja as sprints. Enquanto isso, o backlog guarda a ordem de prioridade."}
            </Empty>
          )}
          {open.map((s) => (
            <SprintCard
              key={s.id}
              sprint={s}
              tasks={tasks}
              canWrite={d.can_write}
              canManage={d.can_manage}
              over={over === s.id}
              zone={dropZone(s.id, (t) => moveTo(t, s.id))}
              drag={drag}
              onOpen={onOpen}
              onRemoveTask={(t) => moveTo(t, null)}
              onEdit={() => setEditing(s)}
              onStart={() => start.mutate(s)}
              onClose={() => setClosing(s)}
              onDelete={() => {
                if (confirm(`Excluir a ${s.name}? As tarefas voltam ao backlog.`)) remove.mutate(s);
              }}
              startBlocked={open.some((x) => x.status === "active")}
            />
          ))}
          {/* O histórico fecha a coluna das sprints: fica à mão sem alongar a tela. */}
          {closed.length > 0 && (
            <details className="sprint-history">
              <summary>Sprints encerradas ({closed.length})</summary>
              <div className="grid">
                {closed.map((s) => <SprintReport key={s.id} sprint={s} />)}
              </div>
            </details>
          )}
        </div>
      </div>

      {editing && <SprintDialog projectId={projectId} sprint={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {closing && (
        <CloseSprintDialog sprint={closing} next={open.find((s) => s.status === "planned")} tasks={tasks} onClose={() => setClosing(null)} />
      )}
    </>
  );
}

interface CardProps {
  sprint: Sprint;
  tasks: Task[];
  canWrite: boolean;
  canManage: boolean;
  over: boolean;
  zone: DropZone;
  drag: (t: Task) => Draggable;
  onOpen: (id: string) => void;
  onRemoveTask: (t: Task) => void;
  onEdit: () => void;
  onStart: () => void;
  onClose: () => void;
  onDelete: () => void;
  startBlocked: boolean;
}

function SprintCard({ sprint: s, tasks, canWrite, canManage, over, zone, drag, onOpen, onRemoveTask, onEdit, onStart, onClose, onDelete, startBlocked }: CardProps) {
  const items = tasksIn(tasks, s.id, { includeDone: true });
  const cap = capacityOf(s);
  const pace = paceOf(s);
  const active = s.status === "active";
  return (
    <section className={`card sprint-card ${active ? "active" : ""} ${over ? "over" : ""}`} aria-label={`${s.name}, ${SPRINT_STATUS_LABEL[s.status]}`} {...zone}>
      <div className="card-head">
        <h2>{s.name}</h2>
        <span className={`badge ${active ? "ok" : ""}`}>{SPRINT_STATUS_LABEL[s.status]}</span>
      </div>
      <p className="task-meta">
        <CalendarRange size={14} aria-hidden /> {fmtDate(s.start_date)} a {fmtDate(s.end_date)} · {s.days_total} dias
        <span className={`badge ${s.overdue ? "alerta" : ""}`}>{daysLeftLabel(s)}</span>
      </p>
      {s.goal ? (
        <p className="sprint-goal"><strong>Meta:</strong> {s.goal}</p>
      ) : (
        <p className="sprint-goal missing">Sem meta. {canManage ? "Escreva uma antes de iniciar." : ""}</p>
      )}

      <div className="sprint-meters">
        <div>
          <span className="label">Concluído</span>
          <div className="okr-bar" role="progressbar" aria-valuenow={pace.done} aria-valuemin={0} aria-valuemax={100} aria-label={`Concluído: ${pace.done}%`}>
            <span className="okr-bar-fill" style={{ width: `${pace.done}%` }} />
            {active && <span className="okr-bar-pace" style={{ left: `${pace.time}%` }} title={`Tempo decorrido: ${pace.time}%`} />}
          </div>
          <span className="muted">
            {s.stats.done}/{s.stats.tasks} tarefas
            {active && pace.behind && <strong className="okr-stale"> · ritmo abaixo do tempo</strong>}
          </span>
        </div>
        <div>
          <span className="label">Capacidade</span>
          {cap.state === "none" ? (
            <span className="muted">{fmtHours(s.stats.minutes)} estimadas · capacidade não informada</span>
          ) : (
            <>
              <div className={`okr-bar sprint-cap ${cap.state}`} role="progressbar" aria-valuenow={cap.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Capacidade usada: ${cap.pct}%`}>
                <span className="okr-bar-fill" style={{ width: `${Math.min(cap.pct, 100)}%` }} />
              </div>
              <span className="muted">
                {fmtHours(s.stats.minutes)} de {fmtHours(s.capacity_minutes!)} ({cap.pct}%)
                {cap.state === "over" && <strong className="sprint-over"> · não cabe: tire tarefas ou reduza o escopo</strong>}
                {cap.state === "tight" && <> · no limite</>}
              </span>
            </>
          )}
          {s.stats.unestimated > 0 && <span className="muted sprint-hint">{s.stats.unestimated} sem estimativa</span>}
        </div>
      </div>

      {s.load.length > 0 && (
        <details className="sprint-load">
          <summary>Carga por pessoa</summary>
          <ul>
            {s.load.map((l) => (
              <li key={l.assignee_id ?? "none"}>
                <span>{l.name ?? "Sem responsável"}</span>
                <span className="muted">{l.tasks} tarefa(s) · {fmtHours(l.open_minutes)} em aberto</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {items.length === 0 ? (
        <p className="muted sprint-drop">{canWrite ? "Arraste tarefas do backlog para cá, ou use “Para a sprint…”." : "Sem tarefas."}</p>
      ) : (
        <ol className="sprint-list compact">
          {items.map((t) => (
            <li key={t.id} className={`sprint-item prio-${t.priority} ${t.status === "done" ? "done" : ""}`} {...drag(t)}>
              <div className="sprint-item-main">
                <button className="title" onClick={() => onOpen(t.id)}>
                  {t.status === "done" && <CheckCircle2 size={14} aria-label="Concluída" />} {t.title}
                </button>
                <div className="task-meta">
                  <TaskTags task={t} />
                  {t.estimate_minutes != null && <span>{fmtHours(t.estimate_minutes)}</span>}
                  {t.assignee_name && <span>{t.assignee_name}</span>}
                  {t.status !== "todo" && t.status !== "done" && <span className="badge info">{STATUS_LABEL[t.status]}</span>}
                </div>
              </div>
              {canWrite && t.status !== "done" && (
                <button className="icon-btn" aria-label={`Devolver “${t.title}” ao backlog`} title="Devolver ao backlog" onClick={() => onRemoveTask(t)}>
                  <Undo2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {canManage && (
        <div className="row sprint-actions">
          {s.status === "planned" && (
            <button className="btn btn-primary btn-sm" disabled={startBlocked} title={startBlocked ? "Encerre a sprint em andamento antes" : undefined} onClick={onStart}>
              <Play size={15} aria-hidden /> Iniciar
            </button>
          )}
          {active && (
            <button className={`btn btn-sm ${s.overdue ? "btn-primary" : "btn-line"}`} onClick={onClose}>Encerrar sprint</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil size={15} aria-hidden /> Editar</button>
          {s.status === "planned" && (
            <button className="btn btn-ghost btn-sm" onClick={onDelete}><Trash2 size={15} aria-hidden /> Excluir</button>
          )}
        </div>
      )}
    </section>
  );
}

export function SprintReport({ sprint: s }: { sprint: Sprint }) {
  const sum = s.summary;
  if (!sum) return null;
  const { pct, scope } = deliveryOf(sum);
  return (
    <section className="card sprint-report" aria-label={`Relatório da ${s.name}`}>
      <div className="card-head">
        <h3>{s.name}</h3>
        <span className="okr-pct">{pct}%</span>
      </div>
      <p className="task-meta">{fmtDate(s.start_date)} a {fmtDate(s.end_date)}{sum.planned_end !== s.end_date && <> (previsto: {fmtDate(sum.planned_end)})</>}</p>
      {sum.goal && <p className="sprint-goal"><strong>Meta:</strong> {sum.goal}</p>}
      <dl className="sprint-numbers">
        <div><dt>Comprometidas no início</dt><dd>{sum.committed.tasks}</dd></div>
        <div><dt>Entraram no meio</dt><dd>{sum.added.tasks}</dd></div>
        <div><dt>Retiradas</dt><dd>{sum.removed}</dd></div>
        <div><dt>Concluídas</dt><dd>{sum.done.tasks} de {scope}</dd></div>
        {sum.done.minutes > 0 && <div><dt>Horas entregues</dt><dd>{fmtHours(sum.done.minutes)}</dd></div>}
      </dl>
      {sum.carried.items.length > 0 && (
        <p className="muted">
          {sum.carried.items.length} não concluída(s) {sum.carried.to ? `foram para a ${sum.carried.to}` : "voltaram ao backlog"}: {sum.carried.items.map((i) => i.title).join(", ")}.
        </p>
      )}
    </section>
  );
}

/** Cartão da sprint ativa na visão geral do projeto. */
export function ActiveSprintCard({ projectId, onGo }: { projectId: string; onGo: () => void }) {
  const q = useSprints(projectId);
  const s = q.data?.sprints.find((x) => x.status === "active");
  if (!s) return null;
  const pace = paceOf(s);
  return (
    <section className="card sprint-card active">
      <div className="card-head">
        <h2>{s.name}</h2>
        <span className={`badge ${s.overdue ? "alerta" : "ok"}`}>{daysLeftLabel(s)}</span>
      </div>
      {s.goal && <p className="sprint-goal"><strong>Meta:</strong> {s.goal}</p>}
      <div className="okr-bar" role="progressbar" aria-valuenow={pace.done} aria-valuemin={0} aria-valuemax={100} aria-label={`Sprint concluída: ${pace.done}%`}>
        <span className="okr-bar-fill" style={{ width: `${pace.done}%` }} />
        <span className="okr-bar-pace" style={{ left: `${pace.time}%` }} title={`Tempo decorrido: ${pace.time}%`} />
      </div>
      <p className="muted">
        {s.stats.done}/{s.stats.tasks} tarefas · {pace.time}% do tempo
        {pace.behind && <strong className="okr-stale"> · ritmo abaixo do tempo</strong>}
      </p>
      <button className="btn btn-line btn-sm" onClick={onGo}>Abrir planejamento</button>
    </section>
  );
}
