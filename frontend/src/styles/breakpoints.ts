// Faixas de largura da janela (D370, regra de responsividade da Etapa 12). Os mesmos valores estão em styles/tokens.css (--bp-*)
// e o teste breakpoints.test.ts confere os dois lados e todos os @media/@container de components/ui/*.module.css.
// Larga >= 1280 · média 1100–1279 · estreita 900–1099 · compacta 800–899 (abaixo de 800 a página pode rolar na horizontal).
export const BREAKPOINTS = { compact: 800, narrow: 900, medium: 1100, wide: 1280 } as const;

// Largura do próprio componente (container queries): sm 480, md 720, lg 960.
export const CONTAINER_BREAKPOINTS = { sm: 480, md: 720, lg: 960 } as const;

// Alturas permitidas em @media (altura da janela): só estas.
export const HEIGHT_BREAKPOINTS = [600, 700] as const;

export type BreakpointName = keyof typeof BREAKPOINTS;
