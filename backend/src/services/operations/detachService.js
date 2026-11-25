'use strict';

// "Separar" o chaveiro ou o Sticker Slab da arma (D355, D366; 2.2.2 e 2.2.3, Revisão 33). É o evento do jogo, não um desfazer.
// Dois modos, escolhidos pela origem do componente:
//   RETURN: o pendurado foi aplicado do estoque; a unidade consumida original volta ao estoque, à venda, com o custo dela e o giro
//           recomeçando na data da separação. A aplicação fica encerrada (`ended_by_operation_id`).
//   SPLIT:  o pendurado veio junto com a arma; nasce uma unidade `GERADO` ("separado de <arma>") e o CUSTO EFETIVO INTEIRO da arma
//           (inclusive o herdado de stickers, patches, caixa e terminal) é dividido entre as duas, proporcionalmente aos valores avaliados
//           (E-P2-Q59 e Q62): parte do pendurado = preço do pendurado / (valor da arma sem o pendurado + preço do pendurado), pelos preços
//           do cache `market_prices` (sem rede). A porcentagem é sempre editável e só é obrigatória quando falta um dos dois preços.
// O custo se conserva: lucro real e saldo das lojas não mudam. Nenhum valor convertido é gravado (2.0).
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const ItemOperation = require('../../models/ItemOperation');
const { runInTransaction } = require('../../models/modelHelpers');
const { AppError, NotFoundError, ConflictError, ValidationError } = require('../../errors/AppError');
const catalogService = require('../catalogService');
const itemService = require('../itemService');
const itemComponentService = require('../itemComponentService');
const { parseDate } = require('../dateUtils');
const valuationService = require('../valuation/valuationService');
const valuationIndex = require('../valuation/valuationIndex');
const { buildPriceTarget } = require('../valuation/marketHashName');
const { assertDate, invalidDate } = require('./operationDates');
const operationContext = require('./operationContext');
const { splitPool, BP_TOTAL } = require('./costService');

const isNil = (v) => v === null || v === undefined;
const MAX_NOTE_LENGTH = 500;
// Id fictício da unidade que será criada, só para a prévia: ela terá id maior que o da arma, então o empate vai para a arma.
const FUTURE_ID = Number.MAX_SAFE_INTEGER;

const unprocessable = (code, message, extra) => new AppError(422, code, message, extra);
const invalidInput = (reason, message, field, params = {}) => unprocessable('INVALID_OPERATION_INPUT', message, { field, params: { reason, ...params } });

function findWeaponOrFail(itemId) {
  const weapon = Item.findById(itemId);
  if (!weapon) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND', { params: { itemId, role: 'TARGET' } });
  if (weapon.status === 'CONSUMIDO') throw new ConflictError('Esta unidade foi consumida: desfaça a operação antes.', 'ITEM_CONSUMED', { params: { itemId: weapon.id } });
  if (weapon.status !== 'EM_ESTOQUE') throw new ConflictError('O item não está em estoque.', 'ITEM_NOT_IN_STOCK', { params: { itemId: weapon.id, role: 'TARGET', status: weapon.status } });
  return weapon;
}

// Arma em estoque + componente dela que pode ser separado + modo. Em RETURN, também a aplicação e a unidade consumida.
function loadSubject(itemId, componentId) {
  const weapon = findWeaponOrFail(itemId);
  const component = ItemComponent.findById(componentId);
  if (!component || component.itemId !== weapon.id) throw new NotFoundError('Componente não encontrado.', 'COMPONENT_NOT_FOUND', { params: { componentId } });
  if (!itemComponentService.isDetachable(component.kind)) {
    throw new ConflictError('Só o chaveiro e o Sticker Slab podem ser separados.', 'COMPONENT_NOT_DETACHABLE', { params: { componentId, kind: component.kind } });
  }
  if (component.origin !== 'APPLIED_FROM_STOCK') return { weapon, component, mode: 'SPLIT', applyOperation: null, returned: null };
  const applyOperation = ItemOperation.findById(component.operationId);
  const returned = Item.findById(component.sourceItemId);
  if (!applyOperation || !returned || returned.status !== 'CONSUMIDO') {
    throw new ConflictError('Não foi possível encontrar a unidade aplicada.', 'COMPONENT_NOT_DETACHABLE', { params: { componentId, kind: component.kind } });
  }
  return { weapon, component, mode: 'RETURN', applyOperation, returned };
}

