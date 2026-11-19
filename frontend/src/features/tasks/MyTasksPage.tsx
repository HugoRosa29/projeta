import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Priority, type Task } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";
import { QuickAdd, TaskDialog, TaskList } from "./TaskParts";

export function MyTasksPage() {
  const { workspace } = useSession();
  const [due, setDue] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const taskParam = sp.get("task");
  useEffect(() => {
    if (taskParam) setOpen(taskParam);
  }, [taskParam]);
  const closeTask = () => {
    setOpen(null);
    if (sp.has("task")) setSp({}, { replace: true });
  };
  const q = useQuery({
    queryKey: ["tasks", "mine", workspace.id, due, status, priority],
    queryFn: () => api.get<{ tasks: Task[]; today: string }>("/tasks/mine", { workspace_id: workspace.id, due, status, priority, include_done: status === "done" }),
  });
  const filtered = !!(due || status || priority);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Minhas tarefas</p>
          <h1>Minhas tarefas</h1>
          <p className="muted">Tarefas atribuídas a você e tarefas pessoais (visíveis só para você).</p>
        </div>
      </div>
      <QuickAdd workspaceId={workspace.id} placeholder="Nova tarefa pessoal…" />
      <div className="row" style={{ marginBottom: 14 }} role="search" aria-label="Filtrar minhas tarefas">
        <select className="select grow" aria-label="Prazo" value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="">Qualquer prazo</option>
          <option value="overdue">Atrasadas</option>
          <option value="today">Hoje</option>
          <option value="week">Próximos 7 dias</option>
          <option value="none">Sem prazo</option>
        </select>
        <select className="select grow" aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Em aberto</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="select grow" aria-label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Qualquer prioridade</option>
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      </div>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (q.data.tasks.length === 0 ? (
        <Empty title={filtered ? "Nenhuma tarefa com esses filtros" : "Você está em dia"}>{filtered ? "Ajuste os filtros para ver mais." : "Crie uma tarefa pessoal acima."}</Empty>
      ) : (
        <TaskList tasks={q.data.tasks} today={q.data.today} onOpen={setOpen} />
      ))}
      {open && <TaskDialog taskId={open} onClose={closeTask} />}
    </>
  );
}
