import type { Task } from "./types";

/** Linha de base salva no projeto (resumo, sem as tarefas). Número 0 = inicial. */
export interface Baseline {
  id: string;
  number: number;
  name: string;
  note: string;
  created_at: string;
  created_by_name: string | null;
  task_count: number;
  start: string | null;
  finish: string | null;
}

/** Datas planejadas de uma tarefa naquela linha de base. */
export interface BaselineTask {
  task_id: string;
  title: string;
  phase: string | null;
  is_milestone: boolean;
  start_date: string | null;
  due_date: string;
}

export interface BaselineDetail extends Baseline {
  tasks: BaselineTask[];
}

/** Por que uma tarefa planejada não aparece mais no cronograma. */
export type Missing = BaselineTask & { reason: "removida" | "sem prazo" };

export interface Comparison {
  planned: Map<string, BaselineTask>;
  /** Dias de desvio no término (positivo = termina depois do planejado); nulo = não estava no plano. */
  finishDelta: (t: Task) => number | null;
  late: Task[];
  early: Task[];
  onPlan: Task[];
  added: Task[];
  missing: Missing[];
  plannedFinish: string | null;
  currentFinish: string | null;
  /** Desvio do término do projeto (última entrega planejada × última entrega atual). */
  projectDelta: number | null;
}

const DAY = 86400000;
const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
/** Dias de calendário de `from` até `to` (datas sem fuso). */
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

/** Início planejado para desenhar: sem início, a barra-fantasma ocupa só o dia do prazo. */
export const plannedStart = (b: BaselineTask) => b.start_date ?? b.due_date;

/** Compara as tarefas atuais com a linha de base. Só entram tarefas com prazo (como no cronograma). */
export function compareBaseline(tasks: Task[], items: BaselineTask[]): Comparison {
  const planned = new Map(items.map((b) => [b.task_id, b]));
  const current = new Map(tasks.map((t) => [t.id, t]));
  const dated = tasks.filter((t) => t.due_date);
  const finishDelta = (t: Task) => {
    const b = planned.get(t.id);
    return b && t.due_date ? daysBetween(b.due_date, t.due_date) : null;
  };
  const late: Task[] = [];
  const early: Task[] = [];
  const onPlan: Task[] = [];
  const added: Task[] = [];
  for (const t of dated) {
    const d = finishDelta(t);
    if (d === null) added.push(t);
    else if (d > 0) late.push(t);
    else if (d < 0) early.push(t);
    else onPlan.push(t);
  }
  const missing: Missing[] = items
    .filter((b) => !current.get(b.task_id)?.due_date)
    .map((b) => ({ ...b, reason: current.has(b.task_id) ? "sem prazo" : "removida" }));
  const plannedFinish = items.map((b) => b.due_date).sort().at(-1) ?? null;
  const currentFinish = dated.map((t) => t.due_date!).sort().at(-1) ?? null;
  return {
    planned,
    finishDelta,
    late: late.sort((a, b) => finishDelta(b)! - finishDelta(a)!),
    early,
    onPlan,
    added,
    missing,
    plannedFinish,
    currentFinish,
    projectDelta: plannedFinish && currentFinish ? daysBetween(plannedFinish, currentFinish) : null,
  };
}

/** "+3 d", "−2 d", "no plano": rótulo curto do desvio. */
export function deltaLabel(d: number): string {
  if (d === 0) return "no plano";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} d`;
}

/** Frase para leitores de tela e dicas: "3 dias depois do planejado". */
export function deltaText(d: number): string {
  if (d === 0) return "no prazo planejado";
  const n = Math.abs(d);
  return `${n} ${n === 1 ? "dia" : "dias"} ${d > 0 ? "depois" : "antes"} do planejado`;
}

/** "LB 1 · Plano aprovado" (a inicial é "LB 0 · Linha de base inicial"). */
export const baselineLabel = (b: Pick<Baseline, "number" | "name">) => `LB ${b.number} · ${b.name}`;
