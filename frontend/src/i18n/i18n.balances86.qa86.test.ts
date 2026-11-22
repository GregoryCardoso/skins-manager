import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { buildCheckPreviewQuery, buildStoreBalanceBody, validateStoreBalanceForm } from '@/lib/storeBalanceForm';
import { API_ERROR_CODES, WARNING_CODES } from './errorCodes';
import { errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

// QA 8.6: códigos de erro e de aviso do backend de saldos, nos dois idiomas, e bordas dos formulários.
const backend = (file: string) => readFileSync(path.join(__dirname, '..', '..', '..', 'backend', 'src', file), 'utf-8');
const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const apiError = (code: string, field?: string) => new ApiRequestError(code, 'msg do backend', 400, { field });

describe('códigos do backend de saldos têm texto nos dois idiomas', () => {
  const sources = [
    'services/storeBalanceService.js', 'middlewares/storeBalanceValidators.js', 'middlewares/validateIdParam.js',
    'models/StoreBalance.js', 'controllers/storeBalanceController.js',
  ];
  const codes = new Set<string>();
  for (const file of sources) {
    for (const m of backend(file).matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)) {
      // só literais usados como código de erro (segundo argumento de ValidationError/NotFoundError ou RECORDED_AT_...)
      if (/^(INITIAL|CHECK|USD|BRL|COMPRA|GANHEI|VENDIDO|EM_ESTOQUE)$/.test(m[1])) continue;
      codes.add(m[1]);
    }
  }

  test('a varredura encontrou os códigos esperados', () => {
    for (const c of ['REQUIRED_FIELD', 'STORE_NOT_FOUND', 'INVALID_AMOUNT', 'RECORDED_AT_IN_FUTURE',
      'BALANCE_CHECK_BEFORE_LAST', 'ADJUSTMENT_NOTE_REQUIRED', 'FIELD_TOO_LONG', 'STORE_BALANCE_NOT_FOUND', 'INVALID_QUERY', 'INVALID_ID']) {
      expect(codes.has(c), c).toBe(true);
    }
  });

  test.each([...codes])('%s está em API_ERROR_CODES e traduzido em pt-BR e en', (code) => {
    expect(API_ERROR_CODES as readonly string[]).toContain(code);
    expect(tPt(`errors.${code}`)).not.toBe(`errors.${code}`);
    expect(tEn(`errors.${code}`)).not.toBe(`errors.${code}`);
  });

  test('avisos do backend (warnings.js) estão em WARNING_CODES e traduzidos; BALANCE_MAYBE_OUTDATED não existe mais', () => {
    const warnings = backend('services/warnings.js');
    const wcodes = [...warnings.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(wcodes.length).toBeGreaterThanOrEqual(5);
    for (const code of wcodes) {
      expect(WARNING_CODES as readonly string[], code).toContain(code);
      expect(tPt(`warnings.${code}`), code).not.toBe(`warnings.${code}`);
      expect(tEn(`warnings.${code}`), code).not.toBe(`warnings.${code}`);
    }
    expect(wcodes).not.toContain('BALANCE_MAYBE_OUTDATED');
    expect([...WARNING_CODES].sort()).toEqual([...wcodes].sort());
  });
});

describe('errorMessageFor para os erros novos', () => {
  test.each(['ADJUSTMENT_NOTE_REQUIRED', 'BALANCE_CHECK_BEFORE_LAST'])('%s: texto próprio, diferente do código e entre idiomas', (code) => {
    const pt = errorMessageFor(apiError(code, 'recordedAt'), tPt, 'pt-BR');
    const enText = errorMessageFor(apiError(code, 'recordedAt'), tEn, 'en');
    expect(pt).not.toBe('msg do backend');
    expect(enText).not.toBe('msg do backend');
    expect(pt).not.toBe(enText);
    expect(pt).not.toMatch(/errors\./);
  });

  test('textos confirmados em D247', () => {
    expect(tPt('errors.ADJUSTMENT_NOTE_REQUIRED')).toBe('Informe uma observação para o ajuste.');
    expect(tEn('errors.BALANCE_CHECK_BEFORE_LAST')).toBe('The check cannot be earlier than the last check. Delete the most recent one to correct it.');
    expect(tPt('warnings.COMPUTED_BALANCE_NEGATIVE')).toBe('Saldo calculado negativo: registre o aporte que falta ou confira as compras e os saques.');
  });

  test('FIELD_TOO_LONG da nota usa o limite do backend; código desconhecido cai na mensagem do backend', () => {
    const e = new ApiRequestError('FIELD_TOO_LONG', 'x', 400, { field: 'note', params: { maxLength: 500 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toContain('500');
    expect(errorMessageFor(new ApiRequestError('CODIGO_NOVO', 'mensagem do servidor', 400), tPt, 'pt-BR')).toBe('mensagem do servidor');
  });
});

describe('formulários do saldo: bordas', () => {
  const check = { amountText: '10', recordedAt: '2026-11-21T09:05', noteText: '' };

  test('conferência: en aceita "1,234.50" (milhar com vírgula) e recusa "1.234,50"', () => {
    expect(validateStoreBalanceForm({ ...check, amountText: '1,234.50' }, 'en')).toEqual({});
    expect(buildStoreBalanceBody({ ...check, amountText: '1,234.50' }, 3, 'en').balanceCents).toBe(123450);
    expect(validateStoreBalanceForm({ ...check, amountText: '1.234,50' }, 'en').balanceCents).toBe('storeBalances.form.invalidMoney');
  });

  test('conferência: corpo com adjust false não leva nota vazia; com nota só com espaços não envia a chave', () => {
    const body = buildStoreBalanceBody({ ...check, noteText: '    ' }, 3, 'pt-BR', false);
    expect(body).toMatchObject({ storeId: 3, adjust: false });
    expect(body).not.toHaveProperty('note');
    expect(buildStoreBalanceBody({ ...check, noteText: ' taxa ' }, 3, 'pt-BR', true)).toMatchObject({ adjust: true, note: 'taxa' });
  });

  test('conferência: nota só com espaços com ajuste -> erro local ADJUSTMENT_NOTE_REQUIRED; sem ajuste, nenhum', () => {
    expect(validateStoreBalanceForm({ ...check, noteText: ' \t ' }, 'pt-BR', { adjust: true }).note).toBe('errors.ADJUSTMENT_NOTE_REQUIRED');
    expect(validateStoreBalanceForm({ ...check, noteText: ' \t ' }, 'pt-BR')).toEqual({});
  });

  test('a chave de erro local da nota existe nos dois idiomas', () => {
    expect(tPt('errors.ADJUSTMENT_NOTE_REQUIRED')).not.toBe('errors.ADJUSTMENT_NOTE_REQUIRED');
    expect(tEn('errors.ADJUSTMENT_NOTE_REQUIRED')).not.toBe('errors.ADJUSTMENT_NOTE_REQUIRED');
  });

  test('chaves de erro locais dos formulários existem nos dois idiomas', () => {
    const keys = [
      ...Object.values(validateStoreBalanceForm({ amountText: '', recordedAt: '', noteText: '' }, 'pt-BR', { adjust: true })),
      ...Object.values(validateStoreBalanceForm({ amountText: 'x', recordedAt: '', noteText: '' }, 'pt-BR')),
    ];
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const key of keys) {
      expect(tPt(key as string), key).not.toBe(key);
      expect(tEn(key as string), key).not.toBe(key);
    }
  });

  test('prévia: nula com valor ou data inválidos, vazios ou só espaços; valor 0 gera consulta', () => {
    expect(buildCheckPreviewQuery({ ...check, amountText: '' }, 1, 'pt-BR')).toBeNull();
    expect(buildCheckPreviewQuery({ ...check, amountText: '  ' }, 1, 'pt-BR')).toBeNull();
    expect(buildCheckPreviewQuery({ ...check, amountText: 'abc' }, 1, 'pt-BR')).toBeNull();
    expect(buildCheckPreviewQuery({ ...check, recordedAt: '2026-13-01T00:00' }, 1, 'pt-BR')).toBeNull();
    expect(buildCheckPreviewQuery({ ...check, amountText: '0' }, 7, 'pt-BR')).toMatchObject({ storeId: 7, balanceCents: 0 });
  });
});

describe('o frontend não calcula o saldo (D74)', () => {
  test('os componentes do painel não somam o breakdown nem as parcelas', () => {
    const dir = path.join(__dirname, '..', 'components');
    for (const file of ['StoreBalancesPanel.tsx', 'StoreBalanceFormModal.tsx', 'StoreBalanceHistory.tsx']) {
      const source = readFileSync(path.join(dir, file), 'utf-8');
      expect(source, file).not.toMatch(/breakdown\.\w+\s*[-+]\s*\w*\.?breakdown/);
      expect(source, file).not.toMatch(/\.reduce\(/);
      expect(source, file).not.toMatch(/availableCents\s*[-+]/);
    }
  });
});
