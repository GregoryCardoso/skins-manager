'use client';

import { useEffect, useState } from 'react';
import Badge, { HoldingBadge, StuckBadge, TradeLockBadge, type BadgeTone } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import Chip from '@/components/ui/Chip';
import Combobox from '@/components/ui/Combobox';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Dialog from '@/components/ui/Dialog';
import Disclosure from '@/components/ui/Disclosure';
import FormErrorSummary from '@/components/ui/FormErrorSummary';
import HelpTip from '@/components/ui/HelpTip';
import IconButton from '@/components/ui/IconButton';
import Menu from '@/components/ui/Menu';
import NumberField from '@/components/ui/NumberField';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import Switch from '@/components/ui/Switch';
import Tabs, { TabPanel } from '@/components/ui/Tabs';
import TextField from '@/components/ui/TextField';
import Tooltip from '@/components/ui/Tooltip';
import { CURRENCY_GROUP_IDS, CURRENCY_PINNED, currencyComboboxOptions, type CurrencyCode } from '@/lib/currencies';
import { StaticI18nProvider, useLocale, useT } from '@/i18n/I18nProvider';
import { loadDictionary, type Dictionary } from '@/i18n/dictionaries';
import type { Language } from '@/types/api';
import styles from './design.module.css';
import { BalanceSection, BannerSection, MoneySection, PanelSection, StatesSection, TableSection, ToastSection, TurnoverSection } from './GallerySectionsData';
import { Row, Section } from './galleryParts';
import { CATALOG_OPTIONS, FX, GALLERY_LANGUAGES, STORE_OPTIONS, THEME_OPTIONS, type GalleryLanguage } from './galleryFixtures';

const L = FX.labels;
const BADGE_TONES: { tone: BadgeTone; text: string }[] = [
  { tone: 'neutral', text: L.badgeNeutral },
  { tone: 'profit', text: L.badgeProfit },
  { tone: 'loss', text: L.badgeLoss },
  { tone: 'estimated', text: L.badgeEstimated },
  { tone: 'pending', text: L.badgePending },
  { tone: 'info', text: L.badgeInfo },
];

function ButtonsSection() {
  const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
  const sizes = ['sm', 'md', 'lg'] as const;
  return (
    <Section title={FX.sections.buttons}>
      {variants.map((variant) => (
        <Row key={variant} caption={variant}>
          {sizes.map((size) => (
            <Button key={size} variant={variant} size={size} icon="plus">
              {L.save}
            </Button>
          ))}
          <Button variant={variant} data-demo-state="hover">{FX.states.hover}</Button>
          <Button variant={variant} data-demo-state="focus">{FX.states.focus}</Button>
          <Button variant={variant} disabled>{FX.states.disabled}</Button>
          <Button variant={variant} loading>{FX.states.loading}</Button>
        </Row>
      ))}
      <Row caption="iconOnlyBelow=narrow (< 1100) / compact (< 900)">
        <Button icon="refresh" iconOnlyBelow="narrow">{L.refresh}</Button>
        <Button icon="plus" iconOnlyBelow="compact" variant="primary">{L.add}</Button>
        <Button icon="refresh" iconPosition="end">{L.reload}</Button>
      </Row>
      <Row caption="texto longo e fullWidth">
        <Button>{L.longButton}</Button>
        <Button fullWidth variant="primary">{L.save}</Button>
      </Row>
    </Section>
  );
}

function IconsSection() {
  return (
    <Section title={FX.sections.iconButtons}>
      <Row caption="IconButton">
        <IconButton icon="refresh" label={L.refresh} />
        <IconButton icon="refresh" label={L.refresh} variant="secondary" />
        <IconButton icon="close" label={L.delete} variant="danger" />
        <IconButton icon="lock" label={L.lock} pressed />
        <IconButton icon="refresh" label={L.refresh} size="sm" />
        <IconButton icon="refresh" label={L.refresh} data-demo-state="hover" />
        <IconButton icon="refresh" label={L.refresh} data-demo-state="focus" />
        <IconButton icon="refresh" label={L.refresh} disabled />
        <IconButton icon="refresh" label={L.refresh} loading />
      </Row>
      <Row caption="Tooltip / HelpTip / Spinner">
        <Tooltip content={L.refresh}>
          <Button icon="refresh">{L.reload}</Button>
        </Tooltip>
        <HelpTip topic={L.helpTopic}>{L.helpText}</HelpTip>
        <Spinner />
        <Spinner size="sm" label={L.spinnerLabel} />
      </Row>
    </Section>
  );
}

