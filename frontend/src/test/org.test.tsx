import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrgSection } from "../features/settings/OrgSection";
import { ShareButton, type OrgView } from "../features/sharing/ShareButton";
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
  own: [{ id: "p1", name: "Portal", shared_up: false, direct: [] }], received: [],
  own_objectives: [{ id: "o1", title: "Rede estável", period: "2026-T4", shared_up: false }], received_objectives: [],
  tree: [
    ["PRESIDENCIA", "PRESIDÊNCIA", null], ["COINT", "COINT", "PRESIDENCIA"], ["COTIN", "COTIN", "COINT"],
    ["DISID", "DISID", "COTIN"], ["DIGTI", "DIGTI", "COTIN"], ["DITEC", "DITEC", "PRESIDENCIA"],
    ["DIRAF", "DIRAF", "PRESIDENCIA"], ["GEPES", "GEPES", "DIRAF"],
  ].map(([sigla, label, parent]) => ({ sigla: sigla!, label: label!, parent, has_space: true })),
  ...over,
});
afterEach(() => vi.restoreAllMocks());

function show(ui: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const project = () => show(<ShareButton workspaceId="w1" kind="project" id="p1" name="Portal" />);
const open = async (name = /Compartilhar: Portal|Compartilhado com .*: Portal/) => userEvent.click(await screen.findByRole("button", { name }));

const settings = () => show(<OrgSection workspaceId="w1" onError={() => {}} onDone={() => {}} />);

it("Configurações abre na unidade acima: projetos, objetivos e compartilhar todos", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ own: [{ id: "p1", name: "Portal", shared_up: false, direct: ["DITEC"] }] }));
  const post = vi.spyOn(api, "post").mockResolvedValue({ shared: 1 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  settings();
  expect(await screen.findByLabelText("Posição no organograma")).toHaveTextContent("PRESIDÊNCIA › COINT › COTIN › DISID");
  expect(screen.getByRole("button", { name: "COTIN (acima)" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "DITEC, 1 compartilhado" })).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Compartilhar Portal com COTIN"));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/shares", { project_id: "p1" });
  await userEvent.click(screen.getByLabelText("Compartilhar Rede estável com COTIN"));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/objective-shares", { objective_id: "o1" });
  await userEvent.click(screen.getByRole("button", { name: "Compartilhar todos os projetos com COTIN" }));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/share-all");
});

it("clicar noutro setor do organograma compartilha direto com ele", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ own: [{ id: "p1", name: "Portal", shared_up: false, direct: ["DITEC"] }] }));
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  settings();
  await userEvent.click(await screen.findByRole("button", { name: /^DITEC/ }));
  expect(screen.queryByLabelText(/Rede estável/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Compartilhar Portal com DITEC"));
  expect(del).toHaveBeenCalledWith("/workspaces/w1/org/direct-shares/p1/DITEC");
  // GEPES está num ramo fechado: a busca o mostra.
  expect(screen.queryByRole("button", { name: /^GEPES/ })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Buscar setor"), "gep");
  await userEvent.click(screen.getByRole("button", { name: /^GEPES/ }));
  await userEvent.click(screen.getByLabelText("Compartilhar Portal com GEPES"));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/direct-shares", { project_id: "p1", unit: "GEPES" });
});

it("Configurações repassa o recebido à unidade acima e mostra no próprio setor o que chegou", async () => {
  const received = { id: "p2", name: "Rede", origin_unit: "DIGTI", origin_workspace: "DIGTI", shared_up: false, can_repass: true };
  vi.spyOn(api, "get").mockResolvedValue(view({ received: [received] }));
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  settings();
  await userEvent.click(await screen.findByLabelText("Repassar Rede a COTIN"));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/shares", { project_id: "p2" });
  await userEvent.click(screen.getByRole("button", { name: "DISID (seu espaço)" }));
  expect(screen.getByRole("link", { name: "Rede" })).toHaveAttribute("href", "/projetos/p2");
});

it("Configurações só mostra, sem alterar, para quem não é Gestor", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ can_share: false }));
  settings();
  expect(await screen.findByLabelText("Compartilhar Portal com COTIN")).toBeDisabled();
  expect(screen.getByText(/Só o Gestor do espaço/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^DITEC/ }));
  expect(screen.getByLabelText("Compartilhar Portal com DITEC")).toBeDisabled();
});

