'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import {
  getUpdateBridge,
  isUpdateResponse,
  isUpdateState,
  type UpdateAction,
  type UpdateBridge,
  type UpdateState,
} from '@/lib/desktop';
import UpdateModal, { isModalHidden, type HiddenMarker } from './UpdateModal';

// Liga o modal de atualização ao processo principal (D188, D194): busca o estado ao montar (o aviso pode ter chegado
// com a janela ainda na tela de carregamento), escuta as mudanças e envia as respostas. O main é o dono do estado;
// aqui só se exibe. Sem a ponte do desktop (navegador, código-fonte), não renderiza nada.
export default function DesktopUpdateHost() {
  const language = useLanguage();
  const bridgeRef = useRef<UpdateBridge | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);
  const [hidden, setHidden] = useState<HiddenMarker | null>(null);
  const [busy, setBusy] = useState(false);

  // Só aceita estado novo ou igual: um evento atrasado nunca desfaz um estado mais recente.
  const accept = useCallback((next: unknown) => {
    if (!isUpdateState(next)) return;
    setState((previous) => (previous && previous.seq > next.seq ? previous : next));
  }, []);

  useEffect(() => {
    const bridge = getUpdateBridge();
    if (!bridge) return undefined;
    bridgeRef.current = bridge;
    let active = true;
    const unsubscribe = bridge.onUpdateState((next) => {
      if (active) accept(next);
    });
    bridge
      .getUpdateState()
      .then((initial) => {
        if (active) accept(initial);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accept]);

  const onAction = useCallback(
    (action: UpdateAction) => {
      const bridge = bridgeRef.current;
      if (!bridge || !state || busy) return;
      setBusy(true);
      bridge
        .respondToUpdate(action, state.seq)
        .then((response) => {
          if (isUpdateResponse(response)) accept(response.state);
        })
        .catch(() => {})
        .finally(() => setBusy(false));
    },
    [state, busy, accept],
  );

  const onHide = useCallback(() => {
    if (state) setHidden({ phase: state.phase, seq: state.seq });
  }, [state]);

  // O "esconder" vale só para a fase em que foi pedido: quando a fase muda, o marcador é descartado
  // (senão um download escondido, que falha e é tentado de novo, faria o segundo download nascer escondido).
  // Ajuste de estado durante a renderização, padrão do React para estado derivado de outro estado.
  const staleHidden = hidden !== null && state !== null && hidden.phase !== state.phase;
  if (staleHidden) setHidden(null);
  const activeHidden = staleHidden ? null : hidden;

  if (!state || state.phase === 'idle' || isModalHidden(activeHidden, state)) return null;
  return <UpdateModal state={state} language={language} busy={busy} onAction={onAction} onHide={onHide} />;
}
