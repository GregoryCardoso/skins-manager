'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import BalanceBar from '@/components/ui/BalanceBar';
import Banner from '@/components/ui/Banner';
import Button from '@/components/ui/Button';
import DataTable, { DetailsRow, HiddenColumnsList, type Column, type SortOrder } from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import Equation from '@/components/ui/Equation';
import ErrorState from '@/components/ui/ErrorState';
import Menu from '@/components/ui/Menu';
import Money from '@/components/ui/Money';
import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import { PositionStrip, StatCard } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import TurnoverRule, { TurnoverLegend } from '@/components/ui/TurnoverRule';
import { useT } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import styles from './design.module.css';
import { Row, Section } from './galleryParts';
import { CONVERSION, FX, GALLERY_LIMITS, GALLERY_LIMITS_TIGHT, GALLERY_LIMITS_WIDE, GALLERY_ROWS, L2, type GalleryBucket, type GalleryRow } from './galleryFixtures';

const L = FX.labels;

// Seções da 12.3b (dados e feedback) do guia vivo. Os rótulos do guia vêm de galleryFixtures; os textos DOS componentes, dos dicionários.

export function BannerSection() {
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  return (
    <Section title={FX.sections.banner}>
      <Banner tone="info">{L2.bannerInfo}</Banner>
      <Banner tone="success">{L2.bannerSuccess}</Banner>
      <Banner tone="warning" title={L2.bannerTitle} action={{ label: L2.bannerActionHref, href: '/design' }}>
        {L2.bannerLong}
      </Banner>
      <Banner
        tone="danger"
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          setTimeout(() => setRetrying(false), 1200);
        }}
      >
        {L2.bannerDanger}
      </Banner>
      {!dismissed && (
        <Banner tone="info" title={L2.bannerTitle} action={{ label: L2.bannerAction, onClick: () => {} }} onDismiss={() => setDismissed(true)}>
          {L2.bannerLong}
        </Banner>
      )}
    </Section>
  );
}

export function ToastSection() {
  const toast = useToast();
  return (
    <Section title={FX.sections.toast}>
      <Row>
        <Button onClick={() => toast.show({ tone: 'success', message: L2.toastMsgSuccess })}>{L2.toastSuccess}</Button>
        <Button onClick={() => toast.show({ tone: 'info', message: L2.toastMsgInfo })}>{L2.toastInfo}</Button>
        <Button onClick={() => toast.show({ tone: 'danger', message: L2.toastMsgDanger })}>{L2.toastDanger}</Button>
        <Button onClick={() => toast.show({ tone: 'success', message: L2.toastMsgAction, action: { label: L2.toastUndo, onClick: () => {} } })}>{L2.toastAction}</Button>
      </Row>
    </Section>
  );
}

export function StatesSection() {
  const [retrying, setRetrying] = useState(false);
  return (
    <Section title={FX.sections.states}>
      <EmptyState
        icon="inventory"
        title={L2.emptyTitle}
        description={L2.emptyText}
        action={
          <Button variant="primary" icon="plus">
            {L2.emptyAction}
          </Button>
        }
      />
      <ErrorState
        title={L2.errorTitle}
        message={L2.errorMessage}
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          setTimeout(() => setRetrying(false), 1200);
        }}
      />
      <Row caption={L2.skeletonText}>
        <div className={styles.gWide} aria-busy="true">
          <Skeleton lines={3} />
        </div>
      </Row>
      <Row caption={L2.skeletonBlock}>
        <Skeleton width="8rem" height="2.5rem" radius="md" />
        <Skeleton width="3rem" height="3rem" radius="pill" />
      </Row>
    </Section>
  );
}

