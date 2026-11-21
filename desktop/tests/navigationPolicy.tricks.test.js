'use strict';

const fs = require('fs');
const path = require('path');
const { classify, isSteamGameLink } = require('../src/lib/navigationPolicy');

const ORIGIN = 'http://localhost:3001';

describe('navigationPolicy: truques de URL', () => {
  test.each([
    ['http://localhost.evil.com:3001/', 'block'],
    ['http://localhost.evil.com/', 'block'],
    ['http://localhost@evil.com:3001/', 'block'],
    ['http://localhost:3001@evil.com/', 'block'],
    ['http://evil.com#@localhost:3001/', 'block'],
    ['http://evil.com/http://localhost:3001/', 'block'],
    ['http://localhost:3002/', 'block'],
    ['http://localhost/', 'block'],
    ['https://localhost:3001/', 'external'],
    ['HTTP://LOCALHOST:3001/inventory', 'allow'],
    ['http://LocalHost:3001/', 'allow'],
    ['  http://localhost:3001/  ', 'allow'],
    ['http://localhost:3001', 'allow'],
    ['http://', 'block'],
    ['https://', 'block'],
    ['http://[::1]:3001/', 'block'],
    ['ftp://localhost:3001/', 'block'],
    ['ws://localhost:3001/', 'block'],
    ['blob:http://localhost:3001/abc', 'allow'], // mesma origem (download do backup, D150)
    ['blob:http://evil.com/abc', 'block'],
    ['view-source:http://localhost:3001/', 'block'],
    ['mailto:a@b.c', 'block'],
    ['vbscript:x', 'block'],
    ['JAVASCRIPT:alert(1)', 'block'],
    ['\tjavascript:alert(1)', 'block'],
    ['//evil.com/x', 'block'],
    ['/relative/path', 'block'],
    ['steam://rungame@evil/730/1', 'block'],
    ['steam://rungame//730/1', 'block'],
    ['steam://RUNGAME/730/1', 'external'],
    ['steam://rungame/730x', 'block'],
    ['steam://rungame/', 'block'],
    ['steam://rungame', 'block'],
    ['steam://', 'block'],
    ['steam:rungame/730', 'block'],
  ])('%j -> %s', (url, expected) => {
    expect(classify(url, ORIGIN)).toBe(expected);
  });

  test('127.0.0.1 não é a origem do app (a janela sempre carrega localhost)', () => {
    expect(classify('http://127.0.0.1:3001/', ORIGIN)).toBe('block');
    expect(classify('http://127.0.0.1:3001/', 'http://127.0.0.1:3001')).toBe('allow');
  });

  test('sem origem do app válida, nada navega dentro da janela', () => {
    expect(classify('http://localhost:3001/', null)).toBe('block');
    expect(classify('http://localhost:3001/', 'lixo')).toBe('block');
    expect(classify('https://x.com/', 'lixo')).toBe('external');
  });

  test('isSteamGameLink só aceita steam: com host rungame e jogo 730', () => {
    expect(isSteamGameLink(new URL('https://rungame/730'))).toBe(false);
    expect(isSteamGameLink(new URL('steam://rungame/730'))).toBe(true);
  });
});

// Contrato com o frontend: o que o botão "Inspecionar" aceita (safeUrl.ts) vs. o que a política deixa passar.
describe('navigationPolicy x botão Inspecionar', () => {
  test('o link de inspeção padrão do CS2 (rungame/730) passa', () => {
    const link = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S76561198000000000A1D2';
    expect(classify(link, ORIGIN)).toBe('external');
  });

  test('o frontend renderiza <a href={link}> sem target para steam: (cai no will-navigate)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'InventoryTable.tsx'), 'utf8');
    expect(src).toMatch(/href=\{link\}/);
    expect(src).toMatch(/isHttpsLink\(link\)/);
  });

  // DEFEITO CONHECIDO (ver relatório): o formulário, a API e o safeUrl aceitam QUALQUER steam://, mas a política só
  // encaminha steam://rungame/730. Links como steam://run/730//+csgo_econ_action_preview%20... (usados por ferramentas
  // de inspeção) ficam bloqueados em silêncio no desktop. Quando for corrigido, troque test.failing por test.
  test.failing('steam://run/730//+csgo_econ_action_preview (aceito pelo frontend) deveria abrir no Steam', () => {
    expect(classify('steam://run/730//+csgo_econ_action_preview%20S1A2D3', ORIGIN)).toBe('external');
  });
});
