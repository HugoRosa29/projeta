// Regras de apresentação das sprints (ADR 0006). O servidor decide acesso, datas e encerramento;
// aqui só se organiza e se explica o que ele devolve.
import type { SprintStatus, Task } from "./types";

export interface SprintStats {
  tasks: number;
  done: number;
  minutes: number;
  done_minutes: number;
  unestimated: number;
}
export interface SprintLoad {
  assignee_id: string | null;
  name: string | null;
  tasks: number;
  minutes: number;
  open_minutes: number;
}
interface Bucket {
  tasks: number;
  minutes: number;
}
/** Relatório gravado no encerramento (não muda depois). */
export interface SprintSummary {
  goal: string;
  planned_end: string;
  committed: Bucket;
  added: Bucket;
  removed: number;
  done: Bucket;
  not_done: Bucket;
  unestimated: number;
  carried: { to: string | null; items: { id: string; title: string }[] };
}
export interface Sprint {
  id: string;
  project_id: string;
  number: number;
  name: string;
  goal: string;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  capacity_minutes: number | null;
  summary: SprintSummary | null;
  version: number;
  days_total: number;
  days_elapsed: number;
  days_left: number;
  overdue: boolean;
  stats: SprintStats;
  load: SprintLoad[];
}
export interface SprintsData {
  sprints: Sprint[];
  backlog_open: number;
  today: string;
  can_manage: boolean;
  can_write: boolean;
}

export const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  planned: "Planejada",
  active: "Em andamento",
  closed: "Encerrada",
};

/** "1h30", "2h", "45min": a tela fala em horas; o servidor guarda minutos. */
export function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Ativa primeiro, depois as planejadas pela data; encerradas por último, a mais recente antes. */
export function groupSprints(list: Sprint[]): { open: Sprint[]; closed: Sprint[] } {
  const open = list.filter((s) => s.status !== "closed").sort((a, b) => (a.status === "active" ? -1 : b.status === "active" ? 1 : a.start_date.localeCompare(b.start_date)));
  const closed = list.filter((s) => s.status === "closed").sort((a, b) => b.start_date.localeCompare(a.start_date));
  return { open, closed };
}

export type CapacityState = "none" | "ok" | "tight" | "over";

/** Planejamento pela capacidade (Cohn): horas estimadas contra as horas disponíveis. Acima de
 * 85% é "no limite" (sobra pouco para imprevistos); acima de 100% a sprint não cabe. */
export function capacityOf(s: Pick<Sprint, "capacity_minutes" | "stats">): { pct: number; state: CapacityState } {
  if (!s.capacity_minutes) return { pct: 0, state: "none" };
  const pct = Math.round((s.stats.minutes / s.capacity_minutes) * 100);
  return { pct, state: pct > 100 ? "over" : pct > 85 ? "tight" : "ok" };
}

/** Andamento contra o calendário: concluído (por tarefas) e tempo decorrido, em %. */
export function paceOf(s: Pick<Sprint, "stats" | "days_elapsed" | "days_total">): { done: number; time: number; behind: boolean } {
  const done = s.stats.tasks ? Math.round((s.stats.done / s.stats.tasks) * 100) : 0;
  const time = s.days_total ? Math.round((s.days_elapsed / s.days_total) * 100) : 0;
  // Mesmo critério do ritmo dos OKRs (ADR 0005): o tempo passa o concluído em mais de 25 pontos.
  return { done, time, behind: s.stats.tasks > 0 && time - done > 25 };
}

export function daysLeftLabel(s: Pick<Sprint, "status" | "days_left" | "overdue" | "days_elapsed">): string {
  if (s.overdue) return "Terminou — falta encerrar";
  if (s.status === "planned" && s.days_elapsed === 0) return "Ainda não começou";
  if (s.days_left === 0) return "Último dia";
  return s.days_left === 1 ? "Falta 1 dia" : `Faltam ${s.days_left} dias`;
}

/** Entrega da sprint encerrada: concluído sobre o que esteve nela (comprometido + adicionado − retirado). */
export function deliveryOf(sum: SprintSummary): { pct: number; scope: number } {
  const scope = sum.committed.tasks + sum.added.tasks - sum.removed;
  return { pct: scope > 0 ? Math.round((sum.done.tasks / scope) * 100) : 0, scope };
}

/** Tarefas principais da sprint (ou do backlog, com `null`), na ordem de prioridade do backlog. */
export function tasksIn(tasks: Task[], sprintId: string | null, opts: { includeDone?: boolean } = {}): Task[] {
  return tasks
    .filter((t) => !t.parent_id && (t.sprint_id ?? null) === sprintId && (opts.includeDone || sprintId !== null || t.status !== "done"))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Nova posição para pôr `moving` logo antes de `before` (ou no fim, sem `before`): o ponto médio
 * entre vizinhos, como a coluna `position` (double) permite, sem renumerar a lista toda. */
export function positionBetween(list: Pick<Task, "id" | "position">[], movingId: string, beforeId: string | null): number {
  const rest = list.filter((t) => t.id !== movingId);
  const pos = (t: Pick<Task, "position">) => t.position ?? 0;
  if (!rest.length) return 1;
  if (beforeId === null) return pos(rest[rest.length - 1]) + 1;
  const i = rest.findIndex((t) => t.id === beforeId);
  if (i <= 0) return pos(rest[0]) - 1;
  return (pos(rest[i - 1]) + pos(rest[i])) / 2;
}