export function PanelSection() {
  return (
    <Section title={FX.sections.panel}>
      <PositionStrip label={L2.stripLabel}>
        <StatCard label={L2.inStock} value={<Money cents={184230} approxCents={1000820} approxCurrency={CONVERSION} size="lg" />} help={L2.helpStat} />
        <StatCard label={L2.holding} value={<Money cents={61500} approxCents={334100} approxCurrency={CONVERSION} size="lg" />} />
        <StatCard label={L2.inLock} value={L2.unitsText} tone="lock" note={L2.nextRelease} />
        <StatCard label={L2.stuck} value={L2.unitsText} tone="stuck" note={L2.stuckNote} />
        <StatCard label={L2.eqResult} value={<Money cents={116402} approxCents={632300} approxCurrency={CONVERSION} signed size="lg" />} tone="profit" />
      </PositionStrip>
      <Panel title={L2.panelTitle} hint={L2.panelHint} actions={<Button size="sm" icon="plus">{L2.panelAction}</Button>}>
        <p>{L2.panelBody}</p>
      </Panel>
      <Panel title={L2.eqResult} headingLevel={3}>
        <Equation
          rows={[
            { label: L2.eqPaid, note: L2.eqPaidNote, value: <Money cents={312000} approxCents={1695000} approxCurrency={CONVERSION} size="md" layout="inline" align="end" /> },
            { op: '+', label: L2.eqBalance, note: L2.eqBalanceNote, value: <Money cents={148672} approxCents={807700} approxCurrency={CONVERSION} size="md" layout="inline" align="end" /> },
            { op: '+', label: L2.eqStock, note: L2.eqStockNote, value: <Money cents={245730} approxCents={1334900} approxCurrency={CONVERSION} size="md" layout="inline" align="end" /> },
            { op: '−', label: L2.eqDeposited, note: L2.eqDepositedNote, value: <Money cents={590000} approxCents={3205300} approxCurrency={CONVERSION} size="md" layout="inline" align="end" /> },
            { op: '=', label: L2.eqResult, variant: 'result', value: <Money cents={116402} approxCents={632300} approxCurrency={CONVERSION} estimated signed size="xl" align="end" /> },
            { label: L2.eqFee, variant: 'sub', value: <Money cents={-2400} size="sm" signed /> },
          ]}
        />
      </Panel>
    </Section>
  );
}

export function MoneySection() {
  return (
    <Section title={FX.sections.money}>
      <Row caption={L2.moneySizes}>
        {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <Money key={size} cents={184230} approxCents={1000820} approxCurrency={CONVERSION} size={size} />
        ))}
      </Row>
      <Row caption={L2.moneyUsd}>
        <Money cents={4415} approxCents={23986} approxCurrency={CONVERSION} />
        <Money cents={4415} approxCents={23986} approxCurrency={CONVERSION} layout="inline" />
        <Money cents={4415} approxCents={23986} approxCurrency="EUR" />
      </Row>
      <Row caption={L2.moneyEstimated}>
        <Money cents={123456} estimated approxCents={670000} approxCurrency={CONVERSION} />
        <Money cents={123456} estimated estimatedBadge={false} />
      </Row>
      <Row caption={L2.moneyJpy}>
        <Money cents={150000} currency="JPY" approxCents={1000} approxCurrency="USD" />
        <Money cents={1200000} currency="KRW" />
      </Row>
      <Row caption={L2.moneyNegative}>
        <Money cents={116402} signed size="lg" />
        <Money cents={-34000} signed size="lg" />
        <Money cents={0} signed size="lg" />
      </Row>
      <Row caption={L2.moneyUnavailable}>
        <Money cents={null} />
      </Row>
      <Row caption={L2.moneyStale}>
        <Money cents={4415} approxCents={23986} approxCurrency={CONVERSION} staleRateNote={L2.staleNote} />
        <Money cents={4415} approxCents={23986} approxCurrency={CONVERSION} staleRateNote={L2.staleNote} layout="inline" />
      </Row>
    </Section>
  );
}

