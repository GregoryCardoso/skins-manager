'use strict';

// Carimbo do backup de migração avança sem sobrescrever (D64 / D151): várias colisões e backup de importação no mesmo instante.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const { selectBackupsToDelete, parseBackupStamp, MIGRATION_BACKUP_PREFIX, IMPORT_BACKUP_PREFIX } = require('../../src/config/backupRetention');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-coll-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // pasta temporária
  }
});

const upTo4 = MIGRATIONS.filter((m) => m.version <= 4);
const NOW = new Date('2026-11-21T10:11:12.345Z');

describe('backupBeforeMigrating: colisão', () => {
  test('três nomes já ocupados em sequência: usa +3 ms e nenhum arquivo existente é tocado', () => {
    const dbPath = path.join(tmpRoot, 'multi', 'inventory.sqlite');
    openDatabase(dbPath, { migrations: upTo4 }).close();
    const dir = path.join(tmpRoot, 'multi', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const taken = ['10-11-12.345', '10-11-12.346', '10-11-12.347'].map((s) => path.join(dir, `inventory-v4-2026-11-21T${s}Z.sqlite`));
    taken.forEach((f, i) => fs.writeFileSync(f, `antigo ${i}`));
    openDatabase(dbPath, { now: NOW }).close();
    taken.forEach((f, i) => expect(fs.readFileSync(f, 'utf8')).toBe(`antigo ${i}`));
    expect(fs.existsSync(path.join(dir, 'inventory-v4-2026-11-21T10-11-12.348Z.sqlite'))).toBe(true);
  });

  test('o backup avançado entra no padrão do tipo e a retenção continua reconhecendo-o', () => {
    const name = 'inventory-v4-2026-11-21T10-11-12.348Z.sqlite';
    expect(parseBackupStamp(name, MIGRATION_BACKUP_PREFIX)).toBe('2026-11-21T10-11-12.348Z');
    expect(parseBackupStamp(name, IMPORT_BACKUP_PREFIX)).toBeNull();
  });

  test('virada de segundo/dia com +1 ms continua com carimbo válido', () => {
    const dbPath = path.join(tmpRoot, 'edge', 'inventory.sqlite');
    openDatabase(dbPath, { migrations: upTo4 }).close();
    const dir = path.join(tmpRoot, 'edge', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'inventory-v4-2026-11-21T23-59-59.999Z.sqlite'), 'antigo');
    openDatabase(dbPath, { now: new Date('2026-11-21T23:59:59.999Z') }).close();
    expect(fs.existsSync(path.join(dir, 'inventory-v4-2026-11-22T00-00-00.000Z.sqlite'))).toBe(true);
  });

  test('a retenção dos 10 mais novos não apaga o backup recém-criado nem arquivos fora do padrão', () => {
    const names = Array.from({ length: 12 }, (_, i) => `inventory-v4-2026-11-${String(i + 1).padStart(2, '0')}T00-00-00.000Z.sqlite`);
    const doomed = selectBackupsToDelete([...names, 'inventory-v4-notes.txt', 'outro.sqlite'].reverse(), { prefix: MIGRATION_BACKUP_PREFIX });
    expect(doomed.sort()).toEqual([names[0], names[1]]);
  });
});
