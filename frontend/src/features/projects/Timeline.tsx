import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Link2, Maximize2, Minimize2, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Empty, useToast } from "../../components/ui";
import { STATUS_LABEL, fmtDate, type Task } from "../../domain/types";
import { dependencyCandidates, localToday, scheduleConflicts } from "../../domain/work";
import { useDependency } from "../tasks/hooks";

/** Alturas fixas: as setas entre barras são calculadas a partir delas. */
const ROW = 28;
const PHASE_ROW = 26;
/** Arrasto menor que isso conta como clique (modo "clicar e escolher"). */
const DRAG_MIN = 5;
const DAY = 86400000;

/** Zoom = quantos dias cabem na largura visível (não pixels fixos por dia): a escala acompanha a
 * tela e, se o projeto inteiro couber na janela, não há rolagem lateral. */
const ZOOMS = [
  ["semana", "Semana", 21],
  ["mes", "Mês", 62],
  ["trimestre", "Trimestre", 124],
  ["ajustar", "Ajustar", 0],
] as const;
type Zoom = (typeof ZOOMS)[number][0];

type Item = { kind: "phase"; key: string; name: string; from: string; to: string } | { kind: "task"; key: string; task: Task };

const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
const short = (d: string) => fmtDate(d).slice(0, 5);

