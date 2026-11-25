import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, OctagonAlert, PartyPopper, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "../../components/ui";
import {
  CONFIDENCES,
  CONFIDENCE_LABEL,
  CONFIDENCE_TONE,
  cheer,
  fmtValue,
  progressOf,
  type Confidence,
  type KeyResult,
} from "../../domain/okr";
import { api } from "../../services/api";
import { ProgressBar } from "./OkrParts";

const ICON = { on_track: CircleCheck, at_risk: TriangleAlert, off_track: OctagonAlert } as const;

interface Result {
  key_result: KeyResult;
  previous_progress: number;
}

/**
 * Check-in em poucos segundos: valor (já preenchido), confiança em um toque e nota opcional.
 * Com uma fila, ao salvar mostra o avanço e oferece o próximo KR — atualizar tudo vira um fluxo só.
 */
export function CheckinDialog({ queue, streak = 0, onClose }: { queue: KeyResult[]; /** Semanas seguidas contando esta. */ streak?: number; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Result | null>(null);
  const kr = queue[index];
  const next = () => {
    setDone(null);
    if (index + 1 < queue.length) setIndex(index + 1);
    else onClose();
  };
  if (!kr) return null;
  const title = queue.length > 1 ? `Check-in ${index + 1} de ${queue.length}` : "Check-in";
  return (
    <Dialog title={title} onClose={onClose} className="okr-checkin">
      {done ? (
        <Done result={done} streak={streak} hasNext={index + 1 < queue.length} onNext={next} onClose={onClose} />
      ) : (
        <Form key={kr.id} kr={kr} onSaved={setDone} />
      )}
    </Dialog>
  );
}

function Form({ kr, onSaved }: { kr: KeyResult; onSaved: (r: Result) => void }) {
  const qc = useQueryClient();
  const fromProject = kr.kind === "project" && kr.project_id !== null;
  const [value, setValue] = useState(String(kr.current_value));
  const [confidence, setConfidence] = useState<Confidence>(kr.confidence);
  const [note, setNote] = useState("");
  const num = Number(value.replace(",", "."));
  const valid = fromProject || (value.trim() !== "" && Number.isFinite(num));
  const preview = fromProject ? kr.progress : valid ? progressOf(kr.start_value, kr.target_value, num) : kr.progress;
  const delta = preview - kr.progress;
  const lo = Math.min(kr.start_value, kr.target_value);
  const hi = Math.max(kr.start_value, kr.target_value);
  const save = useMutation({
    mutationFn: () => api.post<Result>(`/key-results/${kr.id}/checkins`, { value: fromProject ? null : num, confidence, note }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["okrs"] });
      onSaved(r);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !save.isPending) save.mutate();
  };

  return (
    <form onSubmit={submit} className="okr-form">
      <p className="eyebrow okr-obj">{kr.objective_title}</p>
      <h3 className="okr-kr-title">{kr.title}</h3>

      <div className="okr-preview" aria-live="polite">
        <span className="okr-big">{preview}%</span>
        {delta !== 0 && <span className={`badge ${delta > 0 ? "ok" : "alerta"}`}>{delta > 0 ? "+" : ""}{delta} p.p.</span>}
      </div>
      <ProgressBar value={preview} before={kr.progress} label={`Progresso de ${kr.title}`} />

      {fromProject ? (
        <p className="muted okr-hint">O valor vem do projeto <strong>{kr.project_name ?? "vinculado"}</strong> (tarefas concluídas ou % informado). Basta dizer como está a confiança.</p>
      ) : (
        <div className="field">
          <label htmlFor="ci-value">Valor atual <span className="muted">(partida {fmtValue(kr.start_value, kr.unit)} · meta {fmtValue(kr.target_value, kr.unit)})</span></label>
          <div className="okr-value-row">
            <input
              type="range"
              aria-label="Ajustar valor"
              min={lo}
              max={hi}
              step={hi - lo > 20 ? 1 : (hi - lo) / 100}
              value={Number.isFinite(num) ? Math.max(lo, Math.min(hi, num)) : lo}
              onChange={(e) => setValue(e.target.value)}
            />
            <input id="ci-value" className="input okr-num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />
            {kr.unit && <span className="muted">{kr.unit}</span>}
          </div>
        </div>
      )}

      <fieldset className="field okr-conf">
        <legend className="label">Como você vê este resultado até o fim do trimestre?</legend>
        <div className="okr-conf-row">
          {CONFIDENCES.map((c) => {
            const Icon = ICON[c];
            return (
              <label key={c} className={`okr-conf-opt ${CONFIDENCE_TONE[c]} ${confidence === c ? "on" : ""}`}>
                <input type="radio" name="confidence" value={c} checked={confidence === c} onChange={() => setConfidence(c)} className="sr-only" />
                <Icon size={18} aria-hidden /> {CONFIDENCE_LABEL[c]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="ci-note">Nota <span className="muted">(opcional)</span></label>
        <textarea id="ci-note" className="textarea" rows={2} maxLength={2000} placeholder="O que avançou? Tem algo travando?" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {save.isError && <p className="error-box" role="alert">{(save.error as Error).message}</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={!valid || save.isPending}>{save.isPending ? "Salvando…" : "Registrar check-in"}</button>
      </div>
    </form>
  );
}

function Done({ result, streak, hasNext, onNext, onClose }: { result: Result; streak: number; hasNext: boolean; onNext: () => void; onClose: () => void }) {
  const after = result.key_result.progress;
  const hit = after >= 100 && result.previous_progress < 100;
  // O botão de envio sumiu: o foco vai para a próxima ação, para o teclado seguir no fluxo.
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  return (
    <div className={`okr-done ${hit ? "hit" : ""}`} role="status">
      {hit && <PartyPopper size={40} aria-hidden className="okr-pop" />}
      <p className="okr-big">{after}%</p>
      <ProgressBar value={after} before={result.previous_progress} label="Progresso após o check-in" />
      <p className="okr-cheer">{cheer(result.previous_progress, after, streak)}</p>
      <div className="row" style={{ justifyContent: "center" }}>
        {hasNext ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>Parar por aqui</button>
            <button className="btn btn-primary" onClick={onNext} ref={primary}>Próximo resultado-chave</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onClose} ref={primary}>Concluir</button>
        )}
      </div>
    </div>
  );
}
