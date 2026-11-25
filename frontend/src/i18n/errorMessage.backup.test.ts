import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { API_ERROR_CODES } from './errorCodes';
import { errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);

const BACKUP_CODES = ['BACKUP_BUSY', 'BACKUP_UNAVAILABLE', 'BACKUP_INVALID_FILE', 'BACKUP_CORRUPTED', 'BACKUP_NEWER_VERSION', 'BACKUP_IMPORT_FAILED'];

describe('erros de backup (6.3)', () => {
  test('os códigos novos estão na lista e traduzidos nos dois idiomas', () => {
    for (const code of BACKUP_CODES) {
      expect(API_ERROR_CODES).toContain(code);
      expect(tPt(`errors.${code}`), code).not.toBe(`errors.${code}`);
      expect(tEn(`errors.${code}`), code).not.toBe(`errors.${code}`);
    }
  });

  test('BACKUP_NEWER_VERSION usa fileVersion e appVersion de params', () => {
    const e = new ApiRequestError('BACKUP_NEWER_VERSION', 'm', 400, { params: { fileVersion: 9, appVersion: 5 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toContain('9');
    expect(errorMessageFor(e, tPt, 'pt-BR')).toContain('5');
    expect(errorMessageFor(e, tEn, 'en')).toMatch(/format 9.*up to 5/);
  });

  test('BACKUP_NEWER_VERSION sem params cai na mensagem genérica, sem {placeholder}', () => {
    const e = new ApiRequestError('BACKUP_NEWER_VERSION', 'm', 400);
    expect(errorMessageFor(e, tPt, 'pt-BR')).not.toMatch(/[{}]/);
    expect(errorMessageFor(e, tEn, 'en')).not.toMatch(/[{}]/);
  });

  test('PAYLOAD_TOO_LARGE e UNSUPPORTED_MEDIA_TYPE continuam traduzidos', () => {
    for (const code of ['PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE']) {
      const e = new ApiRequestError(code, 'm', 413, { params: { maxBytes: 104857600 } });
      expect(errorMessageFor(e, tPt, 'pt-BR')).not.toBe('');
      expect(errorMessageFor(e, tEn, 'en')).not.toMatch(/^errors\./);
    }
  });
});