// Porcentagem do pendurado: inteiro de 0 a 10000 (duas casas).
function parseShare(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > BP_TOTAL) {
    throw invalidInput('SHARE_INVALID', 'A porcentagem deve ser um inteiro de 0 a 10000 (pontos-base).', 'hangingShareBp', { max: BP_TOTAL });
  }
  return value;
}

// Preços de referência (cache, sem rede) da arma sem o pendurado e do pendurado, mais a sugestão. Só leitura.
function loadSuggestion(weapon, component, { now }) {
  const rows = valuationIndex.loadPriceRows();
  const priceOf = (key) => rows.get(key) ?? null;
  const ids = [weapon.catalogId, component.catalogId].filter((id) => !isNil(id));
  const catalogById = new Map(catalogService.getCatalogItemsByIds(ids).map((c) => [c.id, c]));
  const empty = { hangingShareBp: null, basePriceCents: null, hangingPriceCents: null, basePricedAt: null, hangingPricedAt: null, pricedAt: null, isStale: false };
  // Mesmo cálculo de unidade da 10.5 (item, sem componentes na soma).
  const base = valuationService.valueUnit({ item: weapon, components: [], priceOf, catalogById, now });
  if (base.status !== 'OK') {
    return { suggestion: null, reason: base.status === 'NOT_PRICEABLE' ? 'WEAPON_NOT_PRICEABLE' : 'WEAPON_NO_PRICE', prices: empty };
  }
  const target = buildPriceTarget(component, { catalogById });
  const hangingRow = target.notPriceable ? null : priceOf(target.priceKey);
  const hasHangingPrice = Boolean(hangingRow) && !isNil(hangingRow.basePriceCents) && !isNil(hangingRow.pricedAt);
  const prices = { ...empty, basePriceCents: base.parts.baseCents, basePricedAt: base.pricedAt };
  if (!hasHangingPrice) return { suggestion: null, reason: 'HANGING_NO_PRICE', prices };
  const total = base.parts.baseCents + hangingRow.basePriceCents;
  const pricedAt = Date.parse(base.pricedAt) <= Date.parse(hangingRow.pricedAt) ? base.pricedAt : hangingRow.pricedAt;
  const known = {
    ...prices, hangingPriceCents: hangingRow.basePriceCents, hangingPricedAt: hangingRow.pricedAt, pricedAt,
    isStale: Boolean(base.isStale) || valuationService.isStaleRow(hangingRow, now),
  };
  if (total <= 0) return { suggestion: null, reason: 'WEAPON_NO_PRICE', prices: known };
  return { suggestion: { ...known, hangingShareBp: Math.round((BP_TOTAL * hangingRow.basePriceCents) / total) }, reason: null, prices: known };
}

function detachedDescriptor(subject) {
  const { component, mode, returned } = subject;
  if (mode === 'RETURN') return { category: returned.category, name: returned.name, catalogId: returned.catalogId ?? null, returnedItemId: returned.id };
  const isSlab = component.kind === 'STICKER_SLAB';
  return { category: isSlab ? 'OUTRO' : 'PINGENTE', name: component.name, catalogId: isSlab ? null : component.catalogId ?? null };
}

function previewDetach({ itemId, componentId, hangingShareBp = null }, { now = new Date() } = {}) {
  const subject = loadSubject(itemId, componentId);
  const { weapon, mode } = subject;
  if (mode === 'RETURN') {
    if (!isNil(hangingShareBp)) throw invalidInput('SHARE_NOT_ALLOWED', 'A porcentagem só vale para o pendurado que veio junto com a arma.', 'hangingShareBp');
    const current = operationContext.loadOperationContext([weapon]).costIndex.effectiveOf(weapon);
    // Custo sem a aplicação (como ficará depois de encerrá-la) e o da unidade devolvida (o dela, de antes da aplicação).
    const after = operationContext.loadOperationContext([weapon, subject.returned], { excludeOperationId: subject.applyOperation.id });
    const afterWeapon = after.costIndex.effectiveOf(weapon);
    const afterReturned = after.costIndex.effectiveOf(subject.returned);
    return {
      mode,
      component: componentSummary(subject.component),
      weapon: { effectiveUsdCents: current.effectiveUsdCents, estimated: current.estimated },
      suggestion: null,
      suggestionUnavailableReason: null,
      valuedTotalUsdCents: null,
      result: afterWeapon.effectiveUsdCents === null || afterReturned.effectiveUsdCents === null
        ? null : { weaponUsdCents: afterWeapon.effectiveUsdCents, detachedUsdCents: afterReturned.effectiveUsdCents },
      detached: detachedDescriptor(subject),
    };
  }
  const share = isNil(hangingShareBp) ? null : parseShare(hangingShareBp);
  const { suggestion, reason } = loadSuggestion(weapon, subject.component, { now });
  const cost = operationContext.loadOperationContext([weapon]).costIndex.effectiveOf(weapon);
  const used = share ?? (suggestion ? suggestion.hangingShareBp : null);
  let result = null;
  if (used !== null && cost.effectiveUsdCents !== null) {
    const parts = splitPool(cost.effectiveUsdCents, [{ id: weapon.id, bp: BP_TOTAL - used }, { id: FUTURE_ID, bp: used }]);
    result = { weaponUsdCents: parts.get(weapon.id), detachedUsdCents: parts.get(FUTURE_ID) };
  }
  return {
    mode,
    component: componentSummary(subject.component),
    weapon: { effectiveUsdCents: cost.effectiveUsdCents, estimated: cost.estimated },
    suggestion,
    suggestionUnavailableReason: reason,
    // Valor avaliado do conjunto (arma sem o pendurado + pendurado), pelo cache.
    valuedTotalUsdCents: suggestion ? suggestion.basePriceCents + suggestion.hangingPriceCents : null,
    appliedShareBp: used,
    result,
    detached: detachedDescriptor(subject),
  };
}

