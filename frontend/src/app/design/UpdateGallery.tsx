'use client';

import { useEffect, useState } from 'react';
import UpdateModal, { isModalHidden, type HiddenMarker } from '@/components/UpdateModal';
import Button from '@/components/ui/Button';
import { useLanguage } from '@/i18n/I18nProvider';
import type { UpdateAction, UpdatePhase, UpdateState } from '@/lib/desktop';
import { Row, Section } from './galleryParts';
import { FX } from './galleryFixtures';

// Guia vivo (12.10, parte 3): o UpdateModal com estados simulados. Nada vai ao processo principal: as ações só trocam a fase
// local, como o desktop faria (baixar -> baixando -> pronto; "agora não" -> fecha).
const NOTES = [
  '<!-- en -->',
  '## What is new',
  '- **New look** across every screen.',
  '- Faster inventory table.',
  '',
  '<!-- pt-BR -->',
  '## Novidades',
  '- **Visual novo** em todas as telas.',
  '- Tabela do inventário mais rápida.',
].join('\n');

const SCENARIOS: { id: string; label: string; phase: UpdatePhase; mode: 'installer' | 'portable'; percent?: number | null; error?: UpdateState['error'] }[] = [
  { id: 'available', label: 'available', phase: 'available', mode: 'installer' },
  { id: 'portable', label: 'portable-available', phase: 'portable-available', mode: 'portable' },
  { id: 'downloading', label: 'downloading (42%)', phase: 'downloading', mode: 'installer', percent: 42 },
  { id: 'downloadingIndeterminate', label: 'downloading (sem %)', phase: 'downloading', mode: 'installer', percent: null },
  { id: 'ready', label: 'ready', phase: 'ready', mode: 'installer' },
  { id: 'installing', label: 'installing', phase: 'installing', mode: 'installer' },
  { id: 'errorDownload', label: 'error (download)', phase: 'error', mode: 'installer', error: { kind: 'download', detail: 'net::ERR_CONNECTION_RESET' } },
  { id: 'errorInstall', label: 'error (install)', phase: 'error', mode: 'installer', error: { kind: 'install', detail: '' } },
];

function stateFor(scenario: (typeof SCENARIOS)[number], seq: number): UpdateState {
  return {
    seq,
    phase: scenario.phase,
    mode: scenario.mode,
    version: '2.0.0',
    currentVersion: '1.4.2',
    notes: NOTES,
    percent: scenario.percent ?? null,
    error: scenario.error ?? null,
  };
}

export function UpdateSection() {
  const language = useLanguage();
  const [state, setState] = useState<UpdateState | null>(null);
  const [hidden, setHidden] = useState<HiddenMarker | null>(null);
  const [seq, setSeq] = useState(1);

  const open = (index: number) => {
    setHidden(null);
    setSeq((n) => n + 1);
    setState(stateFor(SCENARIOS[index], seq + 1));
  };

  // Baixar simula o progresso até o "pronto".
  useEffect(() => {
    if (!state || state.phase !== 'downloading' || state.percent === null || state.percent >= 100) return undefined;
    const timer = setTimeout(() => {
      setState((current) => (current && current.phase === 'downloading' ? { ...current, percent: Math.min(100, (current.percent ?? 0) + 14) } : current));
    }, 450);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (state && state.phase === 'downloading' && state.percent === 100) {
      setState({ ...state, phase: 'ready', percent: null, seq: state.seq + 1 });
    }
  }, [state]);

  const onAction = (action: UpdateAction) => {
    if (!state) return;
    if (action === 'download') setState({ ...state, phase: 'downloading', percent: 0, seq: state.seq + 1 });
    else if (action === 'restart') setState({ ...state, phase: 'installing', seq: state.seq + 1 });
    else setState(null);
  };

  const visible = state !== null && !isModalHidden(hidden, state);
  return (
    <Section title={FX.sections.update}>
      <Row>
        {SCENARIOS.map((scenario, index) => (
          <Button key={scenario.id} onClick={() => open(index)}>
            {scenario.label}
          </Button>
        ))}
        {state && !visible && <Button variant="primary" onClick={() => setHidden(null)}>{FX.labels.reopen}</Button>}
      </Row>
      {state && visible && (
        <UpdateModal
          state={state}
          language={language}
          busy={false}
          onAction={onAction}
          onHide={() => setHidden({ phase: state.phase, seq: state.seq })}
        />
      )}
    </Section>
  );
}
