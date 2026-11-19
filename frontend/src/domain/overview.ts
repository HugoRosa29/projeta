// Agregações do panorama da home, a partir das linhas de GET /portfolio. O recorte de acesso já
// veio do servidor; aqui só se soma e se ordena o que a pessoa pode ver.
import { PHASE_LABEL, type Health, type Phase, type PortfolioRow } from "./formal";
import { attributeValue, projectProgress } from "./work";

export const HEALTH_ORDER: Health[] = ["on_track", "at_risk", "late"];

export type TaskState = "done" | "doing" | "todo" | "blocked";
export const TASK_STATE_ORDER: TaskState[] = ["done", "doing", "todo", "blocked"];

/** Recorte escolhido nos filtros do panorama. Campo com valor vazio = "tem o campo preenchido". */
export interface OverviewFilter {
  health: Health | null;
  field: string;
  value: string;
}
export const NO_FILTER: OverviewFilter = { health: null, field: "", value: "" };

export function byField(rows: PortfolioRow[], field: string, value: string): PortfolioRow[] {
  if (!field) return rows;
  return rows.filter((r) => {
    const v = attributeValue(r.attributes, field);
    return value ? v === value : v !== undefined;
  });
}

export function applyFilter(rows: PortfolioRow[], f: OverviewFilter): PortfolioRow[] {
  const sliced = byField(rows, f.field, f.value);
  return f.health ? sliced.filter((r) => r.health === f.health) : sliced;
}

export interface Summary {
  projects: number;
  /** Média simples do % de cada projeto (informado ou calculado pelas tarefas). */
  avgProgress: number;
  tasks: number;
  open: number;
  overdue: number;
  blocked: number;
  health: Record<Health, number>;
  states: Record<TaskState, number>;
}

export function summarize(rows: PortfolioRow[]): Summary {
  const health: Record<Health, number> = { on_track: 0, at_risk: 0, late: 0 };
  const states: Record<TaskState, number> = { done: 0, doing: 0, todo: 0, blocked: 0 };
  let pct = 0;
  let tasks = 0;
  let overdue = 0;
  for (const r of rows) {
    health[r.health] += 1;
    pct += projectProgress(r).pct;
    tasks += r.task_count;
    overdue += r.overdue_count;
    const doing = r.doing_count ?? 0;
    states.done += r.done_count;
    states.doing += doing;
    states.blocked += r.blocked_count;
    // "A fazer" é o resto: o servidor só conta os demais estados.
    states.todo += Math.max(0, r.task_count - r.done_count - doing - r.blocked_count);
  }
  return {
    projects: rows.length,
    avgProgress: rows.length ? Math.round(pct / rows.length) : 0,
    tasks,
    open: tasks - states.done,
    overdue,
    blocked: states.blocked,
    health,
    states,
  };
}

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Rota do projeto, quando a barra é um projeto. */
  to?: string;
  /** Texto extra para o detalhe ao passar o mouse. */
  detail?: string;
}

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "pt-BR");

export function progressBars(rows: PortfolioRow[]): Bar[] {
  return rows
    .map((r) => {
      const { pct, informed } = projectProgress(r);
      return {
        key: r.id,
        label: r.name,
        value: pct,
        to: `/projetos/${r.id}`,
        detail: `${informed ? "% informado · " : ""}${r.done_count} de ${r.task_count} tarefas concluídas`,
      };
    })
    .sort((a, b) => b.value - a.value || byName(a, b));
}

export function overdueBars(rows: PortfolioRow[]): Bar[] {
  return rows
    .filter((r) => r.overdue_count > 0)
    .map((r) => ({ key: r.id, label: r.name, value: r.overdue_count, to: `/projetos/${r.id}` }))
    .sort((a, b) => b.value - a.value || byName(a, b));
}

/** Fases em ordem do ciclo (inclusive as vazias); vazio se nenhum projeto é formal. */
export function phaseBars(rows: PortfolioRow[]): Bar[] {
  if (!rows.some((r) => r.phase)) return [];
  return (Object.keys(PHASE_LABEL) as Phase[]).map((p) => ({
    key: p,
    label: PHASE_LABEL[p],
    value: rows.filter((r) => r.phase === p).length,
  }));
}

export const NO_VALUE = "(sem valor)";
export const OTHERS = "Outros";

/** Projetos por valor de um campo livre, do maior para o menor. Além de `max` barras, o resto
 * vira "Outros" — mais categorias que isso deixam de ser legíveis. */
export function fieldBars(rows: PortfolioRow[], field: string, max = 8): Bar[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = attributeValue(r.attributes, field) ?? NO_VALUE;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const bars = [...counts]
    .map(([label, value]) => ({ key: label, label, value }))
    .sort((a, b) => b.value - a.value || byName(a, b));
  if (bars.length <= max) return bars;
  const rest = bars.slice(max - 1).reduce((n, b) => n + b.value, 0);
  return [...bars.slice(0, max - 1), { key: OTHERS, label: OTHERS, value: rest }];
}

/** Campo sugerido para o gráfico por campo: o primeiro que agrupa (2 a 12 valores distintos). */
export function defaultField(index: Map<string, string[]>): string {
  for (const [name, values] of index) if (values.length >= 2 && values.length <= 12) return name;
  return index.keys().next().value ?? "";
}
