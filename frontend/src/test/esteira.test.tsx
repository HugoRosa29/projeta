import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { paceCounts, parseDate, stageGroups, timelineSpan, track } from "../domain/esteira";
import type { PortfolioRow } from "../domain/formal";
import { Esteira } from "../features/today/Esteira";

const TODAY = "2026-11-16";

function row(over: Partial<PortfolioRow> & { id: string }): PortfolioRow {
  return {
    name: over.id,
    phase: null,
    approach: null,
    sei_process: null,
    task_count: 0,
    done_count: 0,
    overdue_count: 0,
    blocked_count: 0,
    health: "on_track",
    note_stale: false,
    last_note_at: null,
    ...over,
  };
}

const field = (name: string, value: string) => ({ name, value });

describe("datas da esteira", () => {
  it("lê dd/mm/aaaa, dd/mm/aa e ISO, e recusa datas impossíveis", () => {
    expect(parseDate("06/04/2026")).toBe("2026-04-06");
    expect(parseDate(" 1/2/27 ")).toBe("2027-02-01");
    expect(parseDate("2026-12-31")).toBe("2026-12-31");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("em breve")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });

  it("prefere o campo do portfólio (sem acento nem caixa), depois o TAP, depois as tarefas", () => {
    const viaCampo = track(row({ id: "A", attributes: [field("INICIO", "01/01/2026"), field("Data prevista", "30/06/2026")], tap_end: "31/12/2026", last_due: "2026-12-01" }), TODAY);
    expect([viaCampo.start, viaCampo.end, viaCampo.endFrom]).toEqual(["2026-01-01", "2026-06-30", "campo"]);
    const viaTap = track(row({ id: "B", tap_start: "02/03/2026", tap_end: "31/12/2026", last_due: "2026-12-01" }), TODAY);
    expect([viaTap.start, viaTap.end, viaTap.endFrom]).toEqual(["2026-03-02", "2026-12-31", "TAP"]);
    const viaTarefas = track(row({ id: "C", first_due: "2026-05-01", last_due: "2027-01-10", created_on: "2026-04-01" }), TODAY);
    expect([viaTarefas.start, viaTarefas.end, viaTarefas.startFrom]).toEqual(["2026-05-01", "2027-01-10", "tarefas"]);
    expect(track(row({ id: "D", created_on: "2026-04-01" }), TODAY)).toMatchObject({ start: "2026-04-01", end: null, pace: "none" });
  });

  it("classifica o prazo: vencido, ritmo abaixo, termina em breve, no prazo", () => {
    const at = (over: Partial<PortfolioRow>) => track(row({ id: "x", ...over }), TODAY).pace;
    const span = (a: string, b: string) => [field("Início", a), field("Data prevista", b)];
    expect(at({ attributes: span("01/01/2026", "30/06/2026"), progress: 60 })).toBe("late");
    expect(at({ attributes: span("01/01/2026", "30/06/2026"), progress: 100 })).toBe("ok");
    // 10 de 12 meses decorridos (~83%) com 20% feito: 63 pontos atrás
    expect(at({ attributes: span("01/01/2026", "31/12/2026"), progress: 20 })).toBe("behind");
    expect(at({ attributes: span("01/01/2026", "31/12/2026"), progress: 70 })).toBe("ok");
    expect(at({ attributes: span("01/10/2026", "01/12/2026"), progress: 50 })).toBe("soon");
    expect(at({})).toBe("none");
  });

  it("agrupa por fase com 'sem fase' primeiro e conta quem precisa de atenção", () => {
    const tracks = [
      row({ id: "ERP", phase: "execution", attributes: [field("Data prevista", "30/06/2026")] }),
      row({ id: "Portal", phase: "execution" }),
      row({ id: "Nuvem" }),
    ].map((r) => track(r, TODAY));
    const g = stageGroups(tracks);
    expect(g.map((s) => [s.code, s.tracks.length])).toEqual([["00", 1], ["01", 0], ["02", 0], ["03", 2], ["04", 0], ["05", 0]]);
    expect(g[3].tracks.map((t) => t.row.name)).toEqual(["ERP", "Portal"]); // vencido primeiro
    expect(g[3].attention).toBe(1);
    expect(paceCounts(tracks)).toEqual({ late: 1, behind: 0, soon: 0, ok: 0, none: 2 });
  });

  it("monta o eixo em meses inteiros incluindo hoje", () => {
    const t = [track(row({ id: "A", attributes: [field("Início", "15/03/2026"), field("Data prevista", "10/06/2026")] }), TODAY)];
    const s = timelineSpan(t, TODAY)!;
    expect([s.from, s.to]).toEqual(["2026-03-01", "2026-12-01"]);
    expect(s.at("2026-03-01")).toBe(0);
    expect(s.at("2026-12-01")).toBe(100);
    expect(s.ticks.map((t) => t.label)).toEqual(["mar/26", "mai/26", "jul/26", "set/26", "nov/26"]); // até 6 marcas
    expect(timelineSpan([track(row({ id: "B" }), TODAY)], TODAY)).toBeNull();
  });
});

describe("Esteira", () => {
  const ROWS = [
    row({ id: "ERP", phase: "execution", progress: 20, attributes: [field("Início", "01/01/2026"), field("Data prevista", "30/06/2026")] }),
    row({ id: "Portal", phase: "initiation", attributes: [field("Data prevista", "31/03/2027")] }),
    row({ id: "Intranet", first_due: "2026-10-01", last_due: "2027-02-01" }),
  ];
  const show = () => render(<MemoryRouter><Esteira rows={ROWS} today={TODAY} /></MemoryRouter>);

  // Intranet: 37% do prazo (pelas tarefas) decorrido e nada concluído = ritmo abaixo do previsto.
  it("mostra as fases com contagem e alerta, e a timeline com links", () => {
    show();
    const fases = screen.getByRole("list", { name: "Fases" });
    expect(within(fases).getByRole("button", { name: "Execução: 1 projeto, 1 com atenção" })).toBeInTheDocument();
    expect(within(fases).getByRole("button", { name: "Sem fase definida: 1 projeto, 1 com atenção" })).toBeInTheDocument();
    const tl = screen.getByRole("table", { name: "Timeline dos projetos" });
    expect(within(tl).getAllByRole("row").slice(1).map((r) => within(r).getByRole("link").textContent)).toEqual(["ERP", "Intranet", "Portal"]);
    expect(within(tl).getByText(/vencido há 139 dias/)).toBeInTheDocument();
  });

  it("filtra a timeline pela fase e pela situação do prazo", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: /^Iniciação: 1 projeto/ }));
    const tl = () => screen.getByRole("table", { name: "Timeline dos projetos" });
    expect(within(tl()).getAllByRole("link").map((a) => a.textContent)).toEqual(["Portal"]);
    await userEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    await userEvent.click(screen.getByRole("button", { name: /Prazo vencido/ }));
    expect(within(tl()).getAllByRole("link").map((a) => a.textContent)).toEqual(["ERP"]);
  });
});
