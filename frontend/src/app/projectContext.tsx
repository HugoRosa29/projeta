import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

/** Projeto "em tela": o assistente mostra e usa este contexto. Nulo = espaço inteiro. */
interface Value {
  project: { id: string; name: string } | null;
  setProject: (p: { id: string; name: string } | null) => void;
}
const C = createContext<Value>({ project: null, setProject: () => {} });

export function ProjectContextProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Value["project"]>(null);
  const v = useMemo(() => ({ project, setProject }), [project]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

export const useProjectContext = () => useContext(C);

export function useAnnounceProject(p: { id: string; name: string } | null) {
  const { setProject } = useProjectContext();
  const id = p?.id;
  const name = p?.name;
  // layout effect: o contexto some junto com a tela, sem janela em que o assistente ainda enxerga o projeto antigo
  useLayoutEffect(() => {
    setProject(id && name ? { id, name } : null);
    return () => setProject(null);
  }, [id, name, setProject]);
}
