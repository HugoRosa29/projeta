import { Link2, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Empty, useToast } from "../../components/ui";
import { STATUS_LABEL, fmtDate, type Task } from "../../domain/types";
import { dependencyCandidates, scheduleConflicts } from "../../domain/work";
import { useDependency } from "../tasks/hooks";

/** Altura fixa da linha: as setas entre barras são calculadas a partir dela. */
const ROW = 34;
/** Arrasto menor que isso conta como clique (modo "clicar e escolher"). */
const DRAG_MIN = 5;

/** Cronograma (Gantt) com dependências: barra do início ao prazo e setas "termina → começa".
 * Para ligar: arraste a bolinha no fim de uma barra até a tarefa que vem depois, ou clique na
 * bolinha e depois na tarefa (serve para toque e teclado). Clicar numa seta desfaz a ligação.
 * O servidor continua recusando ciclo e quem não pode editar. */
export function Timeline({ tasks, canWrite, onOpen }: { tasks: Task[]; canWrite: boolean; onOpen: (id: string) => void }) {
  const { add, remove } = useDependency();
  const toast = useToast();
  const linesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Largura real da faixa das barras: as setas são desenhadas em pixels.
  const hasRows = tasks.some((t) => t.due_date);
  useLayoutEffect(() => {
    const el = linesRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);

  useEffect(() => {
    if (!linkFrom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLinkFrom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkFrom]);

  const byStart = (t: Task) => t.start_date ?? t.due_date!;
  const dated = tasks.filter((t) => t.due_date).sort((a, b) => byStart(a).localeCompare(byStart(b)) || a.due_date!.localeCompare(b.due_date!));
  if (!dated.length) return <Empty title="Cronograma vazio">Defina início e prazo nas tarefas (ou aplique uma EAP do assistente) para ver a linha do tempo.</Empty>;

  const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const created = (t: Task) => t.created_at.slice(0, 10);
  const from0 = (t: Task) => t.start_date ?? (created(t) && created(t) < t.due_date! ? created(t) : t.due_date!);
  const start = Math.min(...dated.map((t) => ms(from0(t))));
  const end = Math.max(...dated.map((t) => ms(t.due_date!)));
  const span = Math.max(end - start, 86400000);
  const pct = (d: string) => ((ms(d) - start) / span) * 100;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const row = new Map(dated.map((t, i) => [t.id, i]));
  const geo = (t: Task) => {
    const a = t.is_milestone ? pct(t.due_date!) : pct(from0(t));
    const b = pct(t.due_date!);
    return { left: a, right: t.is_milestone ? a : Math.max(b, a + 1) };
  };
  const px = (p: number) => (p / 100) * width;
  const yOf = (id: string) => row.get(id)! * ROW + ROW / 2;

  const source = linkFrom ?? (drag?.moved ? drag.from : null);
  const sourceTask = source ? byId.get(source) : undefined;
  /** Quem pode passar a depender da origem sem formar ciclo. */
  const canTarget = (target: Task) => !!sourceTask && dependencyCandidates(target, tasks).some((c) => c.id === sourceTask.id);

  const link = (fromId: string, toId: string) => {
    const a = byId.get(fromId);
    const b = byId.get(toId);
    setLinkFrom(null);
    if (!a || !b || a.id === b.id) return;
    if ((b.depends_on_ids ?? []).includes(a.id)) return toast(`${b.title} já depende de ${a.title}`);
    if (!canTarget(b)) return toast(`Não dá para ligar: ${a.title} já espera por ${b.title}, e isso fecharia um ciclo.`);
    add.mutate({ taskId: b.id, dependsOnId: a.id }, { onSuccess: () => toast(`${b.title} agora começa depois de ${a.title}`) });
  };

  const unlink = (taskId: string, depId: string) => {
    const a = byId.get(depId);
    const b = byId.get(taskId);
    if (!a || !b || !confirm(`Remover a dependência? “${b.title}” deixa de esperar por “${a.title}”.`)) return;
    remove.mutate({ taskId, dependsOnId: depId }, { onSuccess: () => toast(`${b.title} não depende mais de ${a.title}`) });
  };

  // Arrasto pela bolinha: ponteiro capturado, linha provisória até o ponto atual.
  const point = (e: ReactPointerEvent) => {
    const r = linesRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onHandleDown = (e: ReactPointerEvent, id: string) => {
    if (!canWrite || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ from: id, ...point(e), moved: false });
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = point(e);
    const moved = drag.moved || Math.hypot(p.x - px(geo(byId.get(drag.from)!).right), p.y - yOf(drag.from)) > DRAG_MIN;
    setDrag({ ...drag, ...p, moved });
    const over = document.elementFromPoint?.(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tl-row]")?.dataset.tlRow ?? null;
    setHover(over);
  };
  const onHandleUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    setHover(null);
    if (!d.moved) {
      // Clique simples: entra no modo "agora escolha a tarefa que vem depois" (ou sai dele).
      setLinkFrom(linkFrom === d.from ? null : d.from);
      return;
    }
    const target = document.elementFromPoint?.(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tl-row]")?.dataset.tlRow;
    if (target) link(d.from, target);
  };

  const edges = dated.flatMap((t) =>
    (t.depends_on_ids ?? []).filter((id) => row.has(id)).map((id) => {
      const a = byId.get(id)!;
      const conflict = scheduleConflicts(t, tasks).some((c) => c.id === id);
      return { from: a, to: t, conflict };
    }),
  );
  const hidden = dated.reduce((n, t) => n + (t.depends_on_ids ?? []).filter((id) => !row.has(id)).length, 0);

  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const bend = Math.max(18, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className={`card pane pv-timeline ${source ? "tl-linking" : ""}`}>
      <div className="tl-head">
        <p className="coord">{fmtDate(new Date(start).toISOString().slice(0, 10))} → {fmtDate(new Date(end).toISOString().slice(0, 10))}</p>
        {canWrite && !linkFrom && <p className="coord tl-hint"><Link2 size={12} aria-hidden /> Arraste a bolinha no fim de uma barra até a tarefa que vem depois. Clique numa seta para desfazer.</p>}
      </div>
      {linkFrom && sourceTask && (
        <div className="tl-banner" role="status">
          <span>Escolha a tarefa que só começa depois de <strong>{sourceTask.title}</strong>.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkFrom(null)}><X size={15} aria-hidden /> Cancelar</button>
        </div>
      )}
      <div className="timeline gantt pane-body">
        <div className="gantt-rows" style={{ height: dated.length * ROW }}>
          {dated.map((t) => {
            const g = geo(t);
            const conflicts = scheduleConflicts(t, tasks);
            const deps = (t.depends_on_ids ?? []).map((id) => byId.get(id)?.title).filter(Boolean);
            const target = source && source !== t.id ? (canTarget(t) ? "ok" : "no") : null;
            const label = `${t.title}: ${t.start_date ? `início ${fmtDate(t.start_date)}, ` : ""}prazo ${fmtDate(t.due_date)}, ${STATUS_LABEL[t.status]}${deps.length ? `. Depende de ${deps.join(", ")}` : ""}${conflicts.length ? `. Começa antes de ${conflicts.map((c) => c.title).join(", ")} terminar` : ""}`;
            const pick = () => (linkFrom ? link(linkFrom, t.id) : onOpen(t.id));
            return (
              <div className={`tl-row ${target ? `tl-target-${target}` : ""} ${hover === t.id && target ? "tl-over" : ""} ${source === t.id ? "tl-source" : ""}`} key={t.id} data-tl-row={t.id} style={{ height: ROW }}>
                <button className="title tl-title" onClick={pick} title={deps.length ? `Depende de: ${deps.join(", ")}` : undefined}>
                  {conflicts.length > 0 && <TriangleAlert size={13} aria-hidden className="tl-warn" />}
                  {t.is_milestone ? "◆ " : ""}{t.title}
                </button>
                <div className="tl-track" aria-label={label}>
                  {linkFrom && target === "ok" && (
                    <button type="button" className="tl-pick" onClick={pick} aria-label={`${t.title} começa depois de ${sourceTask?.title ?? ""}`} />
                  )}
                  <div
                    className={`tl-bar ${t.is_milestone ? "milestone" : t.status === "done" ? "done" : t.status === "blocked" ? "blocked" : ""} ${!t.start_date && !t.is_milestone ? "no-start" : ""} ${conflicts.length ? "conflict" : ""}`}
                    style={{ left: `${g.left}%`, width: t.is_milestone ? undefined : `${g.right - g.left}%` }}
                  />
                  {canWrite && (
                    <button
                      type="button"
                      className="tl-handle"
                      style={{ left: `${g.right}%` }}
                      aria-label={`Ligar “${t.title}” a uma tarefa que vem depois`}
                      aria-pressed={linkFrom === t.id}
                      onPointerDown={(e) => onHandleDown(e, t.id)}
                      onPointerMove={onHandleMove}
                      onPointerUp={onHandleUp}
                      onPointerCancel={() => (setDrag(null), setHover(null))}
                      onClick={(e) => {
                        // Teclado (Enter/Espaço) gera clique sem ponteiro: alterna o modo de ligação.
                        if (e.detail === 0) setLinkFrom(linkFrom === t.id ? null : t.id);
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
          <div className="gantt-lines" ref={linesRef}>
            {width > 0 && (
              <svg width={width} height={dated.length * ROW} aria-hidden={!canWrite || undefined}>
                <defs>
                  <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" className="tl-arrowhead" />
                  </marker>
                  <marker id="tl-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" className="tl-arrowhead bad" />
                  </marker>
                </defs>
                {edges.map(({ from, to, conflict }) => {
                  const d = curve(px(geo(from).right) + 6, yOf(from.id), px(geo(to).left) - 2, yOf(to.id));
                  return (
                    <g key={`${from.id}-${to.id}`} className={`tl-edge ${conflict ? "bad" : ""}`}>
                      <path d={d} className="tl-edge-line" markerEnd={`url(#${conflict ? "tl-arrow-bad" : "tl-arrow"})`} />
                      {canWrite && (
                        <path d={d} className="tl-edge-hit" onClick={() => unlink(to.id, from.id)}>
                          <title>{`${to.title} depende de ${from.title}${conflict ? " (começa antes de terminar)" : ""}. Clique para desfazer.`}</title>
                        </path>
                      )}
                    </g>
                  );
                })}
                {drag?.moved && (
                  <path d={curve(px(geo(byId.get(drag.from)!).right) + 6, yOf(drag.from), drag.x, drag.y)} className="tl-edge-line tl-drafting" />
                )}
              </svg>
            )}
          </div>
        </div>
      </div>
      <p className="coord tl-legend">
        Barras tracejadas ainda não têm data de início (começam na criação da tarefa). <TriangleAlert size={12} aria-hidden /> e seta vermelha = começa antes de uma dependência terminar.
        {hidden > 0 && ` ${hidden} dependência(s) com tarefa sem prazo não aparecem aqui.`}
      </p>
    </div>
  );
}