function FieldsSection() {
  const t = useT();
  const [name, setName] = useState('');
  const [brl, setBrl] = useState('1.234,56');
  const [jpy, setJpy] = useState('15,5');
  const [rate, setRate] = useState('1,250');
  const [float, setFloat] = useState('0.0712');
  const [seed, setSeed] = useState('');
  const [theme, setTheme] = useState('system');
  const [store, setStore] = useState('');
  return (
    <Section title={FX.sections.fields}>
      <div className={styles.gGrid}>
        <TextField label={L.search} type="search" leadingIcon="search" value={name} onChange={setName} />
        <TextField label={L.withHint} value={name} onChange={setName} hint={L.hint} />
        <TextField label={L.requiredField} value="" onChange={() => {}} required error={L.errorText} name="required" />
        <TextField label={L.optionalField} value="" onChange={() => {}} optional />
        <TextField label={FX.states.disabled} value="—" onChange={() => {}} disabled />
        <TextField label={L.name} value={name} onChange={setName} maxLength={40} trailing={<IconButton icon="close" label={t('common.close')} size="sm" />} />
        <NumberField label={L.amount} kind="money" currency="BRL" value={brl} onValueChange={setBrl} />
        <NumberField label={L.amountJpy} kind="money" currency="JPY" value={jpy} onValueChange={setJpy} />
        <NumberField label={L.ambiguous} kind="money" currency="USD" value={rate} onValueChange={setRate} />
        <NumberField label={L.rate} kind="decimal" value={rate} onValueChange={setRate} suggestAmbiguous={false} />
        <NumberField label={L.float} kind="float" value={float} onValueChange={setFloat} />
        <NumberField label={L.integer} kind="integer" value={seed} onValueChange={setSeed} error={L.errorText} />
        <Select label={L.theme} value={theme} onChange={setTheme} options={THEME_OPTIONS} />
        <Select label={L.store} value={store} onChange={setStore} options={STORE_OPTIONS} hint={L.hint} />
        <Select label={L.store} value="steam" onChange={() => {}} options={STORE_OPTIONS} error={L.errorText} />
        <Select label={L.store} value="steam" onChange={() => {}} options={STORE_OPTIONS} disabled />
      </div>
    </Section>
  );
}

function ChecksSection() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  const [on, setOn] = useState(true);
  return (
    <Section title={FX.sections.checks}>
      <Row>
        <Checkbox label={L.includeSold} checked={a} onChange={setA} />
        <Checkbox label={L.includeSold} checked={b} onChange={setB} />
        <Checkbox label={L.partial} checked={false} indeterminate onChange={() => {}} />
        <Checkbox label={FX.states.disabled} checked disabled onChange={() => {}} />
        <Checkbox label={L.includeSold} checked={false} onChange={() => {}} error={L.errorText} hint={L.hint} />
      </Row>
      <Row>
        <Switch label={L.activeStore} checked={on} onChange={setOn} />
        <Switch label={L.activeStore} checked={false} onChange={() => {}} />
        <Switch label={FX.states.disabled} checked disabled onChange={() => {}} />
      </Row>
    </Section>
  );
}

function ErrorsSection() {
  const [price, setPrice] = useState('');
  return (
    <Section title={FX.sections.errors}>
      <FormErrorSummary
        errors={[
          { field: 'gallery-price', label: L.errorsTitleField, message: L.errorsPriceMessage },
          { field: 'gallery-store', label: L.errorsTitleStore, message: L.errorsStoreMessage },
        ]}
      />
      <div className={styles.gGrid}>
        <TextField label={L.errorsTitleField} name="gallery-price" value={price} onChange={setPrice} error={L.errorsPriceMessage} />
        <Select label={L.errorsTitleStore} name="gallery-store" value="" onChange={() => {}} options={STORE_OPTIONS} error={L.errorsStoreMessage} />
      </div>
    </Section>
  );
}

