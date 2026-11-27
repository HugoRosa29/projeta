import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, OctagonAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useSession } from "../../app/session";
import { Hero } from "../../components/Hero";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import { HEALTH_LABEL, PHASE_LABEL, type Health, type Phase, type PortfolioRow as Row } from "../../domain/formal";
import { attributeIndex, attributeValue, projectProgress } from "../../domain/work";
import { api } from "../../services/api";
import { coverUrl } from "../projects/cover";
import { areasOf, pickArea } from "../../domain/areas";
import { AreaTabs, useArea } from "../today/Areas";
import { useViewMode, ViewToggle, type ViewMode } from "../../components/ViewToggle";
import { Panorama } from "./Panorama";

const PHASES = Object.keys(PHASE_LABEL) as Phase[];
const SEVERITY: Record<Health, number> = { late: 0, at_risk: 1, on_track: 2 };
const BADGE: Record<Health, string> = { late: "alerta", at_risk: "warn", on_track: "ok" };
type Filter = "all" | Health;
// O quadro (o antigo panorama da home) é o padrão: a home ficou com o resumo em blocos por área.
const MODES: readonly ViewMode[] = ["board", "blocks", "list"];

export function PortfolioPage() {
  const { workspace } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [field, setField] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [areaId, setArea] = useArea();
  const [view, setView] = useViewMode("portfolio", MODES);
  const q = useQuery({
    queryKey: ["portfolio", workspace.id],
    queryFn: () => api.get<{ projects: Row[] }>("/portfolio", { workspace_id: workspace.id }),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  const everything = q.data!.projects;
  const areas = areasOf(everything, workspace.id, workspace.name);
  const area = areas.length > 1 ? pickArea(areas, areaId) : null;
  const all = [...(area ? area.rows : everything)].sort((a, b) => SEVERITY[a.health] - SEVERITY[b.health] || a.name.localeCompare(b.name, "pt-BR"));
  const index = attributeIndex(all.map((r) => r.attributes));
  // O filtro por campo vale também para os contadores de situação.
  const rows = field ? all.filter((r) => (fieldValue ? attributeValue(r.attributes, field) === fieldValue : attributeValue(r.attributes, field) !== undefined)) : all;
  const count = (h: Health) => rows.filter((r) => r.health === h).length;
  const shown = filter === "all" ? rows : rows.filter((r) => r.health === filter);
  const tiles: { key: Filter; label: string; n: number; tone: string }[] = [
    { key: "all", label: "Projetos ativos", n: rows.length, tone: "info" },
    { key: "on_track", label: HEALTH_LABEL.on_track, n: count("on_track"), tone: "ok" },
    { key: "at_risk", label: HEALTH_LABEL.at_risk, n: count("at_risk"), tone: "warn" },
    { key: "late", label: HEALTH_LABEL.late, n: count("late"), tone: "alerta" },
  ];

  return (
    <>
      {/* Faixa baixa com a forma de ver ao lado: o quadro começa logo abaixo, sem rolagem. */}
      <Hero
        compact
        eyebrow="Portfólio"
        title="Visão do portfólio"
        subtitle={area ? `Projetos ativos de ${area.label}, recebidos por ${workspace.name}.` : `Projetos ativos de ${workspace.name} que você pode ver.`}
      >
        <ViewToggle mode={view} onChange={setView} modes={MODES} />
      </Hero>

      {areas.length > 1 && <AreaTabs areas={areas} current={area?.id ?? null} onPick={setArea} total={everything.length} />}

      {view === "board" ? (
        all.length ? (
          // A chave zera filtros e agrupamento ao trocar de área: campos de uma não valem na outra.
          <Panorama key={area?.id ?? ""} rows={all} workspaceName={area ? area.label : workspace.name} />
        ) : (
          <Empty title="Nenhum projeto ativo">Crie um projeto em Projetos para acompanhá-lo aqui.</Empty>
        )
      ) : (
        <>
          {index.size > 0 && (
            <div className="row pf-fields" role="search" aria-label="Filtrar por campo do portfólio">
              <select className="select" aria-label="Campo" value={field} onChange={(e) => (setField(e.target.value), setFieldValue(""))}>
                <option value="">Todos os campos</option>
                {[...index.keys()].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {field && (
                <select className="select" aria-label={`Valor de ${field}`} value={fieldValue} onChange={(e) => setFieldValue(e.target.value)}>
                  <option value="">Qualquer valor</option>
                  {(index.get(field) ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              {field && <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setField(""), setFieldValue(""))}>Limpar</button>}
            </div>
          )}

          {all.length === 0 ? (
            <Empty title="Nenhum projeto ativo">Crie um projeto em Projetos para acompanhá-lo aqui.</Empty>
          ) : (
            <>
              <div className="pf-tiles" role="group" aria-label="Filtrar por situação">
                {tiles.map((t) => (
                  <button key={t.key} type="button" className={`pf-tile ${t.tone}`} aria-pressed={filter === t.key} onClick={() => setFilter(t.key)}>
                    <span className="pf-n">{t.n}</span>
                    <span className="pf-l">{t.label}</span>
                  </button>
                ))}
              </div>

              {shown.length === 0 ? (
                <Empty title="Nenhum projeto nessa situação">Escolha outra situação acima para ver os demais.</Empty>
              ) : (
                view === "list" ? (
                  <div className="plist pf-list" role="list" aria-label="Projetos do portfólio">
                    <div className="plist-head" aria-hidden="true">
                      <span>Situação</span><span>Projeto</span><span>Fase</span><span>Progresso</span><span>Pendências</span>
                    </div>
                    {shown.map((r) => (
                      <PortfolioRow key={r.id} r={r} />
                    ))}
                  </div>
                ) : (
                  <div className="pf-grid">
                    {shown.map((r) => (
                      <ProjectCard key={r.id} r={r} />
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

/** Versão em linha do cartão: mesmas informações, o mínimo de altura. SEI e campos vão numa
 *  segunda linha curta, cortada se não couber (o texto completo fica na dica). */
function PortfolioRow({ r }: { r: Row }) {
  const { pct, informed } = projectProgress(r);
  const at = r.phase ? PHASES.indexOf(r.phase) : -1;
  const extra = [r.sei_process && `SEI ${r.sei_process}`, ...(r.attributes ?? []).map((a) => `${a.name}: ${a.value}`)].filter(Boolean).join(" · ");
  return (
    <Link to={`/projetos/${r.id}`} className={`plist-row ${r.health}`} role="listitem">
      <span><span className={`badge ${BADGE[r.health]}`}>{HEALTH_LABEL[r.health]}</span></span>
      <span className="plist-name">
        <strong>{r.name}</strong>
        {r.shared_from && <span className="badge" title="Compartilhado no organograma: só leitura">de {r.shared_from}</span>}
        {extra && <small className="muted" title={extra}>{extra}</small>}
      </span>
      <span className="plist-cell">
        {r.phase ? (
          <>
            <ol className="pf-steps" aria-label={`Fase: ${PHASE_LABEL[r.phase]}`}>
              {PHASES.map((p, i) => (
                <li key={p} className={i < at ? "done" : i === at ? "current" : ""} />
              ))}
            </ol>
            <small className="coord">{PHASE_LABEL[r.phase]}</small>
          </>
        ) : (
          <small className="coord">Projeto comum</small>
        )}
      </span>
      <span className="plist-prog">
        <span className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${r.name}`}><span style={{ width: `${pct}%` }} /></span>
        <span className="coord">{pct}%{informed ? "*" : ""} · {r.done_count}/{r.task_count}</span>
      </span>
      <span className="plist-facts">
        <span className={r.overdue_count ? "bad" : ""} title={`${r.overdue_count} atrasada${r.overdue_count === 1 ? "" : "s"}`}>
          {r.overdue_count ? <TriangleAlert size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
          {r.overdue_count}<span className="sr-only"> atrasadas</span>
        </span>
        <span className={r.blocked_count ? "warn" : ""} title={`${r.blocked_count} bloqueada${r.blocked_count === 1 ? "" : "s"}`}>
          <OctagonAlert size={14} aria-hidden />
          {r.blocked_count}<span className="sr-only"> bloqueadas</span>
        </span>
        {r.phase && (
          <span className={r.note_stale ? "warn" : ""} title={r.note_stale ? "Nota semanal vencida" : `Nota de ${new Date(r.last_note_at!).toLocaleDateString("pt-BR")}`}>
            <FileText size={14} aria-hidden />
            <span className="sr-only">{r.note_stale ? "Nota semanal vencida" : "Nota em dia"}</span>
          </span>
        )}
      </span>
    </Link>
  );
}

function ProjectCard({ r }: { r: Row }) {
  const { pct, informed } = projectProgress(r);
  const at = r.phase ? PHASES.indexOf(r.phase) : -1;
  return (
    <article className={`pf-card ${r.health}`}>
      <div className="pf-cover">
        {r.cover_version && <img src={coverUrl(r.id, r.cover_version)} alt="" loading="lazy" />}
        <span className={`badge ${BADGE[r.health]}`}>{HEALTH_LABEL[r.health]}</span>
      </div>
      <div className="pf-body">
        <h2>
          <Link to={`/projetos/${r.id}`} className="pf-link">{r.name}</Link>
          {r.shared_from && <> <span className="badge" title="Compartilhado no organograma: só leitura">de {r.shared_from}</span></>}
        </h2>

        {r.phase ? (
          <div>
            <ol className="pf-steps" aria-label={`Fase: ${PHASE_LABEL[r.phase]}`}>
              {PHASES.map((p, i) => (
                <li key={p} className={i < at ? "done" : i === at ? "current" : ""} />
              ))}
            </ol>
            <p className="coord">{PHASE_LABEL[r.phase]}</p>
          </div>
        ) : (
          <p className="coord">Projeto comum</p>
        )}

        <div>
          <div className="pf-pct">
            <strong>{pct}%</strong>
            <span className="muted">{informed ? "informado · " : ""}{r.done_count}/{r.task_count} tarefas</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${r.name}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>

        <ul className="pf-facts">
          <li className={r.overdue_count ? "bad" : ""}>
            {r.overdue_count ? <TriangleAlert size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
            {r.overdue_count} atrasada{r.overdue_count === 1 ? "" : "s"}
          </li>
          <li className={r.blocked_count ? "warn" : ""}>
            <OctagonAlert size={15} aria-hidden />
            {r.blocked_count} bloqueada{r.blocked_count === 1 ? "" : "s"}
          </li>
          {r.phase && (
            <li className={r.note_stale ? "warn" : ""}>
              <FileText size={15} aria-hidden />
              {r.note_stale ? "Nota semanal vencida" : `Nota de ${new Date(r.last_note_at!).toLocaleDateString("pt-BR")}`}
            </li>
          )}
          {r.sei_process && <li className="muted">SEI {r.sei_process}</li>}
        </ul>

        {!!r.attributes?.length && (
          <dl className="pf-attrs">
            {r.attributes.map((a) => (
              <div key={a.name}>
                <dt>{a.name}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}