export function TurnoverSection() {
  const buckets: GalleryBucket[] = ['RECENTE', 'EM_GIRO', 'AGARRADO', 'EM_TRADE_LOCK', 'FORA_DE_VENDA', 'CONSUMIDO'];
  const days: Record<GalleryBucket, number | null> = { RECENTE: 4, EM_GIRO: 13, AGARRADO: 26, EM_TRADE_LOCK: null, FORA_DE_VENDA: null, CONSUMIDO: null };
  return (
    <Section title={FX.sections.turnover}>
      <div className={styles.gGrid}>
        {buckets.map((bucket) => (
          <div key={bucket} className={styles.gCell}>
            <code className={styles.gCaption}>{bucket}</code>
            <TurnoverRule kind="item" bucket={bucket} daysForSale={days[bucket]} limits={GALLERY_LIMITS} tradeLockText="6 d" offSaleSinceText="12 d" />
          </div>
        ))}
      </div>
      <Row caption={L2.ruleSm}>
        <TurnoverRule kind="item" bucket="AGARRADO" daysForSale={31} limits={GALLERY_LIMITS} size="sm" />
        <TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={13} limits={GALLERY_LIMITS} size="sm" />
        <TurnoverRule kind="item" bucket="EM_TRADE_LOCK" daysForSale={null} limits={GALLERY_LIMITS} tradeLockText="6 d" size="sm" />
      </Row>
      <Row caption={L2.ruleNarrow}>
        <div className={styles.gNarrow}>
          <TurnoverRule kind="item" bucket="AGARRADO" daysForSale={26} limits={GALLERY_LIMITS} />
        </div>
      </Row>
      <Row caption={`${L2.ruleExtreme} 1 / 365`}>
        <TurnoverRule kind="item" bucket="RECENTE" daysForSale={1} limits={GALLERY_LIMITS_WIDE} />
        <TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={120} limits={GALLERY_LIMITS_WIDE} />
        <TurnoverRule kind="item" bucket="AGARRADO" daysForSale={400} limits={GALLERY_LIMITS_WIDE} />
      </Row>
      <Row caption={`${L2.ruleExtreme} 20 / 21`}>
        <TurnoverRule kind="item" bucket="RECENTE" daysForSale={15} limits={GALLERY_LIMITS_TIGHT} />
        <TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={21} limits={GALLERY_LIMITS_TIGHT} />
        <TurnoverRule kind="item" bucket="AGARRADO" daysForSale={30} limits={GALLERY_LIMITS_TIGHT} />
      </Row>
      <Row caption={L2.ruleScale}>
        <div className={styles.gWide}>
          <TurnoverRule kind="scale" limits={GALLERY_LIMITS} />
        </div>
        <div className={styles.gWide}>
          <TurnoverRule kind="scale" limits={GALLERY_LIMITS_WIDE} />
        </div>
      </Row>
      <TurnoverLegend limits={GALLERY_LIMITS} />
    </Section>
  );
}

