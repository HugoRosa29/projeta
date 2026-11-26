import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { areasOf, splitByFolder, type Folder } from "../domain/areas";
import type { PortfolioRow } from "../domain/formal";
import { SessionProvider } from "../app/session";
import type { User, Workspace } from "../domain/types";
import { PortfolioPage } from "../features/portfolio/PortfolioPage";
import { AreaBlocks, layoutTiles } from "../features/today/AreaBlocks";
import { api } from "../services/api";

function row(over: Partial<PortfolioRow> & { id: string }): PortfolioRow {
  return {
    name: over.id, phase: null, approach: null, sei_process: null, task_count: 0, done_count: 0, doing_count: 0,
    overdue_count: 0, blocked_count: 0, health: "on_track", note_stale: false, last_note_at: null, ...over,
  };
}
const ROWS = [
  row({ id: "Plano COTIN", workspace_id: "cotin" }),
  row({ id: "Portal", workspace_id: "disid", shared_from: "DISID", via_unit: { sigla: "disid", label: "DISID" }, health: "late", task_count: 4, done_count: 1 }),
  row({ id: "ERP", workspace_id: "disid", shared_from: "DISID", via_unit: { sigla: "disid", label: "DISID" } }),
  row({ id: "Contratos", workspace_id: "dirau", shared_from: "DIRAU", via_unit: { sigla: "dirau", label: "DIRAU" }, health: "at_risk" }),
];
afterEach(() => vi.restoreAllMocks());

it("separa por área: a própria primeiro, depois as recebidas em ordem", () => {
  const areas = areasOf(ROWS, "cotin", "COTIN");
  expect(areas.map((a) => [a.label, a.rows.length, a.own])).toEqual([["COTIN", 1, true], ["DIRAU", 1, false], ["DISID", 2, false]]);
  expect(areas[2].summary.health.late).toBe(1);
});

it("na unidade de cima, as áreas são só as filhas diretas (COINT vê COTIN, não DISID e DIRAU)", () => {
  const via = { sigla: "COTIN", label: "COTIN" };
  const rows = [
    row({ id: "Portal", workspace_id: "disid", shared_from: "DISID", via_unit: via }),
    row({ id: "Contratos", workspace_id: "dirau", shared_from: "DIRAU", via_unit: via }),
    row({ id: "Mapa", workspace_id: "cored", shared_from: "CORED", via_unit: { sigla: "CORED", label: "CORED" } }),
    row({ id: "Folha", workspace_id: "gepes", shared_from: "GEPES", via_unit: null }), // direto, fora da linha
  ];
  const areas = areasOf(rows, "coint", "COINT");
  expect(areas.map((a) => [a.label, a.rows.map((r) => r.id)])).toEqual([["COINT", ["Folha"]], ["CORED", ["Mapa"]], ["COTIN", ["Portal", "Contratos"]]]);
});

it("compartilhamento direto de fora da linha fica junto dos próprios, sem bloco do espaço de origem", () => {
  // Caso real: a DISID compartilhou um projeto direto com a DIRAU (irmã, não filha).
  const rows = [
    row({ id: "Contratos", workspace_id: "dirau" }),
    row({ id: "ERP 06.04", workspace_id: "disid", shared_from: "DISID", via_unit: null }),
  ];
  const areas = areasOf(rows, "dirau", "DIRAU");
  expect(areas.map((a) => [a.label, a.rows.map((r) => r.id), a.own])).toEqual([["DIRAU", ["Contratos", "ERP 06.04"], true]]);
  // Com pastas, cai no bloco "sem pasta": pasta é do espaço dono, não de quem recebeu.
  const split = splitByFolder(areasOf([...rows, row({ id: "Portal", workspace_id: "dirau", folder_id: "f-erp" })], "dirau", "DIRAU"), PASTAS);
  expect(split.map((a) => [a.label, a.rows.map((r) => r.id)])).toEqual([["ERP", ["Portal"]], ["DIRAU", ["Contratos", "ERP 06.04"]]]);
});

