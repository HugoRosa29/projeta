import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrgSection, type OrgView } from "../features/settings/OrgSection";
import { api } from "../services/api";

const chain = [
  { sigla: "DISID", label: "DISID", workspace_name: "DISID", has_space: true },
  { sigla: "COTIN", label: "COTIN", workspace_name: "COTIN", has_space: true },
  { sigla: "COINT", label: "COINT", workspace_name: null, has_space: false },
  { sigla: "PRESIDENCIA", label: "PRESIDÊNCIA", workspace_name: null, has_space: false },
];
const view = (over: Partial<OrgView> = {}): OrgView => ({
  unit: "DISID", parent: "COTIN", chain, children: [], can_share: true,
  units: [{ sigla: "GEPES", label: "GEPES" }, { sigla: "DITEC", label: "DITEC" }],
  own: [{ id: "p1", name: "Portal", shared_up: false, direct: [] }], received: [], ...over,
});
afterEach(() => vi.restoreAllMocks());

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter><OrgSection workspaceId="w1" onError={() => {}} onDone={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

it("mostra o caminho no organograma e o Gestor compartilha com a unidade acima", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view());
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  show();
  expect(await screen.findByLabelText("Posição no organograma")).toHaveTextContent("PRESIDÊNCIA › COINT › COTIN › DISID");
  await userEvent.click(screen.getByLabelText("Compartilhar Portal com COTIN"));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/shares", { project_id: "p1" });
});

it("quem não é Gestor vê sem poder alterar", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ can_share: false }));
  show();
  expect(await screen.findByLabelText("Compartilhar Portal com COTIN")).toBeDisabled();
  expect(screen.getByText("Só o Gestor do espaço altera o compartilhamento.")).toBeInTheDocument();
});

it("na COTIN, o recebido pode ser repassado à COINT", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({
    unit: "COTIN", parent: "COINT", chain: chain.slice(1), own: [],
    received: [{ id: "p1", name: "Portal", origin_unit: "DISID", origin_workspace: "DISID", shared_up: true, can_repass: true }],
  }));
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  show();
  await userEvent.click(await screen.findByLabelText("Repassar Portal a COINT"));
  expect(del).toHaveBeenCalledWith("/workspaces/w1/org/shares/p1");
});

it("espaço fora do organograma explica de onde compartilhar", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ unit: null, parent: null, chain: [], own: [] }));
  show();
  expect(await screen.findByText(/espaço oficial de cada unidade é o da lotação/)).toBeInTheDocument();
});

it("o Gestor compartilha direto com um setor fora da hierarquia e pode desfazer", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ own: [{ id: "p1", name: "Portal", shared_up: false, direct: ["DITEC"] }] }));
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  show();
  await userEvent.selectOptions(await screen.findByLabelText("Compartilhar Portal com outro setor"), "GEPES");
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/direct-shares", { project_id: "p1", unit: "GEPES" });
  // Setor que já tem acesso não aparece de novo na lista.
  expect(screen.queryByRole("option", { name: "DITEC" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Parar de compartilhar Portal com DITEC"));
  expect(del).toHaveBeenCalledWith("/workspaces/w1/org/direct-shares/p1/DITEC");
});

it("recebido direto de outro setor não oferece repasse", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({
    unit: "GEPES", parent: "DIRAF", chain: [], own: [],
    received: [{ id: "p1", name: "Portal", origin_unit: "DISID", origin_workspace: "DISID", shared_up: false, can_repass: false }],
  }));
  show();
  expect(await screen.findByText("Portal")).toBeInTheDocument();
  expect(screen.queryByLabelText(/Repassar Portal/)).not.toBeInTheDocument();
});

it("quem não é Gestor não vê o seletor de setores", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ can_share: false }));
  show();
  await screen.findByText("Compartilhar com outros setores");
  expect(screen.queryByLabelText("Compartilhar Portal com outro setor")).not.toBeInTheDocument();
});
