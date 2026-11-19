import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, FolderKanban, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Hero } from "../../components/Hero";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import type { Task } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";
import { QuickAdd, TaskDialog, TaskList } from "../tasks/TaskParts";
import { Overview } from "./Overview";

const TOOLS = [
  { to: "/projetos", label: "Projetos", icon: FolderKanban },
  { to: "/portfolio", label: "Portfólio", icon: LayoutDashboard },
  { to: "/minhas-tarefas", label: "Minhas tarefas", icon: CheckSquare },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
];

interface TodayData {
  today: string;
  overdue: Task[];
  due_today: Task[];
  upcoming: Task[];
  priorities: Task[];
  inbox: Task[];
}

export function TodayPage() {
  const { workspace, user } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["today", workspace.id], queryFn: () => api.get<TodayData>("/today", { workspace_id: workspace.id }) });
  const d = q.data;
  const empty = d && !d.overdue.length && !d.due_today.length && !d.upcoming.length && !d.priorities.length && !d.inbox.length;

  const section = (title: string, tasks: Task[], badge?: string) =>
    tasks.length > 0 && (
      <section className="card" aria-labelledby={`s-${title}`}>
        <div className="card-head">
          <h2 id={`s-${title}`}>{title}</h2>
          {badge && <span className="badge alerta">{badge}</span>}
        </div>
        <TaskList tasks={tasks} today={d?.today} onOpen={setOpen} />
      </section>
    );

  return (
    <>
      <Hero
        eyebrow="Hoje"
        title={`Olá, ${user.name}`}
        subtitle={d && new Date(`${d.today}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
      >
        {TOOLS.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="hero-tool"><Icon size={18} aria-hidden /> {label}</Link>
        ))}
      </Hero>
      <Overview workspaceId={workspace.id} workspaceName={workspace.name} />
      <QuickAdd workspaceId={workspace.id} placeholder="O que você precisa fazer? (só o título basta)" />
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          {section("Atrasadas", d.overdue, `${d.overdue.length}`)}
          {section("Vencem hoje", d.due_today)}
          {section("Prioridades", d.priorities)}
          {section("Próximos 7 dias", d.upcoming)}
          {section("Sem prazo", d.inbox)}
          {empty && (
            <Empty
              title="Nada pedindo atenção hoje"
              action={<Link to="/projetos" className="btn btn-primary">Criar ou abrir um projeto</Link>}
            >
              Adicione uma tarefa acima ou peça ao assistente para planejar um projeto.
            </Empty>
          )}
        </>
      )}
      {open && <TaskDialog taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
