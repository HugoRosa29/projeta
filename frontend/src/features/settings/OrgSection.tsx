import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorBox, Loading } from "../../components/ui";
import { api } from "../../services/api";
import { orgKey, useOrg, type OrgView } from "../sharing/ShareButton";

export type { OrgView } from "../sharing/ShareButton";

type Node = OrgView["tree"][number];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nameOf = (u: Node) => u.label || u.sigla;

/** Lugar do espaço no organograma e tudo o que ele compartilha, desenhado como o próprio
 *  organograma: clicar num setor mostra os projetos (e, para a unidade acima, os objetivos e o
 *  repasse do que foi recebido) que ele vê. O botão "Compartilhar" no próprio item é só um atalho
 *  para o mesmo. O servidor decide quem pode compartilhar (Gestor do espaço) e quem vê o quê. */
export function OrgSection({ workspaceId, onError, onDone }: { workspaceId: string; onError: (e: unknown) => void; onDone: (msg: string) => void }) {
  const q = useOrg(workspaceId);
  if (q.isLoading) return <section className="card"><h2>Organização</h2><Loading /></section>;
  if (q.isError) return <section className="card"><h2>Organização</h2><ErrorBox error={q.error} onRetry={() => q.refetch()} /></section>;
  const v = q.data!;
  if (!v.unit) {
    return (
      <section className="card">
        <h2>Organização</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Este espaço não representa uma unidade do organograma, então não compartilha com outros setores. Isso é feito no espaço da sua lotação.
        </p>
      </section>
    );
  }
  return <OrgChart workspaceId={workspaceId} v={v} onError={onError} onDone={onDone} />;
}

function OrgChart({ workspaceId, v, onError, onDone }: { workspaceId: string; v: OrgView; onError: (e: unknown) => void; onDone: (msg: string) => void }) {
  const [selected, setSelected] = useState<string | null>(v.parent ?? v.unit);
  // Abre a linha hierárquica do espaço: assim os setores vizinhos já aparecem sem clicar.
  const [open, setOpen] = useState<Set<string>>(() => new Set(v.chain.map((u) => u.sigla)));
  const [filter, setFilter] = useState("");

  const { kids, bySigla, roots } = useMemo(() => {
    const kids = new Map<string, Node[]>();
    const bySigla = new Map<string, Node>();
    const roots: Node[] = [];
    for (const u of v.tree) {
      bySigla.set(u.sigla, u);
      if (u.parent) kids.set(u.parent, [...(kids.get(u.parent) ?? []), u]);
      else roots.push(u);
    }
    return { kids, bySigla, roots };
  }, [v.tree]);

  // Na busca, mostra quem casa e os superiores de cada um, tudo aberto.
  const shown = useMemo(() => {
    const f = fold(filter.trim());
    if (!f) return null;
    const keep = new Set<string>();
    for (const u of v.tree) {
      if (!fold(`${u.sigla} ${u.label}`).includes(f)) continue;
      for (let s: string | null = u.sigla; s && !keep.has(s); s = bySigla.get(s)?.parent ?? null) keep.add(s);
    }
    return keep;
  }, [filter, v.tree, bySigla]);

  const count = (sigla: string) =>
    sigla === v.parent
      ? [...v.own, ...v.own_objectives, ...v.received, ...v.received_objectives].filter((i) => i.shared_up).length
      : v.own.filter((p) => p.direct.includes(sigla)).length;

  const toggle = (sigla: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(sigla)) n.delete(sigla);
      else n.add(sigla);
      return n;
    });

  const renderNode = (u: Node) => {
    if (shown && !shown.has(u.sigla)) return null;
    const children = kids.get(u.sigla) ?? [];
    const expanded = children.length > 0 && (shown ? true : open.has(u.sigla));
    const n = u.sigla === v.unit ? 0 : count(u.sigla);
    const tag = u.sigla === v.unit ? "seu espaço" : u.sigla === v.parent ? "acima" : null;
    const name = nameOf(u);
    return (
      <li key={u.sigla}>
        <div className="orgc-row">
          {children.length > 0 ? (
            <button type="button" className={`orgc-tog${expanded ? " is-open" : ""}`} onClick={() => toggle(u.sigla)} aria-expanded={expanded} aria-label={`${expanded ? "Recolher" : "Abrir"} ${name}`} disabled={!!shown}>
              <ChevronRight size={14} aria-hidden />
            </button>
          ) : <span className="orgc-tog" aria-hidden />}
          <button
            type="button"
            className={`orgc-unit${u.sigla === v.unit ? " is-mine" : ""}${u.sigla === selected ? " is-selected" : ""}${u.has_space ? "" : " no-space"}`}
            aria-pressed={u.sigla === selected}
            aria-label={`${name}${tag ? ` (${tag})` : ""}${n ? `, ${n} compartilhado${n > 1 ? "s" : ""}` : ""}`}
            onClick={() => setSelected(u.sigla)}
          >
            <span className="orgc-name">{name}</span>
            {tag && <span className="orgc-tag">{tag}</span>}
            {n > 0 && <span className="orgc-count" aria-hidden>{n}</span>}
          </button>
        </div>
        {expanded && <ul>{children.map(renderNode)}</ul>}
      </li>
    );
  };

  const sel = selected ? bySigla.get(selected) : undefined;

  return (
    <section className="card">
      <h2>Organização</h2>
      <nav aria-label="Posição no organograma" className="muted" style={{ marginTop: 6 }}>
        {[...v.chain].reverse().map((u, i, arr) => (
          <span key={u.sigla}>{i === arr.length - 1 ? <strong>{u.label}</strong> : u.label}{i < arr.length - 1 && " › "}</span>
        ))}
      </nav>
      <p className="muted" style={{ marginTop: 6 }}>Clique num setor para escolher o que ele vê. Quem recebe vê só em leitura; o número no setor é quanto você já compartilha com ele.</p>

      <div className="orgc">
        <div className="orgc-tree">
          <label className="orgc-search">
            <Search size={15} aria-hidden />
            <span className="sr-only">Buscar setor</span>
            <input className="input" type="search" placeholder="Buscar setor…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <ul className="orgc-root" aria-label="Organograma">
            {roots.map(renderNode)}
          </ul>
          {shown && shown.size === 0 && <p className="muted" style={{ padding: 8 }}>Nenhum setor com esse nome.</p>}
        </div>
        <div className="orgc-panel" aria-live="polite">
          {sel ? <UnitPanel key={sel.sigla} workspaceId={workspaceId} v={v} u={sel} onError={onError} onDone={onDone} /> : <p className="muted">Escolha um setor no organograma.</p>}
        </div>
      </div>
    </section>
  );
}

