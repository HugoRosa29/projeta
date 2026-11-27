import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider } from "../app/session";
import { ToastProvider } from "../components/ui";
import type { Workspace } from "../domain/types";
import { SettingsPage } from "../features/settings/SettingsPage";
import { api } from "../services/api";

afterEach(() => vi.restoreAllMocks());

const ws = (id: string, name: string, kind: Workspace["kind"], role: Workspace["role"]): Workspace => ({
  id, name, kind, timezone: "America/Sao_Paulo", role, permissions: [], notify_email: false, notify_inapp: true,
});

function show(workspaces: Workspace[], url = "/configuracoes") {
  const me = { user: { id: "u1", email: "u1@ex.com", name: "Hugo", timezone: "America/Sao_Paulo" }, workspaces };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><SessionProvider me={me}><MemoryRouter initialEntries={[url]}><SettingsPage /></MemoryRouter></SessionProvider></ToastProvider>
    </QueryClientProvider>,
  );
}

it("mostra uma seção por vez e troca pelo menu", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ members: [{ id: "u1", name: "Hugo", email: "u1@ex.com", role: "admin" }], invitations: [] });
  show([ws("pessoal", "Espaço de Hugo", "personal", "admin")]);

  expect(screen.getByRole("heading", { level: 1, name: "Preferências" })).toBeTruthy();
  expect(screen.getByLabelText("Seu fuso horário")).toBeTruthy();
  expect(screen.queryByText("Membros")).toBeNull();
  // Espaço pessoal não tem organograma nem matriz de permissões.
  expect(screen.queryByRole("button", { name: /Permissões/ })).toBeNull();

  await userEvent.setup().click(screen.getByRole("button", { name: /Pessoas/ }));
  expect(screen.getByRole("heading", { level: 1, name: "Pessoas" })).toBeTruthy();
  expect(await screen.findByText("u1@ex.com")).toBeTruthy();
  expect(screen.queryByLabelText("Seu fuso horário")).toBeNull();
});

it("abre a seção pedida na URL e, para quem não é Gestor, mostra o espaço só em leitura", () => {
  vi.spyOn(api, "get").mockResolvedValue({});
  show([ws("dirau", "DIRAU", "team", "member")], "/configuracoes?secao=espaco");

  expect(screen.getByRole("heading", { level: 1, name: "Este espaço" })).toBeTruthy();
  expect(screen.getByText("Só o Gestor do espaço altera estes dados.")).toBeTruthy();
  expect(screen.queryByLabelText("Nome do espaço")).toBeNull();
  expect(screen.getByRole("button", { name: /Organização/ })).toBeTruthy();
});
