'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { isScreenSender, isAllowedChoice, parseChoicePayload, ALLOWED_BUTTON_IDS } = require('../src/lib/screenPolicy');

const LOADING = path.join('C:', 'Program Files', 'Skins Manager', 'resources', 'app.asar', 'src', 'loading.html');
const LOADING_URL = pathToFileURL(LOADING).href;

describe('isScreenSender', () => {
  test('aceita só a página de carregamento local (URL ou caminho)', () => {
    expect(isScreenSender(LOADING_URL, LOADING_URL)).toBe(true);
    expect(isScreenSender(LOADING_URL, LOADING)).toBe(true);
  });

  test('ignora diferença de maiúsculas no caminho do Windows', () => {
    expect(isScreenSender(LOADING_URL.toUpperCase().replace('FILE:', 'file:'), LOADING_URL)).toBe(true);
  });

  test.each([
    ['origem http do app', 'http://localhost:3001/'],
    ['origem http com o mesmo caminho', 'http://localhost:3001/loading.html'],
    ['outro arquivo local', pathToFileURL(path.join('C:', 'Windows', 'evil.html')).href],
    ['outro arquivo na mesma pasta', LOADING_URL.replace('loading.html', 'other.html')],
    ['com query', `${LOADING_URL}?x=1`],
    ['compartilhamento de rede', 'file://servidor/share/loading.html'],
    ['about:blank', 'about:blank'],
    ['data:', 'data:text/html,<h1>x</h1>'],
    ['vazio', ''],
    ['nulo', null],
    ['indefinido', undefined],
    ['número', 3],
    ['lixo', 'não é url'],
  ])('recusa %s', (label, url) => {
    expect(isScreenSender(url, LOADING_URL)).toBe(false);
  });

  test('sem página esperada, recusa tudo', () => {
    expect(isScreenSender(LOADING_URL, null)).toBe(false);
    expect(isScreenSender(LOADING_URL, '')).toBe(false);
  });
});

describe('isAllowedChoice', () => {
  const state = { buttons: [{ id: 'retry' }, { id: 'close' }] };

  test('aceita os botões do estado atual', () => {
    expect(isAllowedChoice(state, 'retry')).toBe(true);
    expect(isAllowedChoice(state, 'close')).toBe(true);
  });

  test('recusa botão que existe na lista fixa mas não no estado atual', () => {
    expect(isAllowedChoice(state, 'open-data')).toBe(false);
  });

  test('recusa id fora da lista fixa, mesmo que o estado o traga', () => {
    expect(isAllowedChoice({ buttons: [{ id: 'format-disk' }] }, 'format-disk')).toBe(false);
  });

  test.each([[null], [undefined], [1], [{}], [['retry']], ['']])('recusa id inválido %p', (id) => {
    expect(isAllowedChoice(state, id)).toBe(false);
  });

  test('recusa estado inválido', () => {
    expect(isAllowedChoice(null, 'close')).toBe(false);
    expect(isAllowedChoice({}, 'close')).toBe(false);
    expect(isAllowedChoice({ buttons: 'close' }, 'close')).toBe(false);
  });

  test('a lista fixa tem só os ids conhecidos', () => {
    expect([...ALLOWED_BUTTON_IDS].sort()).toEqual(['close', 'open-browser', 'open-data', 'open-logs', 'retry']);
  });
});

describe('parseChoicePayload', () => {
  test('lê só o id', () => {
    expect(parseChoicePayload({ id: 'close', url: 'https://evil.example' })).toBe('close');
  });

  test.each([[null], [undefined], ['close'], [['close']], [{ id: 5 }], [{}]])('recusa %p', (payload) => {
    expect(parseChoicePayload(payload)).toBeNull();
  });
});
