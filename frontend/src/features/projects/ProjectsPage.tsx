import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FolderCog } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Skyline } from "../../components/Skyline";
import { Dialog, Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import { can, type Project } from "../../domain/types";
import { api } from "../../services/api";
import { projectProgress } from "../../domain/work";
import { coverUrl } from "./cover";
import { useSession } from "../../app/session";
import { useViewMode, ViewToggle, type ViewMode } from "../../components/ViewToggle";
import { FolderDialog, useFolders } from "../today/Folders";
import { ExplorerProvider, FolderGrid, FolderTitle, FolderTree, useExplorer } from "./ProjectFolders";

export function ProjectsPage() {
  const { workspace } = useSession();
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const [view, setView] = useViewMode("projects");
  const canCreate = can(workspace, "project.create");
  const q = useQuery({
    queryKey: ["projects", workspace.id, archived],
    queryFn: () => api.get<{ projects: Project[] }>("/projects", { workspace_id: workspace.id, include_archived: archived }),
  });
  const list = (q.data?.projects ?? []).filter((p) => archived || p.status === "active");
  // Pastas do espaço, como no explorador de arquivos: painel de pastas ao lado; na raiz, as
  // pastas e os projetos fora delas; com uma pasta aberta (?pasta=…, para o voltar do navegador
  // funcionar), só os projetos dela.
  const fq = useFolders(workspace.id);
  const folders = useMemo(() => fq.data?.folders ?? [], [fq.data]);
  const canManage = !!fq.data?.can_manage;
  const [params, setParams] = useSearchParams();
  const current = folders.find((f) => f.id === params.get("pasta")) ?? null;
  const openFolder = (id: string | null) => setParams(id ? { pasta: id } : {});
  const known = new Set(folders.map((f) => f.id));
  const inFolder = (p: Project) => (p.folder_id && known.has(p.folder_id) ? p.folder_id : null);
  const shown = list.filter((p) => inFolder(p) === (current?.id ?? null));
  const [organizing, setOrganizing] = useState(false);
  // Sem pastas e sem poder criá-las, a tela fica como sempre foi: sem painel lateral.
  const explorer = canManage || folders.length > 0;
  return (
    <ExplorerProvider workspaceId={workspace.id} folders={folders} projects={list} canManage={canManage} current={current} onOpen={openFolder}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Projetos</p>
          <h1>Projetos</h1>
        </div>
        <span className="spacer" />
        <ViewToggle mode={view} onChange={setView} />
        <div className="view-toggle">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-pressed={archived}
            onClick={() => setArchived((v) => !v)}
            title={archived ? "Ocultar projetos arquivados" : "Mostrar também os projetos arquivados"}
          >
            <Archive size={16} aria-hidden /> Arquivados
          </button>
        </div>
        {canManage && folders.length > 0 && (
          <button className="btn btn-line" onClick={() => setOrganizing(true)} title="Escolher a pasta de cada projeto numa lista (sem arrastar)">
            <FolderCog size={16} aria-hidden /> Organizar
          </button>
        )}
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Novo projeto
          </button>
        )}
      </div>
      <div className={explorer ? "px" : undefined}>
        {explorer && <FolderTree total={list.length} />}
        <div className="px-main">
          {q.isLoading && <Loading />}
          {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
          {current ? <FolderTitle f={current} /> : <FolderGrid />}
          {!current && folders.length > 0 && shown.length > 0 && <h2 className="pf-loose">Fora de pasta</h2>}
          {q.data && current && shown.length === 0 && (
            <Empty title="Pasta vazia">
              {canManage ? "Arraste projetos até esta pasta no painel ao lado, ou use o botão direito num projeto › Mover para." : "Ainda não há projetos nesta pasta."}
            </Empty>
          )}
          {q.data && list.length === 0 && !current && !folders.length && (
            <Empty
              title="Nenhum projeto ainda"
              action={canCreate ? <button className="btn btn-primary" onClick={() => setCreating(true)}>Criar o primeiro projeto</button> : undefined}
            >
              {canCreate ? "Crie um projeto ou descreva o objetivo ao assistente para ele propor as fases e tarefas." : "Peça a um gerente ou administrador para incluir você em um projeto."}
            </Empty>
          )}
          {shown.length > 0 && <ProjectItems projects={shown} view={view} />}
        </div>
      </div>
      {creating && <NewProject workspaceId={workspace.id} folder={current} onClose={() => setCreating(false)} />}
      {organizing && <FolderDialog workspaceId={workspace.id} folders={folders} rows={list.filter((p) => p.status === "active")} onClose={() => setOrganizing(false)} />}
    </ExplorerProvider>
  );
}