function componentSummary(component) {
  return {
    id: component.id, kind: component.kind, catalogId: component.catalogId ?? null, name: component.name, slot: component.slot ?? null,
    pattern: component.pattern ?? null, source: component.source, origin: component.origin,
  };
}

function componentSnapshot(component) {
  return {
    kind: component.kind, catalogId: component.catalogId ?? null, name: component.name, slot: component.slot ?? null, wear: component.wear ?? null,
    pattern: component.pattern ?? null, purchaseReferenceCents: component.purchaseReferenceCents ?? null, source: component.source, origin: component.origin,
    sourceItemId: component.sourceItemId ?? null, operationId: component.operationId ?? null,
  };
}

function normalizeNote(note) {
  if (isNil(note)) return null;
  const text = String(note).trim();
  if (text.length > MAX_NOTE_LENGTH) {
    throw unprocessable('FIELD_TOO_LONG', `A observação deve ter no máximo ${MAX_NOTE_LENGTH} caracteres.`, { field: 'note', params: { maxLength: MAX_NOTE_LENGTH } });
  }
  return text === '' ? null : text;
}

// `input`: { itemId, componentId, detachedAt?, hangingShareBp?, tradeUnlockAt?, note? }. Devolve { operation, weapon, detachedItem }.
function detachComponent(input, { now = new Date() } = {}) {
  return runInTransaction(() => {
    const subject = loadSubject(input.itemId, input.componentId);
    const { weapon, component, mode } = subject;
    if (mode === 'RETURN' && !isNil(input.hangingShareBp)) {
      throw invalidInput('SHARE_NOT_ALLOWED', 'A porcentagem só vale para o pendurado que veio junto com a arma.', 'hangingShareBp');
    }
    const detachedAt = isNil(input.detachedAt) ? now : parseDate(input.detachedAt, 'Data da separação', { field: 'detachedAt' });
    const lowerBounds = [{ reason: 'BEFORE_TARGET_ACQUIRED', at: weapon.acquiredAt }];
    if (mode === 'RETURN') lowerBounds.push({ reason: 'BEFORE_APPLIED', at: subject.applyOperation.occurredAt });
    assertDate(detachedAt, { now, lowerBounds, field: 'detachedAt', errorField: 'detachedAt' });
    const stamp = detachedAt.toISOString();
    let tradeUnlockAt = null;
    if (!isNil(input.tradeUnlockAt)) {
      tradeUnlockAt = parseDate(input.tradeUnlockAt, 'Data de liberação da troca', { field: 'tradeUnlockAt' });
      if (tradeUnlockAt.getTime() < detachedAt.getTime()) {
        throw invalidDate('A liberação da troca não pode ser anterior à separação.', 'TRADE_UNLOCK_BEFORE_DETACHED', { tradeUnlockAt: tradeUnlockAt.toISOString() }, 'tradeUnlockAt');
      }
    }
    const note = normalizeNote(input.note);
    const baseDetail = { mode, weaponItemId: weapon.id, component: componentSnapshot(component) };

    if (mode === 'RETURN') {
      const { returned, applyOperation } = subject;
      const previous = { forSaleSince: returned.forSaleSince ?? null, offSaleAt: returned.offSaleAt ?? null, tradeUnlockAt: returned.tradeUnlockAt ?? null };
      const detail = { ...baseDetail, applyOperationId: applyOperation.id, returnedItemId: returned.id, previous };
      const operation = ItemOperation.createOperation(
        { kind: 'DETACH_COMPONENT', outcome: 'TRANSFERRED', occurredAt: stamp, note, detailJson: JSON.stringify(detail) }, { now }
      );
      ItemOperation.createLink({ operationId: operation.id, itemId: weapon.id, role: 'TARGET', costShareBp: null });
      ItemOperation.createLink({ operationId: operation.id, itemId: returned.id, role: 'TARGET', costShareBp: null });
      ItemOperation.markEnded(applyOperation.id, operation.id);
      ItemComponent.remove(component.id);
      // A unidade volta à venda e o giro recomeça na data da separação; o trade lock informado só vale se for posterior ao atual.
      const patch = { status: 'EM_ESTOQUE', consumedAt: null, forSaleSince: stamp, offSaleAt: null };
      if (tradeUnlockAt && (isNil(returned.tradeUnlockAt) || tradeUnlockAt.getTime() > Date.parse(returned.tradeUnlockAt))) patch.tradeUnlockAt = tradeUnlockAt.toISOString();
      Item.update(returned.id, patch, { now });
      Item.markComponentsImported(weapon.id, stamp);
      Item.update(weapon.id, {}, { now });
      return { operation, weapon: Item.findById(weapon.id), detachedItem: Item.findById(returned.id) };
    }

    // SPLIT: porcentagem do pendurado (sugestão do cache ou informada).
    if (component.kind === 'CHARM' && isNil(component.catalogId)) {
      throw new ValidationError('Este chaveiro não tem item do catálogo; escolha-o no catálogo antes de separar.', 'COMPONENT_CATALOG_REQUIRED', { field: 'components', params: { index: 0 } });
    }
    const { suggestion, prices } = loadSuggestion(weapon, component, { now });
    const informed = isNil(input.hangingShareBp) ? null : parseShare(input.hangingShareBp);
    if (informed === null && !suggestion) {
      throw unprocessable('SPLIT_SHARE_REQUIRED', 'Informe a porcentagem do custo que vai para o pendurado: faltam preços de referência.', { field: 'hangingShareBp' });
    }
    const generatedBp = informed ?? suggestion.hangingShareBp;
    const weaponBp = BP_TOTAL - generatedBp;
    const basis = suggestion && generatedBp === suggestion.hangingShareBp ? 'MARKET_CACHE' : 'MANUAL';

    const descriptor = detachedDescriptor(subject);
    const generatedInput = descriptor.category === 'OUTRO'
      ? { category: 'OUTRO', name: descriptor.name }
      : { catalogId: descriptor.catalogId };
    if (tradeUnlockAt) generatedInput.tradeUnlockAt = tradeUnlockAt.toISOString();
    const prepared = itemService.prepareItemRecord(generatedInput, { acquisition: { type: 'GERADO' }, acquiredAt: detachedAt, now });

    const detail = {
      ...baseDetail,
      share: {
        hangingShareBp: generatedBp, basis, basePriceCents: prices.basePriceCents, hangingPriceCents: prices.hangingPriceCents,
        basePricedAt: prices.basePricedAt, hangingPricedAt: prices.hangingPricedAt, pricedAt: prices.pricedAt,
      },
    };
    const operation = ItemOperation.createOperation(
      { kind: 'DETACH_COMPONENT', outcome: 'TRANSFERRED', occurredAt: stamp, note, detailJson: JSON.stringify(detail) }, { now }
    );
    const generated = Item.create(prepared.record, { now });
    ItemOperation.createLink({ operationId: operation.id, itemId: weapon.id, role: 'TARGET', costShareBp: weaponBp });
    ItemOperation.createLink({ operationId: operation.id, itemId: generated.id, role: 'CREATED', costShareBp: generatedBp });
    ItemComponent.remove(component.id);
    // A "Varredura completa" não pode recolocar o pendurado separado (D361 item 7).
    Item.markComponentsImported(weapon.id, stamp);
    Item.update(weapon.id, {}, { now });
    return { operation, weapon: Item.findById(weapon.id), detachedItem: generated };
  });
}

module.exports = { MAX_NOTE_LENGTH, previewDetach, detachComponent, componentSnapshot };
