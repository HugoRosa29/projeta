import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { useState } from "react";
import { Dialog, useToast } from "../../components/ui";
import { api } from "../../services/api";

interface Unit {
  sigla: string;
  label: string;
  workspace_name: string | null;
  has_space: boolean;
}
/** GET /workspaces/{id}/org (work/org.py). */
export interface OrgView {
  unit: string | null;
  parent: string | null;
  chain: Unit[];
  children: Unit[];
  can_share: boolean;
  /** Destinos do compartilhamento direto: o organograma menos a própria unidade e a de cima. */
  units: { sigla: string; label: string }[];
  /** O organograma inteiro (cada unidade aponta para a de cima), para o desenho em Configurações. */
  tree: { sigla: string; label: string; parent: string | null; has_space: boolean }[];
  own: { id: string; name: string; shared_up: boolean; direct: string[] }[];
  received: { id: string; name: string; origin_unit: string | null; origin_workspace: string; shared_up: boolean; can_repass: boolean }[];
  /** Objetivos de OKR: sobem como os projetos (um nível por vez, repassáveis, só leitura). */
  own_objectives: { id: string; title: string; period: string; shared_up: boolean }[];
  received_objectives: { id: string; title: string; period: string; origin_unit: string | null; origin_workspace: string; shared_up: boolean }[];
}

export const orgKey = (workspaceId: string) => ["ws", "org", workspaceId];
export const useOrg = (workspaceId: string) =>
  useQuery({ queryKey: orgKey(workspaceId), queryFn: () => api.get<OrgView>(`/workspaces/${workspaceId}/org`) });

type Kind = "project" | "objective";

/** O que a tela precisa saber de um item: de quem é, com quem já está e para onde pode ir. */
interface Sharing {
  owned: boolean;
  origin: string | null;
  /** Pode subir (ou ser repassado) à unidade acima. */
  canGoUp: boolean;
  sharedUp: boolean;
  /** Setores escolhidos direto pelo dono (só projetos próprios). */
  direct: string[];
  /** Aceita compartilhamento direto (projeto do próprio espaço). */
  directOk: boolean;
}

function sharingOf(v: OrgView, kind: Kind, id: string): Sharing | null {
  if (!v.unit) return null;
  const up = !!v.parent;
  if (kind === "project") {
    const own = v.own.find((p) => p.id === id);
    if (own) return { owned: true, origin: null, canGoUp: up, sharedUp: own.shared_up, direct: own.direct, directOk: true };
    const rec = v.received.find((p) => p.id === id);
    if (rec) return { owned: false, origin: rec.origin_workspace, canGoUp: up && rec.can_repass, sharedUp: rec.shared_up, direct: [], directOk: false };
    return null;
  }
  const own = v.own_objectives.find((o) => o.id === id);
  if (own) return { owned: true, origin: null, canGoUp: up, sharedUp: own.shared_up, direct: [], directOk: false };
  const rec = v.received_objectives.find((o) => o.id === id);
  if (rec) return { owned: false, origin: rec.origin_workspace, canGoUp: up, sharedUp: rec.shared_up, direct: [], directOk: false };
  return null;
}

/**
 * Botão "Compartilhar" de um projeto ou objetivo, no próprio item. Some quando o espaço não é
 * de uma unidade do organograma. Quem não é Gestor vê com quem está, sem alterar; o servidor
 * confere de novo em cada mudança.
 */
