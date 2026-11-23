'use client';

import Link from 'next/link';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney } from '@/lib/format';
import { entryLink, entryLinkLabelKey, groupEntries, reasonKey } from '@/lib/importSummary';
import type { Category, ImportEntryView } from '@/types/api';
import ItemImage from './ItemImage';
import styles from './ImportEntriesList.module.css';

interface Props {
  entries: readonly ImportEntryView[];
  // Chamado ao seguir um link para o inventário (fecha o modal que contém a lista).
  onNavigate?: () => void;
}

function EntryRow({ entry, onNavigate }: { entry: ImportEntryView; onNavigate?: () => void }) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const { display } = entry;

  const details: string[] = [];
  if (display.variant && display.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${display.variant}`));
  if (display.floatValue !== null) details.push(`float ${formatFloat(display.floatValue, language)}`);
  if (display.phase) details.push(display.phase);
  if (display.paintSeed !== null) details.push(`seed ${display.paintSeed}`);
  if (display.priceCents !== null) details.push(formatMoney(display.priceCents, display.currency, language));
  if (display.date) details.push(formatDate(display.date, language));

  const key = reasonKey(entry);
  const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : formatMoney(cents, display.currency, language));
  const reason = key ? tLoose(key, { state: display.state ?? '', fee: money(display.feeCents), expected: money(display.expectedFeeCents) }) : null;
  // Sem texto próprio, o motivo pode ser um código de erro do app (ex.: FLOAT_OUT_OF_RANGE); senão mostra só o código.
  const errorKey = entry.reasonCode ? `errors.${entry.reasonCode}` : null;
  const errorText = errorKey ? tLoose(errorKey) : null;
  const reasonText = reason && reason !== key ? reason : errorText && errorText !== errorKey ? errorText : entry.reasonCode;
  const link = entryLink(entry);
  const category = (display.category ?? 'OUTRO') as Category;
  const title = display.name ?? display.marketHashName ?? t('imports.unknownItem');

  return (
    <li className={styles.entry}>
      <ItemImage category={category} url={display.imageUrl} size={40} />
      <div className={styles.body}>
        <span className={styles.name}>{title}</span>
        {details.length > 0 && <span className={styles.details}>{details.join(' · ')}</span>}
        {reasonText && (
          <span className={entry.outcome === 'CREATED' || entry.outcome === 'MATCHED' ? `${styles.reason} ${styles.warn}` : styles.reason}>
            {reasonText}
          </span>
        )}
        {(link !== null || entry.candidateIds.length > 0) && (
          <span className={styles.links}>
            {link !== null && <Link href={link} onClick={onNavigate}>{t(entryLinkLabelKey(entry))}</Link>}
            {entry.candidateIds.map((id) => (
              <Link key={id} href={`/?item=${id}`} onClick={onNavigate}>{t('imports.seeCandidate', { id })}</Link>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

// Entradas do resumo (ou das pendências) agrupadas por resultado, com o motivo e o link para o lançamento.
export default function ImportEntriesList({ entries, onNavigate }: Props) {
  const t = useT();
  const groups = groupEntries(entries);
  if (groups.length === 0) return null;
  return (
    <div className={styles.groups}>
      {groups.map((group) => (
        <section key={group.key} className={styles.group} aria-label={t(`imports.groups.${group.key}`)}>
          <h3 className={styles.groupTitle}>{t(`imports.groups.${group.key}`)} ({group.entries.length})</h3>
          <ul className={styles.list}>
            {group.entries.map((entry) => <EntryRow key={entry.id} entry={entry} onNavigate={onNavigate} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
