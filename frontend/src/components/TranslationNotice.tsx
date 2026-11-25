'use client';

import { useT } from '@/i18n/I18nProvider';
import { isMachineTranslated } from '@/i18n/languages';
import styles from './settings.module.css';

// Endereço fixo das Issues do projeto. Só https: o desktop abre no navegador padrão.
export const ISSUES_URL = 'https://github.com/GregoryCardoso/skins-manager/issues';
const LINK_TOKEN = '\u0001';

// Aviso discreto das traduções feitas pelo Claude (D369, E-P3-Q4): só nos idiomas marcados `machineTranslated` no registro
// (en e pt-BR não mostram). O texto traz `{link}` no lugar do nome do link, para cada idioma pôr o link onde a frase pede.
export default function TranslationNotice({ language }: { language: string }) {
  const t = useT();
  if (!isMachineTranslated(language)) return null;
  const [before, after = ''] = t('settings.preferences.translationNotice', { link: LINK_TOKEN }).split(LINK_TOKEN);
  return (
    <p className={styles.muted} data-testid="translation-notice">
      {before}
      <a className={styles.noticeLink} href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
        {t('settings.preferences.translationNoticeLink')}
      </a>
      {after}
    </p>
  );
}
