'use strict';

// 10.7 (D366), QA: o índice de custo como dobra pelas operações em ordem. Separação (`DETACH_COMPONENT` SPLIT) depois de aplicar sticker,
// depois de abrir caixa, antes/depois de outra separação; centavos exatos e resto na maior fração; várias moedas de origem; `estimated`
// herdado; aplicação encerrada fora do custo; e, sem separação, números idênticos aos de sempre. Puro, sem banco.
const { buildCostIndex, splitPool, BP_TOTAL } = require('../../src/services/operations/costService');

const item = (id, extra = {}) => ({ id, acquisitionType: 'COMPRA', purchasePriceCents: 1000, purchaseCurrency: 'USD', fxRateAtPurchase: null, ...extra });
const generated = (id) => item(id, { acquisitionType: 'GERADO', purchasePriceCents: 0 });
const op = (id, kind, extra = {}) => ({ id, kind, outcome: 'TRANSFERRED', undoneAt: null, endedByOperationId: null, ...extra });
const link = (operationId, itemId, role, costShareBp = null) => ({ operationId, itemId, role, costShareBp });
const split = (id, weaponId, generatedId, generatedBp) => ({
  operation: op(id, 'DETACH_COMPONENT'),
  links: [link(id, weaponId, 'TARGET', BP_TOTAL - generatedBp), link(id, generatedId, 'CREATED', generatedBp)],
});
const apply = (id, targetId, ...consumedIds) => ({
  operation: op(id, 'APPLY_COMPONENT'), links: [link(id, targetId, 'TARGET'), ...consumedIds.map((c) => link(id, c, 'CONSUMED'))],
});
const build = (items, ...parts) => buildCostIndex({
  itemsById: new Map(items.map((i) => [i.id, i])), operations: parts.map((p) => p.operation), links: parts.flatMap((p) => p.links),
});

describe('dobra pelas operações em ordem', () => {
  test('separar depois de aplicar sticker: o custo do sticker entra na divisão', () => {
    const weapon = item(1, { purchasePriceCents: 1000 });
    const sticker = item(2, { purchasePriceCents: 100 });
    const gen = generated(3);
    const index = build([weapon, sticker, gen], apply(10, 1, 2), split(11, 1, 3, 2500));
    expect(index.effectiveUsdCents(weapon)).toBe(825); // (1000 + 100) * 75 %
    expect(index.effectiveUsdCents(gen)).toBe(275);
    expect(index.effectiveOf(weapon)).toMatchObject({ ownUsdCents: 1000, inheritedUsdCents: -175 });
  });

  test('separar antes de aplicar: o sticker soma só na arma, depois da divisão', () => {
    const weapon = item(1);
    const sticker = item(2, { purchasePriceCents: 100 });
    const gen = generated(3);
    const index = build([weapon, sticker, gen], split(10, 1, 3, 3000), apply(11, 1, 2));
    expect(index.effectiveUsdCents(weapon)).toBe(800); // 700 + 100
    expect(index.effectiveUsdCents(gen)).toBe(300);
  });

  test('separar antes e depois de outra separação: duas gerações, soma exata', () => {
    const weapon = item(1);
    const index = build([weapon, generated(2), generated(3)], split(10, 1, 2, 5000), split(11, 1, 3, 5000));
    expect(index.effectiveUsdCents(weapon)).toBe(250);
    expect(index.effectiveUsdCents(generated(2))).toBe(500);
    expect(index.effectiveUsdCents(generated(3))).toBe(250);
    expect(250 + 500 + 250).toBe(1000);
  });

  test('arma gerada por abertura de caixa: o custo herdado da caixa e da chave é dividido', () => {
    const box = item(2, { purchasePriceCents: 200 });
    const key = item(3, { purchasePriceCents: 301 });
    const weapon = generated(1);
    const gen = generated(4);
    const open = { operation: op(10, 'OPEN_CASE'), links: [link(10, 2, 'CONSUMED'), link(10, 3, 'CONSUMED'), link(10, 1, 'CREATED', BP_TOTAL)] };
    const index = build([weapon, box, key, gen], open, split(11, 1, 4, 5000));
    expect(index.effectiveUsdCents(weapon)).toBe(251); // 501: o centavo do empate vai para o menor id (a arma)
    expect(index.effectiveUsdCents(gen)).toBe(250);
    expect(index.effectiveOf(weapon).ownUsdCents).toBe(0);
  });

  test('arma que recebe de duas operações antes da separação: ordem por id, não por posição na lista', () => {
    const weapon = item(1);
    const s1 = item(2, { purchasePriceCents: 50 });
    const s2 = item(3, { purchasePriceCents: 70 });
    const gen = generated(4);
    const a = apply(10, 1, 2);
    const b = apply(11, 1, 3);
    const c = split(12, 1, 4, 1000);
    const shuffled = build([weapon, s1, s2, gen], c, b, a);
    const ordered = build([weapon, s1, s2, gen], a, b, c);
    expect(shuffled.effectiveUsdCents(weapon)).toBe(ordered.effectiveUsdCents(weapon));
    expect(ordered.effectiveUsdCents(weapon)).toBe(1008); // (1000 + 50 + 70) = 1120; 90 % = 1008
    expect(ordered.effectiveUsdCents(gen)).toBe(112);
  });

  test('a unidade separada aplicada em outra arma leva o custo dividido junto', () => {
    const weapon = item(1);
    const gen = generated(2);
    const other = item(3, { purchasePriceCents: 500 });
    const index = build([weapon, gen, other], split(10, 1, 2, 2000), apply(11, 3, 2));
    expect(index.effectiveUsdCents(other)).toBe(700);
    expect(index.effectiveUsdCents(weapon)).toBe(800);
  });
});