export function ShareButton({ workspaceId, kind, id, name, className = "btn btn-line btn-sm", compact = false }: {
  workspaceId: string;
  kind: Kind;
  id: string;
  name: string;
  className?: string;
  /** Só o ícone (para a faixa do objetivo). */
  compact?: boolean;
}) {
  const q = useOrg(workspaceId);
  const [open, setOpen] = useState(false);
  const s = q.data && sharingOf(q.data, kind, id);
  if (!q.data || !s) return null;
  const count = (s.sharedUp ? 1 : 0) + s.direct.length;
  const label = count ? `Compartilhado com ${count} setor${count > 1 ? "es" : ""}` : "Compartilhar";
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={`${label}: ${name}`} title={label}>
        <Share2 size={15} aria-hidden />
        {!compact && <> {count ? `Compartilhado · ${count}` : "Compartilhar"}</>}
      </button>
      {open && <ShareDialog workspaceId={workspaceId} v={q.data} s={s} kind={kind} id={id} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ workspaceId, v, s, kind, id, name, onClose }: {
  workspaceId: string;
  v: OrgView;
  s: Sharing;
  kind: Kind;
  id: string;
  name: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pick, setPick] = useState("");
  const parent = v.parent ?? "";
  const label = (sigla: string) => v.chain.find((u) => u.sigla === sigla)?.label ?? v.units.find((u) => u.sigla === sigla)?.label ?? sigla;
  const grandparent = v.chain[2]?.label;
  const base = `/workspaces/${workspaceId}/org`;
  const upPath = kind === "project" ? `${base}/shares` : `${base}/objective-shares`;
  const body = kind === "project" ? { project_id: id } : { objective_id: id };

  const change = useMutation({
    mutationFn: ({ unit, on }: { unit: string; on: boolean }) => {
      if (unit === parent) return on ? api.post(upPath, body) : api.del(`${upPath}/${id}`);
      return on ? api.post(`${base}/direct-shares`, { project_id: id, unit }) : api.del(`${base}/direct-shares/${id}/${encodeURIComponent(unit)}`);
    },
    onSuccess: (_r, { unit, on }) => {
      qc.invalidateQueries({ queryKey: orgKey(workspaceId) });
      qc.invalidateQueries({ queryKey: [kind === "project" ? "projects" : "okrs"] });
      setPick("");
      toast(on ? `${label(unit)} agora vê “${name}”` : `${label(unit)} deixou de ver “${name}”`);
    },
    onError: (e) => toast((e as Error).message),
  });

  const what = kind === "project" ? "o projeto inteiro (ficha, tarefas, comentários)" : "o objetivo, os resultados-chave e o histórico de check-ins";
  const access = [
    ...(s.sharedUp ? [{ unit: parent, note: s.owned ? `unidade acima${grandparent ? ` · pode repassar a ${grandparent}` : ""}` : "repassado por este espaço" }] : []),
    ...s.direct.map((u) => ({ unit: u, note: "setor escolhido · não repassa" })),
  ];
  const options = [
    ...(s.canGoUp && !s.sharedUp ? [{ sigla: parent, label: `${label(parent)} — unidade acima` }] : []),
    ...(s.directOk ? v.units.filter((u) => !s.direct.includes(u.sigla)) : []),
  ];
  const busy = change.isPending;

  return (
    <Dialog title={`Compartilhar “${name}”`} onClose={onClose} className="share-dialog">
      <p className="muted">
        {s.owned
          ? <>Quem recebe vê {what}, só em leitura: ninguém de fora altera nada.</>
          : <>Veio de <strong>{s.origin}</strong>. Aqui você só decide se {parent ? label(parent) : "o nível acima"} também vê.</>}
      </p>

      <h3 className="share-h">Quem vê, além deste espaço</h3>
      {access.length === 0 ? (
        <p className="share-empty">Ninguém de fora. Só a sua equipe vê.</p>
      ) : (
        <ul className="share-list">
          {access.map((a) => (
            <li key={a.unit}>
              <span className="share-unit">{label(a.unit)}</span>
              <span className="muted share-note">{a.note}</span>
              {v.can_share && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => change.mutate({ unit: a.unit, on: false })} aria-label={`Parar de compartilhar com ${label(a.unit)}`}>
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {v.can_share && options.length > 0 && (
        <form
          className="share-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) change.mutate({ unit: pick, on: true });
          }}
        >
          <label className="sr-only" htmlFor="share-pick">Setor</label>
          <select id="share-pick" className="select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy} data-autofocus>
            <option value="">Escolha um setor…</option>
            {options.map((u) => <option key={u.sigla} value={u.sigla}>{u.label}</option>)}
          </select>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!pick || busy}>Compartilhar</button>
        </form>
      )}

      {!v.can_share && <p className="muted share-foot">Só o Gestor do espaço muda com quem é compartilhado.</p>}
      {v.can_share && !s.owned && !s.canGoUp && <p className="muted share-foot">Chegou direto de outro setor: só quem é dono decide quem mais vê.</p>}
      {v.can_share && s.owned && pick && pick !== parent && (
        <p className="muted share-foot">{label(pick)} está fora da sua linha hierárquica: vê, mas não repassa a ninguém.</p>
      )}
    </Dialog>
  );
}
