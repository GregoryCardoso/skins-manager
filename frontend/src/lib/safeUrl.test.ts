import { describe, expect, test } from 'vitest';
import { isHttpsLink, isSafeImageUrl, isSafeInspectLink } from './safeUrl';

describe('isSafeImageUrl (só https)', () => {
  test.each(['https://cdn.example.com/a.png', 'HTTPS://CDN.EXAMPLE.COM/A.PNG', '  https://a.example/x  '])('aceita %p', (v) => {
    expect(isSafeImageUrl(v)).toBe(true);
  });

  test.each([
    'http://cdn.example.com/a.png', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:image/png;base64,AAAA',
    '//cdn.example.com/a.png', 'steam://rungame/730', 'ftp://x/a.png', 'https://', '/rel/a.png', 'texto livre', '', '   ',
  ])('recusa %p', (v) => {
    expect(isSafeImageUrl(v)).toBe(false);
  });

  test.each([null, undefined, 5, {}, [], true])('recusa não-string %p', (v) => {
    expect(isSafeImageUrl(v)).toBe(false);
  });
});

describe('isSafeInspectLink (steam: ou https:)', () => {
  test.each([
    'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S1A2D3',
    'STEAM://rungame/730/1/+x',
    'https://steamcommunity.com/market/listings/730/x',
    'HTTPS://example.com/x',
  ])('aceita %p', (v) => {
    expect(isSafeInspectLink(v)).toBe(true);
  });

  test.each([
    'http://example.com', 'javascript:alert(1)', 'data:text/html,<script>', 'file:///c:/x', 'ftp://x',
    'vbscript:x', 'steam', ' ', '', 'rungame/730', 'ex ample',
  ])('recusa %p', (v) => {
    expect(isSafeInspectLink(v)).toBe(false);
  });

  test.each([null, undefined, 1, {}])('recusa não-string %p', (v) => {
    expect(isSafeInspectLink(v)).toBe(false);
  });

  test('espaços nas pontas são aparados', () => {
    expect(isSafeInspectLink('  steam://rungame/730/1  ')).toBe(true);
  });
});

describe('isHttpsLink', () => {
  test('distingue https de steam (target=_blank só para https)', () => {
    expect(isHttpsLink('https://a.example')).toBe(true);
    expect(isHttpsLink('steam://rungame/730')).toBe(false);
    expect(isHttpsLink('lixo')).toBe(false);
  });
});
