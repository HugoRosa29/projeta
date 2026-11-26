import { LayoutGrid, List, Rows3 } from "lucide-react";
import { useState } from "react";

export type ViewMode = "board" | "blocks" | "list";

const OPTIONS: Record<ViewMode, { label: string; Icon: typeof List }> = {
  board: { label: "Quadro", Icon: Rows3 },
  blocks: { label: "Blocos", Icon: LayoutGrid },
  list: { label: "Lista", Icon: List },
};

/** Modo de exibição de uma lista de projetos. A escolha fica neste navegador, por página:
 *  é preferência de leitura, não dado do espaço, então não vai para o servidor. O primeiro
 *  modo de `modes` é o padrão. */
export function useViewMode(page: string, modes: readonly ViewMode[] = ["blocks", "list"]): [ViewMode, (m: ViewMode) => void] {
  const key = `projeta-view-${page}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(key) as ViewMode | null;
      return saved && modes.includes(saved) ? saved : modes[0];
    } catch {
      return modes[0];
    }
  });
  const set = (m: ViewMode) => {
    try {
      localStorage.setItem(key, m);
    } catch {
      /* armazenamento bloqueado: vale só nesta sessão */
    }
    setMode(m);
  };
  return [mode, set];
}

export function ViewToggle({ mode, onChange, modes = ["blocks", "list"] }: { mode: ViewMode; onChange: (m: ViewMode) => void; modes?: readonly ViewMode[] }) {
  return (
    <div className="view-toggle" role="group" aria-label="Modo de exibição">
      {modes.map((m) => {
        const { label, Icon } = OPTIONS[m];
        return (
          <button key={m} type="button" className="btn btn-sm btn-ghost" aria-pressed={mode === m} onClick={() => onChange(m)} title={`Ver em ${label.toLowerCase()}`}>
            <Icon size={16} aria-hidden /> {label}
          </button>
        );
      })}
    </div>
  );
}
