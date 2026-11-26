'use strict';

// Ligações da 12.10 (parte 2): textos novos nos 13 idiomas e o main usando as telas dentro da janela.
const fs = require('fs');
const path = require('path');
const { MESSAGES, LANGUAGES } = require('../src/i18n');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
const NEW_KEYS = ['common.retry', 'common.technicalDetails', 'screen.errorRegion'];

describe('textos novos das telas (13 idiomas)', () => {
  test.each(LANGUAGES)('%s tem as três chaves novas, preenchidas', (code) => {
    expect(LANGUAGES).toHaveLength(13);
    for (const key of NEW_KEYS) {
      expect([code, key, typeof MESSAGES[code][key]]).toEqual([code, key, 'string']);
      expect(MESSAGES[code][key].trim()).not.toBe('');
    }
  });

  test('fora do inglês, as traduções não são cópia do inglês (exceto onde a palavra coincide)', () => {
    for (const code of LANGUAGES.filter((c) => c !== 'en')) {
      const same = NEW_KEYS.filter((key) => MESSAGES[code][key] === MESSAGES.en[key]);
      expect([code, same]).toEqual([code, []]);
    }
  });

  test('toda chave usada em screens.js existe no inglês', () => {
    const used = new Set([...read('screens.js').matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.js') && !k.endsWith('.html') && !k.startsWith('desktop')));
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((key) => !(key in MESSAGES.en))).toEqual([]);
  });
});

describe('main.js com as telas dentro da janela', () => {
  const main = read('main.js');

  test('os diálogos de início/erro passam por screens; só showStageMissing segue nativo', () => {
    for (const name of ['showStartFailure', 'showAlreadyOpen', 'showNoFreePort', 'showCrashLoop', 'showRenderGone']) {
      expect(main).toContain(`screens.${name}(`);
      expect(main).not.toContain(`dialogs.${name}(`);
    }
    expect(main).toContain('dialogs.showStageMissing(');
  });

  test('"Tentar de novo" na falha de início religa o backend e "Abrir pasta de registros" abre os logs', () => {
    const block = main.slice(main.indexOf('async function onStartupFailure'), main.indexOf('async function onGaveUp'));
    expect(block).toMatch(/choice === 'retry'[\s\S]*supervisor\.retry\(\)/);
    expect(block).toMatch(/choice === 'open-logs'[\s\S]*shell\.openPath\(dataPaths\.logsDir\)/);
  });

  test('depois de "tentar de novo" a interface é carregada de novo (não um reload da tela de erro)', () => {
    expect(main.match(/pageLoaded = false;/g).length).toBeGreaterThanOrEqual(2);
  });

  test('os canais das telas recebem a página local e as funções do controlador', () => {
    expect(main).toMatch(/loadingFile:\s*LOADING_FILE/);
    expect(main).toMatch(/getScreenState:\s*\(\)\s*=>\s*screens\.getState\(\)/);
    expect(main).toMatch(/chooseScreen:\s*\(id\)\s*=>\s*screens\.choose\(id\)/);
  });

  test('o tema das configurações chega às telas', () => {
    expect(main).toMatch(/screens\.setTheme\(theme\)/);
  });

  test('screens.js e screenPolicy.js não usam Electron diretamente', () => {
    for (const file of ['screens.js', 'lib/screenPolicy.js']) expect(read(file)).not.toMatch(/require\('electron'\)/);
  });

  test('o preload expõe só getState, choose e onState em skinsDesktop.screen', () => {
    const preload = read('preload.js');
    expect(preload).toMatch(/screen:\s*\{[\s\S]*getState[\s\S]*choose[\s\S]*onState/);
    expect(preload).toMatch(/invoke\('desktop:screenChoice', \{ id \}\)/);
  });
});
