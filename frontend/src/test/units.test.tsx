import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../components/ui";
import { fmtDate } from "../domain/types";
import { ApiError, api } from "../services/api";

afterEach(() => vi.restoreAllMocks());

describe("datas de calendário", () => {
  it("formata AAAA-MM-DD sem converter fuso", () => {
    expect(fmtDate("2026-03-10")).toBe("10/03/26");
    expect(fmtDate(null)).toBe("");
  });
});

describe("cliente da API", () => {
  it("envia o cabeçalho anti-CSRF e converte erros do servidor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "conflict", message: "Alterada por outra pessoa", details: { x: 1 } } }), { status: 409 }),
    );
    await expect(api.patch("/tasks/1", { title: "x" })).rejects.toMatchObject({ status: 409, code: "conflict", message: "Alterada por outra pessoa" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("projeta-web");
  });
  it("traduz falha de rede em mensagem recuperável", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fail"));
    const err = (await api.get("/me").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("network");
  });
});

describe("Dialog", () => {
  it("fica fora de ancestrais transformados e restaura a rolagem ao fechar", () => {
    const previous = document.body.style.overflow;
    const { container, unmount } = render(
      <section style={{ transform: "translateY(0)", isolation: "isolate" }}>
        <Dialog title="Ficha" onClose={() => {}}><input aria-label="Nome" /></Dialog>
      </section>,
    );
    const dialog = screen.getByRole("dialog", { name: "Ficha" });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe(previous);
  });
  it("fecha com Esc, prende o foco e devolve o foco ao fechar", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <button>abrir</button>
        <Dialog title="Teste" onClose={onClose}>
          <input aria-label="campo" data-autofocus />
          <button>ok</button>
        </Dialog>
      </>,
    );
    expect(screen.getByRole("dialog", { name: "Teste" })).toBeInTheDocument();
    expect(screen.getByLabelText("campo")).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
