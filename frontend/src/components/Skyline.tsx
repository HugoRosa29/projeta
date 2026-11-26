import { CalendarCheck, Flag, Layers } from "lucide-react";
import { useId } from "react";

/* Ilustração "símbolo em volume": as quatro formas do símbolo da Terracap (as mesmas curvas do
   simbolo.svg) apoiadas numa placa branca, a cruz entre elas, em alturas escalonadas e vistas em
   perspectiva isométrica. Feita à mão em SVG (sem imagem externa); decorativa. */

// Curvas do símbolo, em coordenadas do próprio simbolo.svg (131 × 153).
const PIECES = [
  // [caminho, cor do topo, cor da lateral, elevação em px acima da placa]. Ordem: de trás para a frente.
  { d: "M22 10.7H55.7C60.4 24.7 63.9 39.5 65.2 56.2C49 60.9 30.3 64 11.3 64.8V21.2A10.7 10.5 0 0 1 22 10.7Z", top: "#f6c752", side: "#b48a10", lift: 46 },
  { d: "M75.8 10.7H109.5A10.7 10.5 0 0 1 120.2 21.2V30.9C109.1 38 96.9 44.4 83.7 49.7C82.5 35.6 79.5 22.5 75.8 10.7Z", top: "#3f8ad0", side: "#12487c", lift: 32 },
  { d: "M11.3 85.5C29 85.2 46 83 62.8 78.8C58.2 103.1 47.1 124.8 32 143.8H22A10.7 10.5 0 0 1 11.3 133.3Z", top: "#19a862", side: "#00632f", lift: 20 },
  { d: "M120.2 52.1V133.3A10.7 10.5 0 0 1 109.5 143.8H53.3C71.6 121.7 80 97.2 82.9 72.4C96.6 66.8 109.2 59.9 120.2 52.1Z", top: "#0e9a55", side: "#00532a", lift: 8 },
];
const SLAB = { x: 3.3, y: 2.7, w: 124.9, h: 149.1, r: 17 };
const SLAB_H = 10; // espessura da placa, em px de tela
const PIECE_H = 14;

const S = 1.9; // escala do símbolo
const COS = Math.cos(Math.PI / 6);
const CX = 290; // onde o centro do símbolo cai no quadro
const CY = 262;
const MID = [65.7, 77.4];
const MATRIX = [COS * S, 0.5 * S, -COS * S, 0.5 * S] as const;
const E = CX - (MATRIX[0] * MID[0] + MATRIX[2] * MID[1]);
const F = CY - (MATRIX[1] * MID[0] + MATRIX[3] * MID[1]);

// Subir n px na tela = andar -n/S nos dois eixos do símbolo (a projeção mapeia essa diagonal para "cima").
const up = (n: number) => `translate(${(-n / S).toFixed(3)} ${(-n / S).toFixed(3)})`;
const slabPath = `M${SLAB.x + SLAB.r} ${SLAB.y}H${SLAB.x + SLAB.w - SLAB.r}A${SLAB.r} ${SLAB.r} 0 0 1 ${SLAB.x + SLAB.w} ${SLAB.y + SLAB.r}V${SLAB.y + SLAB.h - SLAB.r}A${SLAB.r} ${SLAB.r} 0 0 1 ${SLAB.x + SLAB.w - SLAB.r} ${SLAB.y + SLAB.h}H${SLAB.x + SLAB.r}A${SLAB.r} ${SLAB.r} 0 0 1 ${SLAB.x} ${SLAB.y + SLAB.h - SLAB.r}V${SLAB.y + SLAB.r}A${SLAB.r} ${SLAB.r} 0 0 1 ${SLAB.x + SLAB.r} ${SLAB.y}Z`;

/** Extrusão: a mesma forma repetida de 1 em 1 px de altura (lateral), com a face de cima por último. */
function Solid({ d, from, height, top, side, edge = true }: { d: string; from: number; height: number; top: string; side: string; edge?: boolean }) {
  return (
    <>
      {Array.from({ length: height }, (_, i) => (
        <path key={i} d={d} fill={side} transform={up(from + i)} />
      ))}
      <path d={d} fill={top} transform={up(from + height)} stroke={edge ? "rgba(0,20,10,0.22)" : "none"} strokeWidth={0.45} strokeLinejoin="round" />
    </>
  );
}

/** `onLight`: versão para fundo claro (menu lateral). Decorativa: some para leitores de tela. */
export function Skyline({ onLight = false, chips = true }: { onLight?: boolean; chips?: boolean }) {
  const uid = useId().replace(/:/g, "");
  // No menu lateral fica só o símbolo (sem sol nem arcos), enquadrado na placa, nas peças e na sombra.
  const viewBox = onLight ? "45 60 490 390" : "0 0 600 420";
  return (
    <div className={`sk ${onLight ? "on-light" : ""}`} aria-hidden="true">
      <div className="sk-stage">
        {!onLight && (
        <svg className="sk-layer sk-sky" viewBox={viewBox} focusable="false">
          <defs>
            <radialGradient id={`sun-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe79a" />
              <stop offset="100%" stopColor="#c9a10d" />
            </radialGradient>
          </defs>
          <g className="sk-arcs">
            <circle cx="470" cy="96" r="84" />
            <circle cx="470" cy="96" r="128" strokeDasharray="3 9" />
            <circle cx="470" cy="96" r="178" />
          </g>
          <circle className="sk-sun" cx="470" cy="96" r="44" fill={`url(#sun-${uid})`} />
        </svg>
        )}
        <svg className="sk-layer sk-city" viewBox={viewBox} focusable="false">
          <defs>
            <filter id={`blur-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
          </defs>
          <g transform={`matrix(${MATRIX.join(" ")} ${E.toFixed(2)} ${F.toFixed(2)})`}>
            <g className="sk-block" style={{ ["--i" as string]: 0 }}>
              <Solid d={slabPath} from={0} height={SLAB_H} top="#f7f9f6" side="#c3cdc7" edge={false} />
            </g>
            {PIECES.map((p, i) => (
              <g key={i} className="sk-block" style={{ ["--i" as string]: i + 1 }}>
                {/* sombra da peça sobre a placa */}
                <path d={p.d} fill="rgba(0,35,20,0.32)" transform={`${up(SLAB_H)} translate(5 3)`} filter={`url(#blur-${uid})`} />
                <Solid d={p.d} from={SLAB_H + p.lift} height={PIECE_H} top={p.top} side={p.side} />
              </g>
            ))}
          </g>
        </svg>
        {chips && (
          <div className="sk-layer sk-chips">
            <span className="sk-chip c1"><Layers size={14} /> Planejar</span>
            <span className="sk-chip c2"><CalendarCheck size={14} /> Executar</span>
            <span className="sk-chip c3"><Flag size={14} /> Entregar</span>
          </div>
        )}
      </div>
    </div>
  );
}
