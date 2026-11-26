'use strict';

const fs = require('fs');
const path = require('path');
const { backgroundFor, BACKGROUND_LIGHT, BACKGROUND_DARK } = require('../src/lib/windowTheme');

const tokens = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'tokens.css'), 'utf8');

function bgIn(block) {
  const start = tokens.indexOf(block);
  expect(start).toBeGreaterThanOrEqual(0);
  const match = /--bg:\s*(#[0-9a-fA-F]{6})\s*;/.exec(tokens.slice(start));
  return match[1].toLowerCase();
}

describe('windowTheme', () => {
  test('constantes iguais ao --bg de tokens.css (claro e escuro)', () => {
    expect(BACKGROUND_LIGHT).toBe(bgIn(':root {'));
    expect(BACKGROUND_DARK).toBe(bgIn(":root[data-theme='dark'] {"));
  });

  test('tema escolhido manda, em maiúsculas ou minúsculas', () => {
    expect(backgroundFor({ theme: 'DARK', systemDark: false })).toBe(BACKGROUND_DARK);
    expect(backgroundFor({ theme: 'dark' })).toBe(BACKGROUND_DARK);
    expect(backgroundFor({ theme: 'LIGHT', systemDark: true })).toBe(BACKGROUND_LIGHT);
  });

  test('SYSTEM, nulo ou desconhecido seguem o sistema', () => {
    expect(backgroundFor({ theme: 'SYSTEM', systemDark: true })).toBe(BACKGROUND_DARK);
    expect(backgroundFor({ theme: 'SYSTEM', systemDark: false })).toBe(BACKGROUND_LIGHT);
    expect(backgroundFor({ theme: null, systemDark: true })).toBe(BACKGROUND_DARK);
    expect(backgroundFor({ theme: 'xyz' })).toBe(BACKGROUND_LIGHT);
    expect(backgroundFor()).toBe(BACKGROUND_LIGHT);
  });
});
