import { describe, expect, it } from "vitest";
import { asText, termToMarkdown } from "../domain/formal";

describe("termos do projeto formal", () => {
  it("converte listas do servidor em texto editável", () => {
    expect(asText(null)).toBe("");
    expect(asText("já é texto")).toBe("já é texto");
    expect(asText([{ entrega: "Piloto", prevista: "2026-05-01" }, "Go-live"])).toBe("- Piloto · 2026-05-01\n- Go-live");
  });

  it("exporta em Markdown só os campos preenchidos, com o processo SEI", () => {
    const md = termToMarkdown("tap", "Portal", "00111-1/2026-34", { justificativa: "Modernizar", escopo: "  ", beneficios: "- Menos custo" });
    expect(md).toContain("# Termo de Abertura do Projeto (TAP)");
    expect(md).toContain("**Processo SEI:** 00111-1/2026-34");
    expect(md).toContain("## Justificativa\n\nModernizar");
    expect(md).toContain("## Benefícios esperados");
    expect(md).not.toContain("## Escopo");
  });
});
