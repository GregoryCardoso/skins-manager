import fs from 'node:fs';
import path from 'node:path';
import { DARK_SELECTOR, LIGHT_SELECTOR, readBlock } from '@/styles/parseTokens';
import Icon, { ICONS } from '@/components/ui/Icon';
import Logo from '@/components/Logo';
import styles from './design.module.css';

// Guia vivo do design system (12.2, D370). SÓ no `next dev`: o arquivo é `page.dev.tsx` e o next.config.ts só inclui a
// extensão `dev.tsx` no servidor de desenvolvimento, então a rota não entra no build exportado. Página de desenvolvedor:
// os rótulos vêm das constantes e expressões abaixo e não passam pelos dicionários de propósito.

const FONT_SIZES = ['xs', 'sm', 'md', 'base', 'lg', 'xl'];
const SPACES = ['1', '2', '3', '4', '5', '6', '8', '10', '12'];
const RADII = ['sm', 'md', 'lg', 'pill'];
const SHADOWS = ['1', '2', '3'];
const WEIGHTS = ['regular', 'bold'];
const COLOR_KEYS = ['bg', 'surface', 'surface-2', 'line', 'text', 'muted', 'brand', 'brand-ink', 'brand-soft', 'profit', 'loss', 'loss-ink', 'stuck', 'lock', 'focus', 'profit-soft', 'loss-soft', 'stuck-soft', 'lock-soft'];
const THEMES = ['light', 'dark'] as const;
const SAMPLE = 'Aa 0123456789 US$ 1,234.56 ≈ R$ 6.789,01 Ğş Ł Привіт';
const TITLE = 'Design system — guia vivo (só dev)';
const NOTE = 'Use o botão de tema do cabeçalho para a página; as paletas mostram os dois temas lado a lado, com nome e valor.';
const SECTIONS = { colors: 'Cores', type: 'Tipografia', space: 'Espaçamentos', radius: 'Raios e sombras', icons: 'Logo e ícones' };

export default function DesignGuide() {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');
  const palettes = { light: readBlock(css, LIGHT_SELECTOR), dark: readBlock(css, DARK_SELECTOR) };
  return (
    <div className={styles.page}>
      <h1>{TITLE}</h1>
      <p className={styles.note}>{NOTE}</p>

      <h2 className={styles.h2}>{SECTIONS.colors}</h2>
      <div className={styles.themes}>
        {THEMES.map((theme) => (
          <section key={theme} className={styles.palette} style={{ background: palettes[theme].bg }}>
            <h3 className={styles.h3} style={{ color: palettes[theme].text }}>
              {theme}
            </h3>
            <ul className={styles.swatches}>
              {COLOR_KEYS.map((key) => (
                <li key={key} className={styles.swatch} style={{ color: palettes[theme].text }}>
                  <span className={styles.chip} style={{ background: palettes[theme][key], borderColor: palettes[theme].line }} />
                  <span>
                    <code>{`--${key}`}</code>
                    <br />
                    <small>{palettes[theme][key]}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <h2 className={styles.h2}>{SECTIONS.type}</h2>
      {WEIGHTS.map((weight) => (
        <div key={weight}>
          {FONT_SIZES.map((size) => (
            <p key={size} className={styles.type} style={{ fontSize: `var(--fs-${size})`, fontWeight: `var(--fw-${weight})` }}>
              <code>{`--fs-${size} / --fw-${weight}`}</code> {SAMPLE}
            </p>
          ))}
        </div>
      ))}

      <h2 className={styles.h2}>{SECTIONS.space}</h2>
      <div className={styles.rows}>
        {SPACES.map((n) => (
          <div key={n} className={styles.row}>
            <code>{`--space-${n}`}</code>
            <span className={styles.bar} style={{ width: `var(--space-${n})` }} />
          </div>
        ))}
      </div>

      <h2 className={styles.h2}>{SECTIONS.radius}</h2>
      <div className={styles.boxes}>
        {RADII.map((r) => (
          <div key={r} className={styles.box} style={{ borderRadius: `var(--radius-${r})` }}>
            <code>{`--radius-${r}`}</code>
          </div>
        ))}
        {SHADOWS.map((s) => (
          <div key={s} className={styles.box} style={{ boxShadow: `var(--shadow-${s})` }}>
            <code>{`--shadow-${s}`}</code>
          </div>
        ))}
      </div>

      <h2 className={styles.h2}>{SECTIONS.icons}</h2>
      <div className={styles.boxes}>
        <Logo size={64} />
        {Object.keys(ICONS).map((name) => (
          <div key={name} className={styles.icon}>
            <Icon name={name as keyof typeof ICONS} size={20} />
            <small>{name}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
