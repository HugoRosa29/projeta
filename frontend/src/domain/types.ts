export type Status = "todo" | "doing" | "blocked" | "done";
export type Priority = "low" | "medium" | "high";
export type Role = "admin" | "manager" | "member" | "viewer";

export const STATUSES: Status[] = ["todo", "doing", "blocked", "done"];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  blocked: "Bloqueada",
  done: "Concluída",
};
export const PRIORITY_LABEL: Record<Priority, string> = { low: "Baixa", medium: "Média", high: "Alta" };
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador do espaço",
  manager: "Gerente de projeto",
  member: "Membro",
  viewer: "Leitor",
};

export interface User {
  id: string;
  email: string;
  name: string;
  timezone: string;
}
export interface Workspace {
  id: string;
  name: string;
  kind: "personal" | "team";
  timezone: string;
  role: Role;
  notify_email: boolean;
  notify_inapp: boolean;
}
export interface Task {
  id: string;
  workspace_id: string;
  project_id: string | null;
  owner_id: string | null;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee_id: string | null;
  assignee_name: string | null;
  project_name: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  progress: number;
  phase: string | null;
  is_milestone: boolean;
  labels: string[];
  version: number;
  created_at: string;
  updated_at: string;
  /** Tarefa-mãe (subtarefas têm um nível só). */
  parent_id?: string | null;
  parent_title?: string | null;
}
/** Campo livre do projeto (portfólio): nome e valor definidos por quem usa. */
export interface ProjectAttribute {
  name: string;
  value: string;
}
export interface Project {
  summary?: string;
  responsible?: string;
  requester?: string;
  external_ref?: string;
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  phase?: "initiation" | "planning" | "execution" | "monitoring" | "closing" | null;
  approach?: "agile" | "waterfall" | null;
  sei_process?: string | null;
  task_count: number;
  done_count: number;
  last_activity: string | null;
  /** Data da última troca da imagem; nulo = projeto sem imagem. */
  cover_version?: string | null;
  attributes?: ProjectAttribute[];
  /** % concluído informado por quem gerencia; nulo = calculado pelas tarefas. */
  progress?: number | null;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  project_roles?: string[];
}
export interface ActivityItem {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  via: "manual" | "assistant";
  created_at: string;
  task_id: string | null;
  actor_name: string | null;
}

export const ACTIVITY_LABEL: Record<string, string> = {
  "project.created": "criou o projeto",
  "project.archived": "arquivou o projeto",
  "project.restored": "reativou o projeto",
  "project.member_added": "adicionou uma pessoa ao projeto",
  "project.invited": "convidou uma pessoa pela matrícula",
  "project.roles_set": "definiu as funções de uma pessoa no projeto",
  "project.phase_changed": "mudou a fase do projeto",
  "project.status_note": "publicou uma nota de acompanhamento",
  "project.progress_set": "atualizou o % concluído do projeto",
  "project.tap_saved": "salvou o Termo de Abertura",
  "project.tep_saved": "salvou o Termo de Encerramento",
  "task.created": "criou a tarefa",
  "task.updated": "editou a tarefa",
  "task.status_changed": "mudou o estado da tarefa",
  "task.deleted": "removeu a tarefa",
  "task.commented": "comentou na tarefa",
};

/** "AAAA-MM-DD" -> "dd/mm" sem passar por Date/UTC (data de calendário não tem fuso). */
export function fmtDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
