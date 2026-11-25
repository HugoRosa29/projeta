import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Dialog, useToast } from "../../components/ui";
import type { Project, ProjectAttribute } from "../../domain/types";
import { attributeIndex } from "../../domain/work";
import { api } from "../../services/api";

export function ProjectDetails({ project, canManage }: { project: Project; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="card pane pv-about">
      <div className="card-head">
        <h2>Sobre o projeto</h2>
        {canManage && <button className="btn btn-line btn-sm" onClick={() => setEditing(true)}>Editar informações</button>}
      </div>
      {/* A ficha rola por dentro: descrição longa não empurra os outros cartões para baixo da tela. */}
      <div className="pane-body">
        <p className="muted" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{project.description || "Nenhuma descrição detalhada cadastrada."}</p>
        <dl className="pv-facts">
          {([["Responsável", project.responsible], ["Demandante / relator", project.requester], ["Referência de origem", project.external_ref]] as const).map(([label, value]) => (
            <div key={label}><dt className="coord">{label}</dt><dd>{value || "Não informado"}</dd></div>
          ))}
          {(project.attributes ?? []).map((a) => (
            <div key={a.name}><dt className="coord">{a.name}</dt><dd>{a.value}</dd></div>
          ))}
        </dl>
      </div>
      {editing && <EditDetails project={project} onClose={() => setEditing(false)} />}
    </section>
  );
}

function EditDetails({ project, onClose }: { project: Project; onClose: () => void }) {
  const [form, setForm] = useState({ name: project.name, summary: project.summary ?? "", description: project.description, responsible: project.responsible ?? "", requester: project.requester ?? "", external_ref: project.external_ref ?? "" });
  const [attrs, setAttrs] = useState<ProjectAttribute[]>(project.attributes ?? []);
  const [progress, setProgress] = useState(project.progress != null ? String(project.progress) : "");
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${project.id}`, { ...form, attributes: attrs, progress: progress === "" ? null : Number(progress) }),
    onSuccess: () => {
      for (const key of ["project", "projects", "portfolio"]) qc.invalidateQueries({ queryKey: [key] });
      toast("Informações atualizadas");
      onClose();
    },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };
  return (
    <Dialog title="Informações do projeto" onClose={onClose} className="project-details-dialog">
      <form onSubmit={submit} className="project-details-form">
        <div className="project-details-body">
        <p className="muted project-details-intro">Apresente o objetivo do projeto e indique quem conduz e solicita o trabalho.</p>
        <div className="project-details-columns">
        <section aria-label="Apresentação do projeto">
        <div className="field"><label htmlFor="detail-name">Nome</label><textarea id="detail-name" rows={2} data-autofocus className="textarea project-name-input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="detail-summary">Resumo</label><textarea id="detail-summary" className="textarea" rows={4} maxLength={280} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /><small className="muted">Aparece nos cartões e no cabeçalho. <span className="project-details-count">{form.summary.length}/280</span></small></div>
        <div className="field"><label htmlFor="detail-description">Descrição detalhada</label><textarea id="detail-description" className="textarea" rows={7} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </section>
        <section className="project-details-people" aria-label="Pessoas e origem">
        <h3>Pessoas e origem</h3>
        {([["responsible", "Responsável", 120], ["requester", "Demandante / relator", 120], ["external_ref", "Referência de origem", 80]] as const).map(([key, label, limit]) => (
          <div className="field" key={key}><label htmlFor={`detail-${key}`}>{label}</label><input id={`detail-${key}`} className="input" maxLength={limit} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>
        ))}
        <p className="muted">Responsável e demandante podem ser pessoas ou áreas. Gerencie o acesso na equipe do projeto.</p>
        <div className="field"><label htmlFor="detail-progress">% concluído informado</label><input id="detail-progress" type="number" min={0} max={100} step={1} inputMode="numeric" className="input" value={progress} placeholder="Calcular pelas tarefas" aria-describedby="detail-progress-help" onChange={(e) => setProgress(e.target.value)} /><small id="detail-progress-help" className="muted">Como o “% Terminado” do Redmine. Deixe vazio para calcular pelas tarefas concluídas.</small></div>
        </section>
        </div>
        <AttributesEditor workspaceId={project.workspace_id} value={attrs} onChange={setAttrs} />
        {save.isError && <p className="form-error" role="alert">{(save.error as Error).message}</p>}
        </div>
        <div className="project-details-footer"><button type="button" className="btn btn-line" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar informações"}</button></div>
      </form>
    </Dialog>
  );
}

/** Campos livres: a pessoa dá o nome e o valor. Nomes e valores já usados no espaço viram
 * sugestões, para o portfólio agrupar sem exigir cadastro prévio. */
function AttributesEditor({ workspaceId, value, onChange }: { workspaceId: string; value: ProjectAttribute[]; onChange: (v: ProjectAttribute[]) => void }) {
  const q = useQuery({
    queryKey: ["projects", workspaceId, "attributes"],
    queryFn: () => api.get<{ projects: Project[] }>("/projects", { workspace_id: workspaceId, include_archived: true }),
  });
  const index = attributeIndex((q.data?.projects ?? []).map((p) => p.attributes));
  const set = (i: number, patch: Partial<ProjectAttribute>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const valuesFor = (name: string) => [...index].find(([n]) => n.toLocaleLowerCase("pt-BR") === name.trim().toLocaleLowerCase("pt-BR"))?.[1] ?? [];
  return (
    <section className="attr-editor" aria-labelledby="attr-title">
      <h3 id="attr-title">Campos do portfólio</h3>
      <p className="muted">Crie os campos que fizerem sentido (ex.: Complexidade, PDTI, Custo estimado). Eles aparecem no cartão e servem de filtro no portfólio.</p>
      <datalist id="attr-names">{[...index.keys()].map((n) => <option key={n} value={n} />)}</datalist>
      {value.map((a, i) => (
        <div className="attr-row" key={i}>
          <label className="sr-only" htmlFor={`attr-name-${i}`}>Nome do campo {i + 1}</label>
          <input id={`attr-name-${i}`} className="input" list="attr-names" maxLength={40} placeholder="Nome" value={a.name} onChange={(e) => set(i, { name: e.target.value })} />
          <label className="sr-only" htmlFor={`attr-value-${i}`}>Valor de {a.name || `campo ${i + 1}`}</label>
          <input id={`attr-value-${i}`} className="input" list={`attr-values-${i}`} maxLength={200} placeholder="Valor" value={a.value} onChange={(e) => set(i, { value: e.target.value })} />
          <datalist id={`attr-values-${i}`}>{valuesFor(a.name).map((v) => <option key={v} value={v} />)}</datalist>
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remover ${a.name || `campo ${i + 1}`}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={16} aria-hidden /></button>
        </div>
      ))}
      {value.length < 20 && (
        <button type="button" className="btn btn-line btn-sm" onClick={() => onChange([...value, { name: "", value: "" }])}><Plus size={16} aria-hidden /> Adicionar campo</button>
      )}
    </section>
  );
}
