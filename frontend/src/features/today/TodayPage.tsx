import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import type { Task } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";
import { QuickAdd, TaskDialog, TaskList } from "../tasks/TaskParts";
import { isLead } from "../../domain/okr";
import { MyCheckins, OkrPulse } from "../okrs/OkrCards";
import { Overview } from "./Overview";

interface TodayData {
  today: string;
  overdue: Task[];
  due_today: Task[];
  upcoming: Task[];
  priorities: Task[];
  inbox: Task[];
}

type Bucket = "overdue" | "due_today" | "priorities" | "upcoming" | "inbox";
const BUCKETS: [Bucket, string][] = [
  ["overdue", "Atrasadas"],
  ["due_today", "Hoje"],
  ["priorities", "Prioridades"],
  ["upcoming", "7 dias"],
  ["inbox", "Sem prazo"],
];

/** Cumprimento pela hora local de quem abre a tela. */
export function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Boa noite";
  return hour < 12 ? "Bom dia" : "Boa tarde";
}

/** Iniciais do primeiro e do último nome ("Hugo Sousa Rosa" → "HR"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

/** Home em formato de painel: no desktop cabe numa tela só. O panorama ocupa a coluna principal
 *  e rola por dentro; a coluna lateral reúne OKRs e o trabalho da própria pessoa. */
export function TodayPage() {
  const { workspace, user } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const [showPanorama, setShowPanorama] = useState(false);
  // Só muda a ordem e o destaque da tela; o que cada um vê continua decidido pelo servidor.
  const lead = isLead(workspace);
  const q = useQuery({ queryKey: ["today", workspace.id], queryFn: () => api.get<TodayData>("/today", { workspace_id: workspace.id }) });
  const d = q.data;
  const date = d && new Date(`${d.today}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="dash">
      <header className="dash-hello">
        <span className="dash-avatar" aria-hidden>{initials(user.name)}</span>
        <div className="dash-hello-text">
          <h1>{greeting(new Date().getHours())}, {user.name.split(" ")[0]}</h1>
          {date && <p className="dash-date">{date} · {workspace.name}</p>}
        </div>
        <span className="dash-mode">{lead ? "Visão de gestão" : "Meu dia"}</span>
      </header>

      <div className="dash-main">
        {lead || showPanorama ? (
          <Overview workspaceId={workspace.id} workspaceName={workspace.name} />
        ) : (
          // Execução: o panorama fica a um clique (ADR 0005); o trabalho da pessoa vem primeiro, ao lado.
          <div className="card dash-placeholder">
            <p className="muted">O panorama mostra a situação, o progresso e os prazos dos projetos do espaço.</p>
            <button className="btn btn-line btn-sm" onClick={() => setShowPanorama(true)}>Ver o panorama do espaço</button>
          </div>
        )}
      </div>

      <aside className="dash-side" aria-label="Seu trabalho">
        {lead && <OkrPulse workspaceId={workspace.id} suggest={workspace.kind === "team"} />}
        <MyCheckins workspaceId={workspace.id} />
        <section className="card dash-tasks" aria-labelledby="dash-tasks-title">
          <div className="card-head">
            <h2 id="dash-tasks-title">Minhas tarefas</h2>
            <Link to="/minhas-tarefas" className="btn btn-ghost btn-sm">Ver todas</Link>
          </div>
          <QuickAdd workspaceId={workspace.id} placeholder="Nova tarefa (só o título basta)" />
          {q.isLoading && <Loading />}
          {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
          {d && <TaskTabs data={d} onOpen={setOpen} />}
        </section>
      </aside>

      {open && <TaskDialog taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** As cinco listas do dia num cartão só, em abas: começa na primeira que tem tarefa. */
function TaskTabs({ data, onOpen }: { data: TodayData; onOpen: (id: string) => void }) {
  const [picked, setPicked] = useState<Bucket | null>(null);
  const firstFull = BUCKETS.find(([k]) => data[k].length)?.[0];
  if (!firstFull) {
    return (
      <Empty title="Nada pedindo atenção hoje" action={<Link to="/projetos" className="btn btn-primary btn-sm">Criar ou abrir um projeto</Link>}>
        Adicione uma tarefa acima ou peça ao assistente para planejar um projeto.
      </Empty>
    );
  }
  const current = picked ?? firstFull;
  return (
    <>
      <div className="dash-tabs" role="tablist" aria-label="Tarefas por prazo">
        {BUCKETS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`dash-tab-${k}`}
            aria-selected={current === k}
            aria-controls="dash-tab-panel"
            className={k === "overdue" && data.overdue.length ? "is-alert" : ""}
            onClick={() => setPicked(k)}
          >
            {label} <span className="dash-tab-n">{data[k].length}</span>
          </button>
        ))}
      </div>
      <div className="dash-tab-panel" id="dash-tab-panel" role="tabpanel" aria-labelledby={`dash-tab-${current}`}>
        {data[current].length ? (
          <TaskList tasks={data[current]} today={data.today} onOpen={onOpen} />
        ) : (
          <p className="muted">Nenhuma tarefa aqui.</p>
        )}
      </div>
    </>
  );
}
