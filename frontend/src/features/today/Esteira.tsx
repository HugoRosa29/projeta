import { TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Phase, PortfolioRow } from "../../domain/formal";
import {
  PACE_HINT,
  PACE_LABEL,
  PACE_ORDER,
  byUrgency,
  paceCounts,
  stageGroups,
  timelineSpan,
  track,
  type Pace,
  type Track,
} from "../../domain/esteira";
import { fmtDate, isoDate } from "../../domain/types";

const PACE_TONE: Record<Pace, string> = { late: "bad", behind: "warn", soon: "info", ok: "ok", none: "rest" };
const fmt = (n: number) => n.toLocaleString("pt-BR");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const PREVIEW = 8;

type StageKey = Phase | "none";
const stageKey = (p: Phase | null): StageKey => p ?? "none";

function daysText(t: Track): string {
  if (t.daysLeft === null) return "sem prazo";
  if (t.daysLeft < 0) return `vencido há ${plural(-t.daysLeft, "dia", "dias")}`;
  if (t.daysLeft === 0) return "termina hoje";
  return `faltam ${plural(t.daysLeft, "dia", "dias")}`;
}

function describe(t: Track): string {
  const parts = [`${t.row.name}: ${t.pct}% concluído`, PACE_LABEL[t.pace]];
  if (t.start) parts.push(`início ${fmtDate(t.start)} (${t.startFrom})`);
  if (t.end) parts.push(`término ${fmtDate(t.end)} (${t.endFrom})`);
  if (t.gap !== null && t.gap > 0) parts.push(`${t.gap} pontos atrás do tempo decorrido`);
  return parts.join(" · ");
}