describe('centavos exatos e resto na maior fração', () => {
  test.each([
    [1001, 3333, 668, 333], // arma 6667 (maior) fica com o resto
    [1001, 6667, 333, 668], // gerada 6667 (maior) fica com o resto
    [1001, 5000, 501, 500], // empate: o menor id (a arma)
    [1, 5000, 1, 0],
    [1, 10000, 0, 1],
    [0, 3333, 0, 0],
    [999999, 3333, 666700, 333299],
  ])('custo %i com %i bp para o pendurado: arma %i e gerada %i', (cost, bp, weaponCents, genCents) => {
    const weapon = item(1, { purchasePriceCents: cost });
    const gen = generated(2);
    const index = build([weapon, gen], split(10, 1, 2, bp));
    expect(index.effectiveUsdCents(weapon)).toBe(weaponCents);
    expect(index.effectiveUsdCents(gen)).toBe(genCents);
    expect(weaponCents + genCents).toBe(cost);
  });

  test('100 % e 0 %', () => {
    const weapon = item(1, { purchasePriceCents: 777 });
    const all = build([weapon, generated(2)], split(10, 1, 2, 10000));
    expect([all.effectiveUsdCents(weapon), all.effectiveUsdCents(generated(2))]).toEqual([0, 777]);
    const none = build([weapon, generated(2)], split(10, 1, 2, 0));
    expect([none.effectiveUsdCents(weapon), none.effectiveUsdCents(generated(2))]).toEqual([777, 0]);
  });

  test('splitPool: sempre soma o total, para qualquer bp inteiro de 0 a 10000 (varredura)', () => {
    for (const total of [0, 1, 7, 99, 1001, 123457]) {
      for (let bp = 0; bp <= BP_TOTAL; bp += 137) {
        const parts = splitPool(total, [{ id: 1, bp: BP_TOTAL - bp }, { id: 2, bp }]);
        expect(parts.get(1) + parts.get(2)).toBe(total);
        expect(parts.get(1)).toBeGreaterThanOrEqual(0);
        expect(parts.get(2)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('o vínculo sem porcentagem (nulo) na gerada vale 0 e na arma o resto', () => {
    const weapon = item(1);
    const gen = generated(2);
    const bare = { operation: op(10, 'DETACH_COMPONENT'), links: [link(10, 1, 'TARGET', null), link(10, 2, 'CREATED', null)] };
    const index = build([weapon, gen], bare);
    expect(index.effectiveUsdCents(weapon)).toBe(1000);
    expect(index.effectiveUsdCents(gen)).toBe(0);
  });
});

describe('moedas, estimativa e partes nativas (preço mínimo)', () => {
  test('arma em BRL com sticker em USD: as duas ficam estimadas e as partes nativas são escaladas por bp', () => {
    const weapon = item(1, { purchasePriceCents: 1000, purchaseCurrency: 'BRL', fxRateAtPurchase: 5 }); // US$ 2,00
    const sticker = item(2, { purchasePriceCents: 100 });
    const gen = generated(3);
    const index = build([weapon, sticker, gen], apply(10, 1, 2), split(11, 1, 3, 2500));
    const w = index.effectiveOf(weapon);
    const g = index.effectiveOf(gen);
    expect(w.effectiveUsdCents).toBe(225); // 300 * 75 %
    expect(g.effectiveUsdCents).toBe(75);
    expect(w.estimated).toBe(true);
    expect(g.estimated).toBe(true);
    expect(w.parts).toEqual([{ cents: 750, currency: 'BRL', fxRate: 5 }, { cents: 75, currency: 'USD', fxRate: null }]);
    expect(g.parts).toEqual([{ cents: 250, currency: 'BRL', fxRate: 5 }, { cents: 25, currency: 'USD', fxRate: null }]);
  });

  test('arma em USD sem nada estimado: nenhuma das duas é estimada; sticker em BRL consumido torna as duas estimadas', () => {
    const weapon = item(1);
    const gen = generated(2);
    expect(build([weapon, gen], split(10, 1, 2, 5000)).effectiveOf(gen).estimated).toBe(false);
    const sticker = item(3, { purchasePriceCents: 500, purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
    const mixed = build([weapon, gen, sticker], apply(9, 1, 3), split(10, 1, 2, 5000));
    expect(mixed.effectiveOf(weapon).estimated).toBe(true);
    expect(mixed.effectiveOf(gen).estimated).toBe(true);
  });

  test('antes da separação a arma não é estimada; a aplicação em BRL depois dela não "contamina" a gerada', () => {
    const weapon = item(1);
    const gen = generated(2);
    const sticker = item(3, { purchasePriceCents: 500, purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
    const index = build([weapon, gen, sticker], split(9, 1, 2, 5000), apply(10, 1, 3));
    expect(index.effectiveOf(gen).estimated).toBe(false);
    expect(index.effectiveOf(weapon).estimated).toBe(true);
  });

  test('GANHEI (custo 0) separado: 0 e 0, e a parte nativa continua 0', () => {
    const won = item(1, { acquisitionType: 'GANHEI', purchasePriceCents: 0 });
    const gen = generated(2);
    const index = build([won, gen], split(10, 1, 2, 4000));
    expect(index.effectiveUsdCents(won)).toBe(0);
    expect(index.effectiveUsdCents(gen)).toBe(0);
    expect(index.costParts(won).every((p) => p.cents === 0)).toBe(true);
  });
});

describe('encerrada, desfeita e RETURN fora do custo', () => {
  test('aplicação encerrada por uma separação RETURN: arma volta ao próprio e a unidade devolvida ao dela', () => {
    const weapon = item(1, { purchasePriceCents: 1000 });
    const unit = item(2, { purchasePriceCents: 300 });
    const applyOp = apply(10, 1, 2);
    const ended = { ...applyOp, operation: { ...applyOp.operation, endedByOperationId: 11 } };
    const ret = { operation: op(11, 'DETACH_COMPONENT'), links: [link(11, 1, 'TARGET'), link(11, 2, 'TARGET')] };
    const before = build([weapon, unit], applyOp);
    expect(before.effectiveUsdCents(weapon)).toBe(1300);
    const after = build([weapon, unit], ended, ret);
    expect(after.effectiveUsdCents(weapon)).toBe(1000);
    expect(after.effectiveUsdCents(unit)).toBe(300);
    expect(after.hasOperations).toBe(true); // a RETURN ativa
    expect(after.activeOperations.has(10)).toBe(false);
  });

  test('RETURN sozinho (sem CREATED) não muda nenhum custo; separação desfeita não conta', () => {
    const weapon = item(1);
    const unit = item(2, { purchasePriceCents: 300 });
    const ret = { operation: op(11, 'DETACH_COMPONENT'), links: [link(11, 1, 'TARGET'), link(11, 2, 'TARGET')] };
    const index = build([weapon, unit], ret);
    expect([index.effectiveUsdCents(weapon), index.effectiveUsdCents(unit)]).toEqual([1000, 300]);
    const undone = split(12, 1, 3, 5000);
    undone.operation.undoneAt = '2026-11-20T00:00:00.000Z';
    expect(build([weapon, generated(3)], undone).effectiveUsdCents(weapon)).toBe(1000);
  });

  test('separação encerrada (endedByOperationId) sai do custo como a desfeita', () => {
    const weapon = item(1);
    const gen = generated(2);
    const s = split(10, 1, 2, 5000);
    s.operation.endedByOperationId = 99;
    expect(build([weapon, gen], s).effectiveUsdCents(weapon)).toBe(1000);
  });

  test('aplicação encerrada no meio de duas aplicações: só a ativa conta, mesmo depois de separar', () => {
    const weapon = item(1);
    const s1 = item(2, { purchasePriceCents: 50 });
    const s2 = item(3, { purchasePriceCents: 70 });
    const gen = generated(4);
    const a = apply(10, 1, 2);
    a.operation.endedByOperationId = 20;
    const b = apply(11, 1, 3);
    const c = split(12, 1, 4, 5000);
    const index = build([weapon, s1, s2, gen], a, b, c);
    expect(index.effectiveUsdCents(weapon)).toBe(535); // (1000 + 70) / 2
    expect(index.effectiveUsdCents(gen)).toBe(535);
  });
});

describe('sem separação os números são idênticos', () => {
  test('mesmas aplicações e aberturas: o índice com e sem operações de separação inativas dá o mesmo custo', () => {
    const weapon = item(1);
    const s1 = item(2, { purchasePriceCents: 33 });
    const box = item(3, { purchasePriceCents: 200 });
    const key = item(4, { purchasePriceCents: 300 });
    const opened = generated(5);
    const open = { operation: op(11, 'OPEN_CASE'), links: [link(11, 3, 'CONSUMED'), link(11, 4, 'CONSUMED'), link(11, 5, 'CREATED', BP_TOTAL)] };
    const base = build([weapon, s1, box, key, opened], apply(10, 1, 2), open);
    const gen = generated(6);
    const undone = split(12, 1, 6, 4000);
    undone.operation.undoneAt = '2026-11-20T00:00:00.000Z';
    const withUndone = build([weapon, s1, box, key, opened, gen], apply(10, 1, 2), open, undone);
    for (const i of [weapon, s1, box, key, opened]) {
      expect(withUndone.effectiveOf(i)).toEqual(base.effectiveOf(i));
    }
    expect(base.effectiveUsdCents(weapon)).toBe(1033);
    expect(base.effectiveUsdCents(opened)).toBe(500);
  });

  test('índice vazio devolve o custo próprio', () => {
    const weapon = item(1, { purchasePriceCents: 1234 });
    expect(buildCostIndex().effectiveUsdCents(weapon)).toBe(1234);
    expect(build([weapon]).effectiveUsdCents(weapon)).toBe(1234);
  });

  test('ciclo de operação continua sendo detectado e uma arma não carregada dá erro claro', () => {
    const gen = generated(2);
    const only = { operation: op(10, 'DETACH_COMPONENT'), links: [link(10, 1, 'TARGET', 5000), link(10, 2, 'CREATED', 5000)] };
    expect(() => buildCostIndex({ itemsById: new Map([[2, gen]]), operations: [only.operation], links: only.links }).effectiveUsdCents(gen)).toThrow(/não carregada/);
  });
});
