import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Dialog, useToast } from "../../components/ui";
import { addDays } from "../../domain/work";
import { fmtHours, tasksIn, type Sprint } from "../../domain/sprint";
import { fmtDate, type Task } from "../../domain/types";
import { api } from "../../services/api";
import { useInvalidateWork } from "../tasks/hooks";

/** Planejar uma sprint nova (sem `sprint`) ou editar uma existente. Datas ficam travadas depois do
 * início; o servidor recusa de qualquer forma. Campos vazios na criação usam a cadência do projeto. */
export function SprintDialog({ projectId, sprint, onClose }: { projectId: string; sprint?: Sprint; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateWork();
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [start, setStart] = useState(sprint?.start_date ?? "");
  const [end, setEnd] = useState(sprint?.end_date ?? "");
  const [hours, setHours] = useState(sprint?.capacity_minutes != null ? String(sprint.capacity_minutes / 60) : "");
  const locked = sprint?.status === "active";
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        goal: goal.trim(),
        capacity_minutes: hours === "" ? null : Math.round(Number(hours) * 60),
      };
      if (name.trim()) body.name = name.trim();
      if (!locked) {
        if (start) body.start_date = start;
        if (end) body.end_date = end;
      }
      return sprint
        ? api.patch<Sprint>(`/sprints/${sprint.id}`, { ...body, expected_version: sprint.version })
        : api.post<Sprint>(`/projects/${projectId}/sprints`, body);
    },
    onSuccess: () => {
      invalidate();
      toast(sprint ? "Sprint salva" : "Sprint planejada");
      onClose();
    },
    onError: (e) => toast((e as Error).message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  };
  return (
    <Dialog title={sprint ? `Editar ${sprint.name}` : "Planejar sprint"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="sp-goal">Meta da sprint</label>
          <textarea id="sp-goal" data-autofocus className="textarea" rows={2} maxLength={500} value={goal} placeholder="Em uma frase: o que esta sprint entrega e por quê" aria-describedby="sp-goal-help" onChange={(e) => setGoal(e.target.value)} />
          <small id="sp-goal-help" className="muted">A meta é o compromisso da sprint. Se o escopo mudar no meio, ela continua valendo.</small>
        </div>
        <div className="field">
          <label htmlFor="sp-name">Nome</label>
          <input id="sp-name" className="input" maxLength={80} value={name} placeholder={sprint ? undefined : "Sprint N (automático)"} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor="sp-start">Início</label>
            <input id="sp-start" type="date" className="input" value={start} disabled={locked} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="sp-end">Fim</label>
            <input id="sp-end" type="date" className="input" value={end} min={start || undefined} disabled={locked} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {!sprint && !start && <p className="muted sprint-hint">Sem datas, a sprint começa depois da última e tem a mesma duração (2 semanas na primeira).</p>}
        {start && !end && !locked && (
          <p className="row sprint-hint">
            Duração:
            {[7, 14, 21].map((d) => (
              <button key={d} type="button" className="btn btn-ghost btn-sm" onClick={() => setEnd(addDays(start, d - 1))}>{d / 7} {d === 7 ? "semana" : "semanas"}</button>
            ))}
          </p>
        )}
        {locked && <p className="muted sprint-hint">As datas ficam fixas depois do início.</p>}
        <div className="field">
          <label htmlFor="sp-cap">Capacidade da equipe (horas)</label>
          <input id="sp-cap" type="number" min={0} step={1} className="input" value={hours} aria-describedby="sp-cap-help" onChange={(e) => setHours(e.target.value)} />
          <small id="sp-cap-help" className="muted">Horas que a equipe tem de fato para a sprint, já descontando férias, reuniões e rotina. A sprint compara com a soma das estimativas.</small>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={save.isPending}>{sprint ? "Salvar" : "Planejar"}</button>
          <button type="button" className="btn btn-line" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Encerramento é o momento da revisão: mostra o que foi entregue e pergunta o destino do resto. */
export function CloseSprintDialog({ sprint, next, tasks, onClose }: { sprint: Sprint; next?: Sprint; tasks: Task[]; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateWork();
  const [carry, setCarry] = useState<"next" | "backlog">("next");
  const all = tasksIn(tasks, sprint.id, { includeDone: true });
  const open = all.filter((t) => t.status !== "done");
  const done = all.length - open.length;
  const close = useMutation({
    mutationFn: () => api.post<{ sprint: Sprint; next: Sprint | null }>(`/sprints/${sprint.id}/close`, { carry_to: carry }),
    onSuccess: (r) => {
      invalidate();
      toast(open.length && r.next ? `Sprint encerrada. ${open.length} tarefa(s) foram para a ${r.next.name}.` : "Sprint encerrada");
      onClose();
    },
    onError: (e) => toast((e as Error).message),
  });
  return (
    <Dialog title={`Encerrar ${sprint.name}`} onClose={onClose}>
      {sprint.goal && <p className="sprint-goal"><strong>Meta:</strong> {sprint.goal}</p>}
      <p>
        <strong>{done}</strong> de <strong>{all.length}</strong> tarefas concluídas
        {sprint.stats.minutes > 0 && <> · {fmtHours(sprint.stats.done_minutes)} de {fmtHours(sprint.stats.minutes)} estimadas</>}.
      </p>
      {open.length > 0 ? (
        <fieldset className="field sprint-carry">
          <legend className="label">Para onde vão as {open.length} tarefas não concluídas?</legend>
          <label className="row">
            <input type="radio" name="carry" checked={carry === "next"} onChange={() => setCarry("next")} />
            {next ? `Para a ${next.name} (${fmtDate(next.start_date)} a ${fmtDate(next.end_date)})` : "Para uma nova sprint, na mesma cadência"}
          </label>
          <label className="row">
            <input type="radio" name="carry" checked={carry === "backlog"} onChange={() => setCarry("backlog")} />
            De volta ao backlog, para repriorizar
          </label>
          <ul className="sprint-carry-list">
            {open.map((t) => <li key={t.id}>{t.title}</li>)}
          </ul>
        </fieldset>
      ) : (
        <p className="muted">Tudo concluído. Bom trabalho!</p>
      )}
      <p className="muted sprint-hint">As concluídas ficam registradas nesta sprint. O relatório não muda depois do encerramento.</p>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" disabled={close.isPending} onClick={() => close.mutate()}>Encerrar sprint</button>
        <button type="button" className="btn btn-line" onClick={onClose}>Cancelar</button>
      </div>
    </Dialog>
  );
}
