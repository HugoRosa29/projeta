import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Hero } from "../../components/Hero";
import { Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import { periodLabel, type KeyResult, type Objective, type OkrBoard as Board } from "../../domain/okr";
import { api } from "../../services/api";
import { useSession } from "../../app/session";
import { CheckinDialog } from "./CheckinDialog";
import { MyCheckins, streakAfter, useMyOkrs } from "./OkrCards";
import { KeyResultDialog, ObjectiveDialog } from "./OkrEditors";
import { OkrBoard } from "./OkrBoard";

type Editing =
  | { kind: "objective"; objective?: Objective }
  | { kind: "kr"; objectiveId: string; kr?: KeyResult }
  | null;

/**
 * Metas (OKRs). A mesma página tem duas leituras, decididas pela permissão `okr.manage`
 * (que o servidor confere de novo em cada escrita):
 *  - quem gere abre no painel em quadro: indicadores, filtros, um grupo por objetivo e edição;
 *  - quem executa abre nos próprios resultados-chave e vê o mesmo quadro, sem edição, para contexto.
 */
export function OkrPage() {
  const { workspace } = useSession();
  const [period, setPeriod] = useState("");
  const q = useQuery({
    queryKey: ["okrs", "board", workspace.id, period],
    queryFn: () => api.get<Board>("/okrs", { workspace_id: workspace.id, period: period || undefined }),
  });
  const mine = useMyOkrs(workspace.id);
  const [editing, setEditing] = useState<Editing>(null);
  const [queue, setQueue] = useState<KeyResult[] | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (path: string) => api.del(path),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["okrs"] }), toast("Removido")),
    onError: (e) => toast((e as Error).message),
  });

  const d = q.data;
  const manage = d?.can_manage ?? false;
  const openCheckin = (kr: KeyResult, siblings: KeyResult[]) => {
    // Quem abre o próprio KR segue para os outros seus que pedem atualização, na mesma janela.
    const rest = siblings.filter((k) => k.id !== kr.id && k.mine && k.stale && k.can_checkin);
    setQueue([kr, ...(kr.mine ? rest : [])]);
  };

  return (
    <>
      <Hero
        compact
        eyebrow="Metas · OKRs"
        title={manage ? "Painel de OKRs" : "Metas do time"}
        subtitle={d && <>{periodLabel(d.period)}{d.pace != null && ` · ${d.pace}% do trimestre decorrido`}</>}
      >
        {d && (
          <>
            <label className="sr-only" htmlFor="okr-period">Trimestre</label>
            <select id="okr-period" className="select okr-period" value={d.period} onChange={(e) => setPeriod(e.target.value)}>
              {d.periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
          </>
        )}
      </Hero>

      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}

      {/* Quem executa vê primeiro o que é seu; quem gere, só se tiver KR próprio. */}
      {d && <MyCheckins workspaceId={workspace.id} always={!manage} />}

      {d && !d.objectives.length && (
        <Empty
          title="Nenhum objetivo neste trimestre"
          action={manage ? <button className="btn btn-primary" onClick={() => setEditing({ kind: "objective" })}>Criar o primeiro objetivo</button> : undefined}
        >
          {manage
            ? "Comece com 2 a 4 objetivos. Para cada um, 2 a 5 resultados-chave com responsável: são eles que fazem o check-in."
            : "Quando a gestão definir os objetivos do trimestre, eles aparecem aqui."}
        </Empty>
      )}

      {d && d.objectives.length > 0 && (
        <OkrBoard
          d={d}
          onCheckin={openCheckin}
          manage={
            manage
              ? {
                  onNewObjective: () => setEditing({ kind: "objective" }),
                  onEditObjective: (o) => setEditing({ kind: "objective", objective: o }),
                  onDeleteObjective: (o) => confirm(`Remover o objetivo “${o.title}” e seus resultados-chave? O histórico de check-ins também sai.`) && remove.mutate(`/objectives/${o.id}`),
                  onAddKr: (o) => setEditing({ kind: "kr", objectiveId: o.id }),
                  onEditKr: (o, kr) => setEditing({ kind: "kr", objectiveId: o.id, kr }),
                  onDeleteKr: (kr) => confirm(`Remover o resultado-chave “${kr.title}”?`) && remove.mutate(`/key-results/${kr.id}`),
                }
              : undefined
          }
        />
      )}

      {d && <HowItWorks manage={manage} />}

      {editing?.kind === "objective" && d && (
        <ObjectiveDialog workspaceId={workspace.id} period={d.period} periods={d.periods} objective={editing.objective} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === "kr" && <KeyResultDialog workspaceId={workspace.id} objectiveId={editing.objectiveId} kr={editing.kr} onClose={() => setEditing(null)} />}
      {queue && <CheckinDialog queue={queue} streak={mine.data ? streakAfter(mine.data) : 0} onClose={() => setQueue(null)} />}
    </>
  );
}

function HowItWorks({ manage }: { manage: boolean }) {
  return (
    <details className="card okr-how">
      <summary>Como funcionam os OKRs aqui</summary>
      <ul>
        <li><strong>Objetivo</strong>: aonde o time quer chegar no trimestre, em uma frase.</li>
        <li><strong>Resultado-chave</strong>: como saber que chegou. Tem número de partida, meta e um responsável — ou acompanha o progresso de um projeto.</li>
        <li><strong>Check-in</strong>: toda semana o responsável informa o valor atual e a confiança (no caminho, em risco, fora do caminho). Uma nota curta ajuda quem lê.</li>
        <li>O progresso do objetivo é a média dos resultados-chave. A marca na barra mostra quanto do trimestre já passou.</li>
        {manage && <li>Você pode registrar o check-in no lugar do responsável. Quem pode criar e editar OKRs é definido em Configurações → Perfis e permissões.</li>}
      </ul>
    </details>
  );
}
