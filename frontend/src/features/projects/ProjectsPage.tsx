import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Skyline } from "../../components/Skyline";
import { Dialog, Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import type { Project } from "../../domain/types";
import { api } from "../../services/api";
import { projectProgress } from "../../domain/work";
import { coverUrl } from "./cover";
import { useSession } from "../../app/session";

export function ProjectsPage() {
  const { workspace } = useSession();
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const canCreate = workspace.role === "admin" || workspace.role === "manager";
  const q = useQuery({
    queryKey: ["projects", workspace.id, archived],
    queryFn: () => api.get<{ projects: Project[] }>("/projects", { workspace_id: workspace.id, include_archived: archived }),
  });
  const list = (q.data?.projects ?? []).filter((p) => archived || p.status === "active");
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Projetos</p>
          <h1>Projetos</h1>
        </div>
        <span className="spacer" />
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Mostrar arquivados
        </label>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Novo projeto
          </button>
        )}
      </div>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && list.length === 0 && (
        <Empty
          title="Nenhum projeto ainda"
          action={canCreate ? <button className="btn btn-primary" onClick={() => setCreating(true)}>Criar o primeiro projeto</button> : undefined}
        >
          {canCreate ? "Crie um projeto ou descreva o objetivo ao assistente para ele propor as fases e tarefas." : "Peça a um gerente ou administrador para incluir você em um projeto."}
        </Empty>
      )}
      <div className="grid">
        {list.map((p) => {
          const { pct, informed } = projectProgress(p);
          return (
            <Link key={p.id} to={`/projetos/${p.id}`} className="card" style={{ textDecoration: "none", display: "grid", gap: 10 }}>
              {p.cover_version ? (
                <img className="card-cover" src={coverUrl(p.id, p.cover_version)} alt="" loading="lazy" />
              ) : (
                <div className="card-cover card-cover-default" aria-hidden="true"><Skyline chips={false} /></div>
              )}
              <div className="row">
                <h2 style={{ flex: 1 }}>{p.name}</h2>
                {p.status === "archived" && <span className="badge">Arquivado</span>}
              </div>
              {p.summary && <p className="muted">{p.summary}</p>}
              {p.responsible && <span className="coord">Responsável: {p.responsible}</span>}
              <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso"><span style={{ width: `${pct}%` }} /></div>
              <span className="coord">{p.done_count}/{p.task_count} tarefas · {pct}%{informed ? " (informado)" : ""}</span>
            </Link>
          );
        })}
      </div>
      {creating && <NewProject workspaceId={workspace.id} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProject({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [summary, setSummary] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.post<Project>("/projects", { workspace_id: workspaceId, name, description, summary }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast("Projeto criado");
      nav(`/projetos/${p.id}`);
    },
  });
  const submit = (e: FormEvent) => (e.preventDefault(), m.mutate());
  return (
    <Dialog title="Novo projeto" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="p-name">Nome</label>
          <input id="p-name" data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </div>
        <div className="field">
          <label htmlFor="p-summary">Resumo (opcional)</label>
          <textarea id="p-summary" className="textarea" maxLength={280} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Objetivo do projeto em poucas palavras" />
          <small className="muted">Aparece nos cartões e no cabeçalho. Até 280 caracteres.</small>
        </div>
        <div className="field">
          <label htmlFor="p-desc">Descrição detalhada (opcional)</label>
          <textarea id="p-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {m.isError && <p className="form-error" role="alert">{(m.error as Error).message}</p>}
        <div className="row">
          <button className="btn btn-primary" disabled={m.isPending}>Criar projeto</button>
          <button type="button" className="btn btn-line" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Dialog>
  );
}
