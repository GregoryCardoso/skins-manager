'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePreferences } from '@/components/PreferencesProvider';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/i18n/I18nProvider';
import {
  CONNECTION_RECHECK_MS,
  checkConnection,
  getConnectionState,
  markDown,
  markUp,
  touchChecked,
  useConnectionStatus,
} from '@/lib/connectionStatus';
import { getHealth } from '@/services/api';
import AppUnavailable from './AppUnavailable';
import styles from './ConnectionGate.module.css';

// Porteiro da conexão (D370, 12.4). Um erro de conexão numa chamada qualquer só dispara a checagem: duas falhas do /api/health, com
// 1,5 s entre elas, para o app ser dado como fora do ar (sem falso alarme com o backend subindo ou uma rota lenta). Fora do ar, mostra
// a tela "O app não está respondendo" no lugar do conteúdo, que continua montado e escondido (diálogos, filtros e rolagem ficam como
// estavam). Confere de novo sozinho a cada 10 s e ao voltar o foco para a janela; ao voltar, recarrega tudo e avisa com um Toast.
export default function ConnectionGate({ children }: { children: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { reloadFxRate } = usePreferences();
  const status = useConnectionStatus();
  const [checking, setChecking] = useState(false);
  const running = useRef(false);

  const verify = useCallback(
    async (twice: boolean) => {
      if (running.current) return;
      running.current = true;
      setChecking(true);
      try {
        const ok = await checkConnection(() => getHealth(), { attempts: twice ? 2 : 1 });
        const wasDown = getConnectionState().phase === 'DOWN';
        if (ok) {
          markUp();
          if (wasDown) {
            // A conexão voltou: tudo é lido de novo (como o "Tentar de novo" do Inventário fazia) e a pessoa é avisada.
            void queryClient.invalidateQueries();
            reloadFxRate();
            toast.show({ tone: 'success', message: t('unavailable.recovered') });
          }
        } else if (wasDown) touchChecked();
        else markDown();
      } finally {
        running.current = false;
        setChecking(false);
      }
    },
    [queryClient, reloadFxRate, toast, t],
  );

  // Um erro de conexão colocou o estado em CHECKING: confere (até duas vezes).
  useEffect(() => {
    if (status.phase === 'CHECKING') void verify(true);
  }, [status.phase, verify]);

  // Fora do ar: nova checagem a cada 10 s e ao voltar o foco para a janela.
  useEffect(() => {
    if (status.phase !== 'DOWN') return undefined;
    const timer = setInterval(() => void verify(false), CONNECTION_RECHECK_MS);
    const onFocus = () => void verify(false);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [status.phase, verify]);

  const down = status.phase === 'DOWN';
  return (
    <>
      {down && <AppUnavailable lastCheckedAt={status.lastCheckedAt} checking={checking} onRecheck={() => void verify(false)} />}
      <div className={styles.content} hidden={down}>
        {children}
      </div>
    </>
  );
}
