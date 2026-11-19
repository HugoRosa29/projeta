import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { User, Workspace } from "../domain/types";
import { ApiError, api } from "../services/api";

interface Session {
  user: User;
  workspaces: Workspace[];
  workspace: Workspace;
  setWorkspaceId: (id: string) => void;
  refresh: () => Promise<unknown>;
}

const Ctx = createContext<Session | null>(null);
const KEY = "projeta.workspace";

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User; workspaces: Workspace[] }>("/me"),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 1,
    staleTime: 60_000,
  });
}

export function SessionProvider({ me, children }: { me: { user: User; workspaces: Workspace[] }; children: ReactNode }) {
  const qc = useQueryClient();
  const [stored, setStored] = useState<string | null>(readStored);
  // O id guardado é só uma preferência: o servidor revalida o vínculo em cada chamada.
  const workspace = me.workspaces.find((w) => w.id === stored) ?? me.workspaces[0];
  const setWorkspaceId = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* armazenamento indisponível: segue sem lembrar a escolha */
    }
    setStored(id);
  }, []);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["me"] }), [qc]);
  const value = useMemo(
    () => ({ user: me.user, workspaces: me.workspaces, workspace, setWorkspaceId, refresh }),
    [me, workspace, setWorkspaceId, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession fora do SessionProvider");
  return v;
}
