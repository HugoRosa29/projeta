import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "../../components/ui";
import { api } from "../../services/api";

interface Pending {
  matricula: string;
  created_at: string;
}

/** Convida pela matrícula do GIA: vale na hora para quem já entrou e no primeiro login para os demais. */
export function InviteByMatricula({ projectId }: { projectId: string }) {
  const [matricula, setMatricula] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["invites", projectId],
    queryFn: () => api.get<{ invites: Pending[] }>(`/projects/${projectId}/invites`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["invites", projectId] });
    qc.invalidateQueries({ queryKey: ["project"] });
  };
  const invite = useMutation({
    mutationFn: (m: string) => api.post<{ message: string }>(`/projects/${projectId}/invites`, { matricula: m }),
    onSuccess: (r) => {
      setMatricula("");
      refresh();
      toast(r.message);
    },
    onError: (e) => toast((e as Error).message),
  });
  const revoke = useMutation({
    mutationFn: (m: string) => api.del(`/projects/${projectId}/invites/${encodeURIComponent(m)}`),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message),
  });
  return (
    <div style={{ marginTop: 14 }}>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (matricula.trim()) invite.mutate(matricula.trim());
        }}
      >
        <label htmlFor="invite-matricula">Convidar pela matrícula do GIA</label>
        <div className="row">
          <input
            id="invite-matricula"
            className="input grow"
            maxLength={40}
            autoComplete="off"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
          />
          <button className="btn btn-line btn-sm" disabled={!matricula.trim() || invite.isPending}>
            Convidar
          </button>
        </div>
      </form>
      {(pending.data?.invites ?? []).length > 0 && (
        <>
          <p className="coord">Aguardando o primeiro acesso</p>
          <ul className="task-list">
            {pending.data!.invites.map((i) => (
              <li key={i.matricula} className="task-row">
                {i.matricula}
                <span className="spacer" />
                <button className="btn btn-line btn-sm" onClick={() => revoke.mutate(i.matricula)} aria-label={`Cancelar convite de ${i.matricula}`}>
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
