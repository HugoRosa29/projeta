import { useQuery } from "@tanstack/react-query";
import type { SprintsData } from "../../domain/sprint";
import { api } from "../../services/api";

export function useSprints(projectId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["sprints", projectId],
    queryFn: () => api.get<SprintsData>(`/projects/${projectId}/sprints`),
    enabled: !!projectId && enabled,
  });
}
