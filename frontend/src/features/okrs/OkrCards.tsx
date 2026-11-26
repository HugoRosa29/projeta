import { useQuery } from "@tanstack/react-query";
import { Flame, Target } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ErrorBox } from "../../components/ui";
import { CONFIDENCES, CONFIDENCE_LABEL, CONFIDENCE_TONE, mergeSummaries, periodLabel, staleByOwner, type KeyResult, type MyOkrs, type OkrBoard } from "../../domain/okr";
import { api } from "../../services/api";
import { CheckinDialog } from "./CheckinDialog";
import { KrRow, ProgressBar } from "./OkrParts";

export function useMyOkrs(workspaceId: string) {
  return useQuery({ queryKey: ["okrs", "mine", workspaceId], queryFn: () => api.get<MyOkrs>("/okrs/mine", { workspace_id: workspaceId }) });
}

/** Semanas seguidas contando o check-in que está para ser feito agora. */
export function streakAfter(d: MyOkrs): number {
  return d.checkins_this_week > 0 ? d.streak_weeks : d.streak_weeks + 1;
}

/**
 * O que cabe a mim nos OKRs. Pendentes primeiro, com um botão que abre a fila inteira de check-ins.
 * Sem KR meu no trimestre, não ocupa espaço (a não ser em `always`).
 */
export function MyCheckins({ workspaceId, always = false }: { workspaceId: string; always?: boolean }) {
  const q = useMyOkrs(workspaceId);
  const [queue, setQueue] = useState<KeyResult[] | null>(null);
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d || (!d.key_results.length && !always)) return null;
  const pending = d.key_results.filter((k) => k.stale && k.progress < 100);
  const allUpToDate = d.key_results.length > 0 && pending.length === 0;

  return (
    <section className={`card okr-mine ${pending.length ? "has-pending" : ""}`} aria-labelledby="okr-mine-title">
      <div className="card-head">
        <Target size={20} aria-hidden />
        <h2 id="okr-mine-title">Meus resultados-chave</h2>
        {d.streak_weeks > 0 && (
          <span className="badge ok okr-streak" title="Semanas seguidas com check-in">
            <Flame size={14} aria-hidden /> {d.streak_weeks} semana{d.streak_weeks === 1 ? "" : "s"} seguida{d.streak_weeks === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {!d.key_results.length && <p className="muted">Nenhum resultado-chave seu no {periodLabel(d.period)}. Quando alguém te definir como responsável, ele aparece aqui.</p>}
      {pending.length > 0 && (
        <div className="okr-cta">
          <p>
            <strong>{pending.length === 1 ? "1 resultado-chave pede" : `${pending.length} resultados-chave pedem`} atualização.</strong>{" "}
            <span className="muted">Leva menos de um minuto e mantém o time inteiro informado.</span>
          </p>
          <button className="btn btn-primary" onClick={() => setQueue(pending)}>Fazer check-in{pending.length > 1 ? ` (${pending.length})` : ""}</button>
        </div>
      )}
      {allUpToDate && <p className="okr-cheer-line">Tudo em dia nesta semana. Obrigado por manter os números vivos!</p>}
      {d.key_results.length > 0 && (
        <ul className="okr-kr-list">
          {d.key_results.map((k) => <KrRow key={k.id} kr={k} pace={d.pace} onCheckin={(kr) => setQueue([kr])} />)}
        </ul>
      )}
      {queue && <CheckinDialog queue={queue} streak={streakAfter(d)} onClose={() => setQueue(null)} />}
    </section>
  );
}

/**
 * Resumo para quem gere, na home: andamento do trimestre e quem precisa atualizar. Soma os
 * objetivos próprios e os recebidos das unidades abaixo num panorama só; a separação por origem
 * (e o repasse) fica no painel de OKRs.
 */
export function OkrPulse({ workspaceId, suggest = true }: { workspaceId: string; /** Sem objetivos, convida a definir (não no espaço pessoal). */ suggest?: boolean }) {
  const q = useQuery({ queryKey: ["okrs", "board", workspaceId, ""], queryFn: () => api.get<OkrBoard>("/okrs", { workspace_id: workspaceId }) });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return null;
  const objectives = [...d.objectives, ...d.received.objectives];
  const s = mergeSummaries(objectives, d.summary, d.received.summary);
  if (!s.objectives) {
    if (!d.can_manage || !suggest) return null;
    return (
      <section className="card okr-pulse empty-pulse">
        <div className="card-head"><Target size={20} aria-hidden /><h2>OKRs do {periodLabel(d.period)}</h2></div>
        <p className="muted">Ainda não há objetivos neste trimestre. Defina 2 a 4 objetivos com resultados-chave mensuráveis, e cada responsável atualiza o próprio número.</p>
        <Link to="/metas" className="btn btn-primary">Definir OKRs</Link>
      </section>
    );
  }
  const stale = staleByOwner(objectives);
  return (
    <section className="card okr-pulse" aria-labelledby="okr-pulse-title">
      <div className="card-head">
        <Target size={20} aria-hidden />
        <h2 id="okr-pulse-title">OKRs do {periodLabel(d.period)}</h2>
        <Link to="/metas" className="btn btn-ghost btn-sm">Abrir painel</Link>
      </div>
      <div className="okr-pulse-grid">
        <div>
          <span className="okr-big">{s.progress}%</span>
          <ProgressBar value={s.progress} pace={d.pace} label="Progresso geral dos OKRs" />
          <p className="muted okr-hint">{d.pace != null ? `${d.pace}% do trimestre já passou.` : ""} {s.objectives} objetivos, {s.key_results} resultados-chave.</p>
        </div>
        <div className="okr-conf-bars" aria-label="Resultados-chave por confiança">
          {CONFIDENCES.map((c) => (
            <div key={c} className={`okr-conf-stat ${CONFIDENCE_TONE[c]}`}>
              <span className="okr-conf-n">{s.confidence[c]}</span>
              <span className="muted">{CONFIDENCE_LABEL[c]}</span>
            </div>
          ))}
        </div>
        <div>
          <p><strong>{s.updated_this_week} de {s.key_results}</strong> <span className="muted">atualizados nos últimos 7 dias</span></p>
          {stale.length > 0 ? (
            <ul className="okr-who">
              {stale.slice(0, 4).map((g) => <li key={g.owner}><span>{g.owner}</span> <span className="badge warn">{g.items.length}</span></li>)}
              {stale.length > 4 && <li className="muted">e mais {stale.length - 4}</li>}
            </ul>
          ) : (
            <p className="okr-cheer-line">Todos em dia.</p>
          )}
        </div>
      </div>
    </section>
  );
}
