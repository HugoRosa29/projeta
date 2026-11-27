// Relatório de andamento do projeto: junta o que as abas já mostram numa página para apresentar.
// Tudo vem de leituras que o servidor já recortou pelo acesso da pessoa; aqui só se resume.
import { track, type Pace } from "./esteira";
import type { Health, PortfolioRow } from "./formal";
import { isActive, sortRisks, summarizeRisks, type Risk, type RiskSummary } from "./risk";
import type { Sprint } from "./sprint";
import { STATUSES, type Project, type Status, type Task } from "./types";
import { addDays, projectProgress, projectRisk } from "./work";

/** Nota de acompanhamento (GET /projects/{id}/status-notes), a mais recente primeiro. */
export interface StatusNote {
  id: string;
  state: Health;
  delay_reason: string;
  done: string;
  pending: string;
  blockers: string;
  author_name: string;
  created_at: string;
}

export interface PhaseLine {
  name: string;
  total: number;
  done: number;
  pct: number;
}

export interface ReportInput {
  project: Project;
  tasks: Task[];
  risks: Risk[];
  sprints: Sprint[];
  notes: StatusNote[];
  /** Ordem das fases do projeto (aba Lista); fases só usadas nas tarefas vão ao fim. */
  phaseOrder: string[];
  today: string;
  now: Date;
}

export interface Report {
  progress: { pct: number; informed: boolean; done: number; total: number };
  byStatus: Record<Status, number>;
  schedule: { start: string | null; end: string | null; daysLeft: number | null; gap: number | null; pace: Pace };
  late: Task[];
  blocked: Task[];
  /** Abertas que vencem nos próximos `UPCOMING_DAYS` dias, por prazo. */
  upcoming: Task[];
  /** Concluídas nos últimos `RECENT_DAYS` dias (pela última alteração), as mais recentes primeiro. */
  recentDone: Task[];
  milestones: Task[];
  phases: PhaseLine[];
  /** Mais graves primeiro, até `TOP_RISKS`; o resumo traz os ativos e as contagens. */
  risks: { summary: RiskSummary; top: Risk[] };
  sprint: Sprint | null;
  note: StatusNote | null;
}

export const UPCOMING_DAYS = 30;
export const RECENT_DAYS = 14;
const TOP_RISKS = 5;
const NO_PHASE = "Sem fase";

const byDue = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");

export function buildReport({ project, tasks, risks, sprints, notes, phaseOrder, today, now }: ReportInput): Report {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const t of tasks) byStatus[t.status] += 1;
  const total = tasks.length;
  const done = byStatus.done;
  const { pct, informed } = projectProgress({ progress: project.progress, task_count: total, done_count: done });

  // Mesma regra de prazo do Portfólio (campo do portfólio → tarefas), a partir dos dados do projeto.
  const starts = tasks.map((t) => t.start_date ?? t.due_date).filter((d): d is string => !!d).sort();
  const dues = tasks.map((t) => t.due_date).filter((d): d is string => !!d).sort();
  const row: PortfolioRow = {
    id: project.id,
    name: project.name,
    phase: project.phase ?? null,
    approach: project.approach ?? null,
    sei_process: project.sei_process ?? null,
    task_count: total,
    done_count: done,
    overdue_count: 0,
    blocked_count: byStatus.blocked,
    health: "on_track",
    note_stale: false,
    last_note_at: null,
    attributes: project.attributes,
    progress: project.progress,
    first_due: starts[0] ?? null,
    last_due: dues[dues.length - 1] ?? null,
  };
  const tr = track(row, today);

  const risk = projectRisk(tasks, today);
  const limit = addDays(today, UPCOMING_DAYS);
  const open = tasks.filter((t) => t.status !== "done");
  const upcoming = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= limit).sort(byDue);
  const since = addDays(today, -RECENT_DAYS);
  const recentDone = tasks
    .filter((t) => t.status === "done" && t.updated_at.slice(0, 10) >= since)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const milestones = tasks.filter((t) => t.is_milestone).sort(byDue);

  const counts = new Map<string, { total: number; done: number }>();
  for (const name of phaseOrder) counts.set(name, { total: 0, done: 0 });
  for (const t of tasks) {
    const key = t.phase || NO_PHASE;
    const c = counts.get(key) ?? { total: 0, done: 0 };
    c.total += 1;
    if (t.status === "done") c.done += 1;
    counts.set(key, c);
  }
  const phases = [...counts]
    .filter(([, c]) => c.total > 0)
    .sort(([a], [b]) => Number(a === NO_PHASE) - Number(b === NO_PHASE))
    .map(([name, c]) => ({ name, ...c, pct: Math.round((c.done / c.total) * 100) }));
  // Uma linha só, "Sem fase", não diz nada além do progresso geral.
  const phaseLines = phases.length === 1 && phases[0].name === NO_PHASE ? [] : phases;

  return {
    progress: { pct, informed, done, total },
    byStatus,
    schedule: { start: tr.start, end: tr.end, daysLeft: tr.daysLeft, gap: tr.gap, pace: tr.pace },
    late: risk.late,
    blocked: risk.blocked,
    upcoming,
    recentDone,
    milestones,
    phases: phaseLines,
    risks: { summary: summarizeRisks(risks, today, now), top: sortRisks(risks.filter(isActive)).slice(0, TOP_RISKS) },
    sprint: sprints.find((s) => s.status === "active") ?? null,
    note: notes[0] ?? null,
  };
}

/** "27 de novembro de 2026": data por extenso para a capa. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
