import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "../../components/ui";
import { api } from "../../services/api";
import { useInvalidateWork } from "../tasks/hooks";

/** Fase do projeto. A tarefa guarda o nome em `task.phase`; a lista dá a ordem. */
export interface Phase {
  id: string;
  name: string;
  position: number;
  task_count: number;
  done_count: number;
}
export interface PhasesData {
  phases: Phase[];
  can_write: boolean;
}

/** Ponto de partida para projeto ainda sem fases (ciclo de vida do guia PMBOK). */
export const DEFAULT_PHASES = ["Iniciação", "Planejamento", "Execução", "Monitoramento e controle", "Encerramento"];

export function usePhases(projectId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["phases", projectId],
    queryFn: () => api.get<PhasesData>(`/projects/${projectId}/phases`),
    enabled: !!projectId && enabled,
  });
}

/** Criar, renomear, excluir e reordenar. Renomear e excluir mexem nas tarefas: tudo é recarregado. */
export function usePhaseActions(projectId: string) {
  const invalidate = useInvalidateWork();
  const toast = useToast();
  const opts = { onSuccess: invalidate, onError: (e: unknown) => (invalidate(), toast((e as Error).message)) };
  const create = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) await api.post<Phase>(`/projects/${projectId}/phases`, { name });
    },
    ...opts,
  });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<Phase>(`/phases/${id}`, { name }), ...opts });
  const remove = useMutation({ mutationFn: (id: string) => api.del<void>(`/phases/${id}`), ...opts });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put<PhasesData>(`/projects/${projectId}/phases/order`, { ids }), ...opts });
  return { create, rename, remove, reorder };
}

export const NO_PHASE = "";

/** Agrupa as tarefas na ordem das fases; "sem fase" por último. Subtarefa fica com a mãe. */
export function groupByPhase<T extends { id: string; phase: string | null; parent_id?: string | null }>(
  tasks: T[],
  phases: Pick<Phase, "name">[],
): { name: string; tasks: T[] }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const key = (t: T) => ((t.parent_id && byId.get(t.parent_id)?.phase) ?? t.phase ?? NO_PHASE).toLocaleLowerCase("pt-BR");
  const groups = new Map<string, { name: string; tasks: T[] }>();
  for (const p of phases) groups.set(p.name.toLocaleLowerCase("pt-BR"), { name: p.name, tasks: [] });
  for (const t of tasks) {
    const k = key(t);
    if (!groups.has(k)) groups.set(k, { name: k === NO_PHASE ? NO_PHASE : (t.phase ?? NO_PHASE), tasks: [] });
    groups.get(k)!.tasks.push(t);
  }
  const none = groups.get(NO_PHASE);
  groups.delete(NO_PHASE);
  return [...groups.values(), ...(none ? [none] : [])];
}
