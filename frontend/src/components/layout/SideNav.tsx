'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type Ref } from 'react';
import CurrencyChangeModal from '@/components/CurrencyChangeModal';
import Logo from '@/components/Logo';
import { usePreferences } from '@/components/PreferencesProvider';
import Icon from '@/components/ui/Icon';
import IconButton from '@/components/ui/IconButton';
import { useToast } from '@/components/ui/Toast';
import Tooltip from '@/components/ui/Tooltip';
import VisuallyHidden from '@/components/ui/VisuallyHidden';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatInteger } from '@/lib/format';
import { activeNavId, NAV_ITEMS, SETTINGS_ITEM, type NavId, type NavItem } from '@/lib/routes';
import NavPreferences from './NavPreferences';
import UpdateBadge from './UpdateBadge';
import styles from './SideNav.module.css';
import type { NavMode } from './useNavMode';
import { useReviewCount } from './useReviewCount';

// Acima disto o selo mostra "99+".
const REVIEW_COUNT_MAX = 99;

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  // Menu recolhido: o texto fica só para leitor de tela e o Tooltip mostra o nome.
  withTooltip: boolean;
  reviewCount: number;
}

function NavLink({ item, active, withTooltip, reviewCount }: NavLinkProps) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const label = t(item.labelKey);
  // O selo "Para conferir" é só do item Importações e só com contagem maior que zero.
  const count = item.id === 'imports' && reviewCount > 0 ? reviewCount : 0;
  const reviewText = count > 0 ? tPlural('nav.reviewCount', count) : '';
  const link = (
    <Link href={item.href} className={`${styles.link} ${active ? styles.active : ''}`} aria-current={active ? 'page' : undefined} data-nav-id={item.id}>
      <span className={styles.icon}>
        <Icon name={item.icon} size={18} />
        {count > 0 && <span className={styles.dot} aria-hidden="true" />}
      </span>
      <span className={styles.label}>{label}</span>
      {count > 0 && (
        <span className={styles.count} aria-hidden="true">
          {count > REVIEW_COUNT_MAX ? t('nav.countMax', { count: REVIEW_COUNT_MAX }) : formatInteger(count, locale)}
        </span>
      )}
      {count > 0 && (
        <>
          {' '}
          <VisuallyHidden>{reviewText}</VisuallyHidden>
        </>
      )}
    </Link>
  );
  return withTooltip ? (
    <Tooltip side="right" content={count > 0 ? `${label} · ${reviewText}` : label}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

interface NavBodyProps {
  // 'rail' é a coluna fixa; 'overlay' é o painel aberto por cima do conteúdo.
  variant: 'rail' | 'overlay';
  mode: NavMode;
  short: boolean;
  active: NavId | null;
  reviewCount: number;
  onToggle: () => void;
  onPickCurrency: (currency: string) => void;
  // Botão da coluna fixa: para onde o foco volta quando o menu por cima fecha.
  toggleRef?: Ref<HTMLButtonElement>;
}

function NavBody({ variant, mode, short, active, reviewCount, onToggle, onPickCurrency, toggleRef }: NavBodyProps) {
  const t = useT();
  // O painel por cima é sempre largo; a coluna só é larga no modo expandido.
  const wideLook = variant === 'overlay' || mode === 'expanded';
  const compactPrefs = !wideLook || short;
  const toggleLabel = wideLook ? t('nav.collapse') : t('nav.expand');
  // O alvo do botão (aria-controls) é o painel por cima, quando aberto; senão, a coluna.
  const navId = variant === 'overlay' || mode !== 'overlay' ? 'side-nav' : undefined;
  return (
    <nav aria-label={t('nav.main')} className={styles.nav} id={navId}>
      <div className={styles.brand}>
        <Logo size={34} />
        <span className={styles.brandName}>{t('common.appName')}</span>
      </div>
      <ul className={styles.list}>
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <NavLink item={item} active={active === item.id} withTooltip={!wideLook} reviewCount={reviewCount} />
          </li>
        ))}
      </ul>
      <div className={styles.foot}>
        <UpdateBadge compact={!wideLook} />
        <NavLink item={SETTINGS_ITEM} active={active === 'settings'} withTooltip={!wideLook} reviewCount={0} />
        <NavPreferences compact={compactPrefs} onPickCurrency={onPickCurrency} />
        <div className={styles.toggleRow}>
          <IconButton
            ref={toggleRef}
            icon={wideLook ? 'panelClose' : 'panelOpen'}
            label={toggleLabel}
            onClick={onToggle}
            aria-expanded={wideLook}
            aria-controls="side-nav"
          />
        </div>
      </div>
    </nav>
  );
}

export interface SideNavProps {
  mode: NavMode;
  // Janela baixa (< 700 px): o rodapé fica sempre na forma recolhida.
  short: boolean;
  // Recolher/expandir (faixa larga) ou abrir/fechar por cima (faixa estreita).
  onToggle: () => void;
  onCloseOverlay: () => void;
}

// Menu lateral (D370, 12.4): coluna fixa, recolhível, com o selo "Para conferir" em Importações. Na faixa estreita, abrir o menu o
// põe por cima do conteúdo, num Radix Dialog sem moldura (foco preso, Esc ou clique fora fecham e o foco volta ao botão).
export default function SideNav({ mode, short, onToggle, onCloseOverlay }: SideNavProps) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const toast = useToast();
  const pathname = usePathname();
  const { saveError } = usePreferences();
  const reviewCount = useReviewCount() ?? 0;
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const active = activeNavId(pathname);

  // "Preferência não salva": um Toast de erro (o antigo aviso do cabeçalho). Uma vez só por erro, não importa quantos menus há.
  useEffect(() => {
    if (saveError === null) return;
    toast.show({ tone: 'danger', message: t('header.preferenceNotSaved', { reason: errorMessageFor(saveError, tLoose, locale) }) });
    // Só um erro novo reabre o aviso (trocar de idioma não deve repeti-lo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);

  // O modal de confirmação da moeda fica aqui (fora do painel por cima, que é fechado antes) para sobreviver ao fechamento do Popover.
  const pickCurrency = (currency: string) => {
    onCloseOverlay();
    setPendingCurrency(currency);
  };

  // O Radix só devolve o foco a um Dialog.Trigger; aqui não há, então o foco volta ao botão da coluna ao fechar.
  const railToggle = useRef<HTMLButtonElement>(null);
  const body = (variant: 'rail' | 'overlay') => (
    <NavBody
      variant={variant}
      mode={mode}
      short={short}
      active={active}
      reviewCount={reviewCount}
      onToggle={onToggle}
      onPickCurrency={pickCurrency}
      toggleRef={variant === 'rail' ? railToggle : undefined}
    />
  );

  return (
    <>
      <aside className={styles.rail} data-testid="side-nav-rail">
        {body('rail')}
      </aside>
      {mode === 'overlay' && (
        <RadixDialog.Root
          open
          onOpenChange={(open) => {
            if (!open) onCloseOverlay();
          }}
        >
          <RadixDialog.Portal>
            <RadixDialog.Overlay className={styles.scrim} />
            <RadixDialog.Content
              className={styles.panel}
              aria-describedby={undefined}
              data-testid="side-nav-overlay"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                railToggle.current?.focus();
              }}
            >
              <RadixDialog.Title className={styles.srOnly}>{t('nav.main')}</RadixDialog.Title>
              {body('overlay')}
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
      )}
      {pendingCurrency !== null && <CurrencyChangeModal key={pendingCurrency} currency={pendingCurrency} onClose={() => setPendingCurrency(null)} />}
    </>
  );
}
