import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import type { NextConfig } from 'next';

export default function nextConfig(phase: string): NextConfig {
  return {
    output: 'export',
    images: { unoptimized: true },
    trailingSlash: true,
    reactStrictMode: true,
    // A extensão `dev.tsx` (ex.: app/design/page.dev.tsx, o guia vivo do design system) só vira rota no `next dev`.
    // No `next build` ela não é reconhecida, então a página não entra no export de produção.
    pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ['tsx', 'ts', 'dev.tsx'] : ['tsx', 'ts'],
  };
}
