'use client';

import type { ReactNode } from 'react';
import { useT, useTPlural } from '@/i18n/I18nProvider';
import type { AgingBucket, TurnaroundBucket } from '@/types/api';
import { boundaryPercents, pinPercent, ruleSegments, saleRuleBucket, type RuleBucket, type TurnoverLimits } from '@/lib/turnoverRule';
import { HoldingBadge } from './Badge';
import styles from './TurnoverRule.module.css';

export type { TurnoverLimits };

export type TurnoverRuleProps =
  | {
      kind: 'item';
      // Faixa do item, vinda do backend (`agingBucket`). A régua NUNCA a recalcula: só posiciona o pino.
      bucket: AgingBucket;
      daysForSale: number | null;
      // Vêm de GET /api/settings, nunca do .env.
      limits: TurnoverLimits;
      // "6 d" (texto pronto), para o trade lock.
      tradeLockText?: string;
      // Há quanto tempo está no holding (texto pronto).
      offSaleSinceText?: string;
      size?: 'sm' | 'md';
      className?: string;
    }
  // Venda (12.7a): o tempo até vender na mesma régua. A faixa (`bucket`) vem do backend; `days` = `turnaroundDays` (nulo = sem giro).
  | { kind: 'sale'; bucket: TurnaroundBucket; days: number | null; limits: TurnoverLimits; size?: 'sm' | 'md'; className?: string }
  // Só as faixas, com os números dos limites (a barra das faixas de giro da tela de configurações, 12.8).
  | { kind: 'scale'; limits: TurnoverLimits; size?: 'sm' | 'md'; className?: string };

const RULE_BUCKETS: readonly AgingBucket[] = ['RECENTE', 'EM_GIRO', 'AGARRADO'];

function Track({ limits, children }: { limits: TurnoverLimits; children?: ReactNode }) {
  const [a, b, c] = ruleSegments(limits);
  return (
    <div className={styles.track} style={{ gridTemplateColumns: `${a}fr ${b}fr ${c}fr` }} aria-hidden="true">
      <i className={styles.fast} />
      <i className={styles.moving} />
      <i className={styles.stuck} />
      {children}
    </div>
  );
}

// Régua das vendas: pino na faixa do bucket e, abaixo, "12 d após liberar · Giro rápido" (forma curta: "12 d · Giro rápido").
function SaleRule({ bucket, days, limits, size = 'md', className }: Extract<TurnoverRuleProps, { kind: 'sale' }>) {
  const t = useT();
  const tPlural = useTPlural();
  const ruleBucket = saleRuleBucket(bucket);
  if (ruleBucket === null || days === null || !Number.isFinite(days)) return null;
  const name = t(`enums.turnaroundBucket.${bucket}` as 'enums.turnaroundBucket.GIRO_RAPIDO');
  return (
    <div className={`${styles.rule} ${bucket === 'DEMOROU_VENDER' ? styles.isStuck : ''} ${size === 'sm' ? styles.small : ''} ${className ?? ''}`} data-bucket={bucket}>
      <Track limits={limits}>
        <span className={styles.pin} style={{ left: `${pinPercent({ days, bucket: ruleBucket, limits })}%` }} />
      </Track>
      <div className={styles.lab}>
        <span className={styles.full}>
          <b className={styles.strong}>{tPlural('ui.turnover.daysAfterRelease', days)}</b>
          <span className={styles.name}>{name}</span>
        </span>
        <span className={styles.short}>
          <b className={styles.strong}>{tPlural('ui.turnover.daysShort', days)}</b>
          <span className={styles.name}> · {name}</span>
        </span>
      </div>
    </div>
  );
}

