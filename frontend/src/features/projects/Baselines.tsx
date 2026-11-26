import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Dialog, useToast } from "../../components/ui";
import { baselineLabel, type Baseline, type BaselineDetail } from "../../domain/baseline";
import { fmtDate } from "../../domain/types";
import { api } from "../../services/api";

export function useBaselines(projectId: string | undefined) {
  return useQuery({
    queryKey: ["baselines", projectId],
    queryFn: () => api.get<{ baselines: Baseline[]; can_manage: boolean }>(`/projects/${projectId}/baselines`),
    enabled: !!projectId,
  });
}

export function useBaseline(projectId: string | undefined, id: string | null) {
  return useQuery({
    queryKey: ["baseline", projectId, id],
    queryFn: () => api.get<BaselineDetail>(`/projects/${projectId}/baselines/${id}`),
    enabled: !!projectId && !!id,
  });
}

function useBaselineMutations(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["baselines", "baseline", "project"]) qc.invalidateQueries({ queryKey: [k] });
  };
  return {
    create: useMutation({ mutationFn: (body: { name: string; note: string }) => api.post<Baseline>(`/projects/${projectId}/baselines`, body), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.del<void>(`/projects/${projectId}/baselines/${id}`), onSuccess: refresh }),
  };
}

/** Lista as linhas de base, salva uma nova (quem gerencia) e escolhe qual comparar. */
export function BaselineDialog({ projectId, baselines, canManage, selected, onSelect, onClose }: {
  projectId: string;
  baselines: Baseline[];
  canManage: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const { create, remove } = useBaselineMutations(projectId);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const next = Math.max(0, ...baselines.map((b) => b.number)) + 1;

  const save = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, note },
      {
        onSuccess: (b) => {
          toast(`${baselineLabel(b)} salva. O cronograma agora compara com ela.`);
          onSelect(b.id);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog title="Linhas de base" onClose={onClose} className="bl-dialog">
      <p className="muted bl-intro">
        A <strong>linha de base inicial</strong> nasce com o projeto e guarda o primeiro prazo planejado de cada tarefa. As outras são fotografias do cronograma num momento: salve uma ao aprovar um replanejamento para medir os desvios a partir dele.
      </p>

      <ol className="bl-list">
        {[...baselines].reverse().map((b) => (
          <li key={b.id} className={`bl-item ${selected === b.id ? "on" : ""}`}>
            <div className="bl-item-main">
              <strong>{baselineLabel(b)}</strong>
              <span className="coord">
                {fmtDate(b.created_at.slice(0, 10))}{b.created_by_name ? ` · ${b.created_by_name}` : ""} · {b.task_count} {b.task_count === 1 ? "tarefa" : "tarefas"}{b.finish ? ` · término ${fmtDate(b.finish)}` : ""}
              </span>
              {b.note && <span className="bl-note">{b.note}</span>}
            </div>
            <div className="bl-item-actions">
              {confirm === b.id ? (
                <>
                  <span className="bl-confirm">Excluir de vez?</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Não</button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(b.id, { onSuccess: () => (setConfirm(null), toast(`${baselineLabel(b)} excluída`)), onError: (err) => toast((err as Error).message) })}
                  >
                    Excluir
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" aria-pressed={selected === b.id} onClick={() => (onSelect(b.id), onClose())}>
                    <Eye size={15} aria-hidden /> {selected === b.id ? "Comparando" : "Comparar"}
                  </button>
                  {canManage && b.number > 0 && (
                    <button type="button" className="icon-btn bl-del" aria-label={`Excluir ${baselineLabel(b)}`} title="Excluir" onClick={() => setConfirm(b.id)}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>

      {canManage ? (
        <form className="bl-form" onSubmit={save}>
          <h3>Salvar nova linha de base</h3>
          <p className="muted">Fotografa agora o início e o prazo de todas as tarefas com prazo. As linhas de base anteriores não mudam.</p>
          <div className="field">
            <label htmlFor="bl-name">Nome</label>
            <input id="bl-name" className="input" value={name} maxLength={80} placeholder={`Linha de base ${next}`} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bl-note">Motivo (opcional)</label>
            <textarea id="bl-note" className="textarea" value={note} maxLength={280} placeholder="Ex.: replanejamento aprovado no comitê de 10/12" onChange={(e) => setNote(e.target.value)} />
          </div>
          {create.error && <p className="form-error" role="alert">{(create.error as Error).message}</p>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending}>{create.isPending ? "Salvando…" : "Salvar linha de base"}</button>
        </form>
      ) : (
        <p className="muted bl-readonly">Só quem gerencia o projeto salva ou exclui linhas de base.</p>
      )}
    </Dialog>
  );
}
