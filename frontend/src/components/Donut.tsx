import { useState } from "react";

export interface DonutItem {
  key: string;
  label: string;
  value: number;
  /** Cor da fatia (variável CSS). O texto nunca usa essa cor: a legenda escreve o rótulo. */
  color: string;
}

const R = 46;
const C = 2 * Math.PI * R;
const GAP = 1.6; // folga entre fatias, na cor da superfície

/** Gráfico de rosca com legenda clicável. A legenda é a via de teclado e de leitor de tela; as
 * fatias repetem o clique para quem usa o mouse. Clicar no item escolhido de novo limpa o filtro. */
export function Donut({ title, items, total, centerLabel, selected, onSelect, side = false }: {
  title: string;
  /** Legenda ao lado da rosca (cartão largo e baixo); sem isso, embaixo. */
  side?: boolean;
  items: DonutItem[];
  /** Total do centro (padrão: soma das fatias). */
  total?: number;
  centerLabel: string;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const sum = items.reduce((s, i) => s + i.value, 0);
  const shown = items.filter((i) => i.value > 0);
  const focus = items.find((i) => i.key === (hover ?? selected));
  const pick = (key: string) => onSelect?.(selected === key ? null : key);
  let offset = 0;
  return (
    <figure className={`donut ${side ? "side" : ""}`}>
      <figcaption className="donut-title">{title}</figcaption>
      <div className="donut-body">
        <svg viewBox="0 0 120 120" className="donut-svg" aria-hidden onMouseLeave={() => setHover(null)}>
          <circle cx="60" cy="60" r={R} className="donut-track" />
          {shown.map((i) => {
            const len = (i.value / sum) * C;
            const seg = shown.length > 1 ? Math.max(len - GAP, 0.5) : C;
            const el = (
              // Clique e mouse são atalhos; a legenda abaixo dá o mesmo pelo teclado.
              <circle
                key={i.key}
                cx="60"
                cy="60"
                r={R}
                className={`donut-seg ${focus && focus.key !== i.key ? "dim" : ""}`}
                style={{ stroke: i.color }}
                strokeDasharray={`${seg} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
                onMouseEnter={() => setHover(i.key)}
                onClick={() => pick(i.key)}
              >
                <title>{`${i.label}: ${i.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
          <text x="60" y="58" className="donut-n">{focus ? focus.value : (total ?? sum)}</text>
          <text x="60" y="74" className="donut-sub">{focus ? pct(focus.value, sum) : centerLabel}</text>
        </svg>
        <ul className="donut-legend">
          {items.map((i) => (
            <li key={i.key}>
              <button
                type="button"
                className={`donut-key ${selected === i.key ? "on" : ""}`}
                aria-pressed={selected === i.key}
                disabled={!onSelect || (i.value === 0 && selected !== i.key)}
                onClick={() => pick(i.key)}
                onMouseEnter={() => setHover(i.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i.key)}
                onBlur={() => setHover(null)}
              >
                <span className="donut-swatch" style={{ background: i.color }} aria-hidden />
                <span className="donut-label">{i.label}</span>
                <span className="donut-v">{i.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

function pct(v: number, sum: number) {
  return sum ? `${Math.round((v / sum) * 100)}%` : "0%";
}
