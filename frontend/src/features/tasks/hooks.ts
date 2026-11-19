import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Priority, Status, Task } from "../../domain/types";
import { ApiError, api } from "../../services/api";
import { useToast } from "../../components/ui";

export interface TaskCreateInput {
  workspace_id: string;
  project_id?: string | null;
  title: string;
  due_date?: string | null;
  priority?: Priority;
  status?: Status;
  assignee_id?: string | null;
  description?: string;
  estimate_minutes?: number | null;
  parent_id?: string | null;
}

export function useInvalidateWork() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["tasks", "task", "today", "project", "projects", "agenda"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useCreateTask() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (input: TaskCreateInput) => api.post<Task>("/tasks", input),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateWork();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ task, patch }: { task: Pick<Task, "id" | "version">; patch: Record<string, unknown> }) =>
      api.patch<Task>(`/tasks/${task.id}`, { ...patch, expected_version: task.version }),
    onSuccess: invalidate,
    onError: (e) => {
      invalidate();
      toast(e instanceof ApiError && e.status === 409 ? "Outra pessoa alterou esta tarefa. Atualizamos a lista." : (e as Error).message);
    },
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateWork();
  return useMutation({ mutationFn: (id: string) => api.del<void>(`/tasks/${id}`), onSuccess: invalidate });
}
