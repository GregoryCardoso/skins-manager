'use strict';

const { checkReleaseEnv } = require('../scripts/release');

describe('desktop:release', () => {
  test('sem GH_TOKEN falha com mensagem em português', () => {
    const result = checkReleaseEnv({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/GH_TOKEN não definido/);
    expect(checkReleaseEnv({ GH_TOKEN: '   ' }).ok).toBe(false);
  });
  test('com GH_TOKEN segue', () => {
    expect(checkReleaseEnv({ GH_TOKEN: 'abc' }).ok).toBe(true);
  });
});
