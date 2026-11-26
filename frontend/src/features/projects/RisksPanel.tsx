import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCheck, Plus, ShieldQuestion, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Donut } from "../../components/Donut";
import { Dialog, Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import {
  CATEGORIES,
  CATEGORY_HINT,
  CATEGORY_LABEL,
  IMPACT_LABEL,
  KIND_LABEL,
  LEVELS,
  LEVEL_LABEL,
  OBJECTIVES,
  OBJECTIVE_LABEL,
  PROBABILITY_LABEL,
  REVIEW_DAYS,
  RISK_STATUS_LABEL,
  SCALE_SHORT,
  STATUSES,
  STRATEGIES,
  STRATEGY_HINT,
  STRATEGY_LABEL,
  isActive,
  needsReview,
  responseLate,
  riskCode,
  riskLevel,
  sortRisks,
  summarizeRisks,
  withoutResponse,
  type Risk,
  type RiskCategory,
  type RiskKind,
  type RiskLevel,
  type RiskObjective,
  type RiskStatus,
  type RiskStrategy,
} from "../../domain/risk";
import { fmtDate, type Member } from "../../domain/types";
import { localToday } from "../../domain/work";
import { api } from "../../services/api";

interface RisksData {
  risks: Risk[];
  can_write: boolean;
  can_manage: boolean;
}

const LEVEL_COLOR: Record<RiskLevel, string> = { low: "var(--risk-low)", moderate: "var(--risk-moderate)", high: "var(--risk-high)", critical: "var(--risk-critical)" };
const CAT_COLOR: Record<RiskCategory, string> = { technical: "var(--cat-1)", management: "var(--cat-2)", commercial: "var(--cat-3)", external: "var(--cat-4)" };
const STATUS_COLOR: Record<RiskStatus, string> = { open: "var(--cat-1)", responding: "var(--cat-2)", occurred: "var(--cat-3)", closed: "var(--cat-4)" };

type Flag = "noResponse" | "review" | "late";
type Filter =
  | { by: "level"; value: RiskLevel }
  | { by: "category"; value: RiskCategory }
  | { by: "status"; value: RiskStatus }
  | { by: "cell"; p: number; i: number }
  | { by: "flag"; value: Flag }
  | null;

const FLAG_LABEL: Record<Flag, string> = { noResponse: "Sem resposta definida", review: `Sem revisão há ${REVIEW_DAYS} dias`, late: "Resposta atrasada" };

export function useRisks(projectId: string) {
  return useQuery({ queryKey: ["risks", projectId], queryFn: () => api.get<RisksData>(`/projects/${projectId}/risks`) });
}

/** Aba Riscos: registro de riscos do PMBOK com matriz probabilidade × impacto e gráficos. */
export function RisksPanel({ projectId, members, openRisk, onOpenedRisk }: {
  projectId: string;
  members: Member[];
  /** Risco a abrir assim que a lista carregar (link da visão geral). */
  openRisk?: string | null;
  onOpenedRisk?: () => void;
}) {
  const q = useRisks(projectId);
  const [kind, setKind] = useState<RiskKind | "all">("all");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [dist, setDist] = useState<"level" | "category" | "status">("level");
  const [editing, setEditing] = useState<Risk | "new" | null>(null);

  const pending = openRisk ? q.data?.risks.find((r) => r.id === openRisk) : undefined;
  useEffect(() => {
    if (pending) {
      setEditing(pending);
      onOpenedRisk?.();
    }
  }, [pending, onOpenedRisk]);

  if (q.isLoading) return <Loading label="Carregando riscos…" />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const { risks, can_write: canWrite, can_manage: canManage } = q.data!;
  const today = localToday();
  const now = new Date();

  const t = text.trim().toLowerCase();
  const base = risks.filter((r) => (kind === "all" || r.kind === kind) && (!t || `${riskCode(r.number)} ${r.title} ${r.cause} ${r.effect}`.toLowerCase().includes(t)));
  const s = summarizeRisks(base, today, now);
  const matches = (r: Risk) => {
    if (!filter) return showClosed || isActive(r);
    switch (filter.by) {
      case "status":
        return r.status === filter.value;
      case "level":
        return isActive(r) && riskLevel(r.score) === filter.value;
      case "category":
        return isActive(r) && r.category === filter.value;
      case "cell":
        return isActive(r) && r.probability === filter.p && r.impact === filter.i;
      case "flag":
        return filter.value === "noResponse" ? withoutResponse(r) : filter.value === "review" ? needsReview(r, now) : responseLate(r, today);
    }
  };
  const shown = sortRisks(base.filter(matches));
  const pick = (f: Filter) => setFilter(f);
  const critical = s.byLevel.critical + s.byLevel.high;

  const kpis: [string, number, Flag | "level", string][] = [
    ["Críticos e altos", critical, "level", critical ? "alerta" : "zero"],
    ["Sem resposta definida", s.noResponse.length, "noResponse", s.noResponse.length ? "warn" : "zero"],
    [`Sem revisão há ${REVIEW_DAYS} dias`, s.review.length, "review", s.review.length ? "warn" : "zero"],
    ["Resposta atrasada", s.late.length, "late", s.late.length ? "alerta" : "zero"],
  ];

  return (
    <div className="rk">
      <div className="pv-toolbar rk-toolbar">
        <div className="rk-seg" role="radiogroup" aria-label="Tipo de risco">
          {(["all", "threat", "opportunity"] as const).map((k) => (
            <label key={k} className={`rk-seg-opt ${kind === k ? "on" : ""}`}>
              <input type="radio" name="rk-kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
              {k === "all" ? "Todos" : k === "threat" ? "Ameaças" : "Oportunidades"}
            </label>
          ))}
        </div>
        <input className="input grow" aria-label="Buscar risco" placeholder="Buscar por código, evento, causa…" value={text} onChange={(e) => setText(e.target.value)} />
        {canWrite && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> Novo risco
          </button>
        )}
      </div>

      {risks.length === 0 ? (
        <Empty title="Nenhum risco registrado" action={canWrite ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={16} aria-hidden /> Registrar o primeiro risco</button> : undefined}>
          Registre o que pode dar errado (ameaças) ou melhor que o esperado (oportunidades), avalie probabilidade e impacto e planeje a resposta. A matriz e os gráficos aparecem aqui.
        </Empty>
      ) : (
        <>
          {/* Faixa fina de indicadores; abaixo, o registro em destaque (rola por dentro) e, ao lado,
              a matriz e uma rosca por vez. No computador tudo cabe na tela, sem rolar a página. */}
          <div className="rk-kpis">
            <section className="rk-kpi" aria-label={`Riscos ativos: ${s.active.length} de ${base.length} no registro`}>
              <span className="coord">Riscos ativos</span>
              <strong>{s.active.length}</strong>
              <span className="rk-kpi-note">de {base.length}</span>
            </section>
            {kpis.map(([label, n, key, tone]) => {
              const f: Filter = key === "level" ? { by: "level", value: s.byLevel.critical ? "critical" : "high" } : { by: "flag", value: key };
              const on = key === "level" ? filter?.by === "level" && (filter.value === "critical" || filter.value === "high") : filter?.by === "flag" && filter.value === key;
              return n > 0 ? (
                <button key={label} type="button" className={`rk-kpi rk-kpi-btn ${tone} ${on ? "on" : ""}`} aria-pressed={on} aria-label={`${label}: ${n}. Filtrar o registro`} onClick={() => pick(on ? null : f)}>
                  <span className="coord">{label}</span>
                  <strong>{n}</strong>
                </button>
              ) : (
                <section key={label} className="rk-kpi zero" aria-label={`${label}: 0`}>
                  <span className="coord">{label}</span>
                  <strong>0</strong>
                </section>
              );
            })}
          </div>

          <div className="rk-body">
            <section className="card pane rk-register" aria-labelledby="rk-reg-h">
              <div className="rk-reg-head">
                <h2 id="rk-reg-h">Registro de riscos <span className="badge">{shown.length}</span></h2>
                {filter ? (
                  <span className="rk-filter">
                    {filterLabel(filter)}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(null)}>Limpar filtro</button>
                  </span>
                ) : (
                  <label className="rk-check">
                    <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Mostrar ocorridos e encerrados
                  </label>
                )}
              </div>
              <div className="pane-body">
                {shown.length === 0 ? (
                  <p className="muted">Nenhum risco com esse filtro.</p>
                ) : (
                  <ul className="rk-list">
                    {shown.map((r) => <RiskRow key={r.id} risk={r} today={today} now={now} onOpen={() => setEditing(r)} />)}
                  </ul>
                )}
              </div>
            </section>

            <aside className="rk-side" aria-label="Análise dos riscos">
              <section className="card rk-matrix-card" aria-labelledby="rk-matrix-h">
                <h2 id="rk-matrix-h">Probabilidade × impacto <span className="coord">ativos</span></h2>
                <RiskMatrix matrix={s.matrix} selected={filter?.by === "cell" ? [filter.p, filter.i] : null} onPick={(p, i) => pick(filter?.by === "cell" && filter.p === p && filter.i === i ? null : { by: "cell", p, i })} />
              </section>
              <section className="card rk-dist" aria-labelledby="rk-dist-h">
                <div className="rk-dist-head">
                  <h2 id="rk-dist-h">Distribuição</h2>
                  <div className="rk-seg rk-seg-sm" role="radiogroup" aria-label="Distribuição por">
                    {(["level", "category", "status"] as const).map((k) => (
                      <label key={k} className={`rk-seg-opt ${dist === k ? "on" : ""}`}>
                        <input type="radio" name="rk-dist" className="sr-only" checked={dist === k} onChange={() => setDist(k)} />
                        {k === "level" ? "Nível" : k === "category" ? "Categoria" : "Situação"}
                      </label>
                    ))}
                  </div>
                </div>
                {dist === "level" && (
                  <Donut
                    side
                    title="Riscos ativos por nível"
                    centerLabel="ativos"
                    items={LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l], value: s.byLevel[l], color: LEVEL_COLOR[l] }))}
                    selected={filter?.by === "level" ? filter.value : null}
                    onSelect={(k) => pick(k ? { by: "level", value: k as RiskLevel } : null)}
                  />
                )}
                {dist === "category" && (
                  <Donut
                    side
                    title="Riscos ativos por categoria"
                    centerLabel="ativos"
                    items={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], value: s.byCategory[c], color: CAT_COLOR[c] }))}
                    selected={filter?.by === "category" ? filter.value : null}
                    onSelect={(k) => pick(k ? { by: "category", value: k as RiskCategory } : null)}
                  />
                )}
                {dist === "status" && (
                  <Donut
                    side
                    title="Todos os riscos por situação"
                    centerLabel="no registro"
                    items={STATUSES.map((st) => ({ key: st, label: RISK_STATUS_LABEL[st], value: s.byStatus[st], color: STATUS_COLOR[st] }))}
                    selected={filter?.by === "status" ? filter.value : null}
                    onSelect={(k) => pick(k ? { by: "status", value: k as RiskStatus } : null)}
                  />
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      {editing && (
        <RiskDialog
          projectId={projectId}
          risk={editing === "new" ? null : editing}
          members={members}
          canWrite={canWrite}
          canManage={canManage}
          defaultKind={kind === "opportunity" ? "opportunity" : "threat"}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function filterLabel(f: NonNullable<Filter>): string {
  switch (f.by) {
    case "level":
      return `Nível ${LEVEL_LABEL[f.value].toLowerCase()}`;
    case "category":
      return `Categoria ${CATEGORY_LABEL[f.value].toLowerCase()}`;
    case "status":
      return RISK_STATUS_LABEL[f.value];
    case "cell":
      return `Probabilidade ${SCALE_SHORT[f.p].toLowerCase()} e impacto ${IMPACT_LABEL[f.i].toLowerCase()}`;
    case "flag":
      return FLAG_LABEL[f.value];
  }
}

/** Selo com nível e pontuação. O nível vai escrito: a cor nunca carrega o sentido sozinha. */
export function LevelBadge({ score }: { score: number }) {
  const l = riskLevel(score);
  return <span className={`rk-level lv-${l}`}>{LEVEL_LABEL[l]} · {score}</span>;
}

function RiskRow({ risk: r, today, now, onOpen }: { risk: Risk; today: string; now: Date; onOpen: () => void }) {
  const late = responseLate(r, today);
  const review = needsReview(r, now);
  return (
    <li className={`rk-row ${isActive(r) ? "" : "is-done"}`}>
      <button type="button" className="rk-row-btn" onClick={onOpen}>
        <span className="rk-row-lead">
          <span className="rk-code">{riskCode(r.number)}</span>
          <LevelBadge score={r.score} />
        </span>
        <span className="rk-row-main">
          <span className="rk-row-title">
            {r.kind === "opportunity" && <Sparkles size={14} aria-label="Oportunidade" className="rk-opp" />} {r.title}
          </span>
          <span className="rk-row-meta">
            <span>{CATEGORY_LABEL[r.category]}</span>
            <span>{r.strategy ? STRATEGY_LABEL[r.strategy] : <em className="rk-missing">sem resposta</em>}</span>
            {r.owner_name && <span>{r.owner_name}</span>}
            {r.response_due && <span className={late ? "rk-late" : ""}>{late && <CalendarClock size={12} aria-hidden />} resposta até {fmtDate(r.response_due)}</span>}
            {review && <span className="rk-late"><AlertTriangle size={12} aria-hidden /> revisar</span>}
          </span>
        </span>
        <span className={`badge rk-st st-${r.status}`}>{RISK_STATUS_LABEL[r.status]}</span>
      </button>
    </li>
  );
}

/** Matriz 5×5: impacto no eixo horizontal, probabilidade no vertical (maior em cima). Cada célula
 * filtra o registro. As zonas ficam tingidas pelo nível mesmo vazias, como no mapa de calor do PMBOK. */
function RiskMatrix({ matrix, selected, onPick }: { matrix: number[][]; selected: [number, number] | null; onPick: (p: number, i: number) => void }) {
  return (
    <div className="rk-matrix">
      <span className="rk-axis-y" aria-hidden>Probabilidade →</span>
      <div className="rk-grid" role="grid" aria-label="Matriz de probabilidade e impacto">
        {[5, 4, 3, 2, 1].map((p) => (
          <div key={p} role="row" className="rk-grid-row">
            <span className="rk-tick" aria-hidden>{SCALE_SHORT[p]}</span>
            {[1, 2, 3, 4, 5].map((i) => {
              const n = matrix[p - 1][i - 1];
              const l = riskLevel(p * i);
              const on = selected?.[0] === p && selected?.[1] === i;
              return (
                <div key={i} role="gridcell">
                  <button
                    type="button"
                    className={`rk-cell lv-${l} ${n ? "has" : ""} ${on ? "on" : ""}`}
                    disabled={!n}
                    aria-pressed={on}
                    aria-label={`Probabilidade ${SCALE_SHORT[p].toLowerCase()}, impacto ${IMPACT_LABEL[i].toLowerCase()}: nível ${LEVEL_LABEL[l].toLowerCase()}, ${n} risco(s)`}
                    title={`P${p} × I${i} = ${p * i} (${LEVEL_LABEL[l]}) · ${n} risco(s)`}
                    onClick={() => onPick(p, i)}
                  >
                    {n || ""}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        <div className="rk-grid-row rk-ticks-x" aria-hidden>
          <span className="rk-tick" />
          {[1, 2, 3, 4, 5].map((i) => <span key={i} className="rk-tick">{IMPACT_LABEL[i]}</span>)}
        </div>
      </div>
      <span className="rk-axis-x" aria-hidden>Impacto →</span>
      <ul className="rk-legend" aria-label="Níveis">
        {LEVELS.map((l) => <li key={l}><span className={`rk-swatch lv-${l}`} aria-hidden /> {LEVEL_LABEL[l]}</li>)}
      </ul>
    </div>
  );
}

interface Draft {
  kind: RiskKind;
  title: string;
  cause: string;
  effect: string;
  category: RiskCategory;
  probability: number;
  impact: number;
  affects: RiskObjective[];
  strategy: RiskStrategy | "";
  response: string;
  contingency: string;
  trigger_signal: string;
  owner_id: string;
  response_due: string;
  status: RiskStatus;
}

function toDraft(r: Risk | null, kind: RiskKind): Draft {
  return {
    kind: r?.kind ?? kind,
    title: r?.title ?? "",
    cause: r?.cause ?? "",
    effect: r?.effect ?? "",
    category: r?.category ?? "technical",
    probability: r?.probability ?? 3,
    impact: r?.impact ?? 3,
    affects: r?.affects ?? [],
    strategy: r?.strategy ?? "",
    response: r?.response ?? "",
    contingency: r?.contingency ?? "",
    trigger_signal: r?.trigger_signal ?? "",
    owner_id: r?.owner_id ?? "",
    response_due: r?.response_due ?? "",
    status: r?.status ?? "open",
  };
}

/** Cadastro e edição em três passos do PMBOK: identificar, analisar e responder. */
function RiskDialog({ projectId, risk, members, canWrite, canManage, defaultKind, onClose }: {
  projectId: string;
  risk: Risk | null;
  members: Member[];
  canWrite: boolean;
  canManage: boolean;
  defaultKind: RiskKind;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = toDraft(risk, defaultKind);
  const [d, setD] = useState<Draft>(initial);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["risks", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      risk ? api.patch<Risk>(`/projects/${projectId}/risks/${risk.id}`, body) : api.post<Risk>(`/projects/${projectId}/risks`, body),
    onSuccess: (r, body) => {
      refresh();
      toast(risk ? (body.reviewed && Object.keys(body).length <= 2 ? `${riskCode(r.number)} marcado como revisado` : `${riskCode(r.number)} atualizado`) : `${riskCode(r.number)} registrado`);
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => api.del<void>(`/projects/${projectId}/risks/${risk!.id}`),
    onSuccess: () => {
      refresh();
      toast(`${riskCode(risk!.number)} excluído`);
      onClose();
    },
    onError: (e) => toast((e as Error).message),
  });

  const changeKind = (k: RiskKind) => setD((x) => ({ ...x, kind: k, strategy: x.strategy && STRATEGIES[k].includes(x.strategy) ? x.strategy : "" }));
  const score = d.probability * d.impact;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!risk) return save.mutate({ ...d });
    // Só o que mudou, com a versão lida: edição concorrente vira aviso em vez de sobrescrever.
    const body: Record<string, unknown> = { version: risk.version };
    for (const k of Object.keys(d) as (keyof Draft)[]) {
      if (JSON.stringify(d[k]) !== JSON.stringify(initial[k])) body[k] = d[k];
    }
    if (Object.keys(body).length === 1) return onClose();
    save.mutate(body);
  };

  const title = risk ? `${riskCode(risk.number)} · ${KIND_LABEL[risk.kind]}` : "Novo risco";
  const reviewedDays = risk ? Math.floor((Date.now() - new Date(risk.reviewed_at).getTime()) / 86_400_000) : 0;

  return (
    <Dialog title={title} onClose={onClose} className="rk-dialog">
      <form onSubmit={submit}>
        <fieldset className="rk-fs" disabled={!canWrite}>
          <legend className="rk-step"><span>1</span> Identificar</legend>
          <div className="rk-seg rk-kind" role="radiogroup" aria-label="Tipo">
            {(["threat", "opportunity"] as const).map((k) => (
              <label key={k} className={`rk-seg-opt ${d.kind === k ? "on" : ""}`}>
                <input type="radio" name="rk-d-kind" className="sr-only" checked={d.kind === k} onChange={() => changeKind(k)} />
                {k === "threat" ? <ShieldQuestion size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />} {KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <div className="field">
            <label htmlFor="rk-title">Evento de risco <span className="muted">(o que pode acontecer?)</span></label>
            <input id="rk-title" className="input" required maxLength={160} value={d.title} data-autofocus placeholder={d.kind === "threat" ? "Ex.: Atraso na entrega dos equipamentos" : "Ex.: Liberação antecipada da licença"} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="rk-two">
            <div className="field">
              <label htmlFor="rk-cause">Causa <span className="muted">(por quê?)</span></label>
              <textarea id="rk-cause" className="textarea" rows={2} maxLength={1000} value={d.cause} placeholder="Ex.: fornecedor único, com fila de pedidos" onChange={(e) => set("cause", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rk-effect">Efeito <span className="muted">(o que acontece com o projeto?)</span></label>
              <textarea id="rk-effect" className="textarea" rows={2} maxLength={1000} value={d.effect} placeholder="Ex.: a implantação escorrega um mês" onChange={(e) => set("effect", e.target.value)} />
            </div>
          </div>
          {d.title.trim() && (d.cause.trim() || d.effect.trim()) && (
            // Causa → evento → efeito (metalinguagem de risco). Sem "devido a"/"levaria a" para não
            // gerar contração errada ("a o") com o texto livre de quem preenche.
            <p className="rk-sentence">
              {d.cause.trim() && <>Porque <strong>{d.cause.trim()}</strong>, </>}
              {d.cause.trim() ? "pode ocorrer: " : "Pode ocorrer: "}<strong>{d.title.trim()}</strong>.
              {d.effect.trim() && <> Efeito: <strong>{d.effect.trim()}</strong>.</>}
            </p>
          )}
          <div className="rk-two">
            <div className="field">
              <label htmlFor="rk-cat">Categoria</label>
              <select id="rk-cat" className="select" value={d.category} onChange={(e) => set("category", e.target.value as RiskCategory)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <span className="coord">{CATEGORY_HINT[d.category]}</span>
            </div>
            <fieldset className="field rk-affects">
              <legend className="label">Objetivos afetados</legend>
              <div className="rk-chips">
                {OBJECTIVES.map((o) => (
                  <label key={o} className={`chip ${d.affects.includes(o) ? "on" : ""}`}>
                    <input type="checkbox" className="sr-only" checked={d.affects.includes(o)} onChange={(e) => set("affects", e.target.checked ? [...d.affects, o] : d.affects.filter((x) => x !== o))} />
                    {OBJECTIVE_LABEL[o]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </fieldset>

        <fieldset className="rk-fs" disabled={!canWrite}>
          <legend className="rk-step"><span>2</span> Analisar</legend>
          <div className="rk-analysis">
            <div className="rk-picker" role="group" aria-label="Clique na célula para escolher probabilidade e impacto">
              {[5, 4, 3, 2, 1].map((p) => [1, 2, 3, 4, 5].map((i) => (
                <button
                  key={`${p}-${i}`}
                  type="button"
                  className={`rk-pcell lv-${riskLevel(p * i)} ${d.probability === p && d.impact === i ? "on" : ""}`}
                  aria-label={`Probabilidade ${SCALE_SHORT[p].toLowerCase()}, impacto ${IMPACT_LABEL[i].toLowerCase()}`}
                  aria-pressed={d.probability === p && d.impact === i}
                  onClick={() => setD((x) => ({ ...x, probability: p, impact: i }))}
                >
                  {p * i}
                </button>
              )))}
            </div>
            <div className="rk-analysis-side">
              <div className="field">
                <label htmlFor="rk-p">Probabilidade</label>
                <select id="rk-p" className="select" value={d.probability} onChange={(e) => set("probability", Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {PROBABILITY_LABEL[n]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rk-i">Impacto</label>
                <select id="rk-i" className="select" value={d.impact} onChange={(e) => set("impact", Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {IMPACT_LABEL[n]}</option>)}
                </select>
              </div>
              <p className="rk-score" aria-live="polite">Pontuação <strong>{score}</strong> <LevelBadge score={score} /></p>
            </div>
          </div>
        </fieldset>

        <fieldset className="rk-fs" disabled={!canWrite}>
          <legend className="rk-step"><span>3</span> Planejar a resposta</legend>
          <div className="field">
            <span className="label" id="rk-strat-l">Estratégia</span>
            <div className="rk-strats" role="radiogroup" aria-labelledby="rk-strat-l">
              {STRATEGIES[d.kind].map((st) => (
                <label key={st} className={`rk-strat ${d.strategy === st ? "on" : ""}`}>
                  <input type="radio" name="rk-strat" className="sr-only" checked={d.strategy === st} onChange={() => set("strategy", st)} />
                  <strong>{STRATEGY_LABEL[st]}</strong>
                  <span>{STRATEGY_HINT[st]}</span>
                </label>
              ))}
            </div>
            {d.strategy && <button type="button" className="btn btn-ghost btn-sm rk-clear" onClick={() => set("strategy", "")}>Ainda sem estratégia</button>}
          </div>
          <div className="field">
            <label htmlFor="rk-resp">Plano de resposta <span className="muted">(ações preventivas)</span></label>
            <textarea id="rk-resp" className="textarea" rows={2} maxLength={2000} value={d.response} onChange={(e) => set("response", e.target.value)} />
          </div>
          <div className="rk-two">
            <div className="field">
              <label htmlFor="rk-cont">Plano de contingência <span className="muted">(se ocorrer)</span></label>
              <textarea id="rk-cont" className="textarea" rows={2} maxLength={2000} value={d.contingency} onChange={(e) => set("contingency", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rk-trig">Gatilho <span className="muted">(sinal de que vai ocorrer)</span></label>
              <textarea id="rk-trig" className="textarea" rows={2} maxLength={500} value={d.trigger_signal} onChange={(e) => set("trigger_signal", e.target.value)} />
            </div>
          </div>
          <div className="rk-two">
            <div className="field">
              <label htmlFor="rk-owner">Responsável pelo risco</label>
              <select id="rk-owner" className="select" value={d.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
                <option value="">Ninguém ainda</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rk-due">Prazo da resposta</label>
              <input id="rk-due" type="date" className="input" value={d.response_due} onChange={(e) => set("response_due", e.target.value)} />
            </div>
          </div>
        </fieldset>

        {risk && (
          <fieldset className="rk-fs" disabled={!canWrite}>
            <legend className="rk-step"><span>4</span> Monitorar</legend>
            <div className="rk-two rk-monitor">
              <div className="field">
                <label htmlFor="rk-status">Situação</label>
                <select id="rk-status" className="select" value={d.status} onChange={(e) => set("status", e.target.value as RiskStatus)}>
                  {STATUSES.map((st) => <option key={st} value={st}>{RISK_STATUS_LABEL[st]}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="label">Última revisão</span>
                <span className={reviewedDays > REVIEW_DAYS && isActive(risk) ? "rk-late" : ""}>
                  {fmtDate(risk.reviewed_at.slice(0, 10))} · {reviewedDays === 0 ? "hoje" : `há ${reviewedDays} dia(s)`}
                </span>
                {canWrite && (
                  <button type="button" className="btn btn-line btn-sm rk-reviewed" disabled={save.isPending} onClick={() => save.mutate({ version: risk.version, reviewed: true })}>
                    <CheckCheck size={15} aria-hidden /> Revisado, sem mudança
                  </button>
                )}
              </div>
            </div>
          </fieldset>
        )}

        {save.error && <p className="form-error" role="alert">{(save.error as Error).message}</p>}
        <div className="row rk-actions">
          {risk && canManage && (confirmDel ? (
            <>
              <span className="bl-confirm">Excluir de vez? Prefira “Encerrado” para manter o histórico.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>Não</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => del.mutate()}>Excluir</button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(true)}><Trash2 size={15} aria-hidden /> Excluir</button>
          ))}
          <span className="grow" />
          {canWrite ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>{save.isPending ? "Salvando…" : risk ? "Salvar" : "Registrar risco"}</button>
            </>
          ) : (
            <span className="muted">Só quem trabalha no projeto registra ou altera riscos.</span>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/** Quantos riscos o cartão da visão geral mostra; o resto fica a um clique, na aba. */
const CARD_TOP = 3;
const levelCount = (n: number, l: RiskLevel) => `${n} ${LEVEL_LABEL[l].toLowerCase()}${n === 1 ? "" : "s"}`;

/** Cartão da visão geral, de propósito enxuto: uma barra com o perfil de risco do projeto e os
 * poucos riscos mais graves, só com nível e título. Detalhes (dono, prazo, alertas) ficam na aba. */
export function RisksCard({ projectId, onOpen }: { projectId: string; onOpen: (riskId: string | null) => void }) {
  const q = useRisks(projectId);
  const s = summarizeRisks(q.data?.risks ?? [], localToday(), new Date());
  const top = sortRisks(s.active).slice(0, CARD_TOP);
  const rest = s.active.length - top.length;
  const levels = LEVELS.filter((l) => s.byLevel[l] > 0);
  return (
    <section className="card pane rk-card" aria-labelledby="rk-card-h">
      <h2 id="rk-card-h">
        Riscos do projeto
        <button type="button" className="btn btn-ghost btn-sm rk-card-all" onClick={() => onOpen(null)}>Ver todos</button>
      </h2>
      <div className="pane-body">
        {q.isLoading ? <p className="muted">Carregando…</p> : q.isError ? <p className="muted">Não foi possível carregar os riscos.</p> : s.active.length === 0 ? (
          <p className="muted">Nenhum risco ativo. Registre ameaças e oportunidades na aba Riscos.</p>
        ) : (
          <>
            <div className="rk-card-profile">
              <div className="rk-card-bar" role="img" aria-label={`${s.active.length} riscos ativos: ${levels.map((l) => levelCount(s.byLevel[l], l)).join(", ")}`}>
                {levels.map((l) => <span key={l} className={`lv-${l}`} style={{ flexGrow: s.byLevel[l] }} />)}
              </div>
              <ul className="rk-card-legend" aria-hidden>
                {levels.map((l) => <li key={l}><span className={`rk-swatch lv-${l}`} /> <strong>{s.byLevel[l]}</strong> {levelCount(s.byLevel[l], l).replace(/^\d+ /, "")}</li>)}
              </ul>
            </div>
            <ul className="rk-card-list">
              {top.map((r) => (
                <li key={r.id}>
                  <button type="button" className="rk-card-row" onClick={() => onOpen(r.id)}>
                    <span className={`rk-card-lv lv-${riskLevel(r.score)}`}>{LEVEL_LABEL[riskLevel(r.score)]}</span>
                    <span className="rk-card-title">{r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {rest > 0 && (
              <button type="button" className="rk-card-more" onClick={() => onOpen(null)}>
                + {rest} {rest === 1 ? "outro risco" : "outros riscos"}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
