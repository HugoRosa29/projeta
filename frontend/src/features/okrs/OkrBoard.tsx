import { BarChart3, ChevronDown, Clock, FolderKanban, History, Pencil, Plus, Search, Table2, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PALETTE } from "../../domain/board";
import {
  CONFIDENCES,
  CONFIDENCE_COLOR,
  CONFIDENCE_LABEL,
  KR_SORT_LABEL,
  NO_KR_FILTER,
  behindPace,
  boardStats,
  filterBoard,
  fmtCost,
  fmtCostFull,
  fmtValue,
  isFiltered,
  isRated,
  krOwners,
  objectiveSummary,
  since,
  staleByOwner,
  type Confidence,
  type KeyResult,
  type KrFilter,
  type KrSort,
  type Objective,
  type OkrBoard as Board,
} from "../../domain/okr";
import { HistoryDialog, Initials, ProgressBar } from "./OkrParts";

const fmt = (n: number) => n.toLocaleString("pt-BR");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0);

export interface BoardActions {
  onNewObjective: () => void;
  onEditObjective: (o: Objective) => void;
  onDeleteObjective: (o: Objective) => void;
  onAddKr: (o: Objective) => void;
  onEditKr: (o: Objective, kr: KeyResult) => void;
  onDeleteKr: (kr: KeyResult) => void;
}

type View = "table" | "chart";

/**
 * Painel de OKRs em formato de quadro: faixa de indicadores, ferramentas (busca, responsável,
 * avaliação, ordem) e cada objetivo como um grupo recolhível com uma linha por resultado-chave e
 * uma linha de resumo. As ações de edição só aparecem com `manage` — o servidor confere de novo.
 */
