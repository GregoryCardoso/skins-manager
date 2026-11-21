'use strict';

const { compareVersions, isValidReleaseUrl, evaluateLatestRelease } = require('../src/lib/updatePolicy');

describe('compareVersions', () => {
  test.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['v1.0.1', '1.0.0', 1],
  ])('%s vs %s', (a, b, expected) => expect(compareVersions(a, b)).toBe(expected));

  test('inválida vira null', () => {
    expect(compareVersions('abc', '1.0.0')).toBeNull();
    expect(compareVersions('1.0', '1.0.0')).toBeNull();
    expect(compareVersions(undefined, '1.0.0')).toBeNull();
  });
});

describe('isValidReleaseUrl', () => {
  test('aceita só a página de releases do repositório', () => {
    expect(isValidReleaseUrl('https://github.com/GregoryCardoso/skins-manager/releases/tag/v1.0.1')).toBe(true);
    expect(isValidReleaseUrl('http://github.com/GregoryCardoso/skins-manager/releases/tag/v1.0.1')).toBe(false);
    expect(isValidReleaseUrl('https://github.com/Outro/skins-manager/releases/tag/v1')).toBe(false);
    expect(isValidReleaseUrl('https://github.com.evil.com/GregoryCardoso/skins-manager/releases/x')).toBe(false);
    expect(isValidReleaseUrl('https://github.com/GregoryCardoso/skins-manager/releases/../../x')).toBe(false);
    expect(isValidReleaseUrl('https://user@github.com/GregoryCardoso/skins-manager/releases/x')).toBe(false);
    expect(isValidReleaseUrl('file:///C:/x')).toBe(false);
    expect(isValidReleaseUrl(null)).toBe(false);
  });
});

describe('evaluateLatestRelease', () => {
  const url = 'https://github.com/GregoryCardoso/skins-manager/releases/tag/v1.1.0';
  test('mais nova', () => {
    expect(evaluateLatestRelease({ tag_name: 'v1.1.0', html_url: url, body: 'notas' }, '1.0.0')).toEqual({
      status: 'available',
      latestVersion: '1.1.0',
      url,
      notes: 'notas',
    });
  });
  test('igual e mais antiga', () => {
    expect(evaluateLatestRelease({ tag_name: 'v1.0.0', html_url: url }, '1.0.0').status).toBe('up-to-date');
    expect(evaluateLatestRelease({ tag_name: 'v0.9.0', html_url: url }, '1.0.0').status).toBe('older-remote');
  });
  test('inválidos', () => {
    expect(evaluateLatestRelease(null, '1.0.0').status).toBe('invalid');
    expect(evaluateLatestRelease([], '1.0.0').status).toBe('invalid');
    expect(evaluateLatestRelease({ tag_name: 'lixo', html_url: url }, '1.0.0').status).toBe('invalid');
    expect(evaluateLatestRelease({ tag_name: 'v2.0.0', html_url: 'https://evil.com/' }, '1.0.0').status).toBe('invalid');
    expect(evaluateLatestRelease({ tag_name: 'v2.0.0', html_url: url, draft: true }, '1.0.0').status).toBe('invalid');
    expect(evaluateLatestRelease({ tag_name: 'v2.0.0', html_url: url, prerelease: true }, '1.0.0').status).toBe('invalid');
  });
});
