import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider } from "../app/session";
import { ToastProvider } from "../components/ui";
import type { Member, Project, Workspace } from "../domain/types";
import { TeamPanel, type ProjectData } from "../features/projects/ProjectPage";
import { api } from "../services/api";

afterEach(() => vi.restoreAllMocks());

const ws = (id: string, name: string, kind: Workspace["kind"]): Workspace => ({
  id, name, kind, timezone: "America/Sao_Paulo", role: "admin", permissions: [], notify_email: false, notify_inapp: true,
});
const person = (id: string, name: string, photo: string | null = null): Member => ({ id, name, email: `${id}@ex.com`, role: "member", photo_version: photo });

const data = (members: Member[]): ProjectData => ({
  project: { id: "p1", workspace_id: "dirau", name: "Portal" } as Project,
  can_write: true, can_manage: true, members, stats: {}, activity: [],
});

function show(d: ProjectData) {
  // A sessão está no espaço pessoal: a lista tem de vir do espaço do projeto (a divisão).
  const me = { user: { id: "u1", email: "x", name: "Hugo", timezone: "America/Sao_Paulo" }, workspaces: [ws("pessoal", "Espaço de Hugo", "personal"), ws("dirau", "DIRAU", "team")] };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><SessionProvider me={me}><MemoryRouter><TeamPanel d={d} /></MemoryRouter></SessionProvider></ToastProvider>
    </QueryClientProvider>,
  );
}

it("mostra foto de quem tem e iniciais de quem não tem; adiciona alguém da divisão com um clique", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async (url: string) => {
    if (url === "/workspaces/dirau/members") return { members: [person("u1", "Hugo Sousa Rosa"), person("u2", "Ana Lima", "2026-11-01"), person("u3", "Caio Prado")] };
    return { invites: [] };
  });
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  show(data([person("u1", "Hugo Sousa Rosa", "2026-10-10")]));

  const team = screen.getAllByRole("list")[0];
  expect(team.querySelector("img")?.getAttribute("src")).toBe("/api/v1/users/u1/photo?v=2026-10-10");

  const add = await screen.findByRole("region", { name: "Adicionar da DIRAU" });
  expect(get).toHaveBeenCalledWith("/workspaces/dirau/members");
  expect(within(add).queryByText("Hugo Sousa Rosa")).not.toBeInTheDocument(); // já está na equipe
  expect(within(add).getByText("CP")).toBeInTheDocument(); // sem foto: iniciais

  await userEvent.click(within(add).getByRole("button", { name: "Adicionar Ana Lima ao projeto" }));
  expect(post).toHaveBeenCalledWith("/projects/p1/members", { user_id: "u2" });
});

it("filtra a divisão por nome sem diferenciar acento quando a lista é longa", async () => {
  const many = ["Ana", "Bruno", "Cássia", "Davi", "Edu", "Fábio"].map((n, i) => person(`x${i}`, n));
  vi.spyOn(api, "get").mockImplementation(async (url: string) => (url.includes("/members") ? { members: many } : { invites: [] }));
  show(data([]));
  await userEvent.type(await screen.findByRole("searchbox", { name: "Buscar pessoa da divisão" }), "cassia");
  const add = screen.getByRole("region", { name: "Adicionar da DIRAU" });
  expect(within(add).getByText("Cássia")).toBeInTheDocument();
  expect(within(add).queryByText("Bruno")).not.toBeInTheDocument();
});

it("retira alguém da equipe só depois de confirmar", async () => {
  vi.spyOn(api, "get").mockImplementation(async (url: string) => (url.includes("/members") ? { members: [] } : { invites: [] }));
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  show(data([person("u1", "Hugo Sousa Rosa"), person("u2", "Ana Lima")]));
  const btn = screen.getByRole("button", { name: "Retirar Ana Lima da equipe" });
  await userEvent.click(btn);
  expect(del).not.toHaveBeenCalled();
  await userEvent.click(btn);
  expect(ask).toHaveBeenLastCalledWith(expect.stringContaining("tarefas de Ana Lima neste projeto ficam sem responsável"));
  expect(del).toHaveBeenCalledWith("/projects/p1/members/u2");
});

it("sem permissão de gestão não oferece retirar ninguém", () => {
  vi.spyOn(api, "get").mockResolvedValue({ members: [], invites: [] });
  show({ ...data([person("u2", "Ana Lima")]), can_manage: false });
  expect(screen.queryByRole("button", { name: /Retirar/ })).not.toBeInTheDocument();
});
