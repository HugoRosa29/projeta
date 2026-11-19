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

const PHASES = Object.keys(PHASE_LABEL) as Phase[];
const SEVERITY: Record<Health, number> = { late: 0, at_risk: 1, on_track: 2 };
const BADGE: Record<Health, string> = { late: "alerta", at_risk: "warn", on_track: "ok" };
type Filter = "all" | Health;

export function PortfolioPage() {
  const { workspace } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [field, setField] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const q = useQuery({
    queryKey: ["portfolio", workspace.id],
    queryFn: () => api.get<{ projects: Row[] }>("/portfolio", { workspace_id: workspace.id }),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  const all = [...q.data!.projects].sort((a, b) => SEVERITY[a.health] - SEVERITY[b.health] || a.name.localeCompare(b.name, "pt-BR"));
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
      <Hero eyebrow="Portfólio" title="Visão do portfólio" subtitle={`Projetos ativos de ${workspace.name} que você pode ver.`} />

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
            <div className="pf-grid">
              {shown.map((r) => (
                <ProjectCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </>
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
