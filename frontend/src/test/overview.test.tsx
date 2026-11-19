import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { PortfolioRow } from "../domain/formal";
import { OTHERS, applyFilter, defaultField, fieldBars, overdueBars, phaseBars, progressBars, summarize } from "../domain/overview";
import { Panorama } from "../features/today/Overview";

function row(over: Partial<PortfolioRow> & { id: string }): PortfolioRow {
  return {
    name: over.id,
    phase: null,
    approach: null,
    sei_process: null,
    task_count: 0,
    done_count: 0,
    doing_count: 0,
    overdue_count: 0,
    blocked_count: 0,
    health: "on_track",
    note_stale: false,
    last_note_at: null,
    ...over,
  };
}

const ROWS = [
  row({ id: "ERP", task_count: 10, done_count: 4, doing_count: 3, blocked_count: 1, overdue_count: 2, health: "late", progress: 80, phase: "execution", attributes: [{ name: "Diretoria", value: "DISID" }] }),
  row({ id: "Portal", task_count: 4, done_count: 1, doing_count: 1, blocked_count: 1, health: "at_risk", phase: "planning", attributes: [{ name: "Diretoria", value: "DIRAU" }] }),
  row({ id: "Nuvem", task_count: 2, done_count: 2, attributes: [{ name: "diretoria", value: "DISID" }] }),
];

describe("agregações do panorama", () => {
  it("soma tarefas por estado, com 'a fazer' como o resto, e tira a média do % de cada projeto", () => {
    const s = summarize(ROWS);
    expect(s.states).toEqual({ done: 7, doing: 4, todo: 3, blocked: 2 });
    expect([s.tasks, s.open, s.overdue, s.blocked]).toEqual([16, 9, 2, 2]);
    expect(s.health).toEqual({ on_track: 1, at_risk: 1, late: 1 });
    // ERP 80 (informado), Portal 25 (1/4), Nuvem 100 (2/2)
    expect(s.avgProgress).toBe(68);
    expect(summarize([]).avgProgress).toBe(0);
  });

  it("aplica campo (sem diferenciar maiúsculas) e situação juntos", () => {
    expect(applyFilter(ROWS, { health: null, field: "Diretoria", value: "DISID" }).map((r) => r.id)).toEqual(["ERP", "Nuvem"]);
    expect(applyFilter(ROWS, { health: "late", field: "Diretoria", value: "DISID" }).map((r) => r.id)).toEqual(["ERP"]);
  });

  it("ordena barras e só mostra fases quando há projeto formal", () => {
    expect(progressBars(ROWS).map((b) => [b.label, b.value])).toEqual([["Nuvem", 100], ["ERP", 80], ["Portal", 25]]);
    expect(overdueBars(ROWS).map((b) => b.label)).toEqual(["ERP"]);
    expect(phaseBars(ROWS).filter((b) => b.value).map((b) => b.key)).toEqual(["planning", "execution"]);
    expect(phaseBars([ROWS[2]])).toEqual([]);
  });

  it("agrupa por campo e junta a cauda em 'Outros'", () => {
    expect(fieldBars(ROWS, "Diretoria").map((b) => [b.label, b.value])).toEqual([["DISID", 2], ["DIRAU", 1]]);
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `p${i}`, attributes: [{ name: "Sistema", value: `S${i}` }] }));
    const bars = fieldBars(many, "Sistema", 4);
    expect(bars).toHaveLength(4);
    expect(bars.at(-1)).toMatchObject({ label: OTHERS, value: 7 });
  });

  it("sugere o primeiro campo que agrupa", () => {
    expect(defaultField(new Map([["Código", ["1"]], ["Diretoria", ["DIRAU", "DISID"]]]))).toBe("Diretoria");
    expect(defaultField(new Map())).toBe("");
  });
});

describe("Panorama", () => {
  const show = () => render(<MemoryRouter><Panorama rows={ROWS} workspaceName="Terracap" /></MemoryRouter>);

  it("mostra os indicadores e os projetos com link", () => {
    show();
    expect(screen.getByText("Conclusão média").parentElement).toHaveTextContent("68%");
    expect(screen.getByText("Tarefas abertas").parentElement).toHaveTextContent("9 de 16");
    expect(screen.getAllByRole("link", { name: "ERP" })[0]).toHaveAttribute("href", "/projetos/ERP");
    expect(screen.getByRole("img", { name: /Situação dos projetos: Em dia: 1 projeto \(33%\)/ })).toBeInTheDocument();
  });

  it("filtra todos os gráficos ao clicar numa situação, e desfaz", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: /Filtrar por Atrasado/ }));
    expect(screen.getByText("1 projeto de 3 no recorte")).toBeInTheDocument();
    const progress = screen.getByRole("heading", { name: "Progresso por projeto" }).closest("article")!;
    expect(within(progress).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Filtrar por Atrasado/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(within(progress).getAllByRole("listitem")).toHaveLength(3);
  });

  it("filtra pelo campo livre", async () => {
    const user = userEvent.setup();
    show();
    await user.selectOptions(screen.getByLabelText("Filtrar por campo"), "Diretoria");
    await user.selectOptions(screen.getByLabelText("Valor de Diretoria"), "DIRAU");
    expect(screen.getByText("1 projeto de 3 no recorte")).toBeInTheDocument();
    expect(screen.getByText("Tarefas bloqueadas").parentElement).toHaveTextContent("1");
  });
});
