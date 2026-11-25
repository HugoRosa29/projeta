import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ErrorBox } from "../../components/ui";
import { GROUP_LABEL, HEALTH_COLOR, daysText, elapsed, groupTracks, rangeText, type BoardGroup, type GroupBy } from "../../domain/board";
import { PACE_LABEL, track, type Track } from "../../domain/esteira";
import { HEALTH_LABEL, PHASE_LABEL, type Health, type PortfolioRow } from "../../domain/formal";
import { NO_FILTER, applyFilter, byField, summarize, type OverviewFilter } from "../../domain/overview";
import { fmtDate, isoDate } from "../../domain/types";
import { attributeIndex, projectProgress } from "../../domain/work";
import { api } from "../../services/api";
import { areasOf, pickArea } from "../../domain/areas";
import { AreaSummary, AreaTabs, areaQuery, useArea } from "./Areas";

const fmt = (n: number) => n.toLocaleString("pt-BR");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** Panorama do espaço na home. Usa a mesma consulta do portfólio (mesmo cache, mesmo recorte do servidor). */
export function Overview({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const q = useQuery({
    queryKey: ["portfolio", workspaceId],
    queryFn: () => api.get<{ projects: PortfolioRow[] }>("/portfolio", { workspace_id: workspaceId }),
  });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  // Sem projeto ativo, o panorama não tem o que mostrar: a home fica só com as tarefas.
  if (!q.data?.projects.length) return null;
  return <AreaPanorama rows={q.data.projects} workspaceId={workspaceId} workspaceName={workspaceName} />;
}

/** Com projetos recebidos de outras áreas (organograma), separa por área: "Geral" com o resumo
 *  por área, ou o panorama de uma área só. Sem projetos recebidos, é o panorama de sempre. */
function AreaPanorama({ rows, workspaceId, workspaceName }: { rows: PortfolioRow[]; workspaceId: string; workspaceName: string }) {
  const [areaId, setArea] = useArea();
  const areas = useMemo(() => areasOf(rows, workspaceId, workspaceName), [rows, workspaceId, workspaceName]);
  const split = areas.length > 1;
  const area = split ? pickArea(areas, areaId) : null;
  return (
    <>
      {split && <AreaTabs areas={areas} current={area?.id ?? null} onPick={setArea} total={rows.length} />}
      {split && !area && <AreaSummary areas={areas} onPick={setArea} />}
      {/* A chave zera os filtros ao trocar de espaço ou de área: campos de um não valem no outro. */}
      <Panorama
        key={`${workspaceId}:${area?.id ?? ""}`}
        rows={area ? area.rows : rows}
        workspaceName={area ? area.label : workspaceName}
        portfolioHref={`/portfolio${areaQuery(area?.id)}`}
      />
    </>
  );
}


interface PanoramaProps {
  rows: PortfolioRow[];
  workspaceName: string;
  portfolioHref?: string;
  /** Data de referência dos prazos ("aaaa-mm-dd"); fixa nos testes. */
  today?: string;
}

/** Panorama em formato de quadro, enxuto: poucos números no topo e os projetos em grupos
 *  recolhíveis, uma linha cada. Cor só onde pede atenção (risco, atraso, prazo vencido). */
export function Panorama({ rows, workspaceName, portfolioHref = "/portfolio", today = isoDate(new Date()) }: PanoramaProps) {
  const [filter, setFilter] = useState<OverviewFilter>(NO_FILTER);
  const [picked, setGroupBy] = useState<GroupBy>("health");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const index = useMemo(() => attributeIndex(rows.map((r) => r.attributes)), [rows]);
  // Um campo que sumiu do recorte (troca de área) volta ao agrupamento por situação.
  const groupBy: GroupBy = picked.startsWith("field:") && !index.has(picked.slice(6)) ? "health" : picked;

  // Os contadores de situação ignoram o próprio filtro, para o número escolhido não virar zero nos outros.
  const healthCounts = summarize(byField(rows, filter.field, filter.value)).health;
  const shownRows = applyFilter(rows, filter);
  const s = summarize(shownRows);
  const groups = groupTracks(shownRows.map((r) => track(r, today)), groupBy);

  const filtered = Boolean(filter.health || filter.field);
  const subtitle = filtered
    ? `${plural(shownRows.length, "projeto", "projetos")} de ${fmt(rows.length)} no recorte`
    : `${plural(rows.length, "projeto ativo", "projetos ativos")} que você pode ver em ${workspaceName}`;
  const toggleHealth = (h: Health) => setFilter((f) => ({ ...f, health: f.health === h ? null : h }));
  // Trocar de campo zera o valor: um valor de "Complexidade" não vale para "PDTI".
  const pickField = (field: string) => setFilter((f) => ({ ...f, field, value: "" }));
  const pickValue = (value: string) => setFilter((f) => ({ ...f, value }));
  const toggleGroup = (k: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  // Agrupado por situação, a coluna repetiria o nome do grupo em toda linha.
  const showHealth = groupBy !== "health";

  return (
    <section className="ov pn" aria-labelledby="ov-title">
      <div className="pn-head">
        <div className="pn-title">
          <h2 id="ov-title">Panorama</h2>
          <p className="muted">{subtitle}</p>
        </div>
        <div className="pn-tools" role="search" aria-label="Filtrar o panorama">
          {index.size > 0 && (
            <select className="select pn-select" aria-label="Filtrar por campo" value={filter.field} onChange={(e) => pickField(e.target.value)}>
              <option value="">Todos os campos</option>
              {[...index.keys()].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {filter.field && (
            <select className="select pn-select" aria-label={`Valor de ${filter.field}`} value={filter.value} onChange={(e) => pickValue(e.target.value)}>
              <option value="">Qualquer valor</option>
              {(index.get(filter.field) ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          <label className="pn-groupby">
            <span>Agrupar por</span>
            <select className="select pn-select" value={groupBy} onChange={(e) => { setGroupBy(e.target.value as GroupBy); setClosed(new Set()); }}>
              {(Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[]).map((k) => <option key={k} value={k}>{GROUP_LABEL[k]}</option>)}
              {[...index.keys()].map((n) => <option key={n} value={`field:${n}`}>{n}</option>)}
            </select>
          </label>
          {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(NO_FILTER)}>Limpar filtros</button>}
          <Link to={portfolioHref} className="btn btn-ghost btn-sm">Abrir portfólio</Link>
        </div>
      </div>

      <ul className="pn-stats" aria-label="Resumo">
        <Stat label="Projetos" value={fmt(s.projects)} />
        <Stat label="Conclusão média" value={`${s.avgProgress}%`} />
        <Stat label="Em risco" value={fmt(healthCounts.at_risk)} tone={healthCounts.at_risk ? "warn" : undefined} pressed={filter.health === "at_risk"} onClick={() => toggleHealth("at_risk")} />
        <Stat label="Atrasados" value={fmt(healthCounts.late)} tone={healthCounts.late ? "bad" : undefined} pressed={filter.health === "late"} onClick={() => toggleHealth("late")} />
        <Stat label="Tarefas atrasadas" value={fmt(s.overdue)} tone={s.overdue ? "bad" : undefined} />
      </ul>

      {filter.health && (
        <div className="row pn-chips">
          <button type="button" className="badge ov-chip" onClick={() => toggleHealth(filter.health!)} aria-label={`Remover filtro de situação ${HEALTH_LABEL[filter.health]}`}>
            Situação: {HEALTH_LABEL[filter.health]} <X size={13} aria-hidden />
          </button>
        </div>
      )}

      {groups.length ? (
        // Como um board: cada grupo é uma tabela com o próprio cabeçalho e uma linha de resumo.
        <div className="pn-board-wrap" role="region" aria-label="Quadro dos projetos">
          {groups.map((g) => (
            <Group key={g.key} g={g} open={!closed.has(g.key)} onToggle={() => toggleGroup(g.key)} showHealth={showHealth} today={today} />
          ))}
        </div>
      ) : (
        <p className="muted pn-empty">Nenhum projeto neste recorte.</p>
      )}
    </section>
  );
}

function Group({ g, open, onToggle, showHealth, today }: { g: BoardGroup; open: boolean; onToggle: () => void; showHealth: boolean; today: string }) {
  const rows = g.tracks.map((t) => t.row);
  const sum = summarize(rows);
  const starts = g.tracks.map((t) => t.start ?? t.end).filter((d): d is string => !!d).sort();
  const ends = g.tracks.map((t) => t.end).filter((d): d is string => !!d).sort();
  const from = starts[0] ?? null;
  const to = ends.at(-1) ?? null;
  return (
    <section className={`pn-group g-${g.color}`}>
      <table className="pn-board" aria-label={g.label}>
        <thead>
          <tr>
            <th scope="col" className="pn-gtitle">
              <button type="button" aria-expanded={open} onClick={onToggle}>
                <ChevronDown size={18} aria-hidden className="pn-chev" />
                <span className="pn-group-l">{g.label}</span>
              </button>
              <span className="pn-count">{plural(g.tracks.length, "projeto", "projetos")}</span>
            </th>
            {showHealth && <th scope="col" className="pn-c-health">Situação</th>}
            <th scope="col" className="pn-c-prog">Progresso</th>
            <th scope="col" className="pn-c-tl">Timeline</th>
            <th scope="col" className="pn-c-date">Término</th>
            <th scope="col" className="pn-c-num">Atrasadas</th>
          </tr>
        </thead>
        {open && (
          <>
            <tbody>{g.tracks.map((t) => <BoardRow key={t.row.id} t={t} showHealth={showHealth} today={today} />)}</tbody>
            <tfoot>
              <tr>
                <td className="pn-foot-pad" />
                {showHealth && (
                  <td className="pn-c-health">
                    <span className="pn-mix" role="img" aria-label={`Situação: ${(["late", "at_risk", "on_track"] as Health[]).map((h) => `${HEALTH_LABEL[h]} ${sum.health[h]}`).join(", ")}`}>
                      {(["on_track", "at_risk", "late"] as Health[]).filter((h) => sum.health[h]).map((h) => (
                        <span key={h} className={`g-${HEALTH_COLOR[h]}`} style={{ flexGrow: sum.health[h] }} />
                      ))}
                    </span>
                  </td>
                )}
                <td className="pn-c-prog"><Battery pct={sum.avgProgress} name="Média do grupo" /></td>
                <td className="pn-c-tl"><Pill start={from} end={to} today={today} /></td>
                <td className="pn-c-date" />
                <td className={`pn-c-num${sum.overdue ? " pn-bad" : ""}`}>
                  <span className="sr-only">Tarefas atrasadas no grupo: </span>
                  {fmt(sum.overdue)}
                  <small> soma</small>
                </td>
              </tr>
            </tfoot>
          </>
        )}
      </table>
    </section>
  );
}

function BoardRow({ t, showHealth, today }: { t: Track; showHealth: boolean; today: string }) {
  const r = t.row;
  const { informed } = projectProgress(r);
  const late = t.pace === "late";
  return (
    <tr>
      <th scope="row" className="pn-name">
        <Link to={`/projetos/${r.id}`} title={r.phase ? `${r.name} · ${PHASE_LABEL[r.phase]}` : r.name}>{r.name}</Link>
      </th>
      {showHealth && <td className={`pn-c-health pn-label g-${HEALTH_COLOR[r.health]}`}>{HEALTH_LABEL[r.health]}</td>}
      <td className="pn-c-prog" title={`${informed ? "% informado · " : ""}${fmt(r.done_count)} de ${fmt(r.task_count)} tarefas concluídas`}>
        <Battery pct={t.pct} name="Progresso" />
      </td>
      <td className="pn-c-tl" title={[PACE_LABEL[t.pace], daysText(t)].join(" · ")}>
        <Pill start={t.start} end={t.end} today={today} />
      </td>
      <td className="pn-c-date" title={daysText(t)}>
        {t.end ? fmtDate(t.end) : "—"}
        {late && <span className="sr-only"> ({daysText(t)})</span>}
      </td>
      <td className={`pn-c-num${r.overdue_count ? " pn-bad" : " muted"}`}>
        <span className="sr-only">Tarefas atrasadas: </span>
        {r.overdue_count ? fmt(r.overdue_count) : "—"}
      </td>
    </tr>
  );
}

/** Pílula da timeline: a parte cheia é o tempo já decorrido do período. */
function Pill({ start, end, today }: { start: string | null; end: string | null; today: string }) {
  if (!end) return <span className="pn-pill pn-pill-none">sem data</span>;
  const done = Math.round(elapsed(start, end, today) * 100);
  return (
    <span className="pn-pill" style={{ ["--done" as string]: `${done}%` }}>
      {rangeText(start, end, today)}
    </span>
  );
}

/** Bateria: barra de % com o valor ao lado. */
function Battery({ pct, name }: { pct: number; name: string }) {
  return (
    <span className="pn-bat">
      <span className="pn-bat-track" aria-hidden><span className="pn-bat-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></span>
      <span className="pn-bat-v"><span className="sr-only">{name}: </span>{pct}%</span>
    </span>
  );
}

function Stat({ label, value, tone, pressed, onClick }: { label: string; value: string; tone?: string; pressed?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="pn-stat-v">{value}</span>
      <span className="pn-stat-l">{label}</span>
    </>
  );
  return (
    <li className={`pn-stat${tone ? ` pn-${tone}` : ""}`}>
      {onClick ? (
        <button type="button" aria-pressed={pressed} onClick={onClick} aria-label={`Filtrar por ${label} (${value})`}>
          {body}
        </button>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}
