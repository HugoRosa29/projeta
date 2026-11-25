import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Dialog } from "../../components/ui";
import { periodLabel, type KeyResult, type Objective } from "../../domain/okr";
import type { Member, Project } from "../../domain/types";
import { api } from "../../services/api";

function useMembers(workspaceId: string) {
  return useQuery({ queryKey: ["ws", "members", workspaceId], queryFn: () => api.get<{ members: Member[] }>(`/workspaces/${workspaceId}/members`) });
}

function OwnerSelect({ workspaceId, value, onChange }: { workspaceId: string; value: string; onChange: (v: string) => void }) {
  const q = useMembers(workspaceId);
  return (
    <select id="okr-owner" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sem responsável</option>
      {q.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
  );
}

function useSave(onClose: () => void) {
  const qc = useQueryClient();
  return (fn: () => Promise<unknown>) => ({
    mutationFn: fn,
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["okrs"] }), onClose()),
  });
}

export function ObjectiveDialog({ workspaceId, period, periods, objective, onClose }: { workspaceId: string; period: string; periods: string[]; objective?: Objective; onClose: () => void }) {
  const [title, setTitle] = useState(objective?.title ?? "");
  const [description, setDescription] = useState(objective?.description ?? "");
  const [owner, setOwner] = useState(objective?.owner_id ?? "");
  const [p, setP] = useState(objective?.period ?? period);
  const opts = useSave(onClose);
  const body = { title, description, owner_id: owner || null, period: p };
  const save = useMutation(opts(() => (objective ? api.patch(`/objectives/${objective.id}`, body) : api.post("/objectives", { ...body, workspace_id: workspaceId }))));
  const submit = (e: FormEvent) => (e.preventDefault(), save.mutate());
  return (
    <Dialog title={objective ? "Editar objetivo" : "Novo objetivo"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="obj-title">Objetivo</label>
          <input id="obj-title" className="input" data-autofocus required maxLength={200} placeholder="Ex.: Tornar o atendimento ao cidadão mais rápido" value={title} onChange={(e) => setTitle(e.target.value)} />
          <span className="muted okr-hint">Qualitativo e inspirador: aonde queremos chegar. Como medir fica nos resultados-chave.</span>
        </div>
        <div className="field">
          <label htmlFor="obj-desc">Por que importa <span className="muted">(opcional)</span></label>
          <textarea id="obj-desc" className="textarea" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor="okr-owner">Responsável</label>
            <OwnerSelect workspaceId={workspaceId} value={owner} onChange={setOwner} />
          </div>
          <div className="field grow">
            <label htmlFor="obj-period">Trimestre</label>
            <select id="obj-period" className="select" value={p} onChange={(e) => setP(e.target.value)}>
              {nextPeriods(periods).map((x) => <option key={x} value={x}>{periodLabel(x)}</option>)}
            </select>
          </div>
        </div>
        {save.isError && <p className="error-box" role="alert">{(save.error as Error).message}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending}>Salvar objetivo</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Trimestres conhecidos mais o próximo, para planejar antes de o trimestre começar. */
export function nextPeriods(periods: string[]): string[] {
  const latest = [...periods].sort().at(-1);
  if (!latest) return periods;
  const y = Number(latest.slice(0, 4));
  const q = Number(latest.slice(-1));
  const next = q === 4 ? `${y + 1}-T1` : `${y}-T${q + 1}`;
  return [next, ...periods.filter((p) => p !== next)].sort().reverse();
}

export function KeyResultDialog({ workspaceId, objectiveId, kr, onClose }: { workspaceId: string; objectiveId: string; kr?: KeyResult; onClose: () => void }) {
  const [title, setTitle] = useState(kr?.title ?? "");
  const [owner, setOwner] = useState(kr?.owner_id ?? "");
  const [kind, setKind] = useState<KeyResult["kind"]>(kr?.kind ?? "number");
  const [start, setStart] = useState(String(kr?.start_value ?? 0));
  const [target, setTarget] = useState(String(kr?.target_value ?? 100));
  const [unit, setUnit] = useState(kr?.unit ?? "");
  const [project, setProject] = useState(kr?.project_id ?? "");
  const [cost, setCost] = useState(kr?.cost == null ? "" : String(kr.cost).replace(".", ","));
  const projects = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => api.get<{ projects: Project[] }>("/projects", { workspace_id: workspaceId }),
    enabled: kind === "project",
  });
  const n = (s: string) => Number(s.replace(",", "."));
  // Aceita "40.000,50" ou "40000.5": tira o separador de milhar antes de converter.
  const money = (s: string) => (s.trim() ? Number(s.trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) : null);
  const common = { title, owner_id: owner || null, kind, cost: money(cost) };
  const body =
    kind === "project"
      ? { ...common, project_id: project || null }
      : { ...common, start_value: n(start), target_value: n(target), unit };
  const opts = useSave(onClose);
  const save = useMutation(opts(() => (kr ? api.patch(`/key-results/${kr.id}`, body) : api.post(`/objectives/${objectiveId}/key-results`, body))));
  const submit = (e: FormEvent) => (e.preventDefault(), save.mutate());
  // Só os projetos do próprio espaço podem medir um KR (o servidor confere).
  const own = projects.data?.projects.filter((p) => !p.shared_from) ?? [];

  return (
    <Dialog title={kr ? "Editar resultado-chave" : "Novo resultado-chave"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="kr-title">Resultado-chave</label>
          <input id="kr-title" className="input" data-autofocus required maxLength={200} placeholder="Ex.: Reduzir o prazo médio de resposta de 30 para 10 dias" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="okr-owner">Responsável pelo check-in</label>
          <OwnerSelect workspaceId={workspaceId} value={owner} onChange={setOwner} />
          <span className="muted okr-hint">Quem responde pelo número. Essa pessoa recebe o lembrete na tela Hoje.</span>
        </div>
        <fieldset className="field">
          <legend className="label">Como medir</legend>
          <div className="row">
            <label className="chip"><input type="radio" name="kind" checked={kind === "number"} onChange={() => setKind("number")} /> Número (partida → meta)</label>
            <label className="chip"><input type="radio" name="kind" checked={kind === "project"} onChange={() => setKind("project")} /> Progresso de um projeto</label>
          </div>
        </fieldset>
        {kind === "number" ? (
          <div className="row">
            <div className="field grow">
              <label htmlFor="kr-start">Partida</label>
              <input id="kr-start" className="input" inputMode="decimal" required value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field grow">
              <label htmlFor="kr-target">Meta</label>
              <input id="kr-target" className="input" inputMode="decimal" required value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="field grow">
              <label htmlFor="kr-unit">Unidade</label>
              <input id="kr-unit" className="input" maxLength={20} placeholder="%, dias, R$ mil…" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="kr-project">Projeto</label>
            <select id="kr-project" className="select" required value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Escolha um projeto</option>
              {own.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="muted okr-hint">O progresso acompanha o projeto sozinho (tarefas concluídas ou % informado). O check-in só registra a confiança.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="kr-cost">Custo (R$) <span className="muted">(opcional)</span></label>
          <input id="kr-cost" className="input okr-cost-input" inputMode="decimal" placeholder="Ex.: 40.000" value={cost} onChange={(e) => setCost(e.target.value)} />
          <span className="muted okr-hint">Orçamento previsto para alcançar o resultado. Use 0 quando for feito pela equipe interna, sem custo externo.</span>
        </div>
        {save.isError && <p className="error-box" role="alert">{(save.error as Error).message}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending}>Salvar resultado-chave</button>
        </div>
      </form>
    </Dialog>
  );
}
