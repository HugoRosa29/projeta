import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ErrorBox, Loading, Logo } from "../../components/ui";
import { PACE_LABEL, daysBetween, type Pace } from "../../domain/esteira";
import { APPROACH_LABEL, HEALTH_LABEL, PHASE_LABEL, type Health } from "../../domain/formal";
import { RECENT_DAYS, UPCOMING_DAYS, buildReport, longDate, type Report, type StatusNote } from "../../domain/report";
import { CATEGORY_LABEL, LEVELS, LEVEL_LABEL, RISK_STATUS_LABEL, STRATEGY_LABEL, riskCode, type Risk } from "../../domain/risk";
import { daysLeftLabel, paceOf, type SprintsData } from "../../domain/sprint";
import { STATUSES, STATUS_LABEL, fmtDate, type Member, type Project, type Status, type Task } from "../../domain/types";
import { localToday } from "../../domain/work";
import { useSession } from "../../app/session";
import { api } from "../../services/api";
import type { PhasesData } from "./phases";
import { LevelBadge } from "./RisksPanel";

interface ProjectData {
  project: Project;
  members: Member[];
}

/** Linhas por tabela: o relatório é para ler em poucos minutos; o resto fica no próprio projeto. */
const MAX_ROWS = 10;

const PACE_TONE: Record<Pace, "ok" | "warn" | "bad" | "none"> = { late: "bad", behind: "warn", soon: "warn", ok: "ok", none: "none" };
const HEALTH_TONE: Record<Health, "ok" | "warn" | "bad"> = { on_track: "ok", at_risk: "warn", late: "bad" };
const STATUS_TONE: Record<Status, string> = { done: "var(--chart-ok)", doing: "var(--chart-info)", todo: "var(--rp-todo)", blocked: "var(--chart-bad)" };

/** Relatório de andamento do projeto, numa folha A4 para imprimir ou salvar em PDF e apresentar.
 * Usa as mesmas leituras das abas do projeto: o servidor recorta cada uma pelo acesso da pessoa. */
export function ProjectReport() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectData>(`/projects/${id}`) });
  const tasks = useQuery({ queryKey: ["tasks", "project", id], queryFn: () => api.get<{ tasks: Task[] }>(`/projects/${id}/tasks`) });
  const risks = useQuery({ queryKey: ["risks", id], queryFn: () => api.get<{ risks: Risk[] }>(`/projects/${id}/risks`) });
  const sprints = useQuery({ queryKey: ["sprints", id], queryFn: () => api.get<SprintsData>(`/projects/${id}/sprints`) });
  const notes = useQuery({ queryKey: ["notes", id], queryFn: () => api.get<{ notes: StatusNote[] }>(`/projects/${id}/status-notes`) });
  const phases = useQuery({ queryKey: ["phases", id], queryFn: () => api.get<PhasesData>(`/projects/${id}/phases`) });
  const all = [project, tasks, risks, sprints, notes, phases];

  const name = project.data?.project.name;
  const today = localToday();
  // O título vira o nome sugerido do PDF ao salvar.
  useEffect(() => {
    if (!name) return;
    const before = document.title;
    document.title = `Relatório - ${name} - ${fmtDate(today).replaceAll("/", "-")}`;
    return () => {
      document.title = before;
    };
  }, [name, today]);

  const failed = all.find((q) => q.isError);
  if (failed) return <div className="rp-page"><ErrorBox error={failed.error} onRetry={() => all.forEach((q) => q.isError && q.refetch())} /></div>;
  if (all.some((q) => q.isLoading)) return <div className="rp-page"><Loading label="Montando o relatório…" /></div>;

  const p = project.data!.project;
  const report = buildReport({
    project: p,
    tasks: tasks.data!.tasks,
    risks: risks.data!.risks,
    sprints: sprints.data!.sprints,
    notes: notes.data!.notes,
    phaseOrder: phases.data!.phases.map((ph) => ph.name),
    today,
    now: new Date(),
  });

  return (
    <div className="rp-page">
      <div className="rp-toolbar" role="toolbar" aria-label="Ações do relatório">
        <Link to={`/projetos/${id}`} className="btn btn-ghost btn-sm"><ArrowLeft size={16} aria-hidden /> Voltar ao projeto</Link>
        <span className="grow" />
        <span className="muted rp-tip">Na janela de impressão, escolha “Salvar como PDF” para gerar o arquivo.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Printer size={16} aria-hidden /> Imprimir ou salvar PDF
        </button>
      </div>
      <ReportSheet project={p} members={project.data!.members} report={report} today={today} author={user.name} />
    </div>
  );
}