/** Esteira das fases e timeline de prazos dos projetos do recorte do panorama. */
export function Esteira({ rows, today = isoDate(new Date()) }: { rows: PortfolioRow[]; today?: string }) {
  const tracks = useMemo(() => rows.map((r) => track(r, today)), [rows, today]);
  const [pace, setPace] = useState<Pace | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const counts = paceCounts(tracks);
  const byPace = pace ? tracks.filter((t) => t.pace === pace) : tracks;
  const groups = stageGroups(byPace);
  const listed = (stage ? byPace.filter((t) => stageKey(t.row.phase) === stage) : byPace).slice().sort(byUrgency);
  const noPhase = tracks.every((t) => !t.row.phase);
  const stageLabel = groups.find((g) => stageKey(g.key) === stage)?.label;
  const phaseLabel = (p: Phase | null) => groups.find((g) => g.key === p)?.label ?? "Sem fase";

  const pickPace = (p: Pace) => setPace((cur) => (cur === p ? null : p));
  const pickStage = (k: StageKey) => setStage((cur) => (cur === k ? null : k));

  return (
    <div className="es">
      <article className="card ov-card es-card" aria-labelledby="es-title">
        <div className="ov-card-head">
          <h3 id="es-title">Esteira dos projetos</h3>
          {(pace || stage) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPace(null); setStage(null); }}>
              Limpar seleção
            </button>
          )}
        </div>
        <p className="ov-hint muted">Em que fase cada projeto está e como anda o prazo. Clique num número ou numa etapa para filtrar a timeline.</p>

        <ul className="es-pace" aria-label="Situação dos prazos">
          {PACE_ORDER.map((p) => (
            <li key={p}>
              <button
                type="button"
                className={`es-pace-card t-${PACE_TONE[p]}${pace && pace !== p ? " dim" : ""}`}
                aria-pressed={pace === p}
                onClick={() => pickPace(p)}
                title={PACE_HINT[p]}
              >
                <span className="es-pace-n">{fmt(counts[p])}</span>
                <span className="es-pace-l">{PACE_LABEL[p]}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="es-flow-wrap">
          <ol className="es-flow" aria-label="Fases">
            {groups.map((g) => {
              const k = stageKey(g.key);
              return (
                <li key={k} className={`es-stage${g.key === null ? " es-stage-none" : ""}${g.tracks.length ? " on" : ""}`}>
                  <button
                    type="button"
                    className={`es-box${stage && stage !== k ? " dim" : ""}`}
                    aria-pressed={stage === k}
                    onClick={() => pickStage(k)}
                    aria-label={`${g.label}: ${plural(g.tracks.length, "projeto", "projetos")}${g.attention ? `, ${fmt(g.attention)} com atenção` : ""}`}
                  >
                    <span className="es-code">{g.code}</span>
                    <span className="es-n">{fmt(g.tracks.length)}</span>
                    <span className="es-label">{g.label}</span>
                    {g.attention > 0 && (
                      <span className="es-flag" title={`${plural(g.attention, "projeto", "projetos")} com prazo vencido ou ritmo abaixo do previsto`}>
                        <TriangleAlert size={12} aria-hidden />
                        {fmt(g.attention)}<span className="es-flag-t"> com atenção</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        {noPhase && <p className="es-note muted">Nenhum projeto deste recorte tem fase. Defina a fase no modo formal do projeto para movê-lo na esteira.</p>}
      </article>

      <article className="card ov-card es-card" aria-labelledby="es-tl-title">
        <div className="ov-card-head">
          <h3 id="es-tl-title">Timeline de prazos</h3>
          {stage && (
            <button type="button" className="badge ov-chip" onClick={() => setStage(null)} aria-label={`Remover filtro de fase ${stageLabel}`}>
              {stageLabel} <X size={13} aria-hidden />
            </button>
          )}
          {pace && (
            <button type="button" className="badge ov-chip" onClick={() => setPace(null)} aria-label={`Remover filtro ${PACE_LABEL[pace]}`}>
              {PACE_LABEL[pace]} <X size={13} aria-hidden />
            </button>
          )}
        </div>
        <p className="ov-hint muted">
          Do início ao término previsto; a parte cheia é o % concluído e o tracejado vermelho, o atraso até hoje. Datas: campos do portfólio (Início, Data prevista…), depois o TAP, depois os prazos das tarefas.
        </p>
        {listed.length ? <Timeline tracks={listed} today={today} phaseLabel={phaseLabel} /> : <p className="muted">Nenhum projeto nesta seleção.</p>}
      </article>
    </div>
  );
}

function Timeline({ tracks, today, phaseLabel }: { tracks: Track[]; today: string; phaseLabel: (p: Phase | null) => string }) {
  const [expanded, setExpanded] = useState(false);
  const span = timelineSpan(tracks, today);
  const visible = expanded ? tracks : tracks.slice(0, PREVIEW);
  const todayAt = span?.at(today);
  return (
    <>
      <div className="es-tl" role="table" aria-label="Timeline dos projetos">
        <div className="es-tl-row es-tl-axis" role="row">
          <span role="columnheader" className="es-tl-name">Projeto</span>
          <span className="es-tl-track" role="columnheader" aria-label="Período">
            {span?.ticks.map((t) => (
              <span key={t.date} className="es-tick" style={{ left: `${t.at}%` }}>{t.label}</span>
            ))}
            {todayAt !== undefined && <span className="es-today-l" style={{ left: `${todayAt}%` }}>hoje</span>}
          </span>
          <span role="columnheader" className="es-tl-due">Prazo</span>
        </div>
        {visible.map((t) => (
          <div key={t.row.id} className="es-tl-row" role="row">
            <span role="cell" className="es-tl-name">
              <Link to={`/projetos/${t.row.id}`} title={t.row.name}>{t.row.name}</Link>
              <small className="muted">
                {phaseLabel(t.row.phase)} · {t.pct}%{t.end ? ` · término ${fmtDate(t.end)}` : ""}
              </small>
            </span>
            <span role="cell" className="es-tl-track" data-tip={describe(t)}>
              {span && span.ticks.map((k) => <span key={k.date} className="es-grid" style={{ left: `${k.at}%` }} aria-hidden />)}
              {todayAt !== undefined && <span className="es-today" style={{ left: `${todayAt}%` }} aria-hidden />}
              {span && t.end && <Bar t={t} at={span.at} today={today} />}
              {!t.end && <span className="es-nodate muted">sem data prevista</span>}
            </span>
            <span role="cell" className="es-tl-due">
              <span className={`es-pill t-${PACE_TONE[t.pace]}`}>{daysText(t)}</span>
            </span>
          </div>
        ))}
      </div>
      {tracks.length > PREVIEW && (
        <button type="button" className="btn btn-ghost btn-sm ov-more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? "Mostrar menos" : `Ver todos (${tracks.length})`}
        </button>
      )}
    </>
  );
}

function Bar({ t, at, today }: { t: Track; at: (d: string) => number; today: string }) {
  const left = at(t.start ?? t.end!);
  const right = at(t.end!);
  const width = Math.max(right - left, 0.8);
  return (
    <>
      <span className={`es-bar t-${PACE_TONE[t.pace]}`} style={{ left: `${left}%`, width: `${width}%` }}>
        <span className="es-fill" style={{ width: `${t.pct}%` }} />
      </span>
      {t.pace === "late" && <span className="es-overdue" style={{ left: `${right}%`, width: `${Math.max(0, at(today) - right)}%` }} />}
      <span className={`es-dot t-${PACE_TONE[t.pace]}`} style={{ left: `${right}%` }} />
    </>
  );
}
