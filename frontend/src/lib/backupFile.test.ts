import { describe, expect, test } from 'vitest';
import { BACKUP_MAX_BYTES, bytesToMb, isBackupTooLarge } from './backupFile';

describe('backupFile', () => {
  test('100 MB exatos passam; 1 byte a mais não', () => {
    expect(isBackupTooLarge(BACKUP_MAX_BYTES)).toBe(false);
    expect(isBackupTooLarge(BACKUP_MAX_BYTES + 1)).toBe(true);
  });
  test('bytesToMb', () => {
    expect(bytesToMb(BACKUP_MAX_BYTES)).toBe(100);
  });
});
