import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog, ErrorBox, useToast } from "../../components/ui";
import type { Folder } from "../../domain/areas";
import { api } from "../../services/api";

export function useFolders(workspaceId: string) {
  return useQuery({
    queryKey: ["folders", workspaceId],
    queryFn: () => api.get<{ folders: Folder[]; can_manage: boolean }>(`/workspaces/${workspaceId}/folders`),
  });
}

/** O mínimo de um projeto para organizá-lo: serve à linha do portfólio e ao projeto da lista. */
export interface Fileable {
  id: string;
  name: string;
  folder_id?: string | null;
  shared_from?: string | null;
}

export function useFolderMutations(workspaceId: string) {
  const qc = useQueryClient();
  // A pasta muda o panorama, a tela de projetos e a contagem das pastas: as três se renovam.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["folders", workspaceId] });
    qc.invalidateQueries({ queryKey: ["portfolio", workspaceId] });
    qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
  };
  return {
    create: useMutation({ mutationFn: (name: string) => api.post<Folder>(`/workspaces/${workspaceId}/folders`, { name }), onSuccess: refresh }),
    rename: useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<Folder>(`/folders/${id}`, { name }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.del<void>(`/folders/${id}`), onSuccess: refresh }),
    move: useMutation({
      mutationFn: ({ project, folder }: { project: string; folder: string | null }) => api.put(`/projects/${project}/folder`, { folder_id: folder }),
      onSuccess: refresh,
    }),
  };
}

/** Organiza os projetos próprios do espaço em pastas. Só aparece para quem pode (`can_manage`),
 *  mas quem decide é o servidor: cada ação é validada lá. */
export function FolderDialog({ workspaceId, folders, rows, onClose }: { workspaceId: string; folders: Folder[]; rows: Fileable[]; onClose: () => void }) {
  const toast = useToast();
  const m = useFolderMutations(workspaceId);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  // Ao abrir a edição de um nome, o foco vai para o campo; ao fechar, nada a fazer.
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => renameRef.current?.focus(), [editing?.id]);
  const own = rows.filter((r) => !r.shared_from).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const error = m.create.error ?? m.rename.error ?? m.remove.error ?? m.move.error;

  const create = (e: FormEvent) => {
    e.preventDefault();
    m.create.mutate(name, { onSuccess: (f) => (setName(""), toast(`Pasta “${f.name}” criada.`)) });
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (editing) m.rename.mutate(editing, { onSuccess: () => setEditing(null) });
  };

  return (
    <Dialog title="Pastas de projetos" onClose={onClose} className="fd-dialog">
      <p className="muted fd-intro">
        Agrupe os projetos do setor por tema. No panorama, cada pasta vira um bloco; os projetos fora de pasta ficam juntos num bloco próprio. Pastas só organizam a visão: não mudam quem vê ou edita cada projeto.
      </p>
      {error && <ErrorBox error={error} />}

      <form className="fd-new" onSubmit={create}>
        <label htmlFor="fd-name" className="sr-only">Nome da nova pasta</label>
        <input id="fd-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova pasta (ex.: ERP, Imóveis)" maxLength={60} data-autofocus />
        <button className="btn btn-sm" disabled={!name.trim() || m.create.isPending}>Criar pasta</button>
      </form>

      {folders.length > 0 && (
        <ul className="fd-folders" aria-label="Pastas">
          {folders.map((f) => (
            <li key={f.id} className="fd-folder">
              {editing?.id === f.id ? (
                <form className="fd-rename" onSubmit={rename}>
                  <label htmlFor={`fd-r-${f.id}`} className="sr-only">Novo nome de {f.name}</label>
                  <input id={`fd-r-${f.id}`} className="input" value={editing.name} onChange={(e) => setEditing({ id: f.id, name: e.target.value })} maxLength={60} ref={renameRef} />
                  <button className="btn btn-sm" aria-label="Salvar nome" disabled={!editing.name.trim()}><Check size={14} aria-hidden /></button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              ) : (
                <>
                  <strong className="fd-folder-name">{f.name}</strong>
                  <span className="muted">{f.project_count} {f.project_count === 1 ? "projeto" : "projetos"}</span>
                  {confirm === f.id ? (
                    <>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => m.remove.mutate(f.id, { onSuccess: () => setConfirm(null) })}>Excluir pasta</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Manter</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: f.id, name: f.name })} aria-label={`Renomear ${f.name}`}><Pencil size={14} aria-hidden /></button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(f.id)} aria-label={`Excluir ${f.name}`} title="Os projetos voltam para fora de pasta"><Trash2 size={14} aria-hidden /></button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="fd-sub">Projetos do setor</h3>
      {!folders.length && <p className="muted">Crie uma pasta para começar a organizar.</p>}
      <ul className="fd-projects">
        {own.map((r) => (
          <li key={r.id} className="fd-project">
            <label htmlFor={`fd-p-${r.id}`} title={r.name}>{r.name}</label>
            <select
              id={`fd-p-${r.id}`}
              className="input pn-select"
              value={r.folder_id ?? ""}
              disabled={!folders.length}
              onChange={(e) => m.move.mutate({ project: r.id, folder: e.target.value || null })}
            >
              <option value="">Sem pasta</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