export function OkrBoard({
  d,
  onCheckin,
  manage,
}: {
  d: Board;
  onCheckin: (kr: KeyResult, siblings: KeyResult[]) => void;
  manage?: BoardActions;
}) {
  const [filter, setFilter] = useState<KrFilter>(NO_KR_FILTER);
  const [sort, setSort] = useState<KrSort>("position");
  const [view, setView] = useState<View>("table");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const owners = useMemo(() => krOwners(d.objectives), [d.objectives]);
  const shown = useMemo(() => filterBoard(d.objectives, filter, sort), [d.objectives, filter, sort]);
  const st = boardStats(d);
  const filtered = isFiltered(filter);
  // A cor do grupo segue a posição do objetivo no trimestre, não no recorte: filtrar não troca as cores.
  const color = (id: string) => PALETTE[Math.max(0, d.objectives.findIndex((o) => o.id === id)) % PALETTE.length];
  const set = (patch: Partial<KrFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const toggle = (k: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const krCount = shown.reduce((n, o) => n + o.key_results.length, 0);

  return (
    <section className="pn okr-board" aria-labelledby="okr-board-title">
      <h2 id="okr-board-title" className="sr-only">Objetivos e resultados-chave</h2>

      <ul className="okr-stats" aria-label="Resumo do trimestre">
        <StatBar label="Objetivos" value={fmt(st.objectives)} note={`${fmt(st.onPace)} no ritmo`} fill={pct(st.onPace, st.objectives)} tone="ok" />
        <StatBar
          label="Resultados-chave"
          value={fmt(st.keyResults)}
          note={`${fmt(st.atRisk)} em risco`}
          fill={pct(st.atRisk, st.keyResults)}
          tone={st.atRisk ? "warn" : "ok"}
          pressed={filter.confidence === "at_risk"}
          onClick={st.atRisk ? () => set({ confidence: filter.confidence === "at_risk" ? "" : "at_risk" }) : undefined}
        />
        <li className="okr-stat">
          <div>
            <span className="okr-stat-l">Progresso geral</span>
            <span className="okr-stat-v">
              {st.progress}%{d.pace != null && <small> · esperado ~{d.pace}%</small>}
            </span>
            <ProgressBar value={st.progress} pace={d.pace} label="Progresso geral dos OKRs" />
          </div>
        </li>
        <StatBar
          label="Check-ins em dia"
          value={`${fmt(st.updated)} de ${fmt(st.keyResults)}`}
          note={st.pending ? `${fmt(st.pending)} pedem atualização` : "todos em dia"}
          fill={pct(st.updated, st.keyResults)}
          tone={st.pending ? "info" : "ok"}
          pressed={filter.pending}
          onClick={st.pending ? () => set({ pending: !filter.pending }) : undefined}
        />
      </ul>

      <div className="okr-tools">
        <div className="okr-tools-l" role="search" aria-label="Filtrar os OKRs">
          {manage && (
            <button type="button" className="btn btn-primary btn-sm" onClick={manage.onNewObjective}>
              <Plus size={16} aria-hidden /> Novo objetivo
            </button>
          )}
          <label className="okr-search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Buscar</span>
            <input className="input" type="search" placeholder="Buscar KR, pessoa…" title="Busca no objetivo, no KR, no responsável e no projeto" value={filter.q} onChange={(e) => set({ q: e.target.value })} />
          </label>
          <select className="select pn-select" aria-label="Filtrar por responsável" value={filter.owner} onChange={(e) => set({ owner: e.target.value })}>
            <option value="">Todos os responsáveis</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="none">Sem responsável</option>
          </select>
          <select className="select pn-select" aria-label="Filtrar por avaliação" value={filter.confidence} onChange={(e) => set({ confidence: e.target.value as Confidence | "" })}>
            <option value="">Qualquer avaliação</option>
            {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
          </select>
          <label className="pn-groupby">
            <span className="sr-only">Ordenar</span>
            <select className="select pn-select" value={sort} onChange={(e) => setSort(e.target.value as KrSort)}>
              {(Object.keys(KR_SORT_LABEL) as KrSort[]).map((k) => <option key={k} value={k}>{KR_SORT_LABEL[k]}</option>)}
            </select>
          </label>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(NO_KR_FILTER)}>
              <X size={16} aria-hidden /> Limpar
            </button>
          )}
        </div>
        <div className="okr-views" role="group" aria-label="Forma de ver">
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}><Table2 size={16} aria-hidden /> Tabela</button>
          <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}><BarChart3 size={16} aria-hidden /> Gráfico</button>
        </div>
      </div>

      {filtered && (
        <p className="muted okr-hint okr-count" aria-live="polite">
          {plural(krCount, "resultado-chave", "resultados-chave")} em {plural(shown.length, "objetivo", "objetivos")} no recorte
        </p>
      )}

      {!shown.length && filtered && <p className="muted pn-empty">Nenhum resultado-chave neste recorte.</p>}

      {view === "table" && shown.length > 0 && (
        <div className="pn-board-wrap okr-board-wrap" role="region" aria-label="Quadro dos OKRs">
          {shown.map((o) => (
            <ObjectiveGroup
              key={o.id}
              o={o}
              color={color(o.id)}
              pace={d.pace}
              open={!closed.has(o.id)}
              onToggle={() => toggle(o.id)}
              onCheckin={(kr) => onCheckin(kr, o.key_results.map((x) => ({ ...x, objective_title: o.title })))}
              manage={manage}
            />
          ))}
        </div>
      )}

      {view === "chart" && shown.length > 0 && <ChartView objectives={shown} pace={d.pace} color={color} withoutOwner={d.summary.without_owner} />}
    </section>
  );
}