it("no projeto, um só seletor leva à unidade acima ou a outro setor", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view());
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  project();
  await open();
  expect(screen.getByText("Ninguém de fora. Só a sua equipe vê.")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Setor"), "COTIN");
  await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/shares", { project_id: "p1" });
  await userEvent.selectOptions(screen.getByLabelText("Setor"), "GEPES");
  expect(screen.getByText(/GEPES está fora da sua linha hierárquica/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/direct-shares", { project_id: "p1", unit: "GEPES" });
});

it("lista quem já vê e permite remover cada um", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ own: [{ id: "p1", name: "Portal", shared_up: true, direct: ["DITEC"] }] }));
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  project();
  await open(/Compartilhado com 2 setores: Portal/);
  expect(screen.queryByRole("option", { name: "DITEC" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /COTIN/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Parar de compartilhar com DITEC"));
  expect(del).toHaveBeenCalledWith("/workspaces/w1/org/direct-shares/p1/DITEC");
  await userEvent.click(screen.getByLabelText("Parar de compartilhar com COTIN"));
  expect(del).toHaveBeenCalledWith("/workspaces/w1/org/shares/p1");
});

it("na COTIN, o recebido só pode ser repassado à unidade acima", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({
    unit: "COTIN", parent: "COINT", chain: chain.slice(1), own: [],
    received: [{ id: "p1", name: "Portal", origin_unit: "DISID", origin_workspace: "DISID", shared_up: false, can_repass: true }],
  }));
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  project();
  await open();
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha um setor…", "COINT — unidade acima"]);
  await userEvent.selectOptions(screen.getByLabelText("Setor"), "COINT");
  await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/shares", { project_id: "p1" });
});

it("recebido direto de outro setor não oferece repasse", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({
    unit: "GEPES", parent: "DIRAF", chain: [], own: [],
    received: [{ id: "p1", name: "Portal", origin_unit: "DISID", origin_workspace: "DISID", shared_up: false, can_repass: false }],
  }));
  project();
  await open();
  expect(screen.queryByLabelText("Setor")).not.toBeInTheDocument();
  expect(screen.getByText(/só quem é dono decide/)).toBeInTheDocument();
});

it("quem não é Gestor vê com quem está, sem alterar", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ can_share: false, own: [{ id: "p1", name: "Portal", shared_up: true, direct: [] }] }));
  project();
  await open(/Compartilhado com 1 setor: Portal/);
  expect(screen.getByText("COTIN")).toBeInTheDocument();
  expect(screen.queryByLabelText("Setor")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Parar de compartilhar/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Só o Gestor do espaço/)).toBeInTheDocument();
});

it("objetivo de OKR sobe para a unidade acima", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view());
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  show(<ShareButton workspaceId="w1" kind="objective" id="o1" name="Rede estável" compact />);
  await open(/Compartilhar: Rede estável/);
  expect(screen.queryByRole("option", { name: "GEPES" })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Setor"), "COTIN");
  await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
  expect(post).toHaveBeenCalledWith("/workspaces/w1/org/objective-shares", { objective_id: "o1" });
});

it("fora do organograma, não há botão e Configurações explica", async () => {
  vi.spyOn(api, "get").mockResolvedValue(view({ unit: null, parent: null, chain: [], own: [] }));
  show(<><ShareButton workspaceId="w1" kind="project" id="p1" name="Portal" /><OrgSection workspaceId="w1" onError={() => {}} onDone={() => {}} /></>);
  expect(await screen.findByText(/não representa uma unidade do organograma/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Compartilhar/ })).not.toBeInTheDocument();
});
