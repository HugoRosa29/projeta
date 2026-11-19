import type { ReactNode } from "react";
import { Skyline } from "./Skyline";

/** Faixa de abertura de página: texto à esquerda; à direita a ilustração em camadas ou, se houver, a imagem da página. */
export function Hero({
  eyebrow,
  title,
  subtitle,
  cover,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  cover?: string;
  children?: ReactNode;
}) {
  return (
    <header className={`hero ${cover ? "has-cover" : ""}`}>
      {cover && <img className="hero-cover" src={cover} alt="" />}
      <div className="hero-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {subtitle && <p className="hero-sub">{subtitle}</p>}
        {children && <div className="hero-actions">{children}</div>}
      </div>
      {!cover && (
        <div className="hero-art">
          <Skyline />
        </div>
      )}
    </header>
  );
}
