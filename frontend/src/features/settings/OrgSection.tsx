import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ErrorBox, Loading } from "../../components/ui";
import { api } from "../../services/api";

interface Unit {
  sigla: string;
  label: string;
  workspace_name: string | null;
  has_space: boolean;
}
export interface OrgView {
  unit: string | null;
  parent: string | null;
  chain: Unit[];
  children: Unit[];
  can_share: boolean;
  own: { id: string; name: string; shared_up: boolean }[];
  received: { id: string; name: string; origin_unit: string | null; origin_workspace: string; shared_up: boolean }[];
}

const label = (chain: Unit[], sigla: string | null) => chain.find((u) => u.sigla === sigla)?.label ?? sigla ?? "";

/** Lugar do espaço no organograma e o que ele compartilha com a unidade acima. O servidor decide
 *  quem pode compartilhar (Gestor do espaço) e quem vê o que foi recebido (matriz de permissões). */
export function OrgSection({ workspaceId, onError, onDone }: { workspaceId: string; onError: (e: unknown) => void; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const key = ["ws", "org", workspaceId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<OrgView>(`/workspaces/${workspaceId}/org`) });
  const after = (msg: string) => () => (qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["projects"] }), onDone(msg));
  const toggle = useMutation({
    mutationFn: (v: { id: string; on: boolean }) =>
      v.on ? api.post(`/workspaces/${workspaceId}/org/shares`, { project_id: v.id }) : api.del(`/workspaces/${workspaceId}/org/shares/${v.id}`),
    onSuccess: after("Compartilhamento atualizado"),
    onError,
  });
  const all = useMutation({ mutationFn: () => api.post<{ shared: number }>(`/workspaces/${workspaceId}/org/share-all`), onSuccess: after("Projetos compartilhados"), onError });

  if (q.isLoading) return <section className="card"><h2>Organização</h2><Loading /></section>;
  if (q.isError) return <section className="card"><h2>Organização</h2><ErrorBox error={q.error} onRetry={() => q.refetch()} /></section>;
  const v = q.data!;
  if (!v.unit) {
    return (
      <section className="card">
        <h2>Organização</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Este espaço não representa uma unidade do organograma. O espaço oficial de cada unidade é o da lotação, criado quando alguém lotado nela entra pelo GIA. Compartilhe projetos a partir dele.
        </p>
      </section>
    );
  }
  const parent = label(v.chain, v.parent);
  const busy = toggle.isPending || all.isPending;
  const parentHasSpace = v.chain[1]?.has_space ?? false;

  return (
    <section className="card">
      <h2>Organização</h2>
      <nav aria-label="Posição no organograma" className="muted" style={{ marginTop: 6 }}>
        {[...v.chain].reverse().map((u, i, arr) => (
          <span key={u.sigla}>{i === arr.length - 1 ? <strong>{u.label}</strong> : u.label}{i < arr.length - 1 && " › "}</span>
        ))}
      </nav>

      {v.parent && (
        <>
          <h3 style={{ marginTop: 16 }}>Compartilhar com {parent}</h3>
          <p className="muted">
            {parent} vê em leitura o projeto inteiro, mas não altera nada. Por padrão, nada é compartilhado.
            {!parentHasSpace && ` ${parent} ainda não tem espaço: ele aparece quando alguém lotado lá entrar.`}
          </p>
          {v.own.length === 0 ? <p className="muted">Nenhum projeto ativo neste espaço.</p> : (
            <ul className="task-list" style={{ marginTop: 8 }}>
              {v.own.map((p) => (
                <li key={p.id} className="task-row">
                  <label className="row" style={{ gap: 8, flex: 1 }}>
                    <input type="checkbox" className="check" checked={p.shared_up} disabled={!v.can_share || busy} onChange={(e) => toggle.mutate({ id: p.id, on: e.target.checked })} aria-label={`Compartilhar ${p.name} com ${parent}`} />
                    {p.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {v.can_share && v.own.some((p) => !p.shared_up) && (
            <button className="btn btn-line btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => confirm(`Compartilhar todos os projetos ativos com ${parent}? Projetos criados depois precisam ser marcados um a um.`) && all.mutate()}>
              Compartilhar todos
            </button>
          )}
          {!v.can_share && <p className="muted" style={{ marginTop: 8 }}>Só o Gestor do espaço altera o compartilhamento.</p>}
        </>
      )}

      {v.received.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Recebidos das unidades abaixo</h3>
          {v.parent && <p className="muted">Marque o que {parent} também deve ver. Recolher aqui recolhe também dos níveis acima.</p>}
          <ul className="task-list" style={{ marginTop: 8 }}>
            {v.received.map((p) => (
              <li key={p.id} className="task-row">
                <span style={{ flex: 1 }}><Link to={`/projetos/${p.id}`}>{p.name}</Link> <span className="badge">de {p.origin_workspace}</span></span>
                {v.parent && (
                  <label className="row" style={{ gap: 6 }}>
                    <input type="checkbox" className="check" checked={p.shared_up} disabled={!v.can_share || busy} onChange={(e) => toggle.mutate({ id: p.id, on: e.target.checked })} aria-label={`Repassar ${p.name} a ${parent}`} />
                    Repassar a {parent}
                  </label>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {v.children.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Unidades abaixo</h3>
          <p className="muted">{v.children.map((c) => `${c.label}${c.has_space ? "" : " (sem espaço ainda)"}`).join(" · ")}</p>
        </>
      )}
    </section>
  );
}
