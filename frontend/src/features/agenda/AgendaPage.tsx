import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorBox } from "../../components/ui";
import { isoDate, type Task } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";
import { TaskDialog } from "../tasks/TaskParts";

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function AgendaPage() {
  const { workspace } = useSession();
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [open, setOpen] = useState<string | null>(null);

  const days = useMemo(() => {
    const first = new Date(cursor);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);
  const start = isoDate(days[0]);
  const end = isoDate(days[41]);
  const today = isoDate(new Date());
  const q = useQuery({
    queryKey: ["agenda", workspace.id, start, end],
    queryFn: () => api.get<{ items: Task[] }>("/agenda", { workspace_id: workspace.id, start, end }),
  });
  const byDay = new Map<string, Task[]>();
  for (const t of q.data?.items ?? []) byDay.set(t.due_date!, [...(byDay.get(t.due_date!) ?? []), t]);
  const title = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Agenda</p>
          <h1 style={{ textTransform: "capitalize" }}>{title}</h1>
          <p className="muted">Prazos de tarefas, marcos e tarefas pessoais. Toque em um item para abri-lo.</p>
        </div>
        <span className="spacer" />
        <button className="icon-btn" aria-label="Mês anterior" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft /></button>
        <button className="btn btn-line btn-sm" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoje</button>
        <button className="icon-btn" aria-label="Próximo mês" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight /></button>
      </div>
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <div className="cal" role="grid" aria-label={`Calendário de ${title}`}>
        {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {days.map((d) => {
          const iso = isoDate(d);
          const items = byDay.get(iso) ?? [];
          return (
            <div key={iso} role="gridcell" className={`day ${d.getMonth() !== cursor.getMonth() ? "out" : ""} ${iso === today ? "today" : ""}`}>
              <span className="n">{d.getDate()}</span>
              {items.map((t) => (
                <button key={t.id} className={`item ${t.is_milestone ? "milestone" : ""} ${t.status !== "done" && iso < today ? "late" : ""}`} onClick={() => setOpen(t.id)} title={t.title} aria-label={`${t.is_milestone ? "Marco: " : ""}${t.title}, ${iso}`}>
                  {t.is_milestone ? "◆ " : ""}{t.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {open && <TaskDialog taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
