import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, WARNING_CODES } from './errorCodes';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

// QA Revisão 23 (D254, D255, D256): sem saldo inicial em lugar nenhum, orientação startHint e totais no topo.
const src = path.join(__dirname, '..');
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const prod = walk(src).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const flatPt = flatten(ptBR);
const flatEn = flatten(en);

describe('sem saldo inicial', () => {
  test('nenhuma chave nem texto de tradução menciona saldo inicial', () => {
    for (const [dict, name] of [[flatPt, 'pt-BR'], [flatEn, 'en']] as const) {
      for (const [key, text] of Object.entries(dict)) {
        expect(key, `${name} ${key}`).not.toMatch(/initial(Balance|Hint|Saved|Deleted|Form)|noInitial|setInitial|editInitial|deleteInitial|breakdown\.initial$|kind\.INITIAL|BEFORE_INITIAL/i);
        expect(text, `${name} ${key}`).not.toMatch(/saldo inicial|starting balance|initial balance|opening balance/i);
      }
    }
  });

  test('arquivos removidos não existem e nada no código de produção os importa nem cita', () => {
    for (const f of ['components/InitialBalanceFormModal.tsx', 'lib/initialBalanceForm.ts', 'lib/initialBalanceForm.test.ts']) {
      expect(existsSync(path.join(src, f)), f).toBe(false);
    }
    for (const file of prod) {
      const code = readFileSync(file, 'utf-8');
      expect(code, file).not.toMatch(/initialBalanceForm|InitialBalanceFormModal|putInitialBalance|initialBalance|initialCents|BALANCE_CHECK_BEFORE_INITIAL|'INITIAL'/);
    }
  });

  test('errorCodes.ts sem BEFORE_INITIAL; mantém BEFORE_LAST e ADJUSTMENT_NOTE_REQUIRED; avisos coerentes', () => {
    const codes = API_ERROR_CODES as readonly string[];
    expect(codes).not.toContain('BALANCE_CHECK_BEFORE_INITIAL');
    expect(codes).toContain('BALANCE_CHECK_BEFORE_LAST');
    expect(codes).toContain('ADJUSTMENT_NOTE_REQUIRED');
    expect(flatPt['errors.BALANCE_CHECK_BEFORE_INITIAL']).toBeUndefined();
    expect(flatEn['errors.BALANCE_CHECK_BEFORE_INITIAL']).toBeUndefined();
    expect(WARNING_CODES as readonly string[]).toContain('COMPUTED_BALANCE_NEGATIVE');
  });

  test('o código do backend não emite mais BEFORE_INITIAL nem a rota initial', () => {
    const backend = path.join(src, '..', '..', 'backend', 'src');
    for (const file of walk(backend).filter((f) => f.endsWith('.js') && !/migrations/.test(f))) {
      const code = readFileSync(file, 'utf-8');
      expect(code, file).not.toMatch(/BEFORE_INITIAL|putInitialBalance|upsertInitial|findInitial|initial\/:storeId/);
    }
  });
});

describe('paridade e textos novos', () => {
  test('pt-BR e en têm as mesmas chaves e os mesmos {marcadores}', () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatPt).sort());
    for (const key of Object.keys(flatPt)) expect(holders(flatEn[key]), key).toEqual(holders(flatPt[key]));
  });

  test('startHint, totalsTitle e totalPendingDate nos dois idiomas, com os textos confirmados', () => {
    expect(translate(ptBR, 'storeBalances.startHint')).toBe('Não quer lançar o histórico antigo? Registre um aporte com o saldo atual da loja. O lucro real passa a ser medido a partir dessa data.');
    expect(translate(en, 'storeBalances.startHint')).toBe("Don't want to enter your old history? Record a deposit with the store's current balance. Real profit will be measured from that date on.");
    expect(translate(ptBR, 'storeBalances.totalsTitle')).toBe('Total nas lojas');
    expect(translate(en, 'storeBalances.totalsTitle')).toBe('Total in stores');
    for (const dict of [ptBR, en]) {
      expect(holders(translate(dict, 'storeBalances.totalPendingDate'))).toEqual(['{date}', '{value}']);
      expect(holders(translate(dict, 'storeBalances.totalPending'))).toEqual(['{value}']);
    }
  });

  test('o texto do saldo negativo não manda mais ao saldo inicial e existe nos dois idiomas', () => {
    for (const dict of [ptBR, en]) {
      const text = translate(dict, 'warnings.COMPUTED_BALANCE_NEGATIVE');
      expect(text).not.toBe('warnings.COMPUTED_BALANCE_NEGATIVE');
      expect(text).not.toMatch(/inicial|starting|initial/i);
    }
  });
});

describe('orientação e totais na tela', () => {
  const read = (f: string) => readFileSync(path.join(src, 'components', f), 'utf-8');

  test('startHint aparece no painel e no modal de aporte, em estilo discreto (sem role de alerta)', () => {
    for (const file of ['StoreBalancesPanel.tsx', 'DepositFormModal.tsx']) {
      const code = read(file);
      expect(code, file).toContain("t('storeBalances.startHint')");
      const line = code.split('\n').find((l) => l.includes("storeBalances.startHint")) ?? '';
      expect(line).not.toMatch(/role="alert"|warning/);
    }
  });

  test('a barra de totais vem antes da lista de lojas e não há rodapé de totais', () => {
    const code = read('StoreBalancesPanel.tsx');
    expect(code.indexOf('totalsBar')).toBeGreaterThan(-1);
    expect(code.indexOf("t('storeBalances.totalsTitle')")).toBeLessThan(code.indexOf('styles.list'));
    expect(code.match(/storeBalances\.totalAvailable/g)).toHaveLength(1);
    expect(code).not.toMatch(/<footer/);
  });

  test('o frontend não soma: totais vêm de data.totals', () => {
    const code = read('StoreBalancesPanel.tsx');
    expect(code).toContain('data.totals.availableUsdCents');
    expect(code).not.toMatch(/\.reduce\(/);
  });
});