function SegmentedSection() {
  const [view, setView] = useState('grouped');
  const [density, setDensity] = useState('compact');
  const [stuck, setStuck] = useState(true);
  const [sale, setSale] = useState(false);
  const [lock, setLock] = useState(false);
  return (
    <Section title={FX.sections.segmented}>
      <Row caption="SegmentedControl">
        <SegmentedControl
          label={L.view}
          value={view}
          onChange={setView}
          options={[
            { value: 'grouped', label: L.grouped, icon: 'inventory' },
            { value: 'individual', label: L.individual, icon: 'stores' },
          ]}
          iconOnlyBelow="narrow"
        />
        <SegmentedControl label={L.density} size="sm" value={density} onChange={setDensity} options={[{ value: 'compact', label: L.compact }, { value: 'comfortable', label: L.comfortable }]} />
      </Row>
      <Row caption="Chip">
        <div role="group" aria-label={L.filters} className={styles.gItems}>
          <Chip pressed={sale} onPressedChange={setSale} tone="brand" count={12}>{L.forSale}</Chip>
          <Chip pressed={stuck} onPressedChange={setStuck} tone="stuck">{L.onlyStuck}</Chip>
          <Chip pressed={lock} onPressedChange={setLock} tone="lock" count={3}>{L.inLock}</Chip>
          <Chip pressed={false} onPressedChange={() => {}} disabled>{FX.states.disabled}</Chip>
          <Chip pressed={false} onPressedChange={() => {}} data-demo-state="hover">{FX.states.hover}</Chip>
        </div>
      </Row>
      <Row caption="Badge">
        {BADGE_TONES.map(({ tone, text }) => (
          <Badge key={tone} tone={tone} icon={tone === 'loss' ? 'alert' : undefined}>{text}</Badge>
        ))}
        <TradeLockBadge remainingText="3 d" />
        <TradeLockBadge />
        <HoldingBadge sinceText="12 d" />
        <StuckBadge />
      </Row>
    </Section>
  );
}

// Combobox de moedas (42, em grupos e "mais usadas") e um catálogo fictício com imagem (renderOption).
function ComboboxSection() {
  const locale = useLocale();
  const [currency, setCurrency] = useState<string | null>('BRL');
  const [item, setItem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const t = useT();
  const groups = CURRENCY_GROUP_IDS.map((id) => ({ id, label: t(`currency.groups.${id}` as 'currency.groups.america') }));
  const shown = CATALOG_OPTIONS.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <Section title={FX.sections.combobox}>
      <div className={styles.gGrid}>
        <Combobox
          label={L.amountCurrency}
          value={currency}
          onChange={(v) => setCurrency(v)}
          options={currencyComboboxOptions(locale)}
          groups={groups}
          pinned={[...CURRENCY_PINNED] as CurrencyCode[]}
          clearable
        />
        <Combobox
          label={L.catalog}
          value={item}
          onChange={(v) => setItem(v)}
          options={shown}
          filter="none"
          inputValue={query}
          onInputChange={setQuery}
          placeholder={L.catalogPlaceholder}
          emptyText={L.noResults}
          renderOption={(option, state) => (
            <>
              <span className={styles.gThumb} aria-hidden="true" data-active={state.active || undefined} />
              <span className={styles.gOptionText}>
                <span>{option.label}</span>
                <span className={styles.note}>{option.description}</span>
              </span>
            </>
          )}
        />
        <Combobox label={L.amountCurrency} value="USD" onChange={() => {}} options={currencyComboboxOptions(locale)} disabled />
        <Combobox label={L.amountCurrency} value={null} onChange={() => {}} options={[]} loading error={L.errorText} />
      </div>
    </Section>
  );
}

function DialogsSection() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState<'none' | 'plain' | 'error'>('none');
  const [busy, setBusy] = useState(false);
  return (
    <Section title={FX.sections.dialogs}>
      <Row>
        <Button onClick={() => setDialog(true)}>{L.openDialog}</Button>
        <Button variant="danger" onClick={() => setConfirm('plain')}>{L.openConfirm}</Button>
        <Button onClick={() => setConfirm('error')}>{L.openConfirmError}</Button>
      </Row>
      {dialog && (
        <Dialog
          title={L.dialogTitle}
          description={L.dialogDescription}
          onClose={() => setDialog(false)}
          footer={
            <>
              <Button onClick={() => setDialog(false)}>{L.cancelLike}</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>{L.save}</Button>
            </>
          }
        >
          <div className={styles.gGrid}>
            <TextField label={L.name} value="" onChange={() => {}} autoFocus />
            <Select label={L.store} value="steam" onChange={() => {}} options={STORE_OPTIONS} />
          </div>
          <p>{L.dialogBody}</p>
        </Dialog>
      )}
      {confirm !== 'none' && (
        <ConfirmDialog
          title={L.confirmTitle}
          message={L.confirmMessage}
          details={L.confirmDetails}
          confirmLabel={L.delete}
          tone="danger"
          busy={busy}
          error={confirm === 'error' ? L.confirmError : null}
          onConfirm={() => {
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              setConfirm('none');
            }, 800);
          }}
          onCancel={() => setConfirm('none')}
        />
      )}
    </Section>
  );
}

