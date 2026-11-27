export type Status = "todo" | "doing" | "blocked" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Role = "admin" | "manager" | "member" | "viewer";
/** Ações que o Gestor configura por perfil (identity/policy.py). O servidor confere sempre. */
export type Permission =
  | "project.view_all"
  | "project.create"
  | "project.manage"
  | "task.write"
  | "comment.write"
  | "workspace.invite"
  | "org.view_shared"
  | "okr.manage";

export const STATUSES: Status[] = ["todo", "doing", "blocked", "done"];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  blocked: "Bloqueada",
  done: "Concluída",
};
/** Da mais urgente para a menos: a ordem das opções nos seletores. */
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgente", high: "Alta", medium: "Média", low: "Baixa" };
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Gestor",
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
  /** O que esta pessoa pode fazer neste espaço; só para esconder opções na interface. */
  permissions: Permission[];
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
  /** Início planejado (data de calendário); com o prazo, dá a barra do cronograma. */
  start_date?: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  progress: number;
  phase: string | null;
  is_milestone: boolean;
  /** Tarefas do mesmo projeto que precisam terminar antes desta. */
  depends_on_ids?: string[];
  /** Dependências ainda em aberto (o servidor envia título e prazo: elas podem não estar na lista). */
  waiting_on?: { id: string; title: string; status: Status; due_date: string | null }[];
  /** Quantas tarefas em aberto esperam por esta. */
  blocking_count?: number;
  labels: string[];
  version: number;
  created_at: string;
  updated_at: string;
  /** Tarefa-mãe (subtarefas têm um nível só). */
  parent_id?: string | null;
  parent_title?: string | null;
  /** Sprint do projeto; nulo = backlog. Subtarefa acompanha a sprint da mãe. */
  sprint_id?: string | null;
  sprint_name?: string | null;
  sprint_status?: SprintStatus | null;
  position?: number;
}
export type SprintStatus = "planned" | "active" | "closed";
/** Campo livre do projeto (portfólio): nome e valor definidos por quem usa. */
export interface ProjectAttribute {
  name: string;
  value: string;
}
export interface Project {
  /** Nome do espaço de origem quando o projeto foi compartilhado com esta unidade (só leitura). */
  shared_from?: string | null;
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
  /** Pasta no espaço dono; sempre nula para projeto recebido pelo organograma. */
  folder_id?: string | null;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  project_roles?: string[];
  /** Data da última troca da foto; nula quando a pessoa não tem foto. */
  photo_version?: string | null;
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
  "project.folder_set": "mudou a pasta do projeto",
  "project.tap_saved": "salvou o Termo de Abertura",
  "project.tep_saved": "salvou o Termo de Encerramento",
  "baseline.created": "salvou uma linha de base do cronograma",
  "baseline.deleted": "excluiu uma linha de base do cronograma",
  "risk.created": "registrou o risco",
  "risk.updated": "atualizou o risco",
  "risk.reviewed": "revisou o risco",
  "risk.deleted": "excluiu o risco",
  "task.created": "criou a tarefa",
  "task.updated": "editou a tarefa",
  "task.rescheduled": "reprogramou (seguindo a dependência) a tarefa",
  "task.status_changed": "mudou o estado da tarefa",
  "task.deleted": "removeu a tarefa",
  "task.commented": "comentou na tarefa",
  "sprint.created": "planejou a sprint",
  "sprint.started": "iniciou a sprint",
  "sprint.goal_changed": "reescreveu a meta da sprint",
  "sprint.closed": "encerrou a sprint",
  "sprint.deleted": "excluiu a sprint",
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

export function can(w: Pick<Workspace, "permissions">, p: Permission): boolean {
  return w.permissions?.includes(p) ?? false;
}
