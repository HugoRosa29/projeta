import { useQuery } from "@tanstack/react-query";
import { FolderCog, FolderOpen, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router";
import { ErrorBox } from "../../components/ui";
import { areasOf, splitByFolder, type Area } from "../../domain/areas";
import { HEALTH_COLOR } from "../../domain/board";
import { track } from "../../domain/esteira";
import { HEALTH_LABEL, PHASE_LABEL, type Health, type PortfolioRow } from "../../domain/formal";
import { HEALTH_ORDER, summarize } from "../../domain/overview";
import { fmtDate, isoDate } from "../../domain/types";
import { projectProgress } from "../../domain/work";
import { api } from "../../services/api";
import { Stat } from "../portfolio/Panorama";
import { areaQuery } from "./Areas";
import { FolderDialog, useFolders } from "./Folders";

const SEVERITY: Record<Health, number> = { late: 0, at_risk: 1, on_track: 2 };
const fmt = (n: number) => n.toLocaleString("pt-BR");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
/** Nome de transição válido em CSS a partir de um id (sigla ou UUID). */
const vt = (prefix: string, id: string) => `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

type Mode = "grid" | "open" | "mini";

/** Áreas na ordem de atenção: a do próprio espaço primeiro, depois as com mais projetos
 *  atrasados, depois mais em risco; no empate, em ordem alfabética. */
export function byAttention(areas: Area[]): Area[] {
  return [...areas].sort(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      b.summary.health.late - a.summary.health.late ||
      b.summary.health.at_risk - a.summary.health.at_risk ||
      a.label.localeCompare(b.label, "pt-BR"),
  );
}

/** Troca de layout animada: cada bloco e cada projeto tem um nome de transição e o navegador
 *  interpola posição e tamanho entre o antes e o depois (View Transitions). Sem suporte, ou com
 *  "reduzir movimento" no sistema, a troca é imediata. */
function animate(update: () => void) {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}

/** Panorama da home em blocos: um bloco por área (o próprio espaço e cada unidade filha direta
 *  no organograma), com cada projeto numa barra de progresso na cor da situação. Um bloco pode
 *  ser expandido: ocupa a área toda e as demais viram uma coluna estreita ao lado. Usa a mesma
 *  consulta do portfólio (mesmo cache, mesmo recorte do servidor). */
export function AreaBlocks({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const q = useQuery({
    queryKey: ["portfolio", workspaceId],
    queryFn: () => api.get<{ projects: PortfolioRow[] }>("/portfolio", { workspace_id: workspaceId }),
  });
  // Pastas do espaço: a área própria vira um bloco por pasta. Sem pastas, nada muda.
  const fq = useFolders(workspaceId);
  const folders = fq.data?.folders;
  const [health, setHealth] = useState<Health | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const rows = q.data?.projects;
  // Clicar em "Em risco" ou "Atrasados" deixa nos blocos só os projetos naquela situação.
  const shown = useMemo(() => (rows && health ? rows.filter((r) => r.health === health) : rows ?? []), [rows, health]);
  const areas = useMemo(
    () => byAttention(splitByFolder(areasOf(shown, workspaceId, workspaceName), folders ?? [])),
    [shown, workspaceId, workspaceName, folders],
  );
  // A área expandida pode sumir do recorte (filtro de situação): aí volta ao mosaico.
  const open = areas.find((a) => a.id === openId) ?? null;

  const expand = (id: string) => animate(() => setOpenId(id));
  const collapse = () => {
    const was = openId;
    animate(() => setOpenId(null));
    // O foco volta ao botão que abriu, para quem navega pelo teclado não se perder.
    if (was) requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-expand]")].find((el) => el.dataset.expand === was)?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && collapse();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  // Sem projeto ativo, o panorama não tem o que mostrar: a home fica só com as tarefas.
  if (!rows?.length) return null;
  // Os contadores de situação contam tudo, para o número escolhido não zerar os outros.
  const all = summarize(rows);
  const s = summarize(shown);
  const toggle = (h: Health) => animate(() => setHealth((cur) => (cur === h ? null : h)));

  return (
    <section className="ov ab" aria-labelledby="ab-title">
      <div className="pn-head">
        <div className="pn-title">
          <h2 id="ab-title">Panorama por área</h2>
          <p className="muted">
            {health
              ? `${plural(shown.length, "projeto", "projetos")} de ${fmt(rows.length)} no recorte`
              : `${plural(rows.length, "projeto ativo", "projetos ativos")} em ${plural(areas.length, "área", "áreas")}`}
          </p>
        </div>
        <div className="pn-tools">
          <ul className="ab-legend" aria-label="Cores da situação">
            {HEALTH_ORDER.map((h) => (
              <li key={h} className={`g-${HEALTH_COLOR[h]}`}>{HEALTH_LABEL[h]}</li>
            ))}
          </ul>
          {fq.data?.can_manage && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOrganizing(true)}>
              <FolderCog size={15} aria-hidden /> Organizar pastas
            </button>
          )}
          <Link to="/portfolio" className="btn btn-ghost btn-sm">Abrir portfólio</Link>
        </div>
      </div>
      <ul className="pn-stats" aria-label="Resumo">
        <Stat label="Projetos" value={fmt(s.projects)} />
        <Stat label="Conclusão média" value={`${s.avgProgress}%`} />
        <Stat label="Em risco" value={fmt(all.health.at_risk)} tone={all.health.at_risk ? "warn" : undefined} pressed={health === "at_risk"} onClick={() => toggle("at_risk")} />
        <Stat label="Atrasados" value={fmt(all.health.late)} tone={all.health.late ? "bad" : undefined} pressed={health === "late"} onClick={() => toggle("late")} />
        <Stat label="Tarefas atrasadas" value={fmt(s.overdue)} tone={s.overdue ? "bad" : undefined} />
      </ul>
      {health && (
        <div className="row pn-chips">
          <button type="button" className="badge ov-chip" onClick={() => animate(() => setHealth(null))} aria-label={`Remover filtro de situação ${HEALTH_LABEL[health]}`}>
            Situação: {HEALTH_LABEL[health]} <X size={13} aria-hidden />
          </button>
        </div>
      )}
      {open ? (
        <div className="ab-grid ab-focus">
          <Block area={open} mode="open" onToggle={collapse} />
          <nav className="ab-rail" aria-label="Outras áreas">
            {areas.filter((a) => a !== open).map((a) => <Block key={a.id} area={a} mode="mini" onToggle={() => expand(a.id)} />)}
          </nav>
        </div>
      ) : (
        <div className="ab-grid">
          {areas.map((a) => <Block key={a.id} area={a} mode="grid" onToggle={() => expand(a.id)} />)}
        </div>
      )}
      {organizing && <FolderDialog workspaceId={workspaceId} folders={folders ?? []} rows={rows} onClose={() => setOrganizing(false)} />}
    </section>
  );
}

/** Arranjo dos mini-blocos de uma área: entre as combinações de colunas × linhas em que todos
 *  cabem (altura de 26px para cima), escolhe a que deixa os cartões mais perto da proporção
 *  `ratio` (largura/altura) e com menos células vazias. Assim 6 projetos viram 3×2 num bloco
 *  largo e 2×3 num estreito, e a área expandida se preenche por igual em vez de deixar sobra
 *  embaixo. A altura tem teto (`max`): com poucos projetos o cartão não vira um poste.
 *  Exportada para teste; o painel do computador aplica o resultado via --cols e --tile-h. */
export function layoutTiles(count: number, width: number, height: number, gap: number, minW: number, max: number, ratio: number) {
  const maxCols = Math.max(1, Math.min(count, Math.floor((width + gap) / (minW + gap))));
  let best: { cols: number; h: number; score: number } | null = null;
  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(count / cols);
    const w = (width - (cols - 1) * gap) / cols;
    const free = (height - (rows - 1) * gap) / rows;
    if (free < 26) continue;
    const h = Math.min(max, free);
    const empty = (cols * rows - count) / cols; // fração de linha sobrando no fim
    const score = Math.abs(Math.log(w / h / ratio)) + 0.35 * empty;
    if (!best || score < best.score) best = { cols, h, score };
  }
  // Nem no mínimo cabe: o máximo de colunas, cartões de 26px e a lista rola por dentro.
  return best ? { cols: best.cols, h: Math.floor(best.h), tight: false } : { cols: maxCols, h: 26, tight: true };
}

function useFitTiles(count: number, max: number, ratio: number) {
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.rowGap) || 0;
      const min = parseFloat(cs.getPropertyValue("--tile-min")) || 120;
      // Área de conteúdo, sem o recuo interno: é nela que o grid distribui as colunas.
      const width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const height = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const { cols, h, tight } = layoutTiles(count, width, height, gap, min, max, ratio);
      el.style.setProperty("--cols", String(cols));
      el.style.setProperty("--tile-h", `${h}px`);
      // Rola só se nem no mínimo couber. Uma barra de rolagem passageira comeria largura e o
      // observador não dispararia de novo (o tamanho externo não muda).
      el.toggleAttribute("data-tight", tight);
    };
    // Já na montagem, de forma síncrona: numa transição animada o estado final é capturado logo
    // após a troca, antes do primeiro aviso do observador; sem isto os cartões iriam para a
    // grade provisória e pulariam no fim.
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count, max, ratio]);
  return ref;
}

/** Um bloco de área em três formas: no mosaico ("grid"), expandido ("open", com mais detalhe
 *  por projeto) ou resumido na coluna ao lado do expandido ("mini": nome, alertas e a mistura
 *  de situações numa barra fina). O nome de transição é o mesmo nas três, para o navegador
 *  animar uma forma na outra. */
function Block({ area, mode, onToggle }: { area: Area; mode: Mode; onToggle: () => void }) {
  const s = area.summary;
  const rows = [...area.rows].sort((a, b) => SEVERITY[a.health] - SEVERITY[b.health] || a.name.localeCompare(b.name, "pt-BR"));
  const alerts = (["late", "at_risk"] as Health[]).filter((h) => s.health[h]);
  // Expandida: cartões maiores e um pouco menos largos, para caber a linha de fatos.
  const listRef = useFitTiles(rows.length, mode === "open" ? 210 : 140, mode === "open" ? 1.45 : 1.7);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === "open") closeRef.current?.focus({ preventScroll: true });
  }, [mode]);
  const style = { ["--n" as string]: rows.length, viewTransitionName: vt("ab-area", area.id) };
  // O cabeçalho anima à parte, no tamanho natural: só desliza, sem ser esticado com o bloco.
  const headVt = { viewTransitionName: vt("ab-h", area.id) };
  const alertBadges = alerts.map((h) => (
    <span key={h} className={`ab-alert g-${HEALTH_COLOR[h]}`} title={`${s.health[h]} ${HEALTH_LABEL[h].toLowerCase()}`}>
      {s.health[h]}<span className="ab-alert-l"> {HEALTH_LABEL[h].toLowerCase()}</span>
    </span>
  ));

  if (mode === "mini") {
    return (
      <article className="ab-block ab-mini" style={style} aria-labelledby={`ab-${area.id}`}>
        {/* O cartão inteiro é o botão: trocar de área expandida é um clique em qualquer ponto. */}
        <button type="button" className="ab-mini-btn" style={headVt} onClick={onToggle} data-expand={area.id} aria-label={`Expandir ${area.label}`} title={area.label}>
          <span className="ab-title-row">
            <span className="ab-mini-name" id={`ab-${area.id}`}>
              {area.folder && <FolderOpen size={13} className="ab-folder" aria-label="Pasta" />}
              {area.label}
            </span>
            <span className="ab-mini-n">{s.projects}</span>
            {alertBadges}
          </span>
          <span className="ab-mix" aria-hidden>
            {(["late", "at_risk", "on_track"] as Health[]).filter((h) => s.health[h]).map((h) => (
              <span key={h} className={`g-${HEALTH_COLOR[h]}`} style={{ flexGrow: s.health[h] }} />
            ))}
          </span>
        </button>
      </article>
    );
  }

  const today = isoDate(new Date());
  const open = mode === "open";
  return (
    // No mosaico, clicar num projeto o abre; clicar no resto do bloco expande a área. Pelo
    // teclado, o caminho é o botão "Expandir" dentro dele; um segundo foco no bloco seria redundante.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <article
      className={`ab-block${open ? " ab-open" : " ab-clickable"}`}
      style={style}
      aria-labelledby={`ab-${area.id}`}
      onClick={open ? undefined : onToggle}
    >
      {/* Expandida, clicar no cabeçalho recolhe (o botão "Recolher" e o Esc seguem valendo para
          o teclado). O link do nome e o botão mantêm o próprio comportamento. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <header
        className={`ab-head${open ? " ab-head-collapse" : ""}`}
        style={headVt}
        onClick={open ? (e) => !(e.target as HTMLElement).closest("a, button") && onToggle() : undefined}
      >
        {/* Selos de alerta na linha do nome: com muitas áreas, o cabeçalho cabe em duas linhas. */}
        <div className="ab-title-row">
          <h3 id={`ab-${area.id}`}>
            {/* Expandida, a área abre no portfólio já recortada (?area=…), num link que dá para guardar. */}
            {area.folder && <FolderOpen size={15} className="ab-folder" aria-label="Pasta" />}
            {open ? <Link to={`/portfolio${areaQuery(area.portfolioArea ?? area.id)}`}>{area.label}</Link> : area.label}
            {area.own && !area.folder && <span className="muted ab-own"> {area.loose ? "sem pasta" : "próprios"}</span>}
          </h3>
          {alertBadges}
          {open ? (
            <button ref={closeRef} type="button" className="ab-toggle ab-toggle-text" onClick={onToggle} aria-label={`Recolher ${area.label}`} title="Recolher (Esc)">
              <Minimize2 size={15} aria-hidden /> Recolher
            </button>
          ) : (
            <button
              type="button"
              className="ab-toggle"
              // O clique do bloco já expande; sem parar aqui, a transição começaria duas vezes.
              onClick={(e) => (e.stopPropagation(), onToggle())}
              data-expand={area.id}
              aria-label={`Expandir ${area.label}`}
              title="Expandir"
            >
              <Maximize2 size={14} aria-hidden />
            </button>
          )}
        </div>
        <p className="ab-meta">{plural(s.projects, "projeto", "projetos")} · média {s.avgProgress}%</p>
      </header>
      <ul className="ab-list" ref={listRef}>
        {rows.map((r) => (
          <ProjectBar key={r.id} r={r} from={r.shared_from && r.shared_from !== area.label ? r.shared_from : null} detail={open} today={today} />
        ))}
      </ul>
    </article>
  );
}

/** Mini-bloco do projeto dentro do bloco da área. A cor da barra diz a situação; o texto ao lado
 *  da % diz o mesmo para quem não distingue a cor. `from` é o setor de origem quando a área junta
 *  vários (na COINT, o bloco COTIN mostra de qual divisão veio cada projeto). Na área expandida
 *  (`detail`), mostra também término, tarefas atrasadas e fase. */
function ProjectBar({ r, from, detail, today }: { r: PortfolioRow; from: string | null; detail: boolean; today: string }) {
  const { pct, informed } = projectProgress(r);
  const label = HEALTH_LABEL[r.health];
  const end = detail ? track(r, today).end : null;
  const facts = detail
    ? [end && `Término ${fmtDate(end)}`, r.overdue_count ? plural(r.overdue_count, "tarefa atrasada", "tarefas atrasadas") : null, r.phase && PHASE_LABEL[r.phase]].filter(Boolean)
    : [];
  return (
    <li className={`ab-item g-${HEALTH_COLOR[r.health]}`} style={{ viewTransitionName: vt("ab-p", r.id) }}>
      <div className="ab-tile">
        {from && <span className="ab-from">{from}</span>}
        {/* O projeto abre direto, também no mosaico: sem parar o clique aqui, o bloco o tomaria
            como "expandir área" e a navegação viraria dois passos. */}
        <Link to={`/projetos/${r.id}`} className="ab-name" title={from ? `${r.name} · ${from}` : r.name} onClick={(e) => e.stopPropagation()}>
          {r.name}
        </Link>
        <span
          className="ab-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso de ${r.name}: ${label}`}
          title={`${label} · ${pct}%${informed ? " informado" : ""} · ${r.done_count} de ${r.task_count} tarefas concluídas`}
        >
          <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </span>
        <span className="ab-pct">
          <strong>{pct}%</strong>
          <span className="ab-health">{label}</span>
        </span>
        {facts.length > 0 && <span className="ab-facts">{facts.join(" · ")}</span>}
      </div>
    </li>
  );
}