/** Caminho em ângulos retos com cantos arredondados (estilo de cronograma, sem curvas soltas). */
function rounded(pts: [number, number][], r = 6): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    const ax = x - ((x - px) / (inLen || 1)) * k;
    const ay = y - ((y - py) / (inLen || 1)) * k;
    const bx = x + ((nx - x) / (outLen || 1)) * k;
    const by = y + ((ny - y) / (outLen || 1)) * k;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L ${lx} ${ly}`;
}

/** Do fim da anterior ao início da seguinte. Se a seguinte começa logo em seguida (ou antes),
 * a linha contorna por baixo da anterior em vez de cruzar as barras. */
function route(x1: number, y1: number, x2: number, y2: number): string {
  const g = 10;
  if (x2 - x1 >= g * 2) return rounded([[x1, y1], [x1 + g, y1], [x1 + g, y2], [x2, y2]]);
  const yb = y2 > y1 ? y2 - ROW / 2 : y2 + ROW / 2;
  return rounded([[x1, y1], [x1 + g, y1], [x1 + g, yb], [x2 - g, yb], [x2 - g, y2], [x2, y2]]);
}

const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
};

/** Cronograma (Gantt) com dependências: eixo de tempo com zoom, barras do início ao prazo e setas
 * "termina → começa". Para ligar: arraste a bolinha no fim de uma barra até a tarefa que vem
 * depois, ou clique na bolinha e depois na tarefa (serve para toque e teclado). Clicar numa seta
 * desfaz a ligação. O servidor continua recusando ciclo e quem não pode editar. */
export function Timeline({ tasks, canWrite, onOpen }: { tasks: Task[]; canWrite: boolean; onOpen: (id: string) => void }) {
  const { add, remove } = useDependency();
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const [zoomChoice, setZoom] = useState<Zoom | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [full, setFull] = useState(false);
  /** Ligação escolhida para remover (clique na seta) e onde abrir o balão de confirmação. */
  const [pending, setPending] = useState<{ taskId: string; depId: string; x: number; y: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Largura visível: o zoom "Ajustar" cabe a obra inteira nela.
  const hasRows = tasks.some((t) => t.due_date);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);

  useEffect(() => {
    if (!linkFrom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLinkFrom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkFrom]);

  // Balão de remoção: foco em "Cancelar" (o gesto seguro), Esc ou clique fora fecham.
  useEffect(() => {
    if (!pending) return;
    popRef.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPending(null);
    const onDown = (e: MouseEvent) => !popRef.current?.contains(e.target as Node) && setPending(null);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [pending]);

  // Tela cheia: Esc sai (quando não está escolhendo uma ligação nem confirmando, que usam o mesmo Esc).
  useEffect(() => {
    if (!full || linkFrom || pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, linkFrom, pending]);

  // ---------- escala ----------
  const today = localToday();
  const created = (t: Task) => t.created_at.slice(0, 10);
  const from0 = (t: Task) => t.start_date ?? (created(t) && created(t) < t.due_date! ? created(t) : t.due_date!);
  const dated = tasks.filter((t) => t.due_date).sort((a, b) => from0(a).localeCompare(from0(b)) || a.due_date!.localeCompare(b.due_date!));
  const firstDay = dated.length ? Math.min(ms(today), ...dated.map((t) => ms(from0(t)))) : ms(today);
  const lastDay = dated.length ? Math.max(ms(today), ...dated.map((t) => ms(t.due_date!))) : ms(today);
  // Começa numa segunda-feira (o eixo de semanas fica alinhado) e sobra respiro no fim.
  const startMs = firstDay - (((new Date(firstDay).getUTCDay() + 6) % 7) + 3) * DAY;
  const days = Math.round((lastDay - startMs) / DAY) + 8;
  const label = viewW && viewW < 700 ? 150 : 260;
  const visible = Math.max(0, viewW - label - 8);
  // Abre sempre cabendo na largura (sem rolagem lateral); os outros zooms são para detalhar.
  const fit = Math.max(1.5, visible / days);
  const zoom: Zoom = zoomChoice ?? "ajustar";
  const windowDays = ZOOMS.find((z) => z[0] === zoom)![2];
  // Nunca mais estreito que "Ajustar": se o projeto cabe na janela, cabe na tela.
  const ppd = zoom === "ajustar" ? fit : Math.max(fit, visible / windowDays);
  const chartW = Math.ceil(days * ppd);
  const idx = (d: string) => Math.round((ms(d) - startMs) / DAY);
  const xOf = (d: string) => idx(d) * ppd;
  const scrolls = chartW > visible + 4;
  // Onde o trabalho está: início da primeira tarefa em aberto (ou hoje, se ela já começou).
  const focusDay = (() => {
    const open = dated.filter((t) => t.status !== "done").map(from0).sort()[0];
    return open && open > today ? open : today;
  })();
  const scrollToDay = (d: string, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const left = Math.max(0, idx(d) * ppd - 24);
    if (smooth && el.scrollTo) el.scrollTo({ left, behavior: "smooth" });
    else el.scrollLeft = left;
  };
  const page = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft + dir * visible * 0.8;
    if (el.scrollTo) el.scrollTo({ left, behavior: "smooth" });
    else el.scrollLeft = left;
  };

  // Ao trocar o zoom, posiciona onde o trabalho está, em vez de no começo do eixo.
  useEffect(() => {
    if (zoomChoice && zoomChoice !== "ajustar") scrollToDay(focusDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomChoice]);

  // Roda do mouse sobre o eixo de datas rola para os lados (no resto do gráfico, rola as linhas).
  useEffect(() => {
    const head = headRef.current;
    const el = scrollRef.current;
    if (!head || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    head.addEventListener("wheel", onWheel, { passive: false });
    return () => head.removeEventListener("wheel", onWheel);
  }, [hasRows]);

  if (!dated.length) return <Empty title="Cronograma vazio">Defina início e prazo nas tarefas (ou aplique uma EAP do assistente) para ver a linha do tempo.</Empty>;

  // ---------- linhas: agrupadas por fase quando houver ----------
  const items: Item[] = [];
  const phases: string[] = [];
  if (dated.some((t) => t.phase)) {
    const groups = new Map<string, Task[]>();
    for (const t of dated) groups.set(t.phase || "Sem fase", [...(groups.get(t.phase || "Sem fase") ?? []), t]);
    const ordered = [...groups].sort(([a], [b]) => (a === "Sem fase" ? 1 : b === "Sem fase" ? -1 : 0));
    for (const [name, list] of ordered) {
      const from = list.map(from0).sort()[0];
      const to = list.map((t) => t.due_date!).sort().at(-1)!;
      phases.push(name);
      items.push({ kind: "phase", key: `phase:${name}`, name, from, to });
      // Fase recolhida mostra só a barra-resumo.
      if (!collapsed.has(name)) for (const t of list) items.push({ kind: "task", key: t.id, task: t });
    }
  } else {
    for (const t of dated) items.push({ kind: "task", key: t.id, task: t });
  }
  const yTop = new Map<string, number>();
  let bodyH = 0;
  for (const it of items) {
    yTop.set(it.key, bodyH);
    bodyH += it.kind === "phase" ? PHASE_ROW : ROW;
  }
  const yOf = (id: string) => yTop.get(id)! + ROW / 2;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isDated = new Set(dated.map((t) => t.id));
  const geo = (t: Task) => {
    if (t.is_milestone) {
      const c = xOf(t.due_date!) + ppd / 2;
      return { left: c - 8, right: c + 8, center: c };
    }
    const left = xOf(from0(t));
    const right = Math.max(left + 8, xOf(t.due_date!) + ppd);
    return { left, right, center: (left + right) / 2 };
  };

  // ---------- cadeia em destaque (tudo antes e depois da tarefa sob o mouse) ----------
  const chain = new Set<string>();
  if (hot && !drag && !linkFrom) {
    const dependents = new Map<string, string[]>();
    for (const t of dated) for (const d of t.depends_on_ids ?? []) dependents.set(d, [...(dependents.get(d) ?? []), t.id]);
    const walk = (id: string, next: (id: string) => string[]) => {
      for (const n of next(id)) {
        if (chain.has(n)) continue;
        chain.add(n);
        walk(n, next);
      }
    };
    chain.add(hot);
    walk(hot, (id) => (byId.get(id)?.depends_on_ids ?? []).filter((x) => isDated.has(x)));
    walk(hot, (id) => dependents.get(id) ?? []);
  }
  const lit = chain.size > 1;

  // ---------- ligação ----------
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
    setPending(null);
    if (!a || !b) return;
    remove.mutate({ taskId, dependsOnId: depId }, { onSuccess: () => toast(`${b.title} não depende mais de ${a.title}`) });
  };
  /** O que acontece com as datas ao desfazer (mesma regra do servidor, work/schedule.py). */
  const unlinkEffect = (b: Task, depId: string) => {
    const rest = (b.depends_on_ids ?? []).filter((id) => id !== depId).map((id) => byId.get(id)).filter((d): d is Task => !!d?.due_date);
    const next = rest.sort((x, y) => y.due_date!.localeCompare(x.due_date!))[0];
    if (next) return `O início passa a seguir “${next.title}” (dia seguinte a ${fmtDate(next.due_date)}).`;
    return "As datas atuais ficam como estão, e o início volta a ser editável.";
  };

  // Arrasto pela bolinha: ponteiro capturado, linha provisória até o ponto atual.
  const point = (e: ReactPointerEvent) => {
    const r = linesRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const rowAt = (e: ReactPointerEvent) => document.elementFromPoint?.(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tl-row]")?.dataset.tlRow ?? null;
  const onHandleDown = (e: ReactPointerEvent, id: string) => {
    if (!canWrite || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ from: id, ...point(e), moved: false });
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = point(e);
    const moved = drag.moved || Math.hypot(p.x - geo(byId.get(drag.from)!).right, p.y - yOf(drag.from)) > DRAG_MIN;
    setDrag({ ...drag, ...p, moved });
    setHover(rowAt(e));
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
    const target = rowAt(e);
    if (target) link(d.from, target);
  };

  // ---------- setas ----------
  const edges = dated.flatMap((t) =>
    (t.depends_on_ids ?? []).filter((id) => isDated.has(id) && yTop.has(id) && yTop.has(t.id)).map((id) => {
      const a = byId.get(id)!;
      const conflict = scheduleConflicts(t, tasks).some((c) => c.id === id);
      return { from: a, to: t, conflict, hot: lit && chain.has(a.id) && chain.has(t.id) };
    }),
  );
  const hidden = dated.reduce((n, t) => n + (t.depends_on_ids ?? []).filter((id) => !isDated.has(id)).length, 0);

  // ---------- eixo ----------
  const months: { left: number; width: number; name: string }[] = [];
  for (let d = new Date(startMs); d.getTime() < startMs + days * DAY; ) {
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const left = Math.max(0, ((d.getTime() - startMs) / DAY) * ppd);
    const right = Math.min(chartW, ((next - startMs) / DAY) * ppd);
    months.push({ left, width: right - left, name: MONTH.format(d).replace(".", "").replace(" de ", " ") });
    d = new Date(next);
  }
  const ticks: { x: number; text: string; weekend: boolean; monday: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs + i * DAY);
    const wd = d.getUTCDay();
    ticks.push({ x: i * ppd, text: String(d.getUTCDate()), weekend: wd === 0 || wd === 6, monday: wd === 1 });
  }
  const showDays = ppd >= 22;
  const showWeeks = !showDays && ppd * 7 >= 26;
  const todayX = xOf(today) + ppd / 2;

  const barClass = (t: Task) =>
    [
      "g-bar",
      t.is_milestone ? "milestone" : `s-${t.status}`,
      !t.start_date && !t.is_milestone ? "no-start" : "",
      t.status !== "done" && t.due_date! < today ? "late" : "",
    ].join(" ");

  return (
    <div className={`card pane pv-timeline gantt-card ${source ? "tl-linking" : ""} ${lit ? "g-lit" : ""} ${full ? "g-full" : ""}`}>
      <div className="g-toolbar">
        <div className="g-range">
          <strong>{fmtDate(dated.map(from0).sort()[0])} → {fmtDate(dated.map((t) => t.due_date!).sort().at(-1)!)}</strong>
          <span className="coord">{dated.length} tarefas · {edges.length} ligações</span>
        </div>
        <div className="g-actions">
          {phases.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(phases))}>
              {collapsed.size ? <ChevronsUpDown size={15} aria-hidden /> : <ChevronsDownUp size={15} aria-hidden />} {collapsed.size ? "Expandir fases" : "Recolher fases"}
            </button>
          )}
          {scrolls && (
            <div className="g-nav" role="group" aria-label="Navegar no tempo">
              <button type="button" aria-label="Tela anterior" title="Tela anterior" onClick={() => page(-1)}><ChevronLeft size={16} aria-hidden /></button>
              <button type="button" onClick={() => scrollToDay(today, true)}>Hoje</button>
              <button type="button" aria-label="Próxima tela" title="Próxima tela" onClick={() => page(1)}><ChevronRight size={16} aria-hidden /></button>
            </div>
          )}
          <div className="g-zoom" role="group" aria-label="Escala do cronograma">
            {ZOOMS.map(([z, name]) => (
              <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{name}</button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm g-icon" aria-pressed={full} aria-label={full ? "Sair da tela cheia" : "Cronograma em tela cheia"} title={full ? "Sair da tela cheia (Esc)" : "Tela cheia"} onClick={() => setFull(!full)}>
            {full ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </div>
      {linkFrom && sourceTask ? (
        <div className="tl-banner" role="status">
          <span>Escolha a tarefa que só começa depois de <strong>{sourceTask.title}</strong>.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkFrom(null)}><X size={15} aria-hidden /> Cancelar</button>
        </div>
      ) : null}

      <div className="g-scroll pane-body" ref={scrollRef} style={{ ["--g-label" as string]: `${label}px` }}>
        <div className="g-inner" style={{ width: label + chartW }}>
          <div className="g-head" ref={headRef}>
            <div className="g-corner">Tarefa</div>
            <div className="g-axis" style={{ width: chartW }}>
              <div className="g-months">
                {months.map((m) => <span key={m.left} style={{ left: m.left, width: m.width }}>{m.width > 40 ? m.name : ""}</span>)}
              </div>
              <div className="g-ticks">
                {ticks.map((t) => (showDays || (showWeeks && t.monday)) && (
                  <span key={t.x} className={t.weekend ? "we" : ""} style={{ left: t.x, width: showDays ? ppd : ppd * 7 }}>{t.text}</span>
                ))}
              </div>
              <span className="g-today-pill" style={{ left: todayX }}>Hoje</span>
            </div>
          </div>

          <div className="g-body" style={{ height: bodyH }}>
            <svg className="g-grid" width={chartW} height={bodyH} aria-hidden>
              {ppd >= 6 && ticks.filter((t) => t.weekend).map((t) => <rect key={t.x} x={t.x} y={0} width={ppd} height={bodyH} className="g-weekend" />)}
              {(showDays || showWeeks) && ticks.filter((t) => t.monday).map((t) => <line key={t.x} x1={t.x} x2={t.x} y1={0} y2={bodyH} className="g-week" />)}
              {months.map((m) => <line key={m.left} x1={m.left} x2={m.left} y1={0} y2={bodyH} className="g-month" />)}
              <line x1={todayX} x2={todayX} y1={0} y2={bodyH} className="g-today" />
            </svg>

            {items.map((it) => {
              if (it.kind === "phase") {
                const l = xOf(it.from);
                const r = xOf(it.to) + ppd;
                return (
                  <div key={it.key} className="g-row g-phase" style={{ height: PHASE_ROW }}>
                    <div className="g-label">
                      <button type="button" className="g-phase-toggle" aria-expanded={!collapsed.has(it.name)} onClick={() => {
                        const n = new Set(collapsed);
                        if (n.has(it.name)) n.delete(it.name);
                        else n.add(it.name);
                        setCollapsed(n);
                      }}>
                        {collapsed.has(it.name) ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
                        <span>{it.name}</span>
                      </button>
                    </div>
                    <div className="g-chart"><span className="g-summary" style={{ left: l, width: Math.max(8, r - l) }} title={`${it.name}: ${fmtDate(it.from)} → ${fmtDate(it.to)}`} /></div>
                  </div>
                );
              }
              const t = it.task;
              const g = geo(t);
              const conflicts = scheduleConflicts(t, tasks);
              const deps = (t.depends_on_ids ?? []).map((id) => byId.get(id)?.title).filter(Boolean);
              const target = source && source !== t.id ? (canTarget(t) ? "ok" : "no") : null;
              const dur = idx(t.due_date!) - idx(from0(t)) + 1;
              const aria = `${t.title}: ${t.start_date ? `início ${fmtDate(t.start_date)}, ` : ""}prazo ${fmtDate(t.due_date)}, ${STATUS_LABEL[t.status]}${deps.length ? `. Depende de ${deps.join(", ")}` : ""}${conflicts.length ? `. Começa antes de ${conflicts.map((c) => c.title).join(", ")} terminar` : ""}`;
              const pick = () => (linkFrom ? link(linkFrom, t.id) : onOpen(t.id));
              const cls = [
                "g-row",
                target ? `tl-target-${target}` : "",
                hover === t.id && target ? "tl-over" : "",
                source === t.id ? "tl-source" : "",
                lit ? (chain.has(t.id) ? "g-in" : "g-out") : "",
              ].join(" ");
              return (
                <div className={cls} key={t.id} data-tl-row={t.id} style={{ height: ROW }} onMouseEnter={() => setHot(t.id)} onMouseLeave={() => setHot(null)}>
                  <div className="g-label">
                    <button className="title tl-title" onClick={pick} title={deps.length ? `Depende de: ${deps.join(", ")}` : t.title}>
                      {conflicts.length > 0 && <TriangleAlert size={13} aria-hidden className="tl-warn" />}
                      {t.is_milestone ? "◆ " : ""}{t.title}
                    </button>
                  </div>
                  <div className="g-chart">
                    {linkFrom && target === "ok" && (
                      <button type="button" className="tl-pick" onClick={pick} aria-label={`${t.title} começa depois de ${sourceTask?.title ?? ""}`} />
                    )}
                    <div
                      role="img"
                      aria-label={aria}
                      className={`${barClass(t)} ${conflicts.length ? "conflict" : ""}`}
                      style={t.is_milestone ? { left: g.center - 8 } : { left: g.left, width: g.right - g.left }}
                      title={`${t.title}\n${t.start_date ? fmtDate(t.start_date) : "sem início"} → ${fmtDate(t.due_date)} (${dur} ${dur === 1 ? "dia" : "dias"})\n${STATUS_LABEL[t.status]}${t.assignee_name ? ` · ${t.assignee_name}` : ""}`}
                    >
                      {!t.is_milestone && t.status !== "done" && t.progress > 0 && <span className="g-progress" style={{ width: `${t.progress}%` }} />}
                      {!t.is_milestone && g.right - g.left > 70 && <span className="g-bar-text">{short(from0(t))} – {short(t.due_date!)}</span>}
                    </div>
                    <span className="g-meta" style={{ left: g.right + (canWrite ? 22 : 8) }}>
                      {t.is_milestone && <span>{short(t.due_date!)}</span>}
                      {t.assignee_name && <span className="g-avatar" title={t.assignee_name}>{initials(t.assignee_name)}</span>}
                    </span>
                    {canWrite && (
                      <button
                        type="button"
                        className="tl-handle"
                        style={{ left: g.right + 3 }}
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

            <div className="g-lines" ref={linesRef} style={{ width: chartW, height: bodyH }}>
              <svg width={chartW} height={bodyH}>
                <defs>
                  {(["", "hot", "bad"] as const).map((k) => (
                    <marker key={k} id={`g-arrow${k && `-${k}`}`} viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0,0.5 L8,4 L0,7.5 z" className={`g-arrowhead ${k}`} />
                    </marker>
                  ))}
                </defs>
                {edges.map(({ from, to, conflict, hot: isHot }) => {
                  const d = route(geo(from).right, yOf(from.id), geo(to).left - 1, yOf(to.id));
                  const kind = conflict ? "bad" : isHot ? "hot" : "";
                  return (
                    <g key={`${from.id}-${to.id}`} className={`g-edge ${kind} ${lit && !isHot ? "dim" : ""} ${pending?.taskId === to.id && pending.depId === from.id ? "pending" : ""}`}>
                      <path d={d} className="g-edge-line" markerEnd={`url(#g-arrow${kind && `-${kind}`})`} />
                      {canWrite && (
                        <path
                          d={d}
                          className="g-edge-hit"
                          onClick={(e) => {
                            const r = linesRef.current!.getBoundingClientRect();
                            setPending({ taskId: to.id, depId: from.id, x: e.clientX - r.left, y: e.clientY - r.top });
                          }}
                        >
                          <title>{`${to.title} depende de ${from.title}${conflict ? " (começa antes de terminar)" : ""}. Clique para desfazer.`}</title>
                        </path>
                      )}
                    </g>
                  );
                })}
                {drag?.moved && (
                  <path d={route(geo(byId.get(drag.from)!).right, yOf(drag.from), drag.x, drag.y)} className="g-edge-line g-drafting" />
                )}
              </svg>
            </div>

            {pending && byId.get(pending.depId) && byId.get(pending.taskId) && (() => {
              const a = byId.get(pending.depId)!;
              const b = byId.get(pending.taskId)!;
              // Abre junto do clique, sem sair da área do gráfico; perto do fim, abre para cima.
              const left = label + Math.max(8, Math.min(pending.x - 150, chartW - 316));
              const above = pending.y > bodyH - 170 && pending.y > 170;
              return (
                <div ref={popRef} className={`g-pop ${above ? "above" : ""}`} role="dialog" aria-labelledby="g-pop-title" style={{ left, top: above ? pending.y - 14 : pending.y + 14 }}>
                  <p id="g-pop-title" className="g-pop-title">Remover esta ligação?</p>
                  <div className="g-pop-pair">
                    <span className="g-pop-task" title={a.title}>{a.title}</span>
                    <ArrowRight size={14} aria-label="antes de" />
                    <span className="g-pop-task" title={b.title}>{b.title}</span>
                  </div>
                  <p className="g-pop-note">“{b.title}” deixa de esperar por “{a.title}”. {unlinkEffect(b, a.id)}</p>
                  <div className="g-pop-actions">
                    <button type="button" className="btn btn-line btn-sm" data-cancel onClick={() => setPending(null)}>Cancelar</button>
                    <button type="button" className="btn btn-sm g-pop-remove" disabled={remove.isPending} onClick={() => unlink(b.id, a.id)}>Remover ligação</button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="g-legend coord">
        {canWrite && <span className="g-legend-hint"><Link2 size={12} aria-hidden /> Arraste a bolinha no fim de uma barra até a tarefa seguinte · clique na seta para desfazer</span>}
        <span><i className="g-key s-todo" /> A fazer</span>
        <span><i className="g-key s-doing" /> Em andamento</span>
        <span><i className="g-key s-blocked" /> Bloqueada</span>
        <span><i className="g-key s-done" /> Concluída</span>
        <span><i className="g-key no-start" /> Sem data de início</span>
        <span><i className="g-key milestone" /> Marco</span>
        <span><TriangleAlert size={12} aria-hidden /> Começa antes de uma dependência terminar</span>
        {hidden > 0 && <span>{hidden} dependência(s) com tarefa sem prazo não aparecem aqui</span>}
      </div>
    </div>
  );
}

