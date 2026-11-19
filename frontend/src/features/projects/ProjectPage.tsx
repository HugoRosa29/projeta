import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Hero } from "../../components/Hero";
import { Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import {
  ACTIVITY_LABEL,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  fmtDate,
  type ActivityItem,
  type Member,
  type Priority,
  type Project,
  type Status,
  type Task,
} from "../../domain/types";
import { api } from "../../services/api";
import { useAnnounceProject } from "../../app/projectContext";
import { useSession } from "../../app/session";
import { useUpdateTask } from "../tasks/hooks";
import { projectProgress, subtaskCounts } from "../../domain/work";
import { DueBadge, QuickAdd, SubtaskBadge, TaskDialog, TaskList, TaskTags } from "../tasks/TaskParts";
import { coverUrl, useCoverActions } from "./cover";
import { ProjectDetails } from "./ProjectDetails";
import { FormalPanel } from "./FormalPanel";
import { InviteByMatricula } from "./InviteByMatricula";

interface ProjectData {
  project: Project;
  can_write: boolean;
  can_manage: boolean;
  members: Member[];
  stats: Partial<Record<Status, number>>;
  activity: ActivityItem[];
}

const VIEWS = [
  ["visao", "Visão geral"],
  ["quadro", "Quadro"],
  ["lista", "Lista"],
  ["cronograma", "Cronograma"],
  ["formal", "Formal"],
] as const;

export function ProjectPage() {
  const { id = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") ?? "visao";
  const { workspace } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, remove } = useCoverActions(id);
  const taskParam = sp.get("task");
  useEffect(() => {
    if (taskParam) setOpen(taskParam); // links do assistente abrem a tarefa direto
  }, [taskParam]);
  const closeTask = () => {
    setOpen(null);
    if (sp.has("task")) {
      const n = new URLSearchParams(sp);
      n.delete("task");
      setSp(n, { replace: true });
    }
  };

  const q = useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectData>(`/projects/${id}`) });
  const tasksQ = useQuery({ queryKey: ["tasks", "project", id], queryFn: () => api.get<{ tasks: Task[] }>(`/projects/${id}/tasks`) });
  useAnnounceProject(q.data ? { id, name: q.data.project.name } : null);

  const setStatus = useMutation({
    mutationFn: (status: "active" | "archived") => api.patch(`/projects/${id}`, { status }),
    onSuccess: (_d, status) => {
      for (const k of ["project", "projects"]) qc.invalidateQueries({ queryKey: [k] });
      toast(status === "archived" ? "Projeto arquivado" : "Projeto reativado");
    },
    onError: (e) => toast((e as Error).message),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const tasks = tasksQ.data?.tasks ?? [];
  const archived = d.project.status === "archived";
  const canManageRole = d.can_manage || (archived && (workspace.role === "admin" || workspace.role === "manager"));

  return (
    <>
      <Hero
        eyebrow={<Link to="/projetos">Projetos</Link>}
        title={<>{d.project.name} {archived && <span className="badge">Arquivado</span>}</>}
        subtitle={d.project.summary || undefined}
        cover={d.project.cover_version ? coverUrl(id, d.project.cover_version) : undefined}
      >
        {d.can_manage && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-label="Escolher imagem do projeto"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload.mutate(f);
              }}
            />
            <button className="btn btn-glass btn-sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={16} aria-hidden /> {upload.isPending ? "Enviando…" : d.project.cover_version ? "Trocar imagem" : "Adicionar imagem"}
            </button>
            {d.project.cover_version && (
              <button className="btn btn-glass btn-sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 size={16} aria-hidden /> Remover imagem
              </button>
            )}
          </>
        )}
        {canManageRole && (
          <button className="btn btn-glass btn-sm" onClick={() => setStatus.mutate(archived ? "active" : "archived")}>
            {archived ? "Reativar projeto" : "Arquivar projeto"}
          </button>
        )}
      </Hero>
      <nav className="tabs" aria-label="Visões do projeto">
        {VIEWS.map(([v, label]) => (
          <Link key={v} to={`?view=${v}`} aria-current={view === v ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      {d.can_write && view !== "visao" && <QuickAdd workspaceId={d.project.workspace_id} projectId={id} placeholder="Nova tarefa neste projeto…" />}
      {view === "visao" && <Overview d={d} tasks={tasks} onOpen={setOpen} />}
      {view === "quadro" && (tasksQ.isError ? <ErrorBox error={tasksQ.error} onRetry={() => tasksQ.refetch()} /> : <Board tasks={tasks} canWrite={d.can_write} onOpen={setOpen} />)}
      {view === "lista" && <ListView tasks={tasks} members={d.members} onOpen={setOpen} />}
      {view === "cronograma" && <Timeline tasks={tasks} onOpen={setOpen} />}
      {view === "formal" && <FormalPanel project={d.project} members={d.members} canManage={d.can_manage} />}
      {open && <TaskDialog taskId={open} members={d.members} onClose={closeTask} />}
    </>
  );
}

function Overview({ d, tasks, onOpen }: { d: ProjectData; tasks: Task[]; onOpen: (id: string) => void }) {
  const total = tasks.length;
  const done = d.stats.done ?? 0;
  const { pct, informed } = projectProgress({ progress: d.project.progress, task_count: total, done_count: done });
  const blocked = tasks.filter((t) => t.status === "blocked");
  const qc = useQueryClient();
  const { workspace } = useSession();
  const members = useQuery({ queryKey: ["ws-members", workspace.id], queryFn: () => api.get<{ members: Member[] }>(`/workspaces/${workspace.id}/members`), enabled: d.can_manage });
  const addable = (members.data?.members ?? []).filter((m) => !d.members.some((x) => x.id === m.id));
  const add = useMutation({
    mutationFn: (user_id: string) => api.post(`/projects/${d.project.id}/members`, { user_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project"] }),
  });
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <ProjectDetails project={d.project} canManage={d.can_manage} />
      <section className="card">
        <h2>Progresso</h2>
        <p style={{ fontFamily: "var(--display)", fontSize: "2rem" }}>{pct}%</p>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do projeto"><span style={{ width: `${pct}%` }} /></div>
        <p className="muted" style={{ marginTop: 6 }}>{informed ? `Informado pela gestão do projeto · ${done}/${total} tarefas concluídas` : `${done}/${total} tarefas concluídas`}</p>
        <p className="task-meta" style={{ marginTop: 10 }}>
          {STATUSES.map((s) => <span key={s} className="badge">{STATUS_LABEL[s]}: {d.stats[s] ?? 0}</span>)}
        </p>
        {total === 0 && <Empty title="Sem tarefas ainda">Crie a primeira no quadro ou descreva o objetivo ao assistente.</Empty>}
      </section>
      <section className="card">
        <h2>Bloqueios</h2>
        {blocked.length ? <TaskList tasks={blocked} onOpen={onOpen} /> : <p className="muted">Nenhuma tarefa bloqueada.</p>}
      </section>
      <section className="card">
        <h2>Equipe do projeto</h2>
        <ul className="task-list" style={{ marginTop: 10 }}>
          {d.members.map((m) => <li key={m.id} className="task-row">{m.name} <span className="muted">{m.email}</span></li>)}
        </ul>
        {d.can_manage && addable.length > 0 && (
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="add-member">Adicionar pessoa do espaço</label>
            <select id="add-member" className="select" value="" onChange={(e) => e.target.value && add.mutate(e.target.value)}>
              <option value="">Escolher…</option>
              {addable.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
        {d.can_manage && <InviteByMatricula projectId={d.project.id} />}
      </section>
      <section className="card">
        <h2>Atividade recente</h2>
        {d.activity.length === 0 ? <p className="muted">Sem atividade.</p> : (
          <ul className="task-list" style={{ marginTop: 10 }}>
            {d.activity.map((a) => (
              <li key={a.id} className="task-row" style={{ display: "block" }}>
                <strong>{a.actor_name ?? "Alguém"}</strong> {ACTIVITY_LABEL[a.kind] ?? a.kind}{typeof a.data.title === "string" && <> “{a.data.title}”</>}
                {a.via === "assistant" && <span className="badge info" style={{ marginLeft: 6 }}>via assistente</span>}
                <div className="coord">{new Date(a.created_at).toLocaleString("pt-BR")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Board({ tasks, canWrite, onOpen }: { tasks: Task[]; canWrite: boolean; onOpen: (id: string) => void }) {
  const update = useUpdateTask();
  const [over, setOver] = useState<Status | null>(null);
  const counts = subtaskCounts(tasks);
  const move = (t: Task, status: Status) => t.status !== status && update.mutate({ task: t, patch: { status } });
  return (
    <div className="board">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <section
            key={s}
            className={`column ${over === s ? "over" : ""}`}
            aria-label={`${STATUS_LABEL[s]}, ${col.length} tarefas`}
            onDragOver={(e) => canWrite && (e.preventDefault(), setOver(s))}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const t = tasks.find((x) => x.id === e.dataTransfer.getData("text/plain"));
              if (t && canWrite) move(t, s);
            }}
          >
            <h3>
              {STATUS_LABEL[s]} <span className="badge">{col.length}</span>
            </h3>
            <ul>
              {col.map((t) => (
                <li key={t.id} className={`kcard prio-${t.priority}`} draggable={canWrite} onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}>
                  <button className="title" onClick={() => onOpen(t.id)}>{t.is_milestone ? "◆ " : ""}{t.title}</button>
                  {t.parent_title && <span className="coord kcard-parent"><CornerDownRight size={12} aria-hidden /> {t.parent_title}</span>}
                  <div className="task-meta">
                    {counts.has(t.id) && <SubtaskBadge counts={counts.get(t.id)!} />}
                    <TaskTags task={t} />
                    <DueBadge task={t} />
                    {t.assignee_name && <span>{t.assignee_name}</span>}
                  </div>
                  {canWrite && (
                    <select className="select" aria-label={`Mover “${t.title}” para`} value={t.status} onChange={(e) => move(t, e.target.value as Status)}>
                      {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                    </select>
                  )}
                </li>
              ))}
            </ul>
            {col.length === 0 && <p className="muted" style={{ fontSize: "0.8125rem" }}>{canWrite ? "Arraste uma tarefa para cá." : "Vazio."}</p>}
          </section>
        );
      })}
    </div>
  );
}

function ListView({ tasks, members, onOpen }: { tasks: Task[]; members: Member[]; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [text, setText] = useState("");
  const shown = tasks.filter(
    (t) =>
      (!status || t.status === status) &&
      (!priority || t.priority === priority) &&
      (!assignee || (assignee === "none" ? !t.assignee_id : t.assignee_id === assignee)) &&
      (!text || t.title.toLowerCase().includes(text.toLowerCase())),
  );
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }} role="search" aria-label="Filtrar tarefas">
        <input className="input grow" aria-label="Buscar por título" placeholder="Buscar…" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="select grow" aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os estados</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="select grow" aria-label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Todas as prioridades</option>
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="select grow" aria-label="Responsável" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Qualquer responsável</option>
          <option value="none">Sem responsável</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {shown.length === 0 ? <Empty title={tasks.length ? "Nenhuma tarefa com esses filtros" : "Sem tarefas"}>{tasks.length ? "Limpe os filtros para ver todas." : "Use o campo acima para criar a primeira."}</Empty> : <TaskList tasks={shown} all={tasks} onOpen={onOpen} />}
    </>
  );
}

function Timeline({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const dated = tasks.filter((t) => t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  if (!dated.length) return <Empty title="Cronograma vazio">Defina prazos nas tarefas (ou aplique uma EAP do assistente) para ver a linha do tempo.</Empty>;
  const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const created = (t: Task) => t.created_at.slice(0, 10);
  const start = Math.min(...dated.map((t) => Math.min(ms(t.due_date!), ms(created(t)))));
  const end = Math.max(...dated.map((t) => ms(t.due_date!)));
  const span = Math.max(end - start, 86400000);
  const pos = (d: string) => ((ms(d) - start) / span) * 100;
  return (
    <div className="card">
      <p className="coord" style={{ marginBottom: 10 }}>{fmtDate(new Date(start).toISOString().slice(0, 10))} → {fmtDate(new Date(end).toISOString().slice(0, 10))}</p>
      <div className="timeline">
        {dated.map((t) => {
          const from = t.is_milestone ? pos(t.due_date!) : Math.min(pos(created(t)), pos(t.due_date!));
          const to = pos(t.due_date!);
          return (
            <div className="tl-row" key={t.id}>
              <button className="title" style={{ textAlign: "left", background: "none", border: 0, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => onOpen(t.id)}>
                {t.is_milestone ? "◆ " : ""}{t.title}
              </button>
              <div className="tl-track" aria-label={`${t.title}: prazo ${fmtDate(t.due_date)}, ${STATUS_LABEL[t.status]}`}>
                <div className={`tl-bar ${t.is_milestone ? "milestone" : t.status === "done" ? "done" : t.status === "blocked" ? "blocked" : ""}`} style={{ left: `${from}%`, width: t.is_milestone ? undefined : `${Math.max(to - from, 1)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
