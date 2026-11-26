import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { label: string; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { heading: string }
  | "sep";

interface Open {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Menu do botão direito, como no explorador de arquivos do sistema. Abre também pelo teclado
 *  (tecla Menu ou Shift+F10, que disparam o mesmo evento `contextmenu`): aí ancora no elemento.
 *  Setas navegam, Enter escolhe, Esc fecha e devolve o foco a quem abriu. */
export function useContextMenu(): [ReactNode, (e: MouseEvent, items: MenuItem[]) => void] {
  const [menu, setMenu] = useState<Open | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((e: MouseEvent, items: MenuItem[]) => {
    if (!items.some((i) => typeof i === "object" && "onSelect" in i)) return;
    e.preventDefault();
    e.stopPropagation();
    opener.current = e.currentTarget as HTMLElement;
    // Pelo teclado o evento vem sem coordenadas: o menu sai do canto do elemento.
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    const r = opener.current.getBoundingClientRect();
    setMenu({ x: fromKeyboard ? r.left + 8 : e.clientX, y: fromKeyboard ? r.bottom : e.clientY, items });
  }, []);
  const close = useCallback((refocus: boolean) => {
    setMenu(null);
    if (refocus) opener.current?.focus();
  }, []);
  return [menu ? <Menu key={`${menu.x},${menu.y}`} {...menu} onClose={close} /> : null, open];
}

function Menu({ x, y, items, onClose }: Open & { onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Não deixa o menu sair da janela: perto da borda, abre para o outro lado.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: y + height > window.innerHeight - 4 ? Math.max(4, y - height) : y,
    });
    el.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose(false);
    };
    const gone = () => onClose(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("contextmenu", away);
    window.addEventListener("resize", gone);
    window.addEventListener("scroll", gone, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("contextmenu", away);
      window.removeEventListener("resize", gone);
      window.removeEventListener("scroll", gone, true);
    };
  }, [onClose]);

  const onKey = (e: KeyboardEvent) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
    } else if (e.key === "Tab") onClose(false);
  };

  return createPortal(
    <div ref={ref} className="ctx-menu" role="menu" tabIndex={-1} style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, n) =>
        it === "sep" ? (
          <hr key={n} className="ctx-sep" />
        ) : "heading" in it ? (
          <div key={n} className="ctx-heading" role="presentation">{it.heading}</div>
        ) : (
          <button
            key={n}
            type="button"
            role="menuitem"
            className={`ctx-item${it.danger ? " ctx-danger" : ""}`}
            aria-disabled={it.disabled || undefined}
            tabIndex={-1}
            onClick={() => {
              if (it.disabled) return;
              onClose(false);
              it.onSelect();
            }}
          >
            <span className="ctx-ico" aria-hidden>{it.icon}</span>
            <span className="ctx-label">{it.label}</span>
            {it.hint && <kbd className="ctx-hint">{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
