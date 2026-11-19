import { useQuery } from "@tanstack/react-query";
import { CircleGauge, FolderKanban, ListTodo, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorBox } from "../../components/ui";
import { HEALTH_LABEL, type Health, type PortfolioRow } from "../../domain/formal";
import {
  HEALTH_ORDER,
  NO_FILTER,
  TASK_STATE_ORDER,
  applyFilter,
  byField,
  defaultField,
  fieldBars,
  overdueBars,
  phaseBars,
  progressBars,
  summarize,
  type Bar,
  type OverviewFilter,
  type TaskState,
} from "../../domain/overview";
import { STATUS_LABEL } from "../../domain/types";
import { attributeIndex } from "../../domain/work";
import { api } from "../../services/api";
import { Esteira } from "./Esteira";

const HEALTH_TONE: Record<Health, string> = { on_track: "ok", at_risk: "warn", late: "bad" };
const STATE_TONE: Record<TaskState, string> = { done: "ok", doing: "info", todo: "rest", blocked: "warn" };
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
  // A chave zera os filtros ao trocar de espaço: campos e valores de um não valem no outro.
  return <Panorama key={workspaceId} rows={q.data.projects} workspaceName={workspaceName} />;
}

export function Panorama({ rows, workspaceName }: { rows: PortfolioRow[]; workspaceName: string }) {
  const [filter, setFilter] = useState<OverviewFilter>(NO_FILTER);
  const index = useMemo(() => attributeIndex(rows.map((r) => r.attributes)), [rows]);
  const [picked, setGroupBy] = useState("");
  const groupBy = index.has(picked) ? picked : defaultField(index);

  // A situação é calculada sem o próprio filtro, para destacar o segmento escolhido sem sumir com os outros.
  const sliced = byField(rows, filter.field, filter.value);
  const shown = applyFilter(rows, filter);
  const s = summarize(shown);
  const healthCounts = summarize(sliced).health;
  const phases = phaseBars(shown);
  const filtered = filter.health || filter.field;
  const subtitle = filtered
    ? `${plural(shown.length, "projeto", "projetos")} de ${fmt(rows.length)} no recorte`
    : `${plural(rows.length, "projeto ativo", "projetos ativos")} que você pode ver em ${workspaceName}`;
  const toggleHealth = (h: Health) => setFilter((f) => ({ ...f, health: f.health === h ? null : h }));
  // Trocar de campo zera o valor: um valor de "Complexidade" não vale para "PDTI".
  const pickField = (field: string) => setFilter((f) => ({ ...f, field, value: "" }));
  const pickValue = (value: string) => setFilter((f) => ({ ...f, value }));

  return (
    <section className="ov" aria-labelledby="ov-title">
      <div className="ov-head">
        <div>
          <h2 id="ov-title">Panorama</h2>
          <p className="muted">{subtitle}</p>
        </div>
        <Link to="/portfolio" className="btn btn-ghost btn-sm">Abrir portfólio</Link>
      </div>

      {(index.size > 0 || filter.health) && (
        <div className="row ov-filters" role="search" aria-label="Filtrar o panorama">
          {index.size > 0 && (
            <>
              <select className="select" aria-label="Filtrar por campo" value={filter.field} onChange={(e) => pickField(e.target.value)}>
                <option value="">Todos os campos</option>
                {[...index.keys()].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {filter.field && (
                <select className="select" aria-label={`Valor de ${filter.field}`} value={filter.value} onChange={(e) => pickValue(e.target.value)}>
                  <option value="">Qualquer valor</option>
                  {(index.get(filter.field) ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </>
          )}
          {filter.health && (
            <button
              type="button"
              className="badge ov-chip"
              onClick={() => setFilter((f) => ({ ...f, health: null }))}
              aria-label={`Remover filtro de situação ${HEALTH_LABEL[filter.health]}`}
            >
              Situação: {HEALTH_LABEL[filter.health]} <X size={13} aria-hidden />
            </button>
          )}
          {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(NO_FILTER)}>Limpar filtros</button>}
        </div>
      )}

      <div className="ov-kpis">
        <Kpi icon={<FolderKanban size={18} aria-hidden />} label="Projetos ativos" value={fmt(s.projects)} />
        <Kpi icon={<CircleGauge size={18} aria-hidden />} label="Conclusão média" value={`${s.avgProgress}%`} />
        <Kpi icon={<ListTodo size={18} aria-hidden />} label="Tarefas abertas" value={fmt(s.open)} note={`de ${fmt(s.tasks)}`} />
        <Kpi icon={<TriangleAlert size={18} aria-hidden />} label="Tarefas atrasadas" value={fmt(s.overdue)} tone={s.overdue ? "bad" : undefined} />
        <Kpi icon={<OctagonAlert size={18} aria-hidden />} label="Tarefas bloqueadas" value={fmt(s.blocked)} tone={s.blocked ? "warn" : undefined} />
      </div>

      {/* Logo após os indicadores: é a leitura principal do panorama, no mesmo recorte dos filtros. */}
      <Esteira rows={shown} />

      <div className="ov-grid">
        <Chart title="Situação dos projetos" hint="Clique numa situação para filtrar o panorama.">
          <Segmented
            label="Situação dos projetos"
            unit={["projeto", "projetos"]}
            parts={HEALTH_ORDER.map((h) => ({ key: h, label: HEALTH_LABEL[h], n: healthCounts[h], tone: HEALTH_TONE[h] }))}
            selected={filter.health}
            onSelect={(k) => toggleHealth(k as Health)}
          />
        </Chart>

        <Chart title="Tarefas por estado">
          {s.tasks ? (
            <Segmented
              label="Tarefas por estado"
              unit={["tarefa", "tarefas"]}
              parts={TASK_STATE_ORDER.map((k) => ({ key: k, label: STATUS_LABEL[k], n: s.states[k], tone: STATE_TONE[k] }))}
            />
          ) : (
            <p className="muted">Nenhuma tarefa nos projetos do recorte.</p>
          )}
        </Chart>

        <Chart title="Progresso por projeto" hint="% informado por quem gerencia ou, sem ele, tarefas concluídas.">
          <BarList bars={progressBars(shown)} tone="info" scale={100} suffix="%" name="Progresso" />
        </Chart>

        <Chart title="Tarefas atrasadas por projeto">
          {s.overdue ? (
            <BarList bars={overdueBars(shown)} tone="bad" name="Tarefas atrasadas" />
          ) : (
            <p className="muted">Nenhuma tarefa atrasada no recorte.</p>
          )}
        </Chart>

        {phases.length > 0 && (
          <Chart title="Projetos formais por fase">
            <BarList bars={phases} tone="info" name="Projetos" all />
          </Chart>
        )}

        {index.size > 0 && groupBy && (
          <Chart
            title={`Projetos por ${groupBy}`}
            action={
              index.size > 1 && (
                <select className="select ov-select" aria-label="Agrupar projetos por campo" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                  {[...index.keys()].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              )
            }
          >
            <BarList bars={fieldBars(shown, groupBy)} tone="info" name="Projetos" all />
          </Chart>
        )}
      </div>
    </section>
  );
}

function Kpi({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className={`ov-kpi ${tone ?? ""}`}>
      <span className="ov-kpi-l">{icon}{label}</span>
      <span className="ov-kpi-n">
        {value}
        {note && <small className="muted"> {note}</small>}
      </span>
    </div>
  );
}

function Chart({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <article className="card ov-card">
      <div className="ov-card-head">
        <h3>{title}</h3>
        {action}
      </div>
      {hint && <p className="ov-hint muted">{hint}</p>}
      {children}
    </article>
  );
}

interface Part {
  key: string;
  label: string;
  n: number;
  tone: string;
}

interface SegmentedProps {
  label: string;
  /** Singular e plural, para as descrições ("1 projeto", "3 projetos"). */
  unit: [string, string];
  parts: Part[];
  selected?: string | null;
  /** Com ele, a legenda vira botões de filtro. */
  onSelect?: (key: string) => void;
}

/** Barra segmentada: um todo dividido em partes. A legenda traz os números, então nada depende só da cor. */
function Segmented({ label, unit, parts, selected, onSelect }: SegmentedProps) {
  const total = parts.reduce((n, p) => n + p.n, 0);
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const describe = (p: Part) => `${p.label}: ${plural(p.n, unit[0], unit[1])} (${share(p.n)}%)`;
  const dim = (p: Part) => (selected && selected !== p.key ? " dim" : "");
  return (
    <div>
      <div className="ov-seg" role="img" aria-label={`${label}: ${parts.map(describe).join("; ")}`}>
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            // Só cabe o rótulo dentro do bloco quando ele ocupa uma fatia razoável da barra.
            <span key={p.key} className={`ov-block t-${p.tone}${dim(p)}`} style={{ flexGrow: p.n }} data-tip={describe(p)}>
              {p.n / total >= 0.12 && `${share(p.n)}%`}
            </span>
          ))}
      </div>
      <ul className="ov-legend">
        {parts.map((p) => {
          const body = (
            <>
              <i className={`ov-swatch t-${p.tone}`} aria-hidden />
              <span>{p.label}</span>
              <strong>{fmt(p.n)}</strong>
            </>
          );
          return (
            <li key={p.key} className={dim(p).trim()}>
              {onSelect ? (
                <button type="button" aria-pressed={selected === p.key} onClick={() => onSelect(p.key)} aria-label={`Filtrar por ${p.label} (${plural(p.n, unit[0], unit[1])})`}>
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PREVIEW = 8;

interface BarListProps {
  bars: Bar[];
  tone: string;
  /** Máximo fixo da escala (100 para %); sem ele, vale o maior valor. */
  scale?: number;
  suffix?: string;
  /** O que o número mede, lido por leitores de tela antes do valor. */
  name: string;
  /** Mostra todas as barras de uma vez, sem o "Ver todos". */
  all?: boolean;
}

/** Barras horizontais ordenadas, com o valor na ponta. */
function BarList({ bars, tone, scale, suffix = "", name, all = false }: BarListProps) {
  const [expanded, setExpanded] = useState(false);
  const max = scale ?? Math.max(1, ...bars.map((b) => b.value));
  const visible = all || expanded ? bars : bars.slice(0, PREVIEW);
  return (
    <>
      <ul className={`ov-bars${scale ? " has-track" : ""}`}>
        {visible.map((b) => (
          <li key={b.key}>
            {b.to ? <Link to={b.to} className="ov-bar-l">{b.label}</Link> : <span className="ov-bar-l">{b.label}</span>}
            <span className="ov-track" data-tip={`${b.label}: ${fmt(b.value)}${suffix}${b.detail ? ` · ${b.detail}` : ""}`}>
              {b.value > 0 && <span className={`ov-bar t-${tone}`} style={{ width: `${(b.value / max) * 100}%` }} />}
            </span>
            <span className="ov-bar-v">
              <span className="sr-only">{name}: </span>
              {fmt(b.value)}{suffix}
            </span>
          </li>
        ))}
      </ul>
      {!all && bars.length > PREVIEW && (
        <button type="button" className="btn btn-ghost btn-sm ov-more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? "Mostrar menos" : `Ver todos (${bars.length})`}
        </button>
      )}
    </>
  );
}
