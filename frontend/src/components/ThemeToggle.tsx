import { Moon, Sun } from "lucide-react";
import { useState } from "react";

const KEY = "projeta-theme";

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const current = () => {
  const forced = document.documentElement.dataset.theme;
  return forced === "dark" || forced === "light" ? forced : systemDark() ? "dark" : "light";
};

/** Alterna claro/escuro. Sem escolha salva, o app segue o sistema. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(current);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* armazenamento bloqueado: vale só nesta sessão */
    }
    setTheme(next);
  };
  const toDark = theme === "light";
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={toDark ? "Usar modo escuro" : "Usar modo claro"} title={toDark ? "Modo escuro" : "Modo claro"}>
      {toDark ? <Moon size={20} aria-hidden /> : <Sun size={20} aria-hidden />}
    </button>
  );
}
