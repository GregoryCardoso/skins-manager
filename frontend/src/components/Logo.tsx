'use client';

import { useId } from 'react';
import { useT } from '@/i18n/I18nProvider';

// Logo "S2 · fuzil em destaque" (docs/prototipo-12.1/logo-final.svg): silhueta genérica, sem arte ou marca do jogo.
// Inline para herdar o carregamento do app (offline/Electron); os ids dos gradientes são únicos por instância.
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const t = useT();
  const uid = useId().replace(/:/g, '');
  const tile = `${uid}-tile`;
  const gloss = `${uid}-gloss`;
  const glyph = `${uid}-s`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={t('common.logoAlt')} className={className}>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5AD6C2" />
          <stop offset="1" stopColor="#35AE9C" />
        </linearGradient>
        <radialGradient id={gloss} cx=".28" cy=".18" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <path id={glyph} d="M42 19c-2.5-2.6-6-4-10-4-6 0-10 3.2-10 8 0 10.5 20 6.5 20 17 0 5-4.4 8.5-10.5 8.5-4.6 0-8.4-1.8-11-4.8" />
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${tile})`} />
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${gloss})`} />
      <g transform="rotate(-32 32 33) translate(0 3)">
        <g fill="#062A26" fillOpacity=".4">
          <path d="M15.5 29.2H33v4H15.5z" />
          <path d="M30 28.3h2.2v1H30z" />
          <path d="M22 33.2h3l-1.4 5.8-2.8-.6z" />
          <path d="M27.2 33.2h4.2c.4 3.4 1.8 6.4 4 8.8l-3.8 1.4c-2.4-2.8-4-6.4-4.4-10.2z" />
          <path d="M33 28.3h13.2v1.2H33z" />
          <path d="M43 30.5h15.2v1.3H43z" />
          <path d="M52.4 28.4h1.3v2.2h-1.3z" />
          <path d="M58.2 30h3v2.3h-3z" />
        </g>
        <g fill="#062A26" fillOpacity=".22">
          <path d="M3 31.4 13.6 29.4h1.9v4l-3.4 1.3-7.6 2.6z" />
          <path d="M33 29.6h10.2v3.4H33z" />
        </g>
      </g>
      <use href={`#${glyph}`} fill="none" stroke="#4AC9B5" strokeWidth="10.5" strokeLinecap="round" transform="translate(0 2.5)" />
      <use href={`#${glyph}`} fill="none" stroke="#062A26" strokeWidth="6" strokeLinecap="round" transform="translate(0 2.5)" />
    </svg>
  );
}
