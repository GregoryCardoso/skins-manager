'use client';

import { useT, useTLoose } from '@/i18n/I18nProvider';
import type { ImportEntryAction } from '@/types/api';
import EntryChoice from './EntryChoice';
import styles from './WithoutPurchaseSteps.module.css';

interface Props {
  // Ações que valem agora para a pendência (as de `allowedActions`): o passo só aparece quando a ação existe.
  actions: readonly ImportEntryAction[];
  busy: boolean;
  onChoose: (action: ImportEntryAction) => void;
}

const STEPS: readonly { action: ImportEntryAction; textKey: string; tone: 'primary' | 'secondary' }[] = [
  { action: 'CREATE_PURCHASE', textKey: 'imports.steps.bought', tone: 'primary' },
  { action: 'MARK_WON', textKey: 'imports.steps.won', tone: 'secondary' },
  { action: 'IGNORE', textKey: 'imports.steps.skip', tone: 'secondary' },
];

// "Venda sem compra no app" (12.9): o caso comum em passos. 1) Comprou? Lançar compra. 2) Foi drop? Marcar como ganho. 3) Não quer
// lançar? Ignorar. As mesmas ações e chamadas de antes; só a apresentação muda.
export default function WithoutPurchaseSteps({ actions, busy, onChoose }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const steps = STEPS.filter((step) => actions.includes(step.action));
  if (steps.length === 0) return null;
  return (
    <div className={styles.steps} data-testid="without-purchase-steps">
      <p className={styles.title}>{t('imports.steps.title')}</p>
      <ol className={styles.list}>
        {steps.map((step) => (
          <li key={step.action} className={styles.step}>
            <p className={styles.question}>{tLoose(step.textKey)}</p>
            <EntryChoice
              label={tLoose(`imports.actions.${step.action}`)}
              explain={tLoose(`imports.actions.explain.${step.action}`)}
              tone={step.tone}
              disabled={busy}
              onClick={() => onChoose(step.action)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
