const { selectBackupsToDelete, assessBackupFile, buildExportFileName } = require('../../src/services/backupService');

const IMPORT = 'inventory-before-import-v';
const MIG = 'inventory-v';
const stamp = (n) => `2026-11-${String(n).padStart(2, '0')}T10-00-00.000Z`;

describe('selectBackupsToDelete', () => {
  test('mantém os mais novos mesmo com nomes fora de ordem', () => {
    const names = [12, 3, 25, 1, 7].map((d) => `${IMPORT}4-${stamp(d)}.sqlite`);
    expect(selectBackupsToDelete(names, { prefix: IMPORT, keep: 3 }).sort()).toEqual(
      [`${IMPORT}4-${stamp(1)}.sqlite`, `${IMPORT}4-${stamp(3)}.sqlite`].sort()
    );
  });

  test('tipos são independentes e nome fora do padrão nunca é apagado', () => {
    const names = [
      ...[1, 2, 3].map((d) => `${IMPORT}4-${stamp(d)}.sqlite`),
      ...[1, 2, 3].map((d) => `${MIG}3-${stamp(d)}.sqlite`),
      'inventory-v3-copia-manual.sqlite',
      `inventory-v3-${stamp(1)}.sqlite.bak`,
      'notas.txt',
    ];
    expect(selectBackupsToDelete(names, { prefix: IMPORT, keep: 1 })).toHaveLength(2);
    expect(selectBackupsToDelete(names, { prefix: IMPORT, keep: 1 }).every((n) => n.startsWith(IMPORT))).toBe(true);
    expect(selectBackupsToDelete(names, { prefix: MIG, keep: 1 }).every((n) => n.startsWith(MIG))).toBe(true);
    expect(selectBackupsToDelete(names, { prefix: MIG, keep: 10 })).toEqual([]);
  });

  test('empate de carimbo usa a data de modificação', () => {
    const files = [
      { name: `${MIG}1-${stamp(1)}.sqlite`, mtimeMs: 100 },
      { name: `${MIG}2-${stamp(1)}.sqlite`, mtimeMs: 200 },
    ];
    expect(selectBackupsToDelete(files, { prefix: MIG, keep: 1 })).toEqual([`${MIG}1-${stamp(1)}.sqlite`]);
  });
});

describe('assessBackupFile', () => {
  const tables = ['stores', 'items', 'settings', 'deposits', 'withdrawals', 'store_balances'];
  const SKMG = 1397444935;
  const { REQUIRED_COLUMNS } = require('../../src/services/backupService');
  const columns = Object.fromEntries(Object.entries(REQUIRED_COLUMNS).map(([t, c]) => [t, [...c, 'extra']]));
  test('items sem status é recusado (BACKUP_INVALID_FILE)', () => {
    const noStatus = { ...columns, items: columns.items.filter((c) => c !== 'status') };
    expect(assessBackupFile({ userVersion: 5, applicationId: SKMG, tables, columns: noStatus }, 5).code).toBe('BACKUP_INVALID_FILE');
    expect(assessBackupFile({ userVersion: 5, applicationId: SKMG, tables }, 5).code).toBe('BACKUP_INVALID_FILE');
  });
  test('aceita v4 com SKMG e v3 sem marca', () => {
    expect(assessBackupFile({ userVersion: 4, applicationId: SKMG, tables, columns }, 4).accepted).toBe(true);
    expect(assessBackupFile({ userVersion: 3, applicationId: 0, tables, columns }, 4).accepted).toBe(true);
  });
  test('recusa casos inválidos', () => {
    expect(assessBackupFile({ userVersion: 0, applicationId: 0, tables, columns }, 4).code).toBe('BACKUP_INVALID_FILE');
    expect(assessBackupFile({ userVersion: 3, applicationId: 5, tables, columns }, 4).code).toBe('BACKUP_INVALID_FILE');
    expect(assessBackupFile({ userVersion: 4, applicationId: 0, tables, columns }, 4).code).toBe('BACKUP_INVALID_FILE');
    expect(assessBackupFile({ userVersion: 3, applicationId: 0, tables: ['items'] }, 4).code).toBe('BACKUP_INVALID_FILE');
  });
  test('versão futura', () => {
    expect(assessBackupFile({ userVersion: 9, applicationId: SKMG, tables, columns }, 4)).toEqual({
      accepted: false,
      code: 'BACKUP_NEWER_VERSION',
      params: { fileVersion: 9, appVersion: 4 },
    });
  });
});

test('buildExportFileName', () => {
  expect(buildExportFileName(4, new Date(2026, 10, 20, 9, 5))).toBe('skins-manager-backup-v4-2026-11-20-0905.sqlite');
});
