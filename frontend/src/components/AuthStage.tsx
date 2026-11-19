import type { ReactNode } from "react";
import { useMotion } from "./motion";
import { Skyline } from "./Skyline";

/** Moldura das telas de entrada: painel de marca com ilustração + o cartão do formulário. */
export function AuthStage({ children }: { children: ReactNode }) {
  useMotion();
  return (
    <main className="auth" id="main">
      <aside className="auth-hero">
        <div className="auth-hero-copy">
          <p className="eyebrow">Terracap · Projeta</p>
          <h2>Projetos claros, do plano à entrega.</h2>
        </div>
        <div className="auth-hero-art">
          <Skyline />
        </div>
      </aside>
      <div className="auth-side">{children}</div>
    </main>
  );
}
