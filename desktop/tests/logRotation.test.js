'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRotatingLog, rotatedName, shouldRotate } = require('../src/lib/logRotation');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-log-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('shouldRotate', () => {
  test('arquivo vazio nunca gira; passou do limite gira', () => {
    expect(shouldRotate(0, 5000, 100)).toBe(false);
    expect(shouldRotate(50, 50, 100)).toBe(false);
    expect(shouldRotate(50, 51, 100)).toBe(true);
  });
});

describe('createRotatingLog', () => {
  test('nomes dos arquivos girados', () => {
    expect(path.basename(rotatedName(path.join(dir, 'main.log'), 1))).toBe('main.1.log');
  });

  test('grava e acumula abaixo do limite', () => {
    const file = path.join(dir, 'main.log');
    const log = createRotatingLog(file, { maxBytes: 100 });
    log.write('aaa\n');
    log.write('bbb\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('aaa\nbbb\n');
  });

  test('gira e mantém só 3 arquivos (atual, .1 e .2)', () => {
    const file = path.join(dir, 'backend.log');
    const log = createRotatingLog(file, { maxBytes: 10, keep: 3 });
    for (const line of ['11111111\n', '22222222\n', '33333333\n', '44444444\n', '55555555\n']) log.write(line);
    const names = fs.readdirSync(dir).sort();
    expect(names).toEqual(['backend.1.log', 'backend.2.log', 'backend.log']);
    expect(fs.readFileSync(file, 'utf8')).toBe('55555555\n');
    expect(fs.readFileSync(path.join(dir, 'backend.1.log'), 'utf8')).toBe('44444444\n');
    expect(fs.readFileSync(path.join(dir, 'backend.2.log'), 'utf8')).toBe('33333333\n');
  });

  test('retoma o tamanho de um arquivo que já existe', () => {
    const file = path.join(dir, 'main.log');
    fs.writeFileSync(file, '1234567890');
    const log = createRotatingLog(file, { maxBytes: 12 });
    log.write('abcde');
    expect(fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8')).toBe('1234567890');
    expect(fs.readFileSync(file, 'utf8')).toBe('abcde');
  });

  test('cria a pasta de logs se não existir e não lança em falha de gravação', () => {
    const file = path.join(dir, 'logs', 'main.log');
    const log = createRotatingLog(file);
    log.write('x');
    expect(fs.existsSync(file)).toBe(true);
    const broken = createRotatingLog(file, { fsImpl: { ...fs, appendFileSync: () => { throw new Error('disco cheio'); } } });
    expect(() => broken.write('y')).not.toThrow();
  });
});