function MenuSection() {
  return (
    <Section title={FX.sections.menu}>
      <Row>
        <Menu
          items={[
            { id: 'edit', label: L.edit, icon: 'settings', onSelect: () => {} },
            { id: 'hold', label: L.moveToHolding, icon: 'inventory', onSelect: () => {} },
            { id: 'sold', label: L.sellDisabled, icon: 'lock', disabled: true, disabledReason: L.sellDisabledReason, onSelect: () => {} },
            { type: 'separator' },
            { id: 'del', label: L.deleteItem, icon: 'close', tone: 'danger', onSelect: () => {} },
          ]}
        />
        <Menu label={L.menuLabel} trigger={<Button icon="more">{L.menuLabel}</Button>} align="start" items={[{ type: 'label', label: L.filters }, { id: 'a', label: L.edit, onSelect: () => {} }]} />
      </Row>
    </Section>
  );
}

function TabsSection() {
  const [tab, setTab] = useState('sale');
  return (
    <Section title={FX.sections.tabs}>
      <Tabs
        label={L.sections}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sale', label: L.tabForSale, count: 24 },
          { value: 'holding', label: L.tabHolding, count: 6 },
          { value: 'lock', label: L.inLock },
          { value: 'sold', label: L.includeSold },
          { value: 'more', label: L.longButton },
        ]}
      >
        <TabPanel value="sale">{L.panelA}</TabPanel>
        <TabPanel value="holding">{L.panelB}</TabPanel>
        <TabPanel value="lock">{L.panelB}</TabPanel>
        <TabPanel value="sold">{L.panelA}</TabPanel>
        <TabPanel value="more">{L.panelB}</TabPanel>
      </Tabs>
      <Disclosure>{L.disclosureBody}</Disclosure>
      <Disclosure label={L.disclosure} defaultOpen>{L.disclosureBody}</Disclosure>
    </Section>
  );
}

function Gallery() {
  return (
    <>
      <ButtonsSection />
      <IconsSection />
      <FieldsSection />
      <ChecksSection />
      <ErrorsSection />
      <SegmentedSection />
      <ComboboxSection />
      <DialogsSection />
      <MenuSection />
      <TabsSection />
      <BannerSection />
      <ToastSection />
      <StatesSection />
      <PanelSection />
      <MoneySection />
      <TurnoverSection />
      <BalanceSection />
      <TableSection />
    </>
  );
}

// Seletor de idiomas: renderiza a galeria dentro de um StaticI18nProvider por idioma, lado a lado (textos longos em de/ru, CJK em ja),
// sem trocar o idioma do app.
export default function ComponentGallery() {
  const [selected, setSelected] = useState<GalleryLanguage[]>(['en']);
  const [dictionaries, setDictionaries] = useState<Partial<Record<GalleryLanguage, Dictionary>>>({});

  useEffect(() => {
    let cancelled = false;
    for (const language of selected) {
      if (dictionaries[language]) continue;
      void loadDictionary(language).then((messages) => {
        if (!cancelled) setDictionaries((current) => ({ ...current, [language]: messages }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [selected, dictionaries]);

  const toggle = (language: GalleryLanguage) =>
    setSelected((current) => (current.includes(language) ? current.filter((l) => l !== language) : [...current, language]));

  return (
    <div>
      <h2 className={styles.h2}>{FX.title}</h2>
      <p className={styles.note}>{FX.note}</p>
      <div className={styles.gLangBar} role="group" aria-label={FX.languages}>
        <span>{FX.languages}</span>
        {GALLERY_LANGUAGES.map((language) => (
          <label key={language} className={styles.gLang}>
            <input type="checkbox" checked={selected.includes(language)} onChange={() => toggle(language)} />
            <code>{language}</code>
          </label>
        ))}
      </div>
      <div className={styles.gColumns}>
        {selected.map((language) => {
          const messages = dictionaries[language];
          if (!messages) return null;
          return (
            <div key={language} className={styles.gColumn} lang={language}>
              <code className={styles.gColumnTitle}>{language}</code>
              <StaticI18nProvider language={language as Language} messages={messages}>
                <Gallery />
              </StaticI18nProvider>
            </div>
          );
        })}
      </div>
    </div>
  );
}
