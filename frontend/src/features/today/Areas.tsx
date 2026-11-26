import { useSearchParams } from "react-router";
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
