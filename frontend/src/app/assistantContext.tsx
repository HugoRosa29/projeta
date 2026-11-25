import { createContext, useContext } from "react";

/** Abre o painel do assistente de qualquer tela, opcionalmente com um rascunho no campo de mensagem.
 * O rascunho nunca é enviado sozinho: a pessoa completa e envia, e qualquer alteração ainda passa
 * por proposta e confirmação. Fora do layout (ex.: testes), não faz nada. */
interface Value {
  openAssistant: (draft?: string) => void;
}
export const AssistantContext = createContext<Value>({ openAssistant: () => {} });

export const useAssistant = () => useContext(AssistantContext);
