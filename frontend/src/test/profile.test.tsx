import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider } from "../app/session";
import type { Workspace } from "../domain/types";
import { ProfilePage, type Profile } from "../features/profile/ProfilePage";
import { api } from "../services/api";

afterEach(() => vi.restoreAllMocks());

const ws = (id: string, name: string, kind: Workspace["kind"]): Workspace => ({
  id, name, kind, timezone: "America/Sao_Paulo", role: "admin", permissions: [], notify_email: false, notify_inapp: true,
});
const profile = (over: Partial<Profile> = {}): Profile => ({
  id: "u1", name: "Daniel Reis Santos", email: "daniel@terracap.df.gov.br", matricula: "12345",
  allotment: "DIRAU - DIRAU - DIVISÃO DE INFRAESTRUT DE REDES E ATEND AO USUARIO", timezone: "America/Sao_Paulo",
  created_at: "2026-08-10T13:00:00Z", photo_version: null, origin: "gia", unit: { sigla: "DIRAU", label: "DIRAU" },
  heads_of: [{ sigla: "DIRAU", label: "DIRAU" }],
  workspaces: [
    { id: "p", name: "Espaço de Daniel", kind: "personal", org_unit: null, role: "admin" },
    { id: "d", name: "DIRAU", kind: "team", org_unit: "DIRAU", role: "admin" },
  ],
  ...over,
});

function show() {
  const me = { user: { id: "u1", email: "x", name: "Daniel", timezone: "America/Sao_Paulo" }, workspaces: [ws("p", "Espaço de Daniel", "personal"), ws("d", "DIRAU", "team")] };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider me={me}><MemoryRouter><ProfilePage /></MemoryRouter></SessionProvider>
    </QueryClientProvider>,
  );
}

it("mostra matrícula, lotação do GIA, unidade, titularidade e espaços", async () => {
  vi.spyOn(api, "get").mockResolvedValue(profile());
  show();
  expect(await screen.findByRole("heading", { name: "Daniel Reis Santos" })).toBeInTheDocument();
  expect(screen.getByText("12345")).toBeInTheDocument();
  expect(screen.getByText(/DIVISÃO DE INFRAESTRUT/)).toBeInTheDocument();
  expect(screen.getByText("Titular de")).toBeInTheDocument();
  expect(screen.getByText("Unidade DIRAU")).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/me/profile");
});

it("abre outro espaço a partir do perfil", async () => {
  vi.spyOn(api, "get").mockResolvedValue(profile());
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Abrir" }));
  expect(screen.getAllByText("Atual")).toHaveLength(1);
});

it("conta local explica a falta de lotação", async () => {
  vi.spyOn(api, "get").mockResolvedValue(profile({ origin: "local", matricula: null, allotment: null, unit: null, heads_of: [] }));
  show();
  expect(await screen.findByText("Sem matrícula (conta local)")).toBeInTheDocument();
  expect(screen.getByText("Sem unidade")).toBeInTheDocument();
  expect(screen.queryByText("Titular de")).not.toBeInTheDocument();
});

it("sem foto mostra as iniciais e oferece adicionar; com foto oferece trocar e remover", async () => {
  vi.spyOn(api, "get").mockResolvedValue(profile());
  show();
  expect(await screen.findByText("DS")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Adicionar foto/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Remover foto/ })).not.toBeInTheDocument();
});

it("com foto mostra a imagem versionada e envia a remoção", async () => {
  vi.spyOn(api, "get").mockResolvedValue(profile({ photo_version: "2026-11-25T12:00:00Z" }));
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
  show();
  const img = await screen.findByRole("img", { name: "Sua foto de perfil" });
  expect(img.getAttribute("src")).toBe("/api/v1/me/photo?v=2026-11-25T12%3A00%3A00Z");
  expect(screen.getByRole("button", { name: /Trocar foto/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Remover foto/ }));
  expect(del).toHaveBeenCalledWith("/me/photo");
});