// A régua de giro (o elemento marcante do protótipo). O trilho é decorativo (aria-hidden): a informação está no texto visível, com o
// nome da faixa (nunca só a cor). Largura do próprio componente: abaixo de 160 px, ou com size="sm", o trilho afina e o rótulo vira
// uma linha só ("26 d · Encalhado").
export default function TurnoverRule(props: TurnoverRuleProps) {
  const t = useT();
  const tPlural = useTPlural();

  if (props.kind === 'scale') {
    const [firstEnd, secondEnd] = boundaryPercents(props.limits);
    return (
      <div className={`${styles.rule} ${styles.scale} ${props.size === 'sm' ? styles.small : ''} ${props.className ?? ''}`}>
        <Track limits={props.limits} />
        <div className={styles.ticks}>
          <span className={styles.tick} style={{ left: `${firstEnd}%` }}>
            {tPlural('ui.turnover.daysShort', props.limits.fastTurnoverDays)}
          </span>
          <span className={styles.tick} style={{ left: `${secondEnd}%` }}>
            {tPlural('ui.turnover.daysShort', props.limits.slowItemDays)}
          </span>
        </div>
      </div>
    );
  }

  if (props.kind === 'sale') return <SaleRule {...props} />;

  const { bucket, daysForSale, limits, tradeLockText, offSaleSinceText, size = 'md', className } = props;
  if (bucket === 'CONSUMIDO') return null;
  if (bucket === 'FORA_DE_VENDA') return <HoldingBadge sinceText={offSaleSinceText} />;

  const sizeClass = size === 'sm' ? styles.small : '';
  const name = t(`enums.agingBucket.${bucket}` as 'enums.agingBucket.RECENTE');

  if (bucket === 'EM_TRADE_LOCK') {
    const text = tradeLockText ? t('ui.turnover.tradeLock', { time: tradeLockText }) : name;
    return (
      <div className={`${styles.rule} ${styles.isLock} ${sizeClass} ${className ?? ''}`} data-bucket={bucket}>
        <Track limits={limits} />
        <div className={styles.lab}>
          <b className={styles.strong}>{text}</b>
        </div>
      </div>
    );
  }

  if (!RULE_BUCKETS.includes(bucket)) return null;
  const hasDays = daysForSale !== null && Number.isFinite(daysForSale);
  const days = hasDays ? (daysForSale as number) : 0;
  return (
    <div className={`${styles.rule} ${bucket === 'AGARRADO' ? styles.isStuck : ''} ${sizeClass} ${className ?? ''}`} data-bucket={bucket}>
      <Track limits={limits}>
        {hasDays && <span className={styles.pin} style={{ left: `${pinPercent({ days, bucket: bucket as RuleBucket, limits })}%` }} />}
      </Track>
      <div className={styles.lab}>
        {hasDays ? (
          <>
            <span className={styles.full}>
              <b className={styles.strong}>{tPlural('ui.turnover.daysForSale', days)}</b>
              <span className={styles.name}>{name}</span>
            </span>
            <span className={styles.short}>
              <b className={styles.strong}>{tPlural('ui.turnover.daysShort', days)}</b>
              <span className={styles.name}> · {name}</span>
            </span>
          </>
        ) : (
          <span className={styles.name}>{name}</span>
        )}
      </div>
    </div>
  );
}

// Legenda do rodapé da tabela: o que cada faixa do trilho significa, com os limites atuais.
export function TurnoverLegend({ limits, className, variant = 'item' }: { limits: TurnoverLimits; className?: string; variant?: 'item' | 'sale' }) {
  const t = useT();
  const tPlural = useTPlural();
  if (variant === 'sale') {
    return (
      <ul className={`${styles.legend} ${className ?? ''}`}>
        <li className={styles.legendItem}>
          <i className={`${styles.swatch} ${styles.fast}`} aria-hidden="true" />
          {tPlural('ui.turnover.legend.fast', limits.fastTurnoverDays)}
        </li>
        <li className={styles.legendItem}>
          <i className={`${styles.swatch} ${styles.moving}`} aria-hidden="true" />
          {t('enums.turnaroundBucket.GIRO_NORMAL')}
        </li>
        <li className={styles.legendItem}>
          <i className={`${styles.swatch} ${styles.stuck}`} aria-hidden="true" />
          {tPlural('ui.turnover.legend.slowSale', limits.slowItemDays)}
        </li>
        <li className={styles.legendItem}>{t('ui.turnover.legend.fromSale')}</li>
      </ul>
    );
  }
  return (
    <ul className={`${styles.legend} ${className ?? ''}`}>
      <li className={styles.legendItem}>
        <i className={`${styles.swatch} ${styles.fast}`} aria-hidden="true" />
        {tPlural('ui.turnover.legend.fast', limits.fastTurnoverDays)}
      </li>
      <li className={styles.legendItem}>
        <i className={`${styles.swatch} ${styles.moving}`} aria-hidden="true" />
        {t('ui.turnover.legend.moving')}
      </li>
      <li className={styles.legendItem}>
        <i className={`${styles.swatch} ${styles.stuck}`} aria-hidden="true" />
        {tPlural('ui.turnover.legend.stuck', limits.slowItemDays)}
      </li>
      <li className={styles.legendItem}>
        <i className={`${styles.swatch} ${styles.lockSwatch}`} aria-hidden="true" />
        {t('ui.turnover.legend.lock')}
      </li>
    </ul>
  );
}
