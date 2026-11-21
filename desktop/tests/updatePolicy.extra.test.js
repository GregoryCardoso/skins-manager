'use strict';

const {
  parseVersion,
  compareVersions,
  isValidReleaseUrl,
  evaluateLatestRelease,
  formatReleaseNotes,
  LATEST_RELEASE_API_URL,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
} = require('../src/lib/updatePolicy');

const OK_URL = 'https://github.com/GregoryCardoso/skins-manager/releases/tag/v1.1.0';

describe('constantes', () => {
  test('API, teto e timeout conforme D181', () => {
    expect(LATEST_RELEASE_API_URL).toBe('https://api.github.com/repos/GregoryCardoso/skins-manager/releases/latest');
    expect(MAX_RESPONSE_BYTES).toBe(256 * 1024);
    expect(REQUEST_TIMEOUT_MS).toBe(10000);
  });
});

describe('parseVersion', () => {
  test('aceita v, pré-release e build', () => {
    expect(parseVersion('v1.2.3-rc.1+abc')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ['rc', '1'] });
    expect(parseVersion(' 1.2.3 ')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });
  test.each(['', '1', '1.2', '1.2.3.4', 'a.b.c', '1.2.x', '1.2.3-', '-1.2.3', null, undefined, 5, {}])(
    'recusa %p',
    (value) => expect(parseVersion(value)).toBeNull()
  );
  test('números gigantes (fora do inteiro seguro) são recusados', () => {
    expect(parseVersion('99999999999999999999.0.0')).toBeNull();
  });
});

describe('compareVersions: mais casos', () => {
  test('build metadata é ignorada', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });
  test('ordem de pré-releases da especificação semver', () => {
    const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(compareVersions(order[i], order[i + 1])).toBe(-1);
      expect(compareVersions(order[i + 1], order[i])).toBe(1);
    }
  });
});

describe('isValidReleaseUrl: ataques', () => {
  test.each([
    ['outro dono', 'https://github.com/Outro/skins-manager/releases/tag/v1'],
    ['outro repo', 'https://github.com/GregoryCardoso/outro/releases/tag/v1'],
    ['http', 'http://github.com/GregoryCardoso/skins-manager/releases/tag/v1'],
    ['prefixo enganoso de repo', 'https://github.com/GregoryCardoso/skins-manager-evil/releases/tag/v1'],
    ['prefixo enganoso de dono', 'https://github.com/GregoryCardoso2/skins-manager/releases/tag/v1'],
    ['userinfo', 'https://GregoryCardoso@github.com/GregoryCardoso/skins-manager/releases/tag/v1'],
    ['userinfo com senha', 'https://a:b@github.com/GregoryCardoso/skins-manager/releases/x'],
    ['@ para outro host', 'https://github.com@evil.com/GregoryCardoso/skins-manager/releases/x'],
    ['host com sufixo', 'https://github.com.evil.com/GregoryCardoso/skins-manager/releases/x'],
    ['porta', 'https://github.com:8443/GregoryCardoso/skins-manager/releases/x'],
    ['javascript', 'javascript:alert(1)//https://github.com/GregoryCardoso/skins-manager/releases/'],
    ['javascript puro', 'javascript:alert(1)'],
    ['data', 'data:text/html,<script>1</script>'],
    ['file', 'file:///C:/Windows/System32/calc.exe'],
    ['traversal', 'https://github.com/GregoryCardoso/skins-manager/releases/../../evil'],
    ['sem barra final do prefixo', 'https://github.com/GregoryCardoso/skins-manager/releases'],
    ['vazio', ''],
    ['número', 42],
    ['objeto', {}],
    ['undefined', undefined],
  ])('recusa %s', (_n, url) => expect(isValidReleaseUrl(url)).toBe(false));

  test('traversal codificado não escapa do repositório', () => {
    const url = 'https://github.com/GregoryCardoso/skins-manager/releases/%2e%2e/%2e%2e/evil';
    if (isValidReleaseUrl(url)) {
      expect(new URL(url).pathname.startsWith('/GregoryCardoso/skins-manager/releases/')).toBe(true);
    }
  });
  test('aceita download e tag', () => {
    expect(isValidReleaseUrl('https://github.com/GregoryCardoso/skins-manager/releases/download/v1/x.exe')).toBe(true);
    expect(isValidReleaseUrl('https://github.com/GregoryCardoso/skins-manager/releases/latest')).toBe(true);
  });
});