export function ReportSheet({ project: p, members, report: r, today, author }: { project: Project; members: Member[]; report: Report; today: string; author: string }) {
  const facts: [string, ReactNode][] = [
    ["Responsável", p.responsible],
    ["Demandante", p.requester],
    ["Fase", p.phase ? PHASE_LABEL[p.phase] : null],
    ["Abordagem", p.approach ? APPROACH_LABEL[p.approach] : null],
    ["Processo SEI", p.sei_process],
    ["Referência", p.external_ref],
    ["Origem", p.shared_from],
    ["Equipe", members.length ? `${members.length} pessoa${members.length > 1 ? "s" : ""}` : null],
  ];
  const s = r.schedule;
  const risksHigh = r.risks.summary.byLevel.critical + r.risks.summary.byLevel.high;
  return (
    <article className="rp-sheet" aria-label={`Relatório de andamento: ${p.name}`}>
      <header className="rp-head">
        <div className="rp-brand">
          <Logo height={26} />
          <span className="rp-issued">Emitido em {longDate(today)}<br />por {author}</span>
        </div>
        <p className="eyebrow">Relatório de andamento do projeto</p>
        <h1>{p.name}{p.status === "archived" && <span className="rp-tag">Arquivado</span>}</h1>
        {p.summary && <p className="rp-summary">{p.summary}</p>}
        <dl className="rp-facts">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </header>

      <section className="rp-kpis" aria-label="Indicadores">
        <div className="rp-kpi rp-kpi-main">
          <span className="rp-label">Progresso{r.progress.informed ? " informado" : ""}</span>
          <strong>{r.progress.pct}%</strong>
          <Bar pct={r.progress.pct} label="Progresso do projeto" />
          <span className="rp-note">{r.progress.done} de {r.progress.total} tarefas concluídas</span>
        </div>
        <div className={`rp-kpi tone-${PACE_TONE[s.pace]}`}>
          <span className="rp-label">Prazo</span>
          <strong className="rp-kpi-text">{PACE_LABEL[s.pace]}</strong>
          <span className="rp-note">{s.end ? `Término previsto ${fmtDate(s.end)}${s.daysLeft !== null ? ` · ${daysText(s.daysLeft)}` : ""}` : "Sem data de término"}</span>
        </div>
        <div className={`rp-kpi ${r.late.length ? "tone-bad" : ""}`}>
          <span className="rp-label">Tarefas atrasadas</span>
          <strong>{r.late.length}</strong>
          <span className="rp-note">{r.blocked.length} bloqueada{r.blocked.length === 1 ? "" : "s"}</span>
        </div>
        <div className={`rp-kpi ${risksHigh ? "tone-warn" : ""}`}>
          <span className="rp-label">Riscos ativos</span>
          <strong>{r.risks.summary.active.length}</strong>
          <span className="rp-note">{risksHigh} crítico{risksHigh === 1 ? "" : "s"} ou alto{risksHigh === 1 ? "" : "s"}</span>
        </div>
      </section>

      {s.start && s.end && <ScheduleBar start={s.start} end={s.end} today={today} pct={r.progress.pct} />}

      {r.note && <NoteBlock note={r.note} />}

      <div className="rp-grid">
        <Section title="Tarefas por estado">
          {r.progress.total === 0 ? <p className="rp-empty">Nenhuma tarefa cadastrada.</p> : <StatusBar byStatus={r.byStatus} total={r.progress.total} />}
        </Section>
        {r.sprint ? (
          <Section title="Sprint em andamento">
            <SprintBlock sprint={r.sprint} />
          </Section>
        ) : r.phases.length > 0 ? (
          <Section title="Andamento por fase"><PhaseBlock phases={r.phases} /></Section>
        ) : null}
      </div>
      {r.sprint && r.phases.length > 0 && <Section title="Andamento por fase"><PhaseBlock phases={r.phases} /></Section>}

      <Section title="Pontos de atenção" count={unique([...r.late, ...r.blocked]).length}>
        <TaskTable
          tasks={unique([...r.late, ...r.blocked])}
          empty="Nenhuma tarefa atrasada ou bloqueada."
          lead={(t) => (t.status === "blocked" ? <span className="rp-tag bad">Bloqueada</span> : <span className="rp-tag bad">Atrasada</span>)}
          leadTitle="Motivo"
        />
      </Section>

      <div className="rp-grid">
        <Section title={`Próximas entregas (${UPCOMING_DAYS} dias)`} count={r.upcoming.length}>
          <TaskTable tasks={r.upcoming} empty={`Nada vencendo nos próximos ${UPCOMING_DAYS} dias.`} compact />
        </Section>
        <Section title={`Concluídas nos últimos ${RECENT_DAYS} dias`} count={r.recentDone.length}>
          <TaskTable tasks={r.recentDone} empty="Nenhuma tarefa concluída no período." compact doneDate />
        </Section>
      </div>

      {r.milestones.length > 0 && (
        <Section title="Marcos" count={r.milestones.length}>
          <ul className="rp-milestones">
            {r.milestones.map((m) => (
              <li key={m.id} className={m.status === "done" ? "done" : m.due_date && m.due_date < today ? "late" : ""}>
                <span className="rp-diamond" aria-hidden>◆</span>
                <span className="rp-ms-title">{m.title}</span>
                <span className="rp-ms-date">{m.due_date ? fmtDate(m.due_date) : "Sem data"}</span>
                <span className="rp-ms-state">{m.status === "done" ? "Concluído" : m.due_date && m.due_date < today ? "Atrasado" : "Previsto"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Riscos principais" count={r.risks.summary.active.length}>
        {r.risks.summary.active.length === 0 ? <p className="rp-empty">Nenhum risco ativo registrado.</p> : <RiskBlock report={r} />}
      </Section>

      {(p.attributes?.length ?? 0) > 0 && (
        <Section title="Campos do portfólio">
          <dl className="rp-facts rp-attrs">
            {p.attributes!.map((a) => <div key={a.name}><dt>{a.name}</dt><dd>{a.value}</dd></div>)}
          </dl>
        </Section>
      )}

      <footer className="rp-foot">
        <span>Projet.AI · Relatório de andamento · {p.name}</span>
        <span>Dados de {fmtDate(today)}; o projeto pode ter mudado depois.</span>
      </footer>
    </article>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rp-section">
      <h2>{title}{count !== undefined && count > 0 && <span className="rp-count">{count}</span>}</h2>
      {children}
    </section>
  );
}

function Bar({ pct, label, tone }: { pct: number; label: string; tone?: string }) {
  return (
    <div className="rp-bar" role="img" aria-label={`${label}: ${pct}%`}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(tone ? { background: tone } : {}) }} />
    </div>
  );
}

/** Linha do tempo do início ao término: o trecho até hoje e o % concluído lado a lado. */
function ScheduleBar({ start, end, today, pct }: { start: string; end: string; today: string; pct: number }) {
  const span = Math.max(1, daysBetween(start, end));
  const elapsed = Math.round(Math.max(0, Math.min(1, daysBetween(start, today) / span)) * 100);
  return (
    <section className="rp-schedule" aria-label={`Cronograma: ${elapsed}% do prazo decorrido, ${pct}% concluído`}>
      <div className="rp-sch-dates">
        <span><span className="rp-label">Início</span> {fmtDate(start)}</span>
        <span><span className="rp-label">Término</span> {fmtDate(end)}</span>
      </div>
      <div className="rp-sch-track">
        <span className="rp-sch-time" style={{ width: `${elapsed}%` }} />
        <span className="rp-sch-done" style={{ width: `${Math.min(100, pct)}%` }} />
        {elapsed > 0 && elapsed < 100 && <span className="rp-sch-today" style={{ left: `${elapsed}%` }}><span>Hoje</span></span>}
      </div>
      <div className="rp-sch-legend">
        <span><i className="sw-time" /> Prazo decorrido {elapsed}%</span>
        <span><i className="sw-done" /> Concluído {pct}%</span>
      </div>
    </section>
  );
}

function NoteBlock({ note }: { note: StatusNote }) {
  const parts: [string, string][] = [
    ["Entregue", note.done],
    ["Pendente", note.pending],
    ["Impedimentos", note.blockers],
    ["Motivo do atraso", note.delay_reason],
  ];
  return (
    <section className={`rp-note-block tone-${HEALTH_TONE[note.state]}`}>
      <h2>
        Última nota de acompanhamento <span className={`rp-tag ${HEALTH_TONE[note.state]}`}>{HEALTH_LABEL[note.state]}</span>
      </h2>
      <p className="rp-note">{note.author_name}, {new Date(note.created_at).toLocaleDateString("pt-BR")}</p>
      <dl className="rp-note-parts">
        {parts.filter(([, v]) => v.trim()).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}

function StatusBar({ byStatus, total }: { byStatus: Record<Status, number>; total: number }) {
  const order: Status[] = ["done", "doing", "todo", "blocked"];
  return (
    <>
      <div className="rp-stack" role="img" aria-label={order.map((s) => `${STATUS_LABEL[s]}: ${byStatus[s]}`).join(", ")}>
        {order.filter((s) => byStatus[s] > 0).map((s) => <span key={s} style={{ flexGrow: byStatus[s], background: STATUS_TONE[s] }} />)}
      </div>
      <ul className="rp-legend">
        {STATUSES.map((s) => (
          <li key={s}><i style={{ background: STATUS_TONE[s] }} />{STATUS_LABEL[s]} <strong>{byStatus[s]}</strong> <span className="muted">({Math.round((byStatus[s] / total) * 100)}%)</span></li>
        ))}
      </ul>
    </>
  );
}

function PhaseBlock({ phases }: { phases: Report["phases"] }) {
  return (
    <ul className="rp-phases">
      {phases.map((ph) => (
        <li key={ph.name}>
          <span className="rp-ph-name">{ph.name}</span>
          <Bar pct={ph.pct} label={ph.name} />
          <span className="rp-ph-n">{ph.done}/{ph.total}</span>
        </li>
      ))}
    </ul>
  );
}

function SprintBlock({ sprint: s }: { sprint: NonNullable<Report["sprint"]> }) {
  const pace = paceOf(s);
  return (
    <div className="rp-sprint">
      <p><strong>{s.name}</strong> · {fmtDate(s.start_date)} a {fmtDate(s.end_date)} · {daysLeftLabel(s)}</p>
      {s.goal && <p className="rp-goal">Meta: {s.goal}</p>}
      <Bar pct={pace.done} label="Concluído na sprint" tone={pace.behind ? "var(--chart-warn)" : undefined} />
      <p className="rp-note">{s.stats.done} de {s.stats.tasks} tarefas concluídas · {pace.time}% do tempo da sprint decorrido{pace.behind ? " · ritmo abaixo do previsto" : ""}</p>
    </div>
  );
}

function TaskTable({ tasks, empty, lead, leadTitle, compact, doneDate }: {
  tasks: Task[];
  empty: string;
  lead?: (t: Task) => ReactNode;
  leadTitle?: string;
  compact?: boolean;
  /** Mostra a data da conclusão (última alteração) em vez do prazo. */
  doneDate?: boolean;
}) {
  if (tasks.length === 0) return <p className="rp-empty">{empty}</p>;
  const shown = tasks.slice(0, MAX_ROWS);
  return (
    <>
      <table className={`rp-table ${compact ? "compact" : ""}`}>
        <thead>
          <tr>
            {lead && <th scope="col">{leadTitle}</th>}
            <th scope="col">Tarefa</th>
            <th scope="col">Responsável</th>
            <th scope="col" className="num">{doneDate ? "Concluída" : "Prazo"}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.id}>
              {lead && <td>{lead(t)}</td>}
              <td>{t.is_milestone ? "◆ " : ""}{t.title}{t.parent_title && <span className="rp-parent"> · {t.parent_title}</span>}</td>
              <td>{t.assignee_name ?? "—"}</td>
              <td className="num">{doneDate ? fmtDate(t.updated_at.slice(0, 10)) : t.due_date ? fmtDate(t.due_date) : "Sem prazo"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length > shown.length && <p className="rp-more">+ {tasks.length - shown.length} outras no projeto</p>}
    </>
  );
}

function RiskBlock({ report: r }: { report: Report }) {
  const lv = r.risks.summary.byLevel;
  return (
    <>
      <ul className="rp-levels">
        {LEVELS.map((l) => <li key={l} className={`lv-${l}`}><strong>{lv[l]}</strong> {LEVEL_LABEL[l].toLowerCase()}{lv[l] === 1 ? "" : "s"}</li>)}
      </ul>
      <table className="rp-table">
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Risco</th>
            <th scope="col">Nível</th>
            <th scope="col">Resposta</th>
            <th scope="col">Responsável</th>
          </tr>
        </thead>
        <tbody>
          {r.risks.top.map((k) => (
            <tr key={k.id}>
              <td className="rp-mono">{riskCode(k.number)}</td>
              <td>{k.title}<span className="rp-parent"> · {CATEGORY_LABEL[k.category]} · {RISK_STATUS_LABEL[k.status]}</span></td>
              <td><LevelBadge score={k.score} /></td>
              <td>{k.strategy ? STRATEGY_LABEL[k.strategy] : <span className="rp-tag warn">Sem estratégia</span>}</td>
              <td>{k.owner_name ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.risks.summary.active.length > r.risks.top.length && <p className="rp-more">+ {r.risks.summary.active.length - r.risks.top.length} outros riscos ativos na aba Riscos</p>}
    </>
  );
}

function unique(list: Task[]): Task[] {
  const seen = new Set<string>();
  return list.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
}

function daysText(n: number): string {
  if (n === 0) return "termina hoje";
  if (n < 0) return `vencido há ${-n} dia${n === -1 ? "" : "s"}`;
  return `falta${n === 1 ? "" : "m"} ${n} dia${n === 1 ? "" : "s"}`;
}
