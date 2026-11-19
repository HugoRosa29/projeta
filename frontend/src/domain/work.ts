// Regras de apresentação de subtarefas e campos livres. O servidor valida; aqui só se organiza.
import type { ProjectAttribute, Task } from "./types";

export interface Nested {
  task: Task;
  /** Subtarefas exibidas logo abaixo da tarefa-mãe. */
  children: Task[];
}

/** Agrupa subtarefas sob a mãe, mantendo a ordem recebida. Subtarefa cuja mãe não está na lista
 * (ex.: filtrada) aparece sozinha, para nada sumir da tela. */
export function nestTasks(tasks: Task[]): Nested[] {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parent_id && ids.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  }
  return tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id)).map((task) => ({ task, children: kids.get(task.id) ?? [] }));
}

/** Contagem de subtarefas por mãe, a partir da lista completa do projeto: { id: [feitas, total] }. */
export function subtaskCounts(tasks: Task[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const t of tasks) {
    if (!t.parent_id) continue;
    const [done, total] = out.get(t.parent_id) ?? [0, 0];
    out.set(t.parent_id, [done + (t.status === "done" ? 1 : 0), total + 1]);
  }
  return out;
}

/** Nomes de campo e seus valores já usados, para sugerir no formulário e filtrar no portfólio.
 * Agrupa sem diferenciar maiúsculas, como o servidor; mostra a primeira grafia encontrada. */
export function attributeIndex(lists: (ProjectAttribute[] | undefined)[]): Map<string, string[]> {
  const names = new Map<string, string>();
  const values = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const { name, value } of list ?? []) {
      const key = name.toLocaleLowerCase("pt-BR");
      if (!names.has(key)) names.set(key, name);
      values.set(key, (values.get(key) ?? new Set()).add(value));
    }
  }
  const out = new Map<string, string[]>();
  for (const [key, name] of [...names].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))) {
    out.set(name, [...values.get(key)!].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })));
  }
  return out;
}

export function attributeValue(list: ProjectAttribute[] | undefined, name: string): string | undefined {
  const key = name.toLocaleLowerCase("pt-BR");
  return list?.find((a) => a.name.toLocaleLowerCase("pt-BR") === key)?.value;
}

/** Percentual do projeto: o informado por quem gerencia (como o "% Terminado" do Redmine) ou,
 * sem ele, a fração de tarefas concluídas. */
export function projectProgress(p: { progress?: number | null; task_count: number; done_count: number }): { pct: number; informed: boolean } {
  if (p.progress != null) return { pct: p.progress, informed: true };
  return { pct: p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0, informed: false };
}
