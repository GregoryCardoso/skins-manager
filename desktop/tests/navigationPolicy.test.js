'use strict';

const { classify, isSameOrigin } = require('../src/lib/navigationPolicy');

const ORIGIN = 'http://localhost:3001';

describe('navigationPolicy.classify', () => {
  test.each([
    ['http://localhost:3001/', 'allow'],
    ['http://localhost:3001/sales/?a=1', 'allow'],
    ['https://csfloat.com/item/1', 'external'],
    ['https://steamcommunity.com/market', 'external'],
    ['steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20ABC', 'external'],
    ['steam://rungame/730', 'external'],
    ['steam://rungame/440/123', 'block'],
    ['steam://rungame/7300/1', 'block'],
    ['steam://run/730', 'block'],
    ['steam://open/friends', 'block'],
    ['http://example.com/', 'block'],
    ['http://localhost:3002/', 'block'],
    ['http://127.0.0.1:3001/', 'block'],
    ['http://localhost:3001.evil.com/', 'block'],
    ['file:///C:/Windows/win.ini', 'block'],
    ['javascript:alert(1)', 'block'],
    ['data:text/html,<b>x</b>', 'block'],
    ['about:blank', 'block'],
    ['', 'block'],
    ['isto não é url', 'block'],
  ])('%s -> %s', (url, expected) => {
    expect(classify(url, ORIGIN)).toBe(expected);
  });

  test('valores que não são texto são bloqueados', () => {
    expect(classify(undefined, ORIGIN)).toBe('block');
    expect(classify(null, ORIGIN)).toBe('block');
    expect(classify(42, ORIGIN)).toBe('block');
  });

  test('segue a porta da origem informada', () => {
    expect(classify('http://localhost:3005/x', 'http://localhost:3005')).toBe('allow');
    expect(classify('http://localhost:3001/x', 'http://localhost:3005')).toBe('block');
  });
});

describe('navigationPolicy.isSameOrigin', () => {
  test('origem inválida ou nula nunca confere', () => {
    expect(isSameOrigin('http://localhost:3001/', null)).toBe(false);
    expect(isSameOrigin('file:///x.html', ORIGIN)).toBe(false);
    expect(isSameOrigin(undefined, ORIGIN)).toBe(false);
  });
});
