'use strict';

const { checkGitState } = require('../scripts/lib/gitState');

const SHA = 'c'.repeat(40);

function fakeGit({ status = '', sha = SHA, remotes = '  origin/main\n', failAt = null } = {}) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (failAt === args[0]) return { status: 128, stdout: '' };
    if (args[0] === 'status') return { status: 0, stdout: status };
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${sha}\n` };
    return { status: 0, stdout: remotes };
  };
  return { runGit, calls };
}

describe('checkGitState', () => {
  test('limpo e no remoto: ok com o SHA', () => {
    const { runGit, calls } = fakeGit();
    expect(checkGitState({ runGit })).toEqual({ ok: true, sha: SHA });
    expect(calls).toEqual([
      ['status', '--porcelain', '--untracked-files=no'],
      ['rev-parse', 'HEAD'],
      ['branch', '-r', '--contains', SHA],
    ]);
  });

  test('mudanças rastreadas sem commit (modificado ou apagado): recusa sem consultar o resto', () => {
    for (const status of [' M a.js\n', ' D b.js\n', 'M  c.js\n']) {
      const { runGit, calls } = fakeGit({ status });
      const r = checkGitState({ runGit });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/sem commit/);
      expect(calls).toHaveLength(1);
    }
  });

  test('HEAD fora do remoto: recusa pedindo o push', () => {
    const r = checkGitState({ runGit: fakeGit({ remotes: '\n' }).runGit });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/git push/);
  });

  test.each(['status', 'rev-parse', 'branch'])('git falhando em %s: recusa com mensagem em português', (failAt) => {
    const r = checkGitState({ runGit: fakeGit({ failAt }).runGit });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Não foi possível/);
  });

  test('SHA inválido: recusa', () => {
    expect(checkGitState({ runGit: fakeGit({ sha: 'xyz' }).runGit }).ok).toBe(false);
  });
});
