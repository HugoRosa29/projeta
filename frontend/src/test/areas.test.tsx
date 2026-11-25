import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { areasOf } from "../domain/areas";
import type { PortfolioRow } from "../domain/formal";
import { Overview } from "../features/today/Overview";
import { api } from "../services/api";

function row(over: Partial<PortfolioRow> & { id: string }): PortfolioRow {
  return {
    name: over.id, phase: null, approach: null, sei_process: null, task_count: 0, done_count: 0, doing_count: 0,
    overdue_count: 0, blocked_count: 0, health: "on_track", note_stale: false, last_note_at: null, ...over,
  };
}
const ROWS = [
  row({ id: "Plano COTIN", workspace_id: "cotin" }),
  row({ id: "Portal", workspace_id: "disid", shared_from: "DISID", health: "late", task_count: 4, done_count: 1 }),
  row({ id: "ERP", workspace_id: "disid", shared_from: "DISID" }),
  row({ id: "Contratos", workspace_id: "dirau", shared_from: "DIRAU", health: "at_risk" }),
];
afterEach(() => vi.restoreAllMocks());

it("separa por área: a própria primeiro, depois as recebidas em ordem", () => {
  const areas = areasOf(ROWS, "cotin", "COTIN");
  expect(areas.map((a) => [a.label, a.rows.length, a.own])).toEqual([["COTIN", 1, true], ["DIRAU", 1, false], ["DISID", 2, false]]);
  expect(areas[2].summary.health.late).toBe(1);
});

function Where() {
  return <span data-testid="url">{useLocation().search}</span>;
}
function show(path = "/") {
  vi.spyOn(api, "get").mockResolvedValue({ projects: ROWS });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="*" element={<><Overview workspaceId="cotin" workspaceName="COTIN" /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("geral mostra o resumo por área e abrir uma área filtra o panorama e guarda na URL", async () => {
  show();
  const table = await screen.findByRole("table", { name: "Resumo por área" });
  expect(within(table).getByRole("rowheader", { name: "DISID" })).toBeInTheDocument();
  expect(screen.getByText("4 projetos ativos que você pode ver em COTIN")).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole("group", { name: "Área do panorama" })).getByRole("button", { name: /DISID/ }));
  expect(screen.getByTestId("url")).toHaveTextContent("?area=disid");
  expect(screen.getByText("2 projetos ativos que você pode ver em DISID")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Por área" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Abrir portfólio" })).toHaveAttribute("href", "/portfolio?area=disid");
});

it("link guardado abre direto no panorama da área", async () => {
  show("/?area=dirau");
  expect(await screen.findByText("1 projeto ativo que você pode ver em DIRAU")).toBeInTheDocument();
});

it("sem projetos recebidos não aparece separação por área", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ projects: [ROWS[0]] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><Overview workspaceId="cotin" workspaceName="COTIN" /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("1 projeto ativo que você pode ver em COTIN")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Área do panorama" })).not.toBeInTheDocument();
});
