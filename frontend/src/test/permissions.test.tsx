import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PermissionsMatrix, invitableRoles } from "../features/settings/SettingsPage";
import { api } from "../services/api";

const matrix = {
  catalog: [
    { id: "project.create", label: "Criar projetos" },
    { id: "comment.write", label: "Comentar tarefas nos projetos em que está" },
  ],
  roles: [
    { id: "manager", label: "Gerente de projeto" },
    { id: "member", label: "Membro" },
    { id: "viewer", label: "Leitor" },
  ],
  permissions: { manager: ["project.create", "comment.write"], member: ["comment.write"], viewer: [] },
};
afterEach(() => vi.restoreAllMocks());

function show(editable: boolean) {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <PermissionsMatrix workspaceId="w1" editable={editable} onSaved={onSaved} onError={() => {}} />
    </QueryClientProvider>,
  );
  return onSaved;
}

it("o Gestor marca uma permissão e salva a matriz inteira", async () => {
  vi.spyOn(api, "get").mockResolvedValue(matrix);
  const put = vi.spyOn(api, "put").mockResolvedValue(matrix);
  const user = userEvent.setup();
  const onSaved = show(true);
  await user.click(await screen.findByLabelText("Leitor: Comentar tarefas nos projetos em que está"));
  await user.click(screen.getByRole("button", { name: "Salvar permissões" }));
  expect(put).toHaveBeenCalledWith("/workspaces/w1/permissions", {
    permissions: { manager: ["project.create", "comment.write"], member: ["comment.write"], viewer: ["comment.write"] },
  });
  expect(onSaved).toHaveBeenCalled();
});

it("quem não é Gestor vê a matriz sem poder alterar", async () => {
  vi.spyOn(api, "get").mockResolvedValue(matrix);
  show(false);
  expect(await screen.findByLabelText("Membro: Criar projetos")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Salvar permissões" })).not.toBeInTheDocument();
});

it("convite só concede perfil igual ou abaixo, e nunca o de Gestor sem sê-lo", () => {
  expect(invitableRoles("admin")).toEqual(["admin", "manager", "member", "viewer"]);
  expect(invitableRoles("manager")).toEqual(["manager", "member", "viewer"]);
  expect(invitableRoles("viewer")).toEqual(["viewer"]);
});

it("nome do arquivo de exportação é seguro e datado", async () => {
  const { exportFilename } = await import("../features/settings/SettingsPage");
  expect(exportFilename("DISID – Gestão", new Date("2026-11-19T12:00:00Z"))).toBe("projeta-disid-gestao-2026-11-19.json");
  expect(exportFilename("***", new Date("2026-11-19T12:00:00Z"))).toBe("projeta-espaco-2026-11-19.json");
});
