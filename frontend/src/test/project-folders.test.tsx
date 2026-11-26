import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionProvider } from "../app/session";
import { ToastProvider } from "../components/ui";
import type { Folder } from "../domain/areas";
import type { Project, User, Workspace } from "../domain/types";
import { DRAG_TYPE, freeName } from "../features/projects/ProjectFolders";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { api } from "../services/api";

const proj = (id: string, folder_id: string | null = null, over: Partial<Project> = {}): Project => ({
  id, workspace_id: "disid", name: id, description: "", status: "active", task_count: 0, done_count: 0, last_activity: null, folder_id, ...over,
});
let folders: Folder[] = [];
let projects: Project[] = [];

function show(canManage: boolean, url = "/projetos") {
  vi.spyOn(api, "get").mockImplementation(async (path: string) =>
    (path.endsWith("/folders") ? { folders, can_manage: canManage } : { projects }) as never,
  );
  const ws = { id: "disid", name: "DISID", kind: "team", role: canManage ? "admin" : "member", permissions: [] } as unknown as Workspace;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <SessionProvider me={{ user: { id: "u1", name: "Ana" } as User, workspaces: [ws] }}><ProjectsPage /></SessionProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const tree = () => screen.getByRole("navigation", { name: "Pastas de projetos" });
const grid = () => within(screen.getByRole("list", { name: "Pastas" }));

beforeEach(() => {
  localStorage.setItem("projeta-view-projects", "list");
  folders = [
    { id: "f-erp", name: "ERP corporativo", position: 0, project_count: 2 },
    { id: "f-vazia", name: "Vazia", position: 1, project_count: 0 },
  ];
  projects = [proj("ERP 06.04", "f-erp"), proj("Contratação ERP", "f-erp"), proj("Portal"), proj("Recebido", null, { shared_from: "DIRAU" })];
});
afterEach(() => vi.restoreAllMocks());

it("nome da pasta nova segue o padrão do sistema, sem repetir", () => {
  expect(freeName([])).toBe("Nova pasta");
  const f = (name: string) => ({ id: name, name, position: 0, project_count: 0 });
  expect(freeName([f("Nova pasta"), f("nova pasta (2)")])).toBe("Nova pasta (3)");
});

it("painel de pastas ao lado, pastas na raiz e só os projetos fora de pasta listados", async () => {
  show(true);
  await screen.findByRole("list", { name: "Projetos" });
  expect(within(tree()).getByRole("button", { name: /Projetos\s*4/ })).toHaveAttribute("aria-current", "page");
  expect(within(tree()).getByRole("button", { name: /ERP corporativo\s*2/ })).toBeInTheDocument();
  expect(grid().getByRole("button", { name: /ERP corporativo\s*2 projetos/ })).toBeInTheDocument();
  const lista = screen.getByRole("list", { name: "Projetos" });
  expect(within(lista).getAllByRole("listitem").map((r) => r.querySelector("strong")?.textContent)).toEqual(["Portal", "Recebido"]);
  // Quem gere arrasta os próprios; o recebido pelo organograma não vai para pasta.
  expect(within(lista).getByText("Portal").closest("a")).toHaveAttribute("draggable", "true");
  expect(within(lista).getByText("Recebido").closest("a")).not.toHaveAttribute("draggable");
});

it("soltar um projeto numa pasta do painel o guarda nela na hora", async () => {
  const put = vi.spyOn(api, "put").mockImplementation(async (path, body) => {
    const id = path.split("/")[2];
    projects = projects.map((p) => (p.id === id ? { ...p, folder_id: (body as { folder_id: string }).folder_id } : p));
    return {} as never;
  });
  show(true);
  const portal = (await screen.findByText("Portal")).closest("a")!;
  const data = { types: [DRAG_TYPE], getData: () => "Portal", setData: vi.fn(), dropEffect: "", effectAllowed: "" };
  fireEvent.dragStart(portal, { dataTransfer: data });
  const alvo = within(tree()).getByRole("button", { name: /ERP corporativo/ }).closest("li")!;
  expect(alvo).toHaveClass("pf-target");
  fireEvent.dragEnter(alvo, { dataTransfer: data });
  expect(alvo).toHaveClass("pf-drop");
  fireEvent.drop(alvo, { dataTransfer: data });
  await waitFor(() => expect(put).toHaveBeenCalledWith("/projects/Portal/folder", { folder_id: "f-erp" }));
  // Otimista: sai da raiz sem esperar o servidor.
  await waitFor(() => expect(screen.queryByText("Portal")).not.toBeInTheDocument());
});

it("Nova pasta nasce com o nome selecionado; digitar e Enter renomeia", async () => {
  const post = vi.spyOn(api, "post").mockImplementation(async (_p, body) => {
    const f = { id: "f-nova", name: (body as { name: string }).name, position: 2, project_count: 0 };
    folders = [...folders, f];
    return f as never;
  });
  const patch = vi.spyOn(api, "patch").mockResolvedValue({});
  show(true);
  await userEvent.click(await within(await screen.findByRole("navigation", { name: "Pastas de projetos" })).findByRole("button", { name: /Nova pasta/ }));
  expect(post).toHaveBeenCalledWith("/workspaces/disid/folders", { name: "Nova pasta" });
  const campo = await screen.findByLabelText("Novo nome de Nova pasta");
  expect(campo).toHaveFocus();
  await userEvent.keyboard("Imóveis{Enter}");
  await waitFor(() => expect(patch).toHaveBeenCalledWith("/folders/f-nova", { name: "Imóveis" }));
});

it("F2 renomeia no lugar e Esc desiste sem salvar", async () => {
  const patch = vi.spyOn(api, "patch").mockResolvedValue({});
  show(true);
  await screen.findByRole("list", { name: "Projetos" });
  const card = grid().getByRole("button", { name: /Vazia/ });
  card.focus();
  await userEvent.keyboard("{F2}");
  expect(screen.getByLabelText("Novo nome de Vazia")).toHaveFocus();
  await userEvent.keyboard("Outra{Escape}");
  expect(patch).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Novo nome de Vazia")).not.toBeInTheDocument();
});

it("botão direito na pasta: Excluir pede confirmação e só então apaga", async () => {
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  show(true);
  await screen.findByRole("list", { name: "Projetos" });
  fireEvent.contextMenu(within(tree()).getByRole("button", { name: /ERP corporativo/ }), { clientX: 50, clientY: 50 });
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Abrir", "RenomearF2", "ExcluirDel"]);
  await userEvent.click(within(menu).getByRole("menuitem", { name: /Excluir/ }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Os 2 projetos dela não são apagados");
  expect(del).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir pasta" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("/folders/f-erp"));
});

it("botão direito no projeto: Mover para outra pasta", async () => {
  const put = vi.spyOn(api, "put").mockResolvedValue({});
  show(true, "/projetos?pasta=f-erp");
  fireEvent.contextMenu((await screen.findByText("ERP 06.04")).closest("a")!, { clientX: 10, clientY: 10 });
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: /ERP corporativo/ })).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(within(menu).getByRole("menuitem", { name: /Vazia/ }));
  await waitFor(() => expect(put).toHaveBeenCalledWith("/projects/ERP 06.04/folder", { folder_id: "f-vazia" }));
});

it("quem não gere navega pelas pastas, sem criar, renomear, arrastar nem mover", async () => {
  show(false, "/projetos?pasta=f-vazia");
  expect(await screen.findByText("Pasta vazia")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Renomear|Nova pasta/ })).not.toBeInTheDocument();
  await userEvent.click(within(tree()).getByRole("button", { name: /Projetos/ }));
  const portal = screen.getByText("Portal").closest("a")!;
  expect(portal).not.toHaveAttribute("draggable");
  fireEvent.contextMenu(portal, { clientX: 10, clientY: 10 });
  expect(within(screen.getByRole("menu")).queryByText("Mover para")).not.toBeInTheDocument();
});