describe('evaluateLatestRelease: mais casos', () => {
  test('mais velha, igual e mais nova com tag sem "v"', () => {
    expect(evaluateLatestRelease({ tag_name: '0.9.9', html_url: OK_URL }, '1.0.0')).toEqual({ status: 'older-remote', latestVersion: '0.9.9' });
    expect(evaluateLatestRelease({ tag_name: '1.0.0', html_url: OK_URL }, '1.0.0')).toEqual({ status: 'up-to-date', latestVersion: '1.0.0' });
    expect(evaluateLatestRelease({ tag_name: '1.0.1', html_url: OK_URL }, '1.0.0').status).toBe('available');
  });
  test('JSON inválido ou campos faltando', () => {
    for (const json of [undefined, null, 'texto', 42, [], {}, { html_url: OK_URL }, { tag_name: 123, html_url: OK_URL }, { tag_name: '' }]) {
      expect(evaluateLatestRelease(json, '1.0.0').status).toBe('invalid');
    }
  });
  test('versão atual inválida vira invalid', () => {
    expect(evaluateLatestRelease({ tag_name: 'v2.0.0', html_url: OK_URL }, 'xyz').status).toBe('invalid');
  });
  test('mais nova sem html_url ou com url inválida vira invalid', () => {
    expect(evaluateLatestRelease({ tag_name: 'v2.0.0' }, '1.0.0').status).toBe('invalid');
    expect(
      evaluateLatestRelease({ tag_name: 'v2.0.0', html_url: 'https://github.com/GregoryCardoso/skins-manager-evil/releases/x' }, '1.0.0').status
    ).toBe('invalid');
  });
  test('rascunho e pré-release descartados mesmo sendo mais novos', () => {
    expect(evaluateLatestRelease({ tag_name: 'v9.0.0', html_url: OK_URL, draft: true }, '1.0.0').status).toBe('invalid');
    expect(evaluateLatestRelease({ tag_name: 'v9.0.0', html_url: OK_URL, prerelease: true }, '1.0.0').status).toBe('invalid');
  });
  test('tag com pré-release semver, mesmo sem flag, é menor que a final atual', () => {
    expect(evaluateLatestRelease({ tag_name: 'v1.0.0-beta.1', html_url: OK_URL }, '1.0.0').status).toBe('older-remote');
  });
  test('body ausente vira notas vazias', () => {
    expect(evaluateLatestRelease({ tag_name: 'v1.1.0', html_url: OK_URL }, '1.0.0').notes).toBe('');
  });
});

describe('formatReleaseNotes', () => {
  test('texto simples passa; tags HTML saem', () => {
    expect(formatReleaseNotes('Olá')).toBe('Olá');
    expect(formatReleaseNotes('<p>Um</p><ul><li>a</li><li>b</li></ul>')).toBe('Um\na\nb');
    expect(formatReleaseNotes('a<br>b<br/>c')).toBe('a\nb\nc');
    expect(formatReleaseNotes('<script>alert(1)</script>x')).not.toMatch(/</);
  });
  test('lista do electron-updater', () => {
    expect(formatReleaseNotes([{ version: '1', note: 'A' }, { version: '2', note: 'B' }, { version: '3' }, null])).toBe('A\n\nB');
  });
  test('tipos inesperados viram vazio', () => {
    expect(formatReleaseNotes(null)).toBe('');
    expect(formatReleaseNotes(undefined)).toBe('');
    expect(formatReleaseNotes(42)).toBe('');
    expect(formatReleaseNotes({})).toBe('');
  });
  test('CRLF e linhas em branco em excesso são normalizados', () => {
    expect(formatReleaseNotes('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
  });
  test('limita a 1500 caracteres com reticências', () => {
    const out = formatReleaseNotes('x'.repeat(5000));
    expect(out.length).toBe(1503);
    expect(out.endsWith('...')).toBe(true);
    expect(formatReleaseNotes('x'.repeat(1500))).toBe('x'.repeat(1500));
  });
});
