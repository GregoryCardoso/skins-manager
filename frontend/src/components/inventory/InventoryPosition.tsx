'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import type { InventoryPosition as Position, PositionCost } from '@/types/api';
import Money from '../ui/Money';
import { PositionStrip, StatCard } from '../ui/StatCard';
import styles from './inventory.module.css';

function CostValue({ cost }: { cost: PositionCost }) {
  return (
    <Money
      size="lg"
      cents={cost.costUsdCents}
      currency="USD"
      estimated={cost.costUsesRecordedFx}
      estimatedBadge={false}
      approxCents={cost.approx?.cents ?? null}
      approxCurrency={cost.approx?.currency ?? null}
    />
  );
}

// Faixa de posição do inventário (D370, 12.5b, Q-12.5-2): estoque à venda e no holding (custo), unidades em trade lock e encalhadas.
// Todo o estoque, independente de filtros, busca e abas. Nada é calculado aqui: os números vêm de `meta.position`.
export default function InventoryPosition({ position }: { position: Position }) {
  const t = useT();
  const locale = useLocale();
  const { tradeLocked, stagnant } = position;
  return (
    <PositionStrip label={t('inventory.position.label')} className={styles.position}>
      <StatCard label={t('inventory.position.forSale')} value={<CostValue cost={position.forSale} />} help={t('inventory.position.costHelp')} />
      <StatCard label={t('inventory.position.offSale')} value={<CostValue cost={position.offSale} />} help={t('inventory.position.costHelp')} />
      <StatCard
        label={t('inventory.position.tradeLocked')}
        tone={tradeLocked.units > 0 ? 'lock' : 'neutral'}
        value={tradeLocked.units}
        note={tradeLocked.units > 0 && tradeLocked.nextUnlockAt ? t('inventory.position.nextUnlock', { date: formatDate(tradeLocked.nextUnlockAt, locale) }) : undefined}
      />
      <StatCard
        label={t('inventory.position.stagnant')}
        tone={stagnant.units > 0 ? 'stuck' : 'neutral'}
        value={stagnant.units}
        note={stagnant.units > 0 ? t('inventory.position.groups', { count: stagnant.groups }) : undefined}
        help={t('inventory.position.stagnantHint')}
      />
    </PositionStrip>
  );
}