function UnitPanel({ workspaceId, v, u, onError, onDone }: { workspaceId: string; v: OrgView; u: Node; onError: (e: unknown) => void; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const base = `/workspaces/${workspaceId}/org`;
  const after = (msg: string, list: string) => () => (
    qc.invalidateQueries({ queryKey: orgKey(workspaceId) }), qc.invalidateQueries({ queryKey: [list] }), onDone(msg)
  );
  const up = useMutation({
    mutationFn: (x: { id: string; on: boolean }) => (x.on ? api.post(`${base}/shares`, { project_id: x.id }) : api.del(`${base}/shares/${x.id}`)),
    onSuccess: after("Compartilhamento atualizado", "projects"),
    onError,
  });
  const direct = useMutation({
    mutationFn: (x: { id: string; on: boolean }) =>
      x.on ? api.post(`${base}/direct-shares`, { project_id: x.id, unit: u.sigla }) : api.del(`${base}/direct-shares/${x.id}/${encodeURIComponent(u.sigla)}`),
    onSuccess: after("Compartilhamento atualizado", "projects"),
    onError,
  });
  const objUp = useMutation({
    mutationFn: (x: { id: string; on: boolean }) =>
      x.on ? api.post(`${base}/objective-shares`, { objective_id: x.id }) : api.del(`${base}/objective-shares/${x.id}`),
    onSuccess: after("Compartilhamento atualizado", "okrs"),
    onError,
  });
  const all = useMutation({ mutationFn: () => api.post<{ shared: number }>(`${base}/share-all`), onSuccess: after("Projetos compartilhados", "projects"), onError });

  const busy = up.isPending || direct.isPending || objUp.isPending || all.isPending;
  const off = !v.can_share || busy;
  const name = nameOf(u);
  const grandparent = v.chain[2]?.label;
  const readOnly = !v.can_share && <p className="muted orgc-foot">Só o Gestor do espaço altera o compartilhamento.</p>;
  const noSpace = !u.has_space && <p className="muted orgc-foot">{name} ainda não tem espaço: verá o que for compartilhado quando alguém lotado lá entrar.</p>;
  const check = (key: string, label: string, checked: boolean, onChange: (on: boolean) => void, text: ReactNode) => (
    <li key={key} className="task-row">
      <label className="row orgc-check" style={{ gap: 8, flex: 1 }}>
        <input type="checkbox" className="check" checked={checked} disabled={off} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span>{text}</span>
      </label>
    </li>
  );
  const projects = (shared: (p: OrgView["own"][number]) => boolean, mut: typeof up | typeof direct) =>
    v.own.length === 0 ? <p className="muted">Nenhum projeto ativo neste espaço.</p> : (
      <ul className="task-list">{v.own.map((p) => check(p.id, `Compartilhar ${p.name} com ${name}`, shared(p), (on) => mut.mutate({ id: p.id, on }), p.name))}</ul>
    );

  if (u.sigla === v.unit) {
    const got = [...v.received.map((p) => ({ id: p.id, title: p.name, from: p.origin_workspace, to: `/projetos/${p.id}` })), ...v.received_objectives.map((o) => ({ id: o.id, title: o.title, from: o.origin_workspace, to: "/metas" }))];
    return (
      <>
        <h3>{name} <span className="orgc-tag">seu espaço</span></h3>
        <p className="muted orgc-sub">O que outras unidades compartilharam com este espaço.</p>
        {got.length === 0 ? <p className="muted">Nada recebido ainda.</p> : (
          <ul className="task-list">
            {got.map((g) => <li key={g.id} className="task-row"><span style={{ flex: 1 }}><Link to={g.to}>{g.title}</Link> <span className="badge">de {g.from}</span></span></li>)}
          </ul>
        )}
      </>
    );
  }

  if (u.sigla === v.parent) {
    const repass = [...v.received.filter((p) => p.can_repass), ...v.received_objectives];
    return (
      <>
        <h3>{name} <span className="orgc-tag">acima</span></h3>
        <p className="muted orgc-sub">Vê em leitura, sem alterar nada{grandparent ? `, e pode repassar a ${grandparent}` : ""}.</p>
        <h4>Projetos</h4>
        {projects((p) => p.shared_up, up)}
        {v.can_share && v.own.some((p) => !p.shared_up) && (
          <button className="btn btn-line btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => confirm(`Compartilhar com ${name} todos os projetos ativos que ainda não estão lá? Projetos criados depois precisam ser marcados um a um.`) && all.mutate()}>
            Compartilhar todos os projetos com {name}
          </button>
        )}
        <h4>Objetivos (OKR)</h4>
        {v.own_objectives.length === 0 ? <p className="muted">Nenhum objetivo neste espaço.</p> : (
          <ul className="task-list">
            {v.own_objectives.map((o) => check(o.id, `Compartilhar ${o.title} com ${name}`, o.shared_up, (on) => objUp.mutate({ id: o.id, on }), <>{o.title} <span className="badge">{o.period}</span></>))}
          </ul>
        )}
        {repass.length > 0 && (
          <>
            <h4>Recebidos de outras unidades</h4>
            <p className="muted orgc-sub">Repassar a {name}. Recolher aqui recolhe também dos níveis acima.</p>
            <ul className="task-list">
              {v.received.filter((p) => p.can_repass).map((p) => check(p.id, `Repassar ${p.name} a ${name}`, p.shared_up, (on) => up.mutate({ id: p.id, on }), <>{p.name} <span className="badge">de {p.origin_workspace}</span></>))}
              {v.received_objectives.map((o) => check(o.id, `Repassar ${o.title} a ${name}`, o.shared_up, (on) => objUp.mutate({ id: o.id, on }), <>{o.title} <span className="badge">objetivo · {o.period}</span> <span className="badge">de {o.origin_workspace}</span></>))}
            </ul>
          </>
        )}
        {noSpace}
        {readOnly}
      </>
    );
  }

  return (
    <>
      <h3>{name}</h3>
      <p className="muted orgc-sub">Vê em leitura e não repassa a ninguém: só este espaço decide. Objetivos de OKR só sobem pela unidade acima.</p>
      <h4>Projetos</h4>
      {projects((p) => p.direct.includes(u.sigla), direct)}
      {noSpace}
      {readOnly}
    </>
  );
}
