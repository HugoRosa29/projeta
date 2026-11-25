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

/** Soma dias a uma data de calendário (aaaa-mm-dd) sem passar por fuso: prazo é data, não instante. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Opções de "Adiar" contadas a partir de hoje no fuso da pessoa (o `today` vem do servidor). */
export function postponeOptions(today: string): { label: string; date: string }[] {
  return [
    { label: "Amanhã", date: addDays(today, 1) },
    { label: "Em 3 dias", date: addDays(today, 3) },
    { label: "Em 1 semana", date: addDays(today, 7) },
  ];
}

/** Data de calendário de hoje no fuso do navegador (o fuso da pessoa que está olhando). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface ProjectRisk {
  late: Task[];
  blocked: Task[];
  dueSoon: Task[];
  /** Atrasadas, depois bloqueadas, depois as que vencem logo — sem repetir tarefa. */
  attention: { task: Task; reason: "late" | "blocked" | "soon" }[];
  /** Prazos de hoje até `soonDays` dias à frente, do mais próximo ao mais distante. */
  upcoming: Task[];
}

/** O que precisa de atenção num projeto. Só conta tarefa em aberto; "logo" = nos próximos `soonDays` dias. */
export function projectRisk(tasks: Task[], today: string, soonDays = 7): ProjectRisk {
  const open = tasks.filter((t) => t.status !== "done");
  const byDue = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  const limit = addDays(today, soonDays);
  const late = open.filter((t) => t.due_date && t.due_date < today).sort(byDue);
  const blocked = open.filter((t) => t.status === "blocked").sort(byDue);
  const dueSoon = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= limit).sort(byDue);
  const seen = new Set<string>();
  const attention: ProjectRisk["attention"] = [];
  for (const [list, reason] of [[late, "late"], [blocked, "blocked"], [dueSoon, "soon"]] as const) {
    for (const task of list) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      attention.push({ task, reason });
    }
  }
  const upcoming = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= limit).sort(byDue);
  return { late, blocked, dueSoon, attention, upcoming };
}

/** Tarefas que podem virar dependência de `task` sem formar ciclo: do mesmo projeto, não ela
 * mesma, não já ligadas e que não esperem (direta ou indiretamente) por `task`. O servidor faz a
 * mesma checagem; aqui só se evita oferecer o que seria recusado. */
export function dependencyCandidates(task: Task, all: Task[]): Task[] {
  if (!task.project_id) return [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const waitsOnTask = (start: string): boolean => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === task.id) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.depends_on_ids ?? []));
    }
    return false;
  };
  const current = new Set(task.depends_on_ids ?? []);
  return all.filter((c) => c.project_id === task.project_id && c.id !== task.id && !current.has(c.id) && !waitsOnTask(c.id));
}

/** Dependências cujo prazo cai depois do início desta tarefa (ou do prazo, sem início): o
 * cronograma pede algo que ainda não terá terminado. Mesmo dia não conta (a anterior pode acabar
 * de manhã), nem dependência já concluída. */
export function scheduleConflicts(task: Task, all: Task[]): Task[] {
  const begins = task.start_date ?? task.due_date;
  if (!begins || task.status === "done") return [];
  const byId = new Map(all.map((t) => [t.id, t]));
  return (task.depends_on_ids ?? [])
    .map((id) => byId.get(id))
    .filter((d): d is Task => !!d && d.status !== "done" && !!d.due_date && d.due_date > begins);
}
