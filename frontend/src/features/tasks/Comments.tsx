import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorBox, useToast } from "../../components/ui";
import { api } from "../../services/api";

const MAX_CHARS = 5000; // o mesmo limite do servidor (work/comments.py)

interface Comment {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  can_edit: boolean;
  can_delete: boolean;
}

/** Comentários em texto puro (sem HTML nem Markdown), na ordem em que foram escritos. */
export function Comments({ taskId, canWrite }: { taskId: string; canWrite: boolean }) {
  const key = ["comments", taskId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ comments: Comment[] }>(`/tasks/${taskId}/comments`),
  });
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  // O histórico do projeto registra "comentou", então ele também precisa ser recarregado.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["project"] });
  };
  const onError = (e: unknown) => toast((e as Error).message);
  const add = useMutation({
    mutationFn: (text: string) => api.post(`/tasks/${taskId}/comments`, { body: text }),
    onSuccess: () => (setBody(""), refresh()),
    onError,
  });
  const edit = useMutation({
    mutationFn: (c: { id: string; body: string }) => api.patch(`/comments/${c.id}`, { body: c.body }),
    onSuccess: () => (setEditing(null), refresh()),
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/comments/${id}`),
    onSuccess: refresh,
    onError,
  });

  const items = q.data?.comments ?? [];
  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) add.mutate(body.trim());
  };
  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (editing?.body.trim()) edit.mutate(editing);
  };
  const confirmRemove = (id: string) => {
    if (confirm("Remover este comentário?")) remove.mutate(id);
  };

  return (
    <section className="task-section" aria-labelledby="comments-title">
      <h3 id="comments-title">
        <MessageSquare size={16} aria-hidden /> Comentários{" "}
        {items.length > 0 && <span className="badge">{items.length}</span>}
      </h3>
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && <p className="muted">Nenhum comentário ainda.</p>}
      <ol className="comments">
        {items.map((c) => (
          <li key={c.id}>
            <div className="comment-head">
              <strong>{c.author_name}</strong>
              <span className="coord">
                {new Date(c.created_at).toLocaleString("pt-BR")}
                {c.edited_at ? " · editado" : ""}
              </span>
              <span style={{ flex: 1 }} />
              {c.can_edit && editing?.id !== c.id && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: c.id, body: c.body })}>
                  Editar
                </button>
              )}
              {c.can_delete && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirmRemove(c.id)}>
                  Remover
                </button>
              )}
            </div>
            {editing?.id === c.id ? (
              <form onSubmit={submitEdit}>
                <label className="sr-only" htmlFor={`edit-${c.id}`}>
                  Editar comentário
                </label>
                <textarea
                  id={`edit-${c.id}`}
                  className="textarea"
                  rows={3}
                  maxLength={MAX_CHARS}
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                />
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn btn-primary btn-sm" disabled={edit.isPending || !editing.body.trim()}>
                    Salvar
                  </button>
                  <button type="button" className="btn btn-line btn-sm" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <p className="comment-body">{c.body}</p>
            )}
          </li>
        ))}
      </ol>
      {canWrite && (
        <form onSubmit={submitNew}>
          <label className="sr-only" htmlFor={`new-comment-${taskId}`}>
            Novo comentário
          </label>
          <textarea
            id={`new-comment-${taskId}`}
            className="textarea"
            rows={3}
            maxLength={MAX_CHARS}
            placeholder="Registre andamento, decisão ou pendência…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn btn-primary btn-sm" disabled={add.isPending || !body.trim()}>
              Comentar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
