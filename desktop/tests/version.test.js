'use strict';

const fs = require('fs');
const path = require('path');
const { packageFiles, SEMVER } = require('../../scripts/setVersion');

describe('versão sincronizada (D176)', () => {
  const versions = packageFiles().map((file) => ({ file, version: JSON.parse(fs.readFileSync(file, 'utf8')).version }));

  test('os quatro package.json existem e têm semver', () => {
    expect(versions).toHaveLength(4);
    for (const { file, version } of versions) expect([file, SEMVER.test(version)]).toEqual([file, true]);
  });

  test('todos têm a mesma versão', () => {
    expect(new Set(versions.map((v) => v.version)).size).toBe(1);
  });
});

describe('electron-builder.yml (D180)', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');

  test('desinstalar não apaga os dados, instalação por usuário e sem um clique', () => {
    expect(yml).toMatch(/^\s+deleteAppDataOnUninstall: false$/m);
    expect(yml).toMatch(/^\s+perMachine: false$/m);
    expect(yml).toMatch(/^\s+oneClick: false$/m);
  });

  test('o destino de extraResources é a pasta que o main procura', () => {
    const { PACKAGED_APP_DIR_NAME } = require('../src/lib/paths');
    expect(yml).toMatch(new RegExp(String.raw`^\s+to: ${PACKAGED_APP_DIR_NAME}$`, 'm'));
  });
});
