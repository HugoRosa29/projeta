import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, FolderKanban, House, LayoutDashboard, MessageCircle, Settings } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { Logo } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";
import { Skyline } from "../components/Skyline";
import { useMotion } from "../components/motion";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { api } from "../services/api";
import { useProjectContext } from "./projectContext";
import { useSession } from "./session";

const LINKS = [
  { to: "/", label: "Hoje", icon: House, end: true },
  { to: "/projetos", label: "Projetos", icon: FolderKanban },
  { to: "/portfolio", label: "Portfólio", icon: LayoutDashboard },
  { to: "/minhas-tarefas", label: "Tarefas", full: "Minhas tarefas", icon: CheckSquare },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/configuracoes", label: "Ajustes", full: "Configurações", icon: Settings },
];

export function AppLayout() {
  const { user, workspaces, workspace, setWorkspaceId } = useSession();
  const { project } = useProjectContext();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  useMotion();

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    window.location.assign("/entrar");
  };

  return (
    <div className={`shell ${assistantOpen && !expanded ? "with-assistant" : ""}`}>
      <a href="#main" className="skip-link">Pular para o conteúdo</a>
      <div className="scroll-progress" aria-hidden="true" />
      <aside className="nav" aria-label="Navegação principal">
        <NavLink to="/" className="brand" aria-label="Terracap Projeta — início"><Logo /> <span className="brand-name">Projeta</span></NavLink>
        <nav className="nav-links">
          {LINKS.map(({ to, label, full, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}><Icon size={20} aria-hidden /> {full ?? label}</NavLink>
          ))}
        </nav>
        <div className="nav-art"><Skyline onLight chips={false} /></div>
        <div className="nav-foot">
          <span className="coord">{user.name}</span>
          <button className="btn btn-ghost" onClick={logout}>Sair</button>
        </div>
      </aside>

      <div className="content">
        <main className="main" id="main" tabIndex={-1}>
          <div className="topbar">
            <label className="sr-only" htmlFor="ws">Espaço de trabalho</label>
            <select id="ws" className="select ws-switch" value={workspace.id} onChange={(e) => setWorkspaceId(e.target.value)}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}{w.kind === "personal" ? " (pessoal)" : ""}</option>)}
            </select>
            <span className="spacer" />
            <ThemeToggle />
            <button className="btn btn-primary btn-sm" aria-expanded={assistantOpen} aria-controls="assistant" onClick={() => setAssistantOpen((v) => !v)}>
              <MessageCircle size={18} aria-hidden /> Assistente
            </button>
            {project && <span className="context-chip" title="Projeto em tela">{project.name}</span>}
          </div>
          <Outlet key={workspace.id} />
        </main>
      </div>

      {assistantOpen && <AssistantPanel expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} onClose={() => (setAssistantOpen(false), setExpanded(false))} />}

      <nav className="bottom-nav" aria-label="Navegação principal (celular)">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}><Icon size={22} aria-hidden />{label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