function StatBar({
  label,
  value,
  note,
  fill,
  tone,
  pressed,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  fill: number;
  tone: "ok" | "warn" | "info";
  pressed?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="okr-stat-l">{label}</span>
      <span className="okr-stat-v">
        {value} <small>· {note}</small>
      </span>
      <span className={`okr-stat-bar t-${tone}`} aria-hidden>
        <span style={{ width: `${fill}%` }} />
      </span>
    </>
  );
  return (
    <li className="okr-stat">
      {onClick ? (
        <button type="button" aria-pressed={pressed} onClick={onClick} aria-label={`${label}: ${value}, ${note}. Filtrar`}>
          {body}
        </button>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

/** "nunca", "hoje", "ontem", "há 5 dias": cabe na coluna sem cortar. */
const sinceShort = (iso: string | null) => (iso ? since(iso).replace(/^atualizado /, "") : "nunca");

function ObjectiveGroup({
  o,
  color,
  pace,
  open,
  onToggle,
  onCheckin,
  manage,
}: {
  o: Objective;
  color: string;
  pace: number | null;
  open: boolean;
  onToggle: () => void;
  onCheckin: (kr: KeyResult) => void;
  manage?: BoardActions;
}) {
  const sum = objectiveSummary(o);
  const n = o.key_results.length;
  const behind = behindPace(o.progress, pace);
  return (
    <section className={`pn-group okr-group g-${color}`}>
      {/* Faixa do objetivo: título inteiro numa linha só, com o resumo ao lado, como no board. */}
      <header className="okr-ghead">
        <button type="button" className="okr-gtoggle" aria-expanded={open} onClick={onToggle} title={o.description || undefined}>
          <ChevronDown size={18} aria-hidden className="pn-chev" />
          <span className="okr-gtitle">{o.title}</span>
        </button>
        <span className="okr-gmeta">
          <span>{o.owner_name ?? "sem responsável"}</span>
          <span>{plural(n, "KR", "KRs")}</span>
          <strong>{o.progress}%</strong>
          {behind && <span className="badge warn">ritmo abaixo do previsto</span>}
        </span>
        {manage && (
          <span className="okr-acts okr-gacts">
            <button type="button" className="okr-icon" onClick={() => manage.onEditObjective(o)} aria-label={`Editar objetivo ${o.title}`} title="Editar objetivo">
              <Pencil size={15} aria-hidden />
            </button>
            <button type="button" className="okr-icon" onClick={() => manage.onDeleteObjective(o)} aria-label={`Remover objetivo ${o.title}`} title="Remover objetivo">
              <Trash2 size={15} aria-hidden />
            </button>
          </span>
        )}
      </header>
      {open && (
        <table className="pn-board okr-table" aria-label={o.title}>
          <thead>
            <tr>
              <th scope="col" className="okr-c-name">Resultado-chave</th>
              <th scope="col" className="okr-c-who">Resp.</th>
              <th scope="col" className="pn-c-prog">Progresso</th>
              <th scope="col" className="okr-c-upd">Último check-in</th>
              <th scope="col" className="pn-c-health">Avaliação</th>
              <th scope="col" className="okr-c-cost">Custo</th>
              <th scope="col" className="okr-c-act"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {o.key_results.map((k) => (
              <KrLine key={k.id} kr={k} pace={pace} onCheckin={onCheckin} onEdit={manage && (() => manage.onEditKr(o, k))} onDelete={manage && (() => manage.onDeleteKr(k))} />
            ))}
            {!n && (
              <tr>
                <td colSpan={7} className="okr-empty-row muted">
                  Sem resultados-chave ainda. Um objetivo vira mensurável com 2 a 5 resultados-chave.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="okr-foot-name">
                {manage && (
                  <button type="button" className="okr-add" onClick={() => manage.onAddKr(o)}>
                    <Plus size={15} aria-hidden /> Adicionar KR
                  </button>
                )}
                {sum.projects > 0 && <small className="okr-foot-note">{plural(sum.projects, "projeto vinculado", "projetos vinculados")}</small>}
              </td>
              <td className="okr-c-who">
                {fmt(sum.owners)}
                <small> resp.</small>
              </td>
              <td className="pn-c-prog">
                <Battery pct={o.progress} pace={pace} name="Média do objetivo" />
              </td>
              <td className={`okr-c-upd${sum.pending ? " okr-stale" : ""}`}>
                {sum.pending ? `${fmt(sum.pending)} ${sum.pending === 1 ? "pendente" : "pendentes"}` : "em dia"}
              </td>
              <td className="pn-c-health">
                {n > 0 && (
                  <span className="pn-mix" role="img" aria-label={`Avaliação: ${CONFIDENCES.map((c) => `${CONFIDENCE_LABEL[c]} ${sum.confidence[c]}`).join(", ")}, sem avaliação ${sum.unrated}`}>
                    {CONFIDENCES.filter((c) => sum.confidence[c]).map((c) => (
                      <span key={c} className={`g-${CONFIDENCE_COLOR[c]}`} style={{ flexGrow: sum.confidence[c] }} />
                    ))}
                    {sum.unrated > 0 && <span className="okr-mix-none" style={{ flexGrow: sum.unrated }} />}
                  </span>
                )}
              </td>
              <td className="okr-c-cost" title={sum.cost != null ? `${fmtCostFull(sum.cost)}${sum.costMissing ? ` · ${sum.costMissing} sem custo informado` : ""}` : undefined}>
                <strong>{sum.cost != null && sum.cost > 0 ? fmtCost(sum.cost) : "—"}</strong>
                {sum.cost != null && sum.cost > 0 && <small> total</small>}
              </td>
              <td className="okr-c-act" />
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

function KrLine({
  kr,
  pace,
  onCheckin,
  onEdit,
  onDelete,
}: {
  kr: KeyResult;
  pace: number | null;
  onCheckin: (kr: KeyResult) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [history, setHistory] = useState(false);
  const pending = kr.stale && kr.progress < 100;
  return (
    <tr className={kr.mine ? "okr-mine-row" : undefined}>
      <th scope="row" className="pn-name okr-c-name">
        <span className="okr-kr-t">{kr.title}</span>
        <span className="okr-kr-sub">
          {kr.kind === "project" ? (
            kr.project_id ? (
              <Link to={`/projetos/${kr.project_id}`} title={kr.project_name ?? ""}>
                <FolderKanban size={13} aria-hidden /> {kr.project_name}
              </Link>
            ) : (
              "pelo projeto vinculado"
            )
          ) : (
            <>
              {fmtValue(kr.current_value, kr.unit)} de {fmtValue(kr.target_value, kr.unit)}
            </>
          )}
        </span>
      </th>
      <td className="okr-c-who">
        <span className="okr-who-cell" title={kr.owner_name ?? "Sem responsável"}>
          <Initials name={kr.owner_name} />
          <span className="sr-only">{kr.owner_name ?? "Sem responsável"}</span>
        </span>
      </td>
      <td className="pn-c-prog" title={kr.behind_pace ? "Ritmo abaixo do previsto: o tempo decorrido passa o progresso em mais de 25 pontos" : undefined}>
        <Battery pct={kr.progress} pace={pace} name="Progresso" />
        {kr.behind_pace && <span className="sr-only"> (ritmo abaixo do previsto)</span>}
      </td>
      <td className={`okr-c-upd${pending ? " okr-stale" : " muted"}`}>
        <Clock size={13} aria-hidden /> {sinceShort(kr.last_checkin_at)}
      </td>
      {isRated(kr) ? (
        <td className={`pn-c-health pn-label g-${CONFIDENCE_COLOR[kr.confidence]}`}>{CONFIDENCE_LABEL[kr.confidence]}</td>
      ) : (
        <td className="pn-c-health okr-unrated">Sem avaliação</td>
      )}
      <td className={`okr-c-cost${kr.cost ? "" : " muted"}`} title={fmtCostFull(kr.cost)}>
        <span className="sr-only">Custo: </span>
        {fmtCost(kr.cost)}
      </td>
      <td className="okr-c-act">
        <span className="okr-acts">
          {kr.can_checkin && (
            <button type="button" className={`okr-ck${kr.mine && pending ? " hot" : ""}`} onClick={() => onCheckin(kr)} aria-label={`Check-in de ${kr.title}`}>
              Check-in
            </button>
          )}
          <button type="button" className="okr-icon" onClick={() => setHistory(true)} aria-label={`Histórico de ${kr.title}`} title="Histórico">
            <History size={15} aria-hidden />
          </button>
          {onEdit && (
            <button type="button" className="okr-icon okr-edit" onClick={onEdit} aria-label={`Editar ${kr.title}`} title="Editar">
              <Pencil size={15} aria-hidden />
            </button>
          )}
          {onDelete && (
            <button type="button" className="okr-icon okr-edit" onClick={onDelete} aria-label={`Remover ${kr.title}`} title="Remover">
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </span>
        {history && <HistoryDialog kr={kr} onClose={() => setHistory(false)} />}
      </td>
    </tr>
  );
}

/** Bateria do quadro, com a marca do ritmo esperado para hoje. */
function Battery({ pct, pace, name }: { pct: number; pace: number | null; name: string }) {
  const v = Math.min(100, Math.max(0, pct));
  return (
    <span className="pn-bat">
      <span className="pn-bat-track okr-bat-track" aria-hidden>
        <span className={`pn-bat-fill${behindPace(v, pace) ? " okr-bat-behind" : ""}`} style={{ width: `${v}%` }} />
        {pace != null && <span className="okr-bat-pace" style={{ left: `${pace}%` }} />}
      </span>
      <span className="pn-bat-v">
        <span className="sr-only">{name}: </span>
        {pct}%
      </span>
    </span>
  );
}

/** Leitura em gráfico: progresso por objetivo contra o ritmo, avaliação dos KRs e quem precisa atualizar. */
function ChartView({ objectives, pace, color, withoutOwner }: { objectives: Objective[]; pace: number | null; color: (id: string) => string; withoutOwner: number }) {
  const krs = objectives.flatMap((o) => o.key_results);
  const rated = krs.filter(isRated);
  const byConf = CONFIDENCES.map((c) => [c, rated.filter((k) => k.confidence === c).length] as const);
  const unrated = krs.length - rated.length;
  const stale = staleByOwner(objectives);
  return (
    <div className="okr-chart">
      <article className="card">
        <h3>Progresso por objetivo</h3>
        <ul className="okr-chart-objs">
          {objectives.map((o) => (
            <li key={o.id} className={`g-${color(o.id)}`}>
              <span className="okr-chart-name">{o.title}</span>
              <ProgressBar value={o.progress} pace={pace} label={o.title} />
              <span className="okr-pct">{o.progress}%</span>
              <ul className="okr-chart-krs">
                {o.key_results.map((k) => (
                  <li key={k.id}>
                    <span className="okr-chart-kr" title={k.title}>{k.title}</span>
                    <span className="okr-chart-kbar" aria-hidden>
                      <span className={isRated(k) ? `g-${CONFIDENCE_COLOR[k.confidence]}` : "g-gray"} style={{ width: `${k.progress}%` }} />
                    </span>
                    <span className="okr-pct muted"><span className="sr-only">{k.title}: </span>{k.progress}%</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {pace != null && <p className="muted okr-hint">A marca vertical é o ritmo esperado para hoje ({pace}% do trimestre). A cor das barras dos KRs é a avaliação.</p>}
      </article>
      <div className="okr-chart-side">
        <article className="card">
          <h3>Avaliação dos resultados-chave</h3>
          {krs.length > 0 && (
            <div className="ov-seg okr-chart-seg" role="img" aria-label={byConf.map(([c, v]) => `${CONFIDENCE_LABEL[c]}: ${v}`).join(", ")}>
              {byConf.filter(([, v]) => v).map(([c, v]) => (
                <span key={c} className={`ov-block t-${c === "on_track" ? "ok" : c === "at_risk" ? "warn" : "bad"}`} style={{ flexGrow: v }}>{v}</span>
              ))}
              {unrated > 0 && <span className="ov-block t-rest" style={{ flexGrow: unrated }}>{unrated}</span>}
            </div>
          )}
          <ul className="ov-legend">
            {byConf.map(([c, v]) => (
              <li key={c} className={v ? "" : "dim"}>
                <span className={`ov-swatch t-${c === "on_track" ? "ok" : c === "at_risk" ? "warn" : "bad"}`} /> {CONFIDENCE_LABEL[c]} <strong>{v}</strong>
              </li>
            ))}
            {unrated > 0 && (
              <li>
                <span className="ov-swatch t-rest" /> Sem check-in <strong>{unrated}</strong>
              </li>
            )}
          </ul>
        </article>
        <article className="card">
          <h3>Quem precisa atualizar</h3>
          {stale.length ? (
            <ul className="okr-who">
              {stale.map((g) => (
                <li key={g.owner}>
                  <span>{g.owner}</span> <span className="badge warn">{g.items.length}</span>
                  <span className="muted okr-who-items">{g.items.map((k) => k.title).join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="okr-cheer-line">Todos os resultados-chave foram atualizados nos últimos 7 dias.</p>
          )}
          {withoutOwner > 0 && <p className="muted okr-hint">{withoutOwner} resultado(s)-chave sem responsável: sem dono, ninguém faz o check-in.</p>}
        </article>
      </div>
    </div>
  );
}
