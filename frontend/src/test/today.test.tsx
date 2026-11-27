import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider } from "../app/session";
import type { Task, User, Workspace } from "../domain/types";
import { TodayPage, greeting, initials } from "../features/today/TodayPage";
import { api } from "../services/api";

const base: Omit<Task, "id" | "title"> = { workspace_id: "w1", project_id: null, owner_id: null, description: "", status: "todo", priority: "medium", assignee_id: null, assignee_name: null, project_name: null, due_date: null, estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 1, created_at: "", updated_at: "", parent_id: null, parent_title: null };
const task = (id: string, title: string): Task => ({ ...base, id, title });

afterEach(() => vi.restoreAllMocks());

function show(role: string, photo: string | null = null) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path === "/today") return { today: "2026-11-24", overdue: [], due_today: [task("a", "Assinar contrato")], upcoming: [], priorities: [], inbox: [task("b", "Ler relatório")] };
    if (path === "/portfolio") return { projects: [] };
    if (path === "/me/profile") return { photo_version: photo };
    return { key_results: [], objectives: [], summary: { objectives: 0 }, can_manage: false };
  });
  const me = { user: { id: "u1", name: "Ana" } as User, workspaces: [{ id: "w1", name: "Equipe", kind: "team", role } as Workspace] };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SessionProvider me={me}><TodayPage /></SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("junta as listas do dia em abas e abre na primeira que tem tarefa", async () => {
  show("member");
  const tabs = await screen.findByRole("tablist", { name: "Tarefas por prazo" });
  expect(within(tabs).getByRole("tab", { name: "Hoje 1" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Assinar contrato");
  await userEvent.click(within(tabs).getByRole("tab", { name: "Sem prazo 1" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Ler relatório");
  expect(screen.getByRole("tabpanel")).not.toHaveTextContent("Assinar contrato");
});

it("para quem executa, o panorama fica a um clique", async () => {
  show("member");
  expect(await screen.findByRole("button", { name: "Ver o panorama do espaço" })).toBeInTheDocument();
});

it("cumprimenta pela hora e mostra as iniciais", () => {
  expect([greeting(4), greeting(9), greeting(13), greeting(19)]).toEqual(["Boa noite", "Bom dia", "Boa tarde", "Boa noite"]);
  expect(initials("Hugo Sousa Rosa")).toBe("HR");
  expect(initials("Ana")).toBe("A");
});

it("a coluna de OKRs e tarefas pode ser escondida, e a escolha fica no navegador", async () => {
  localStorage.removeItem("projeta-home-side");
  show("member");
  const side = await screen.findByRole("complementary", { name: "Seu trabalho" });
  await userEvent.click(screen.getByRole("button", { name: /Esconder OKRs e tarefas/ }));
  expect(side).not.toBeVisible();
  expect(localStorage.getItem("projeta-home-side")).toBe("hidden");
  await userEvent.click(screen.getByRole("button", { name: /Mostrar OKRs e tarefas/ }));
  expect(screen.getByRole("complementary", { name: "Seu trabalho" })).toBeVisible();
});

it("a saudação mostra a foto da pessoa e, sem foto, as iniciais", async () => {
  show("member", "2026-11-01T10:00:00Z");
  const hello = await screen.findByRole("banner");
  await vi.waitFor(() => expect(hello.querySelector(".dash-avatar img")).toHaveAttribute("src", expect.stringContaining("/users/u1/photo")));
});

it("sem foto, a saudação mostra as iniciais", async () => {
  show("member");
  await screen.findByRole("tablist", { name: "Tarefas por prazo" });
  expect(document.querySelector(".dash-avatar")).toHaveTextContent("A");
});
