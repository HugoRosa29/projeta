import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Marca do produto Projet.AI (public/brand/projetai-logo.png, 864×200). Já traz o nome escrito. */
export function Logo({ height = 34 }: { height?: number }) {
  return <img className="brand-logo" src="/brand/projetai-logo.png" alt="Projet.AI" height={height} width={Math.round((height * 864) / 200)} />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Algo deu errado.";
  return (
    <div className="error-box" role="alert">
      <span>{msg}</span>
      {onRetry && (
        <button className="btn btn-line btn-sm" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

/** Diálogo modal acessível: foco preso, Esc fecha, devolve o foco ao fechar. */
export function Dialog({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter(
        (n) => !n.hasAttribute("disabled"),
      );
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [onClose]);
  return createPortal(
    // Fechar por clique no fundo é conveniência de mouse; teclado fecha com Esc (tratado acima).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {msg && <div className="toast">{msg}</div>}
      </div>
    </ToastCtx.Provider>
  );
}