export function BalanceSection() {
  const stores = [
    { name: 'CSFloat', currency: 'USD', available: 62, pending: 18, availableText: 'US$ 842.10', pendingText: 'US$ 190.00' },
    { name: 'Steam', currency: 'BRL', available: 35, pending: 0, availableText: formatMoney(192040, 'BRL', 'pt-BR'), pendingText: formatMoney(0, 'BRL', 'pt-BR') },
    { name: 'CS.MONEY', currency: 'USD', available: 16, pending: 9, availableText: 'US$ 291.12', pendingText: 'US$ 98.00' },
    { name: L2.balanceEmpty, currency: 'USD', available: 0, pending: 0, availableText: 'US$ 0.00', pendingText: 'US$ 0.00' },
  ];
  return (
    <Section title={FX.sections.balance}>
      <div className={styles.gStack}>
        {stores.map((store) => (
          <div key={store.name} className={styles.gStore}>
            <span className={styles.gStoreName}>
              {store.name} <Badge tone="neutral">{store.currency}</Badge>
            </span>
            <span>{store.availableText}</span>
            <BalanceBar
              availableCents={store.available}
              pendingCents={store.pending}
              scaleMaxCents={100}
              availableText={store.availableText}
              pendingText={store.pendingText}
              className={styles.gStoreBar}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function TableSection() {
  const t = useT();
  const [sort, setSort] = useState<{ columnId: string; order: SortOrder } | null>({ columnId: 'turn', order: 'desc' });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['ak']));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['kara']));

  const columns: Column<GalleryRow>[] = [
    {
      id: 'name',
      header: L2.colItem,
      minWidth: '10rem',
      sortable: true,
      cell: (row) => (
        <div className={styles.gItemCell}>
          <span className={styles.gName}>{row.name}</span>
          <span className={styles.note}>{row.meta}</span>
        </div>
      ),
    },
    { id: 'qty', header: L2.colQty, align: 'end', sortable: true, cell: (row) => <strong>{row.qty}</strong> },
    { id: 'cost', header: L2.colCost, align: 'end', priority: 2, sortable: true, firstOrder: 'desc', cell: (row) => <Money cents={row.costCents} size="sm" align="end" /> },
    { id: 'min', header: L2.colMin, align: 'end', cell: (row) => <Money cents={row.minCents} approxCents={row.approxMinCents} approxCurrency={CONVERSION} size="sm" align="end" /> },
    {
      id: 'turn',
      header: L2.colTurnover,
      width: '12rem',
      sortable: true,
      cell: (row) => <TurnoverRule kind="item" bucket={row.bucket} daysForSale={row.days} limits={GALLERY_LIMITS} tradeLockText="6 d" offSaleSinceText="12 d" />,
    },
    { id: 'store', header: L2.colStore, priority: 3, cell: (row) => row.store },
    {
      id: 'actions',
      header: L2.colActions,
      hideHeader: true,
      align: 'end',
      cell: (row) => (
        <div className={styles.gActions}>
          <Button size="sm" variant="primary" disabled={row.bucket === 'EM_TRADE_LOCK'}>
            {L2.sellAction}
          </Button>
          <Menu
            items={[
              { id: 'edit', label: L.edit, icon: 'settings', onSelect: () => {} },
              { id: 'hold', label: L.moveToHolding, icon: 'inventory', onSelect: () => {} },
            ]}
          />
        </div>
      ),
    },
  ];

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Section title={FX.sections.table}>
      <Row caption={`${L2.tableExpanded} · ${L2.tableTone} · ${L2.legendNote} · ${L2.sortedBy}: ${sort?.columnId ?? '-'} ${sort?.order ?? ''}`}>
        <div className={styles.gWide}>
          <DataTable
            caption={L2.tableCaption}
            columns={columns}
            rows={GALLERY_ROWS}
            getRowId={(row) => row.id}
            sort={sort}
            onSortChange={(columnId, order) => setSort({ columnId, order })}
            rowTone={(row) => (row.bucket === 'AGARRADO' ? 'stuck' : row.bucket === 'EM_TRADE_LOCK' ? 'lock' : undefined)}
            expandable={{
              canExpand: (row) => row.id === 'ak',
              isExpanded: (id) => open.has(id),
              onToggle: toggle,
              rowLabel: (row) => row.name,
              renderExpanded: (row, hiddenColumns, ctx) => (
                <>
                  {hiddenColumns.length > 0 && (
                    <DetailsRow colSpan={ctx.colSpan}>
                      <HiddenColumnsList row={row} columns={hiddenColumns} />
                    </DetailsRow>
                  )}
                  {row.id === 'ak' && (
                    <>
                      <DetailsRow colSpan={ctx.colSpan}>{L2.unitFloat}</DetailsRow>
                      <DetailsRow colSpan={ctx.colSpan}>{L2.unitFloat2}</DetailsRow>
                    </>
                  )}
                </>
              ),
            }}
            footer={<TurnoverLegend limits={GALLERY_LIMITS} />}
          />
        </div>
      </Row>
      <Row caption={`${L2.tableSelect} · ${L2.tableComfortable}`}>
        <div className={styles.gWide}>
          <DataTable
            caption={L2.tableCaption}
            density="comfortable"
            columns={columns}
            rows={GALLERY_ROWS.slice(0, 3)}
            getRowId={(row) => row.id}
            selection={{ selectedIds: selected, onChange: (ids) => setSelected(ids), rowLabel: (row) => row.name }}
            rowLabel={(row) => row.name}
          />
        </div>
      </Row>
      <Row caption={L2.tableLoading}>
        <div className={styles.gWide}>
          <DataTable caption={L2.tableCaption} columns={columns} rows={[]} getRowId={(row) => row.id} loading />
        </div>
      </Row>
      <Row caption={L2.tableEmpty}>
        <div className={styles.gWide}>
          <DataTable caption={L2.tableCaption} columns={columns} rows={[]} getRowId={(row) => row.id} empty={<EmptyState icon="search" title={L2.tableEmptyText} />} />
        </div>
      </Row>
      <p className={styles.note}>
        {t('ui.table.selectAll')} · {t('ui.table.selectRow', { name: GALLERY_ROWS[0].name })}
      </p>
    </Section>
  );
}
