'use strict';

// Confere o estado do Git antes de publicar um release (7.6): o rascunho aponta para o commit testado,
// então o working tree não pode ter mudanças rastreadas sem commit e o HEAD precisa estar no remoto.
// Sem `git fetch` de propósito: usa as referências remotas locais (atualizadas pelo push), sem rede nem senha.
const childProcess = require('child_process');

function defaultRunGit(args, cwd, env) {
  // chama por childProcess.spawnSync (não desestruturado) para os testes poderem trocar a função
  const result = childProcess.spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', error: result.error };
}

/**
 * Devolve { ok: true, sha } ou { ok: false, message } (em português).
 * `runGit(args)` devolve { status, stdout }; é injetável.
 */
function checkGitState({ runGit }) {
  const git = (args) => {
    const result = runGit(args);
    if (!result || result.status !== 0 || result.error) return null;
    return String(result.stdout || '').trim();
  };

  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null) return { ok: false, message: 'Não foi possível consultar o Git. Confira se o git está instalado e se esta é a pasta do projeto.' };
  if (dirty !== '') {
    return { ok: false, message: 'Há mudanças rastreadas sem commit. Faça o commit (e o push) antes de publicar; o release precisa apontar para um commit.' };
  }
  const sha = git(['rev-parse', 'HEAD']);
  if (sha === null || !/^[0-9a-f]{40}$/i.test(sha)) return { ok: false, message: 'Não foi possível descobrir o commit atual (git rev-parse HEAD).' };
  const remotes = git(['branch', '-r', '--contains', sha]);
  if (remotes === null) return { ok: false, message: 'Não foi possível consultar o remoto (git branch -r).' };
  if (remotes === '') {
    return { ok: false, message: 'O commit atual não está no GitHub. Faça o push (git push) antes de publicar o release.' };
  }
  return { ok: true, sha };
}

module.exports = { checkGitState, defaultRunGit };