/** Projetos em blocos ou lista. Quem organiza arrasta cada um até uma pasta; o botão direito
 *  mostra abrir e mover. */
function ProjectItems({ projects, view }: { projects: Project[]; view: ViewMode }) {
  const x = useExplorer();
  if (view === "list") {
    return (
      <div className="plist" role="list" aria-label="Projetos">
        <div className="plist-head" aria-hidden="true">
          <span /><span>Projeto</span><span>Responsável</span><span>Progresso</span>
        </div>
        {projects.map((p) => <ProjectRow key={p.id} p={p} />)}
      </div>
    );
  }
  return (
    <div className="grid">
      {projects.map((p) => {
        const { pct, informed } = projectProgress(p);
        return (
          <Link key={p.id} to={`/projetos/${p.id}`} className="card" style={{ textDecoration: "none", display: "grid", gap: 10 }} {...x.dragProps(p)} onContextMenu={(e) => x.projectMenu(e, p)}>
            {p.cover_version ? (
              <img className="card-cover" src={coverUrl(p.id, p.cover_version)} alt="" loading="lazy" draggable={false} />
            ) : (
              <div className="card-cover card-cover-default" aria-hidden="true"><Skyline chips={false} /></div>
            )}
            <div className="row">
              <h2 style={{ flex: 1 }}>{p.name}</h2>
              {p.status === "archived" && <span className="badge">Arquivado</span>}
              {p.shared_from && <span className="badge" title="Compartilhado no organograma: só leitura">de {p.shared_from}</span>}
            </div>
            {p.summary && <p className="muted">{p.summary}</p>}
            {p.responsible && <span className="coord">Responsável: {p.responsible}</span>}
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso"><span style={{ width: `${pct}%` }} /></div>
            <span className="coord">{p.done_count}/{p.task_count} tarefas · {pct}%{informed ? " (informado)" : ""}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Uma linha por projeto: o mínimo de altura para caber muitos na tela sem rolar. */
function ProjectRow({ p }: { p: Project }) {
  const x = useExplorer();
  const { pct, informed } = projectProgress(p);
  return (
    <Link to={`/projetos/${p.id}`} className="plist-row" role="listitem" {...x.dragProps(p)} onContextMenu={(e) => x.projectMenu(e, p)}>
      {p.cover_version ? (
        <img className="plist-thumb" src={coverUrl(p.id, p.cover_version)} alt="" loading="lazy" draggable={false} />
      ) : (
        <span className="plist-thumb card-cover-default" aria-hidden="true"><Skyline chips={false} /></span>
      )}
      <span className="plist-name">
        <strong>{p.name}</strong>
        {p.status === "archived" && <span className="badge">Arquivado</span>}
        {p.shared_from && <span className="badge" title="Compartilhado no organograma: só leitura">de {p.shared_from}</span>}
        {p.summary && <small className="muted" title={p.summary}>{p.summary}</small>}
      </span>
      <span className="plist-cell muted">{p.responsible || "—"}</span>
      <span className="plist-prog">
        <span className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${p.name}`}><span style={{ width: `${pct}%` }} /></span>
        <span className="coord">{pct}%{informed ? "*" : ""} · {p.done_count}/{p.task_count}</span>
      </span>
    </Link>
  );
}

/** Criado com uma pasta aberta, o projeto já nasce nela. */
function NewProject({ workspaceId, folder, onClose }: { workspaceId: string; folder: { id: string; name: string } | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [summary, setSummary] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: async () => {
      const p = await api.post<Project>("/projects", { workspace_id: workspaceId, name, description, summary });
      if (!folder) return { p, filed: true };
      // Guardar na pasta exige gerir projetos; sem essa permissão o projeto fica fora de pasta.
      const filed = await api.put(`/projects/${p.id}/folder`, { folder_id: folder.id }).then(() => true, () => false);
      return { p, filed };
    },
    onSuccess: ({ p, filed }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["folders", workspaceId] });
      toast(folder ? (filed ? `Projeto criado na pasta ${folder.name}` : "Projeto criado fora de pasta: você não pode organizar pastas") : "Projeto criado");
      nav(`/projetos/${p.id}`);
    },
  });
  const submit = (e: FormEvent) => (e.preventDefault(), m.mutate());
  return (
    <Dialog title={folder ? `Novo projeto em ${folder.name}` : "Novo projeto"} onClose={onClose}>
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
