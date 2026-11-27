'use strict';
// A logo da tela de carregamento (desktop/src/loading.html) é o mesmo desenho da logo do app (frontend/src/components/Logo.tsx).
// Antes ela era uma versão simplificada, sem o brilho e a silhueta (relato do usuário, 12.12): este teste impede que divirjam de novo.
const fs = require('fs');
const path = require('path');

const loading = fs.readFileSync(path.join(__dirname, '..', 'src', 'loading.html'), 'utf8');
const logo = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'Logo.tsx'), 'utf8');

const pathsOf = (text) => [...text.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
const colorsOf = (text) => [...new Set([...text.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()))];

describe('logo da tela de carregamento = logo do app', () => {
  test('todos os traços (path d) da logo do app estão na tela de carregamento', () => {
    const appPaths = pathsOf(logo);
    expect(appPaths.length).toBeGreaterThan(5);
    for (const d of appPaths) expect(loading).toContain(`d="${d}"`);
  });

  test('as cores da logo do app estão na tela de carregamento, com o brilho e a rotação da silhueta', () => {
    const loadingColors = colorsOf(loading);
    for (const color of colorsOf(logo)) expect(loadingColors).toContain(color);
    expect(loading).toContain('rotate(-32 32 33) translate(0 3)');
    expect(loading).toMatch(/radialGradient id="gloss"/);
  });
});