it("o bloco que junta setores mostra de qual setor veio cada projeto", async () => {
  const via = { sigla: "COTIN", label: "COTIN" };
  vi.spyOn(api, "get").mockResolvedValue({ projects: [
    row({ id: "Portal", workspace_id: "disid", shared_from: "DISID", via_unit: via }),
    row({ id: "Contratos", workspace_id: "dirau", shared_from: "DIRAU", via_unit: via }),
  ] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AreaBlocks workspaceId="coint" workspaceName="COINT" /></MemoryRouter>
    </QueryClientProvider>,
  );
  const [block] = await screen.findAllByRole("article");
  expect(within(block).getByRole("heading")).toHaveTextContent("COTIN");
  expect(within(block).getByText("DISID")).toBeInTheDocument();
  expect(within(block).getByTitle("Contratos · DIRAU")).toHaveTextContent("Contratos");
});

function Where() {
  return <span data-testid="url">{useLocation().pathname + useLocation().search}</span>;
}
function show(rows = ROWS) {
  vi.spyOn(api, "get").mockResolvedValue({ projects: rows });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Routes><Route path="*" element={<><AreaBlocks workspaceId="cotin" workspaceName="COTIN" /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("home mostra um bloco por área, cada projeto com barra na cor da situação", async () => {
  show();
  expect(await screen.findByText("4 projetos ativos em 3 áreas")).toBeInTheDocument();
  const blocks = screen.getAllByRole("article");
  // Ordem de atenção: a própria, depois quem tem atrasado (DISID), depois em risco (DIRAU).
  expect(blocks.map((b) => within(b).getByRole("heading").textContent)).toEqual(["COTIN próprios", "DISID", "DIRAU"]);
  const disid = blocks[1];
  // Atrasado vem primeiro; a situação está na cor e também no nome acessível da barra.
  const bars = within(disid).getAllByRole("progressbar");
  expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Progresso de Portal: Atrasado", "Progresso de ERP: Em dia"]);
  expect(bars[0]).toHaveAttribute("aria-valuenow", "25");
  expect(bars[0].closest("li")).toHaveClass("g-red");
  expect(within(disid).getByTitle("1 atrasado")).toHaveTextContent("1 atrasado");
});

it("mantém os números do topo e filtrar por situação deixa só esses projetos nos blocos", async () => {
  show();
  const stats = await screen.findByRole("list", { name: "Resumo" });
  expect(within(stats).getByText("Projetos").parentElement).toHaveTextContent("4");
  expect(within(stats).getByText("Conclusão média").parentElement).toHaveTextContent("6%");
  await userEvent.click(within(stats).getByRole("button", { name: /Atrasados/ }));
  expect(screen.getByText("1 projeto de 4 no recorte")).toBeInTheDocument();
  expect(screen.getAllByRole("article").map((b) => within(b).getByRole("heading").textContent)).toEqual(["DISID"]);
});

it("expandir uma área a mostra com detalhes e deixa as outras resumidas ao lado; Esc recolhe", async () => {
  show(ROWS.map((r) => (r.id === "Portal" ? { ...r, overdue_count: 2 } : r)));
  await userEvent.click(await screen.findByRole("button", { name: "Expandir DISID" }));
  const open = screen.getByRole("article", { name: "DISID" });
  expect(within(open).getByRole("button", { name: "Recolher DISID" })).toHaveFocus();
  expect(within(open).getByText("2 tarefas atrasadas")).toBeInTheDocument(); // detalhe só no expandido
  const rail = screen.getByRole("navigation", { name: "Outras áreas" });
  expect(within(rail).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Expandir COTIN", "Expandir DIRAU"]);
  await userEvent.click(within(rail).getByRole("button", { name: "Expandir DIRAU" }));
  expect(screen.getByRole("button", { name: "Recolher DIRAU" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("navigation", { name: "Outras áreas" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("clicar em qualquer ponto do bloco expande a área; expandida, o nome abre o portfólio recortado", async () => {
  show();
  await userEvent.click(await screen.findByTitle("Contratos")); // em cima de um projeto, no mosaico
  expect(screen.getByRole("button", { name: "Recolher DIRAU" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "DIRAU" }));
  expect(screen.getByTestId("url")).toHaveTextContent("/portfolio?area=dirau");
});

it("sem projetos ativos o panorama não aparece", async () => {
  show([]);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "Panorama por área" })).not.toBeInTheDocument();
});

it("portfólio abre no quadro (o antigo panorama da home), recortado pela área da URL", async () => {
  localStorage.removeItem("projeta-view-portfolio");
  vi.spyOn(api, "get").mockResolvedValue({ projects: ROWS });
  const me = { user: { id: "u1", name: "Ana" } as User, workspaces: [{ id: "cotin", name: "COTIN", kind: "team", role: "admin" } as Workspace] };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/portfolio?area=disid"]}>
        <SessionProvider me={me}><PortfolioPage /></SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", { name: /Quadro/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("2 projetos ativos que você pode ver em DISID")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Quadro dos projetos" })).toBeInTheDocument();
});

it("arranja os projetos na grade que melhor preenche o bloco, sem cartões altos demais", () => {
  // Bloco largo e baixo: 6 projetos em 3×2, não 6×1 espremidos nem 1×6.
  expect(layoutTiles(6, 600, 200, 6, 120, 140, 1.7)).toMatchObject({ cols: 3, tight: false });
  // Bloco estreito e alto: 2 colunas.
  expect(layoutTiles(6, 260, 400, 6, 120, 140, 1.7)).toMatchObject({ cols: 2 });
  // Poucos projetos num espaço grande: a altura para no teto.
  expect(layoutTiles(2, 900, 700, 6, 120, 140, 1.7).h).toBe(140);
  // Não cabe nem com 26px: lista rola por dentro, no máximo de colunas.
  expect(layoutTiles(40, 140, 200, 6, 120, 140, 1.7)).toEqual({ cols: 1, h: 26, tight: true });
});

const PASTAS: Folder[] = [
  { id: "f-erp", name: "ERP", position: 0, project_count: 2 },
  { id: "f-vazia", name: "Vazia", position: 1, project_count: 0 },
];
const DISID = [
  row({ id: "ERP 06.04", workspace_id: "disid", folder_id: "f-erp", health: "late" }),
  row({ id: "Contratação ERP", workspace_id: "disid", folder_id: "f-erp" }),
  row({ id: "Portal", workspace_id: "disid" }),
];

it("pastas dividem os próprios projetos: um bloco por pasta com projeto e um sem pasta", () => {
  const areas = splitByFolder(areasOf(DISID, "disid", "DISID"), PASTAS);
  expect(areas.map((a) => [a.label, a.rows.map((r) => r.id), a.folder ?? null, !!a.loose])).toEqual([
    ["ERP", ["ERP 06.04", "Contratação ERP"], "f-erp", false],
    ["DISID", ["Portal"], null, true],
  ]);
  expect(areas[0].summary.health.late).toBe(1);
  expect(areas[0].portfolioArea).toBe("disid");
});

it("sem projeto em pasta, a visão fica como antes", () => {
  const plain = DISID.map((r) => ({ ...r, folder_id: null }));
  expect(splitByFolder(areasOf(plain, "disid", "DISID"), PASTAS).map((a) => a.label)).toEqual(["DISID"]);
  // Recebidos do organograma não entram em pasta de quem recebeu.
  const mixed = splitByFolder(areasOf([...DISID, ...ROWS.slice(1)], "disid", "DISID"), PASTAS);
  expect(mixed.map((a) => a.label)).toEqual(["ERP", "DISID", "DIRAU"]);
});

it("no panorama, a pasta vira bloco e quem gere vê o botão de organizar", async () => {
  vi.spyOn(api, "get").mockImplementation(async (path: string) =>
    (path.endsWith("/folders") ? { folders: PASTAS, can_manage: true } : { projects: DISID }) as never,
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AreaBlocks workspaceId="disid" workspaceName="DISID" /></MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  const [erp, solto] = screen.getAllByRole("article");
  expect(within(erp).getByRole("heading")).toHaveTextContent("ERP");
  expect(within(erp).getByLabelText("Pasta")).toBeInTheDocument();
  expect(within(solto).getByRole("heading")).toHaveTextContent("DISID sem pasta");
  await userEvent.click(screen.getByRole("button", { name: /Organizar pastas/ }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Pastas de projetos");
  expect(screen.getByLabelText("Portal")).toHaveValue("");
  expect(screen.getByLabelText("ERP 06.04")).toHaveValue("f-erp");
});
