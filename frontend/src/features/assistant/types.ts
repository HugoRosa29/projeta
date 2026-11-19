export interface Link {
  label: string;
  href: string;
}

export interface WbsTask {
  ref: string;
  title: string;
  due_date: string | null;
  estimate_minutes: number | null;
  is_milestone: boolean;
  depends_on: string[];
}
export interface WbsPayload {
  project_id: string | null;
  project_name: string | null;
  summary: string;
  assumptions: string[];
  phases: { name: string; tasks: WbsTask[] }[];
}
export interface CreatePayload {
  project_id: string | null;
  tasks: { title: string; due_date?: string | null; priority?: string | null }[];
}
export interface UpdatePayload {
  task_id: string;
  changes: {
    status?: string | null;
    due_date?: string | null;
    progress?: number | null;
    priority?: "low" | "medium" | "high" | null;
    assignee_id?: string | null;
    clear_due_date?: boolean;
    clear_assignee?: boolean;
  };
}

export interface CommentPayload {
  task_id: string;
  body: string;
}

export interface StatusNotePayload {
  project_id: string;
  state: "on_track" | "at_risk" | "late";
  delay_reason: string;
  done: string;
  pending: string;
  blockers: string;
}

export interface Proposal {
  id: string;
  kind: "create_tasks" | "apply_wbs" | "update_task" | "status_note" | "add_comment";
  status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  expires_at: string;
  payload: WbsPayload | CreatePayload | UpdatePayload | StatusNotePayload | CommentPayload;
  preview: {
    count?: number;
    phases?: number;
    milestones?: number;
    titles?: string[];
    can_write?: boolean;
    tasks?: { task_id: string; title: string; project: string | null; href: string; changes: { field: string; label: string; before: string; after: string }[] }[];
  };
  result: { created?: { id: string; title: string; href: string }[]; updated?: { id: string; title: string; href: string }[]; project?: { id: string; name: string; href: string } } | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  links: Link[];
  created_at: string;
  proposal: Proposal | null;
  candidates: { task_id: string; label: string; project: string | null; due_date: string | null; status: string }[] | null;
  pending_action: unknown;
}

export interface Conversation {
  conversation_id: string | null;
  messages: ChatMessage[];
}
