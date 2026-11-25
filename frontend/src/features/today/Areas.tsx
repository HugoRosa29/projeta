import { useSearchParams } from "react-router";
import { HEALTH_LABEL } from "../../domain/formal";
import type { Area } from "../../domain/areas";

/** Área escolhida fica na URL (?area=…): o link do panorama de DISID pode ser guardado e
 *  enviado, e a home e o portfólio mostram o mesmo recorte. */
export function useArea(): [string | null, (id: string | null) => void] {
  const [sp, setSp] = useSearchParams();
  const set = (id: string | null) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("area", id);
      else next.delete("area");
      return next;
    }, { replace: true });
  return [sp.get("area"), set];
}

export function areaQuery(id: string | null | undefined): string {
  return id ? `?area=${encodeURIComponent(id)}` : "";
}

export function AreaTabs({ areas, current, onPick, total }: { areas: Area[]; current: string | null; onPick: (id: string | null) => void; total: number }) {
  return (
    <div className="area-tabs" role="group" aria-label="Área do panorama">
      <button type="button" className={`btn btn-sm ${current ? "btn-line" : "btn-primary"}`} aria-pressed={!current} onClick={() => onPick(null)}>
        Geral <span className="area-n">{total}</span>
      </button>
      {areas.map((a) => (
        <button key={a.id} type="button" className={`btn btn-sm ${current === a.id ? "btn-primary" : "btn-line"}`} aria-pressed={current === a.id} onClick={() => onPick(a.id)}>
          {a.label} <span className="area-n">{a.rows.length}</span>
        </button>
      ))}
    </div>
  );
}

/** Visão geral por área: uma linha por área, com situação e conclusão; clicar abre o panorama dela. */
export function AreaSummary({ areas, onPick }: { areas: Area[]; onPick: (id: string) => void }) {
  return (
    <section className="card area-summary" aria-labelledby="area-sum-title">
      <h2 id="area-sum-title">Por área</h2>
      <table className="area-table" aria-label="Resumo por área">
        <thead>
          <tr>
            <th scope="col">Área</th>
            <th scope="col">Projetos</th>
            <th scope="col">Conclusão média</th>
            <th scope="col">{HEALTH_LABEL.on_track}</th>
            <th scope="col">{HEALTH_LABEL.at_risk}</th>
            <th scope="col">{HEALTH_LABEL.late}</th>
            <th scope="col"><span className="sr-only">Abrir</span></th>
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a.id}>
              <th scope="row">{a.label}{a.own && <span className="muted"> (próprios)</span>}</th>
              <td>{a.summary.projects}</td>
              <td>{a.summary.avgProgress}%</td>
              <td><span className={a.summary.health.on_track ? "badge ok" : "muted"}>{a.summary.health.on_track}</span></td>
              <td><span className={a.summary.health.at_risk ? "badge warn" : "muted"}>{a.summary.health.at_risk}</span></td>
              <td><span className={a.summary.health.late ? "badge alerta" : "muted"}>{a.summary.health.late}</span></td>
              <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(a.id)}>Ver panorama</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
