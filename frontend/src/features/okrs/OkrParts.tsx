import { useQuery } from "@tanstack/react-query";
import { Clock, FolderKanban, History, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Dialog, ErrorBox, Loading } from "../../components/ui";
import {
  CONFIDENCE_BADGE,
  CONFIDENCE_LABEL,
  fmtValue,
  since,
  type CheckIn,
  type Confidence,
  type KeyResult,
} from "../../domain/okr";
import { api } from "../../services/api";

/** Barra de progresso com o ponto anterior (o que avançou fica destacado) e a marca do ritmo esperado. */
export function ProgressBar({ value, before, pace, label }: { value: number; before?: number; pace?: number | null; label: string }) {
  const gain = before !== undefined && value > before;
  return (
    <div className="okr-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="okr-bar-fill" style={{ width: `${gain ? before : value}%` }} />
      {gain && <span className="okr-bar-gain" style={{ left: `${before}%`, width: `${value - before!}%` }} />}
      {pace != null && <span className="okr-bar-pace" style={{ left: `${pace}%` }} title={`Esperado hoje: ${pace}%`} />}
    </div>
  );
}

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return <span className={`badge ${CONFIDENCE_BADGE[c]}`}>{CONFIDENCE_LABEL[c]}</span>;
}

export function Initials({ name }: { name: string | null }) {
  const ini = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return <span className="okr-avatar" title={name ?? "Sem responsável"} aria-hidden>{ini || "?"}</span>;
}

/** Uma linha de KR. Quem pode registrar vê o botão de check-in; quem gere vê editar e remover. */
export function KrRow({
  kr,
  pace,
  onCheckin,
  onEdit,
  onDelete,
}: {
  kr: KeyResult;
  pace: number | null;
  onCheckin?: (kr: KeyResult) => void;
  onEdit?: (kr: KeyResult) => void;
  onDelete?: (kr: KeyResult) => void;
}) {
  const [history, setHistory] = useState(false);
  return (
    <li className={`okr-kr ${kr.mine ? "mine" : ""}`}>
      <div className="okr-kr-main">
        <Initials name={kr.owner_name} />
        <div className="okr-kr-text">
          <span className="okr-kr-name">{kr.title}</span>
          <span className="okr-kr-meta muted">
            {kr.owner_name ?? "Sem responsável"}
            {" · "}
            {kr.kind === "project" ? (
              kr.project_id ? <Link to={`/projetos/${kr.project_id}`}><FolderKanban size={12} aria-hidden /> {kr.project_name}</Link> : "projeto vinculado"
            ) : (
              <>{fmtValue(kr.current_value, kr.unit)} de {fmtValue(kr.target_value, kr.unit)}</>
            )}
            {" · "}
            <span className={kr.stale && kr.progress < 100 ? "okr-stale" : ""}><Clock size={12} aria-hidden /> {since(kr.last_checkin_at)}</span>
          </span>
        </div>
        <span className="okr-pct">{kr.progress}%</span>
      </div>
      <ProgressBar value={kr.progress} pace={pace} label={`Progresso de ${kr.title}`} />
      <div className="okr-kr-foot">
        <ConfidenceBadge c={kr.confidence} />
        {kr.behind_pace && <span className="badge warn" title="O tempo decorrido passa o progresso em mais de 25 pontos">Ritmo abaixo do previsto</span>}
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => setHistory(true)} aria-label={`Histórico de ${kr.title}`}><History size={16} aria-hidden /></button>
        {onEdit && <button className="btn btn-ghost btn-sm" onClick={() => onEdit(kr)} aria-label={`Editar ${kr.title}`}><Pencil size={16} aria-hidden /></button>}
        {onDelete && <button className="btn btn-ghost btn-sm" onClick={() => onDelete(kr)} aria-label={`Remover ${kr.title}`}><Trash2 size={16} aria-hidden /></button>}
        {onCheckin && kr.can_checkin && (
          <button className={`btn btn-sm ${kr.mine && kr.stale ? "btn-primary" : "btn-line"}`} onClick={() => onCheckin(kr)}>Check-in</button>
        )}
      </div>
      {history && <HistoryDialog kr={kr} onClose={() => setHistory(false)} />}
    </li>
  );
}

export function HistoryDialog({ kr, onClose }: { kr: KeyResult; onClose: () => void }) {
  const q = useQuery({ queryKey: ["okrs", "checkins", kr.id], queryFn: () => api.get<{ checkins: CheckIn[] }>(`/key-results/${kr.id}/checkins`) });
  return (
    <Dialog title={`Histórico: ${kr.title}`} onClose={onClose}>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !q.data.checkins.length && <p className="muted">Nenhum check-in ainda.</p>}
      {q.data && q.data.checkins.length > 0 && (
        <ol className="okr-timeline">
          {q.data.checkins.map((c) => (
            <li key={c.id}>
              <div className="row">
                <strong>{c.progress}%</strong>
                {kr.kind === "number" && <span className="muted">{fmtValue(c.value, kr.unit)}</span>}
                <ConfidenceBadge c={c.confidence} />
                <span className="spacer" />
                <span className="muted">{c.author_name ?? "—"} · {new Date(c.created_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}</span>
              </div>
              {c.note && <p className="okr-note">{c.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
