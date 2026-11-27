import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, FileBarChart, FileText, Link2, History, ImagePlus, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Hero } from "../../components/Hero";
import { Dialog, Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import {
  ACTIVITY_LABEL,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  can,
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
import { localToday, projectProgress, projectRisk, subtaskCounts } from "../../domain/work";
import { ShareButton } from "../sharing/ShareButton";
import { DueBadge, QuickAdd, SubtaskBadge, TaskDialog, TaskTags } from "../tasks/TaskParts";
import { coverUrl, useCoverActions } from "./cover";
import { ProjectDetails } from "./ProjectDetails";
import { FormalPanel } from "./FormalPanel";
import { RisksCard, RisksPanel } from "./RisksPanel";
import { Timeline } from "./Timeline";
import { InviteByMatricula } from "./InviteByMatricula";
import { PhaseList } from "./PhaseList";
import { ActiveSprintCard, SprintsView } from "../sprints/SprintsView";
import { useSprints } from "../sprints/hooks";

export interface ProjectData {
  project: Project;
  can_write: boolean;
  can_manage: boolean;
  members: Member[];
  stats: Partial<Record<Status, number>>;
  activity: ActivityItem[];
}

const VIEWS = [
  ["visao", "Visão geral"],
  ["sprints", "Sprints"],
  ["quadro", "Quadro"],
  ["lista", "Lista"],
  ["cronograma", "Cronograma"],
  ["riscos", "Riscos"],
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
  const [panel, setPanel] = useState<"ficha" | "equipe" | "historico" | null>(null);
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

  // Link da visão geral para um risco: a aba abre a ficha dele e o endereço volta a ser só a aba.
  const clearRiskParam = useCallback(() => {
    setSp((cur) => {
      const n = new URLSearchParams(cur);
      n.delete("risk");
      return n;
    }, { replace: true });
  }, [setSp]);

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
  const canManageRole = d.can_manage || (archived && can(workspace, "project.manage"));

  const taskViewsError = tasksQ.isError ? <ErrorBox error={tasksQ.error} onRetry={() => tasksQ.refetch()} /> : null;

  return (
    <div className={`project-shell ${view === "visao" ? "is-overview" : ""}`}>
      <Hero
        compact
        eyebrow={<Link to="/projetos">Projetos</Link>}
        title={<>{d.project.name} {archived && <span className="badge">Arquivado</span>}</>}
        subtitle={d.project.summary || undefined}
        cover={d.project.cover_version ? coverUrl(id, d.project.cover_version) : undefined}
      >
        <button className="btn btn-glass btn-sm" onClick={() => setPanel("ficha")}>
          <FileText size={16} aria-hidden /> Ficha do projeto
        </button>
        <button className="btn btn-glass btn-sm" onClick={() => setPanel("equipe")} aria-label={`Equipe do projeto: ${d.members.length} pessoa(s)`}>
          <Users size={16} aria-hidden /> Equipe
          <span className="pv-avatars" aria-hidden>
            {d.members.slice(0, 3).map((m) => <Avatar key={m.id} id={m.id} name={m.name} photoVersion={m.photo_version} size={24} />)}
            {d.members.length > 3 && <span>+{d.members.length - 3}</span>}
          </span>
        </button>
        <button className="btn btn-glass btn-sm" onClick={() => setPanel("historico")}>
          <History size={16} aria-hidden /> Histórico
        </button>
        <Link className="btn btn-glass btn-sm" to={`/projetos/${id}/relatorio`}>
          <FileBarChart size={16} aria-hidden /> Relatório
        </Link>
        {workspace.kind === "team" && <ShareButton workspaceId={workspace.id} kind="project" id={id} name={d.project.name} className="btn btn-glass btn-sm" />}
      </Hero>
      {/* Abas e criação rápida dividem a mesma faixa: a altura que sobra fica para o trabalho. */}
      <div className="project-bar">
        <nav className="tabs" aria-label="Visões do projeto">
          {VIEWS.map(([v, label]) => (
            <Link key={v} to={`?view=${v}`} aria-current={view === v ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        {d.can_write && view !== "visao" && view !== "riscos" && <QuickAdd workspaceId={d.project.workspace_id} projectId={id} tasks={tasks} placeholder="Nova tarefa neste projeto…" />}
      </div>

      <div className={`project-view pv-${view}`}>
        {view === "visao" && <Overview d={d} tasks={tasks} onOpen={setOpen} onGoSprints={() => setSp({ view: "sprints" })} onGoRisks={(risk) => setSp(risk ? { view: "riscos", risk } : { view: "riscos" })} />}
        {view === "sprints" && (taskViewsError ?? <SprintsView projectId={id} tasks={tasks} onOpen={setOpen} />)}
        {view === "quadro" && (taskViewsError ?? <Board projectId={id} tasks={tasks} canWrite={d.can_write} onOpen={setOpen} />)}
        {view === "lista" && <ListView projectId={id} workspaceId={d.project.workspace_id} tasks={tasks} members={d.members} canWrite={d.can_write} onOpen={setOpen} />}
        {view === "cronograma" && (taskViewsError ?? <Timeline tasks={tasks} canWrite={d.can_write} onOpen={setOpen} projectId={id} />)}
        {view === "riscos" && <RisksPanel projectId={id} members={d.members} openRisk={sp.get("risk")} onOpenedRisk={clearRiskParam} />}
        {view === "formal" && <FormalPanel project={d.project} members={d.members} canManage={d.can_manage} />}
      </div>
      {open && <TaskDialog taskId={open} members={d.members} onClose={closeTask} />}

      {/* Consulta e gestão ficam a um clique: a visão geral mostra só o que pede ação. */}
      {panel === "ficha" && (
        <Dialog title="Ficha do projeto" onClose={() => setPanel(null)} className="pv-dialog">
          <ProjectDetails project={d.project} canManage={d.can_manage} />
          {(d.can_manage || canManageRole) && (
            <div className="row pv-dialog-actions">
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
                  <button className="btn btn-line btn-sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={16} aria-hidden /> {upload.isPending ? "Enviando…" : d.project.cover_version ? "Trocar imagem" : "Adicionar imagem"}
                  </button>
                  {d.project.cover_version && (
                    <button className="btn btn-ghost btn-sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                      <Trash2 size={16} aria-hidden /> Remover imagem
                    </button>
                  )}
                </>
              )}
              <span className="grow" />
              {canManageRole && (
                <button className="btn btn-danger btn-sm" onClick={() => setStatus.mutate(archived ? "active" : "archived")}>
                  {archived ? "Reativar projeto" : "Arquivar projeto"}
                </button>
              )}
            </div>
          )}
        </Dialog>
      )}
      {panel === "equipe" && (
        <Dialog title="Equipe do projeto" onClose={() => setPanel(null)} className="pv-dialog">
          <TeamPanel d={d} />
        </Dialog>
      )}
      {panel === "historico" && (
        <Dialog title="Histórico do projeto" onClose={() => setPanel(null)} className="pv-dialog">
          {d.activity.length === 0 ? <p className="muted">Sem atividade.</p> : (
            <ul className="pv-activity">
              {d.activity.map((a) => (
                <li key={a.id}>
                  <strong>{a.actor_name ?? "Alguém"}</strong> {ACTIVITY_LABEL[a.kind] ?? a.kind}{typeof a.data.title === "string" && <> “{a.data.title}”</>}
                  {a.via === "assistant" && <span className="badge info" style={{ marginLeft: 6 }}>via assistente</span>}
                  <div className="coord">{new Date(a.created_at).toLocaleString("pt-BR")}</div>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </div>
  );
}

export function TeamPanel({ d }: { d: ProjectData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user, workspaces } = useSession();
  const wsId = d.project.workspace_id;
  // A divisão é o espaço do projeto, não o escolhido na barra: só membros dele podem entrar.
  const wsName = workspaces.find((w) => w.id === wsId)?.name ?? "do espaço";
  const members = useQuery({ queryKey: ["ws-members", wsId], queryFn: () => api.get<{ members: Member[] }>(`/workspaces/${wsId}/members`), enabled: d.can_manage });
  const [filter, setFilter] = useState("");
  const addable = (members.data?.members ?? []).filter((m) => !d.members.some((x) => x.id === m.id));
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const shown = addable.filter((m) => norm(`${m.name} ${m.email}`).includes(norm(filter.trim())));
  const add = useMutation({
    mutationFn: (m: Member) => api.post(`/projects/${d.project.id}/members`, { user_id: m.id }).then(() => m),
    onSuccess: (m) => (qc.invalidateQueries({ queryKey: ["project"] }), toast(`${m.name} entrou no projeto`)),
    onError: (e) => toast((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => api.del(`/projects/${d.project.id}/members/${m.id}`).then(() => m),
    onSuccess: (m) => {
      // As tarefas da pessoa no projeto ficam sem responsável: a lista de tarefas também muda.
      for (const k of ["project", "tasks"]) qc.invalidateQueries({ queryKey: [k] });
      toast(`${m.name} saiu da equipe`);
    },
    onError: (e) => toast((e as Error).message),
  });
  const askRemove = (m: Member) => {
    const msg = m.id === user.id
      ? "Sair da equipe deste projeto? Suas tarefas nele ficam sem responsável, e você pode perder o acesso para editar."
      : `Retirar ${m.name} da equipe? As tarefas de ${m.name} neste projeto ficam sem responsável.`;
    if (confirm(msg)) remove.mutate(m);
  };
  return (
    <>
      <ul className="pv-people">
        {d.members.map((m) => (
          <li key={m.id}>
            <Avatar id={m.id} name={m.name} photoVersion={m.photo_version} size={36} />
            <span className="pv-person"><strong>{m.name}</strong> <span className="muted">{m.email}</span></span>
            {d.can_manage && (
              <button className="btn btn-ghost btn-sm pv-remove" disabled={remove.isPending} onClick={() => askRemove(m)} aria-label={`Retirar ${m.name} da equipe`} title="Retirar da equipe">
                <UserMinus size={14} aria-hidden /> Retirar
              </button>
            )}
          </li>
        ))}
      </ul>
      {d.can_manage && addable.length > 0 && (
        <section className="pv-addable" aria-labelledby="pv-addable-h">
          <h3 id="pv-addable-h" className="pv-addable-h">Adicionar da {wsName}</h3>
          {addable.length > 5 && (
            <input className="input" type="search" placeholder="Buscar por nome ou e-mail" aria-label="Buscar pessoa da divisão" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          {shown.length === 0 ? <p className="muted">Ninguém com esse nome. Quem ainda não entrou no PROJETA pode ser convidado pela matrícula abaixo.</p> : (
            <ul className="pv-people pv-people-add">
              {shown.map((m) => (
                <li key={m.id}>
                  <Avatar id={m.id} name={m.name} photoVersion={m.photo_version} size={36} />
                  <span className="pv-person"><strong>{m.name}</strong> <span className="muted">{m.email}</span></span>
                  <button className="btn btn-line btn-sm" disabled={add.isPending} onClick={() => add.mutate(m)} aria-label={`Adicionar ${m.name} ao projeto`}>
                    <UserPlus size={14} aria-hidden /> Adicionar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {d.can_manage && <InviteByMatricula projectId={d.project.id} />}
    </>
  );
}

const REASON = { late: ["Atrasada", "alerta"], blocked: ["Bloqueada", "alerta"], soon: ["Vence logo", "warn"] } as const;

/** Linha enxuta dos cartões da visão geral: marcador à esquerda, título, responsável. */
function PvRow({ task, lead, onOpen }: { task: Task; lead: ReactNode; onOpen: (id: string) => void }) {
  return (
    <li>
      <button className="pv-row" onClick={() => onOpen(task.id)}>
        <span className="pv-row-lead">{lead}</span>
        <span className="pv-row-title">{task.is_milestone ? "◆ " : ""}{task.title}</span>
        {task.assignee_name && <span className="pv-row-meta">{task.assignee_name}</span>}
      </button>
    </li>
  );
}

/** Visão geral: o que está em risco, o que vem a seguir e o que é meu. Ficha, equipe e histórico
 * ficam nos botões do cabeçalho. */
function Overview({ d, tasks, onOpen, onGoSprints, onGoRisks }: { d: ProjectData; tasks: Task[]; onOpen: (id: string) => void; onGoSprints: () => void; onGoRisks: (riskId: string | null) => void }) {
  const { user } = useSession();
  const total = tasks.length;
  const done = d.stats.done ?? 0;
  const { pct, informed } = projectProgress({ progress: d.project.progress, task_count: total, done_count: done });
  const today = localToday();
  const risk = projectRisk(tasks, today);
  const mine = tasks
    .filter((t) => t.assignee_id === user.id && t.status !== "done")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const openByStatus = STATUSES.filter((s) => s !== "done" && (d.stats[s] ?? 0) > 0)
    .map((s) => `${d.stats[s]} ${STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");
  const kpis = [
    ["Atrasadas", risk.late, "alerta", "late"],
    ["Bloqueadas", risk.blocked, "alerta", "blocked"],
    ["Vencem em 7 dias", risk.dueSoon, "warn", "soon"],
  ] as const;
  const [kpiOpen, setKpiOpen] = useState<(typeof kpis)[number] | null>(null);
  return (
    <div className="pv-overview">
      <div className="pv-kpis">
        <section className="pv-kpi pv-kpi-progress" aria-label={`Progresso: ${pct}%`}>
          <span className="coord">Progresso{informed ? " informado" : ""}</span>
          <strong>{pct}%</strong>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do projeto"><span style={{ width: `${pct}%` }} /></div>
          <span className="pv-kpi-note">{done} de {total} tarefas concluídas{openByStatus && ` · ${openByStatus}`}</span>
        </section>
        {kpis.map((k) => {
          const [label, list, tone] = k;
          const n = list.length;
          // Com zero não há o que listar: fica como cartão estático.
          return n > 0 ? (
            <button key={label} type="button" className={`pv-kpi pv-kpi-btn ${tone}`} aria-label={`${label}: ${n}. Ver tarefas`} onClick={() => setKpiOpen(k)}>
              <span className="coord">{label}</span>
              <strong>{n}</strong>
            </button>
          ) : (
            <section key={label} className="pv-kpi zero" aria-label={`${label}: 0`}>
              <span className="coord">{label}</span>
              <strong>0</strong>
            </section>
          );
        })}
      </div>
      {kpiOpen && (
        <Dialog title={`${kpiOpen[0]} (${kpiOpen[1].length})`} onClose={() => setKpiOpen(null)} className="pv-dialog">
          <ul className="pv-rows">
            {kpiOpen[1].map((t) => (
              <PvRow
                key={t.id}
                task={t}
                onOpen={(id) => {
                  setKpiOpen(null);
                  onOpen(id);
                }}
                lead={<span className={`badge ${REASON[kpiOpen[3]][1]}`}>{t.due_date ? fmtDate(t.due_date) : "Sem prazo"}</span>}
              />
            ))}
          </ul>
        </Dialog>
      )}
      <div className="pv-cols">
        <section className="card pane">
          <h2>Precisa de atenção {risk.attention.length > 0 && <span className="badge alerta">{risk.attention.length}</span>}</h2>
          <div className="pane-body">
            {risk.attention.length === 0 ? <p className="muted">Nada atrasado, bloqueado ou vencendo nos próximos 7 dias.</p> : (
              <ul className="pv-rows">
                {risk.attention.map(({ task, reason }) => (
                  <PvRow key={task.id} task={task} onOpen={onOpen} lead={<span className={`badge ${REASON[reason][1]}`}>{REASON[reason][0]}{task.due_date ? ` · ${fmtDate(task.due_date)}` : ""}</span>} />
                ))}
              </ul>
            )}
          </div>
        </section>
        {/* Riscos registrados (aba Riscos) no lugar das próximas entregas: o que vence em 7 dias
            já aparece no indicador acima e em "Precisa de atenção". */}
        <RisksCard projectId={d.project.id} onOpen={onGoRisks} />
        <div className="pv-col">
          <section className="card pane">
            <h2>Minhas tarefas {mine.length > 0 && <span className="badge">{mine.length}</span>}</h2>
            <div className="pane-body">
              {mine.length === 0 ? <p className="muted">Nada em aberto com você neste projeto.</p> : (
                <ul className="pv-rows">
                  {mine.map((t) => (
                    <PvRow key={t.id} task={t} onOpen={onOpen} lead={<span className="pv-date">{t.due_date ? fmtDate(t.due_date) : "Sem prazo"}</span>} />
                  ))}
                </ul>
              )}
            </div>
          </section>
          <ActiveSprintCard projectId={d.project.id} onGo={onGoSprints} />
        </div>
      </div>
    </div>
  );
}

/** Filtro de sprint do Quadro e da Lista: "" = todas, "backlog" = sem sprint, ou o id da sprint.
 * Sem escolha da pessoa, o Quadro abre na sprint em andamento (o trabalho de agora). */
function useSprintFilter(projectId: string, preferActive: boolean) {
  const sprints = useSprints(projectId).data?.sprints ?? [];
  const [choice, setChoice] = useState<string | null>(null);
  const active = sprints.find((s) => s.status === "active");
  const value = choice ?? (preferActive && active ? active.id : "");
  const keep = (t: Task) => !value || (value === "backlog" ? !t.sprint_id : t.sprint_id === value);
  const select = sprints.length > 0 && (
    <select className="select grow" aria-label="Sprint" value={value} onChange={(e) => setChoice(e.target.value)}>
      <option value="">Todas as sprints e o backlog</option>
      <option value="backlog">Só o backlog (sem sprint)</option>
      {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "active" ? " (em andamento)" : s.status === "closed" ? " (encerrada)" : ""}</option>)}
    </select>
  );
  return { keep, select };
}

function Board({ projectId, tasks: all, canWrite, onOpen }: { projectId: string; tasks: Task[]; canWrite: boolean; onOpen: (id: string) => void }) {
  const update = useUpdateTask();
  const [over, setOver] = useState<Status | null>(null);
  const filter = useSprintFilter(projectId, true);
  const tasks = all.filter(filter.keep);
  const counts = subtaskCounts(all);
  const move = (t: Task, status: Status) => t.status !== status && update.mutate({ task: t, patch: { status } });
  return (
    <div className="pv-stack">
    {filter.select && <div className="pv-toolbar">{filter.select}</div>}
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
            <ul className="column-list">
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
              {col.length === 0 && <li className="muted column-empty">{canWrite ? "Arraste uma tarefa para cá." : "Vazio."}</li>}
            </ul>
          </section>
        );
      })}
    </div>
    </div>
  );
}

function ListView({ projectId, workspaceId, tasks, members, canWrite, onOpen }: { projectId: string; workspaceId: string; tasks: Task[]; members: Member[]; canWrite: boolean; onOpen: (id: string) => void }) {
  const sprint = useSprintFilter(projectId, false);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [text, setText] = useState("");
  const shown = tasks.filter(
    (t) =>
      (!status || t.status === status) &&
      (!priority || t.priority === priority) &&
      (!assignee || (assignee === "none" ? !t.assignee_id : t.assignee_id === assignee)) &&
      (!text || t.title.toLowerCase().includes(text.toLowerCase())) &&
      sprint.keep(t),
  );
  const filtering = shown.length !== tasks.length || !!(status || priority || assignee || text);
  return (
    <div className="pv-stack">
      <div className="pv-toolbar" role="search" aria-label="Filtrar tarefas">
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
        {sprint.select}
      </div>
      <div className="pv-scroll">
        {canWrite && shown.length > 1 && <p className="coord dep-tip"><Link2 size={12} aria-hidden /> Arraste uma tarefa sobre a que só pode começar depois dela, ou sobre o título de uma fase para movê-la.</p>}
        {filtering && shown.length === 0 ? (
          <Empty title="Nenhuma tarefa com esses filtros">Limpe os filtros para ver todas.</Empty>
        ) : (
          <PhaseList projectId={projectId} workspaceId={workspaceId} tasks={tasks} shown={shown} filtering={filtering} canWrite={canWrite} onOpen={onOpen} />
        )}
      </div>
      <p className="coord pv-count">{shown.length} de {tasks.length} tarefas</p>
    </div>
  );
}
