'use client';

import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { saleFeeSentence, saleHoldSentence, storeActionReasons, withdrawalSentence } from '@/lib/storeSummary';
import type { Store } from '@/types/api';
import Badge from './ui/Badge';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Menu, { type MenuEntry } from './ui/Menu';
import Panel from './ui/Panel';
import styles from './StoreCard.module.css';

interface Props {
  store: Store;
  // Loja com uma ação em andamento (desabilita Editar e o menu).
  busy: boolean;
  onEdit: (store: Store) => void;
  onToggleActive: (store: Store) => void;
  onMakePrimary: (store: Store) => void;
  // Escolhe esta loja como a loja Steam do app, ou limpa a escolha se ela já é (10.4, D363).
  onToggleSteam: (store: Store) => void;
  onDelete: (store: Store) => void;
}

// Um cartão por loja (12.8): nome com os selos, as taxas numa frase e as ações. "Editar" em destaque; o resto no menu "Mais ações", com o
// motivo visível quando uma ação está indisponível. Só apresentação: as regras (principal, em uso, inativa) são da API.
export default function StoreCard({ store, busy, onEdit, onToggleActive, onMakePrimary, onToggleSteam, onDelete }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const tr = { t: t as (key: string, params?: Record<string, string | number>) => string, tPlural, locale };
  const reasons = storeActionReasons(store);
  const reasonText = (key: string | null): string | undefined => (key === null ? undefined : (t as (k: string) => string)(key));

  const fee = saleFeeSentence(store, tr);
  const items: MenuEntry[] = [
    {
      id: 'toggleActive',
      label: store.isActive ? t('storesTable.actions.deactivate') : t('storesTable.actions.activate'),
      onSelect: () => onToggleActive(store),
      disabled: reasons.toggleActive !== null,
      disabledReason: reasonText(reasons.toggleActive),
    },
    {
      id: 'makePrimary',
      label: t('storesTable.actions.makePrimary'),
      onSelect: () => onMakePrimary(store),
      disabled: reasons.makePrimary !== null,
      disabledReason: reasonText(reasons.makePrimary),
    },
    { id: 'toggleSteam', label: store.isSteamStore ? t('stores.steamClear') : t('stores.steamSet'), onSelect: () => onToggleSteam(store) },
    { type: 'separator' },
    {
      id: 'delete',
      label: t('storesTable.actions.delete'),
      tone: 'danger',
      onSelect: () => onDelete(store),
      disabled: reasons.delete !== null,
      disabledReason: reasonText(reasons.delete),
    },
  ];

  return (
    <Panel
      as="div"
      title={store.name}
      headingLevel={2}
      className={`${styles.card} ${store.isActive ? '' : styles.inactive}`}
      hint={
        <span className={styles.badges}>
          <Badge tone="neutral">{store.currency}</Badge>
          {store.isPrimary && <Badge tone="info">{t('storesTable.primary')}</Badge>}
          {!store.sellsHere && <Badge tone="neutral">{t('stores.card.buyOnlyBadge')}</Badge>}
          {store.isSteamStore && <Badge tone="info">{t('stores.steamBadge')}</Badge>}
          <Badge tone={store.isActive ? 'profit' : 'neutral'} icon={store.isActive ? 'circleCheck' : undefined}>
            {store.isActive ? t('storesTable.active') : t('storesTable.inactive')}
          </Badge>
        </span>
      }
      actions={
        <>
          <Button size="sm" disabled={busy} onClick={() => onEdit(store)}>
            {t('storesTable.actions.edit')}
          </Button>
          <Menu
            items={items}
            trigger={<IconButton icon="more" label={t('stores.card.moreActionsFor', { name: store.name })} disabled={busy} data-store-menu="" />}
          />
        </>
      }
    >
      <dl className={styles.facts}>
        {(fee !== null || store.sellsHere) && (
          <div className={styles.fact}>
            <dt>{t('storesTable.columns.saleFee')}</dt>
            <dd className={fee === null ? styles.warn : undefined}>{fee ?? t('storesTable.feesNotConfigured')}</dd>
          </div>
        )}
        {fee !== null && (
          <div className={styles.fact}>
            <dt>{t('storesTable.columns.rounding')}</dt>
            <dd>{(t as (key: string) => string)(`storeForm.rounding.${store.saleFeeRounding}`)}</dd>
          </div>
        )}
        <div className={styles.fact}>
          <dt>{t('storesTable.columns.saleHold')}</dt>
          <dd>{saleHoldSentence(store, tr)}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t('storesTable.columns.withdrawal')}</dt>
          <dd>{withdrawalSentence(store, tr)}</dd>
        </div>
      </dl>
    </Panel>
  );
}
