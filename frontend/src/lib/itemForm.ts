// Lógica pura do formulário de item (D116). Nenhuma regra de negócio: só decide visibilidade e monta o corpo
// que o backend valida. Textos de erro local são chaves de tradução (`itemForm.invalidMoney` etc.).
import { dateToLocalInput, isoToLocalInput, localInputToIso, addDaysToLocalInput } from '@/lib/dateInput';
import { formatFloat } from '@/lib/format';
import {
  formatCentsInput, formatDecimalInput, parseDecimalInput, parseFloatInput, parseIntegerInput, parseMoneyToCents,
} from '@/lib/numberInput';
import type {
  AcquisitionType, CatalogSummary, Category, Exterior, ItemCreateBody, ItemPatchBody, ItemView, Store, Variant,
} from '@/types/api';

export const WEAPON_CATEGORIES: readonly Category[] = ['SKIN', 'FACA', 'LUVA'];
// Categorias de nome livre (sem catálogo); PASSE_BATALHA só se não existir no catálogo (o backend decide).
export const FREE_NAME_CATEGORIES: readonly Category[] = ['OUTRO', 'PASSE_BATALHA'];
export const ALL_VARIANTS: readonly Variant[] = ['NORMAL', 'STATTRAK', 'SOUVENIR'];
export const ALL_EXTERIORS: readonly Exterior[] = ['FN', 'MW', 'FT', 'WW', 'BS'];

export const isWeaponCategory = (category: Category | ''): boolean =>
  category !== '' && WEAPON_CATEGORIES.includes(category);

// Item escolhido no catálogo. `CatalogItem` (busca) e o resumo do item gravado cabem aqui.
export type CatalogChoice = CatalogSummary & { category: Category };

export interface ItemFormState {
  catalog: CatalogChoice | null;
  // Item fora do catálogo (categoria OUTRO/PASSE_BATALHA com nome livre).
  freeMode: boolean;
  name: string;
  category: Category | '';
  variant: Variant | '';
  floatText: string;
  exterior: Exterior | '';
  paintSeedText: string;
  phase: string;
  acquisitionType: AcquisitionType;
  purchaseStoreId: number | null;
  priceText: string;
  fxText: string;
  // datetime-local (hora local)
  acquiredAt: string;
  tradeUnlockAt: string;
  inspectLink: string;
  originDetail: string;
  assetId: string;
}

export type FormErrors = Partial<Record<string, string>>;
export type BuildResult<T> = { ok: true; body: T } | { ok: false; errors: FormErrors };

const trimOrNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

export function findStore(stores: Store[], id: number | null): Store | undefined {
  return id === null ? undefined : stores.find((s) => s.id === id);
}

// Categoria efetiva do formulário (catálogo > escolha livre).
export function effectiveCategory(state: ItemFormState): Category | '' {
  return state.catalog ? state.catalog.category : state.category;
}

export interface FieldVisibility {
  weapon: boolean;
  // Exterior manual só sem float.
  exteriorInput: boolean;
  exteriorDerived: boolean;
  phaseLocked: boolean;
  // Compra: preço e loja obrigatórios.
  price: boolean;
  fx: boolean;
  informativeStore: boolean;
}

export function fieldVisibility(state: ItemFormState, stores: Store[]): FieldVisibility {
  const weapon = isWeaponCategory(effectiveCategory(state));
  const hasFloat = state.floatText.trim() !== '';
  const store = findStore(stores, state.purchaseStoreId);
  const isCompra = state.acquisitionType === 'COMPRA';
  return {
    weapon,
    exteriorInput: weapon && !hasFloat,
    exteriorDerived: weapon && hasFloat,
    phaseLocked: !!state.catalog?.phase,
    price: isCompra,
    fx: isCompra && store?.currency === 'BRL',
    informativeStore: !isCompra,
  };
}

// Campos do formulário de item visíveis no momento (erro de campo oculto não pode ficar sem lugar na tela).
export function visibleItemFields(
  allFields: readonly string[],
  vis: FieldVisibility,
  mode: { showSearch: boolean; freeMode: boolean; hasCatalog: boolean },
): string[] {
  const hidden = new Set<string>();
  if (!mode.showSearch) hidden.add('catalogId');
  if (!(mode.freeMode && !mode.hasCatalog)) {
    hidden.add('name');
    hidden.add('category');
  }
  if (!vis.weapon) for (const f of ['variant', 'floatValue', 'exterior', 'paintSeed', 'phase']) hidden.add(f);
  if (!vis.price) hidden.add('purchasePriceCents');
  if (!vis.fx) hidden.add('fxRateAtPurchase');
  return allFields.filter((f) => !hidden.has(f));
}

// Opções de variante pela categoria e pelo catálogo; o valor atual sempre fica na lista.
export function variantOptions(category: Category | '', catalog: CatalogChoice | null, current: Variant | ''): Variant[] {
  let options: Variant[] = ['NORMAL'];
  if (category === 'SKIN') {
    options = ['NORMAL'];
    if (!catalog || catalog.hasStattrak) options.push('STATTRAK');
    if (!catalog || catalog.hasSouvenir) options.push('SOUVENIR');
  } else if (category === 'FACA') {
    options = ['NORMAL'];
    if (!catalog || catalog.hasStattrak) options.push('STATTRAK');
  }
  if (current !== '' && !options.includes(current)) options.push(current);
  return options;
}

export interface FormContext {
  stores: Store[];
  usdBrlRate: number | null;
  language: string;
  now?: Date;
}

export function initialCreateState({ stores, usdBrlRate, language, now = new Date() }: FormContext): ItemFormState {
  const primary = stores.find((s) => s.isPrimary) ?? null;
  return {
    catalog: null,
    freeMode: false,
    name: '',
    category: '',
    variant: '',
    floatText: '',
    exterior: '',
    paintSeedText: '',
    phase: '',
    acquisitionType: 'COMPRA',
    purchaseStoreId: primary ? primary.id : null,
    priceText: '',
    fxText: primary?.currency === 'BRL' && usdBrlRate !== null ? formatDecimalInput(usdBrlRate, language) : '',
    acquiredAt: dateToLocalInput(now),
    tradeUnlockAt: '',
    inspectLink: '',
    originDetail: '',
    assetId: '',
  };
}

export function stateFromItem(item: ItemView, language: string): ItemFormState {
  return {
    catalog: item.catalog ? { ...item.catalog, category: item.category } : null,
    freeMode: !item.catalog && !item.isLegacy,
    name: item.name,
    category: item.category,
    variant: item.variant ?? '',
    floatText: item.floatValue !== null ? formatFloat(item.floatValue, language) : '',
    exterior: item.exterior ?? '',
    paintSeedText: item.paintSeed !== null ? String(item.paintSeed) : '',
    phase: item.phase ?? '',
    acquisitionType: item.acquisitionType,
    purchaseStoreId: item.purchaseStoreId,
    priceText: item.acquisitionType === 'COMPRA' ? formatCentsInput(item.purchasePriceCents, language) : '',
    fxText: item.fxRateAtPurchase !== null ? formatDecimalInput(item.fxRateAtPurchase, language) : '',
    acquiredAt: isoToLocalInput(item.acquiredAt),
    tradeUnlockAt: isoToLocalInput(item.tradeUnlockAt),
    inspectLink: item.inspectLink ?? '',
    originDetail: item.originDetail ?? '',
    assetId: item.assetId ?? '',
  };
}

// Escolher um item do catálogo: a categoria vem dele, a fase trava se o catálogo define, variante padrão NORMAL.
export function applyCatalogChoice(state: ItemFormState, choice: CatalogChoice): ItemFormState {
  const weapon = isWeaponCategory(choice.category);
  const options = variantOptions(choice.category, choice, '');
  const keepVariant = state.variant !== '' && options.includes(state.variant);
  return {
    ...state,
    catalog: choice,
    freeMode: false,
    name: choice.name,
    category: choice.category,
    variant: weapon ? (keepVariant ? state.variant : 'NORMAL') : '',
    // Trocar de item limpa a fase anterior (igual ao backend); reescolher o mesmo item a mantém (T68).
    phase: choice.phase ?? (weapon && state.catalog?.id === choice.id ? state.phase : ''),
  };
}

// Trocar a loja de compra: ao mudar de moeda o preço antigo não vale (D52 adendo 1) e a cotação é pré-preenchida.
export function applyPurchaseStore(
  state: ItemFormState,
  storeId: number | null,
  { stores, usdBrlRate, language }: FormContext,
): ItemFormState {
  const previous = findStore(stores, state.purchaseStoreId);
  const next = findStore(stores, storeId);
  const currencyChanged = !!previous && !!next && previous.currency !== next.currency;
  const fxText = next?.currency === 'BRL'
    ? (state.fxText.trim() !== '' && !currencyChanged ? state.fxText : usdBrlRate !== null ? formatDecimalInput(usdBrlRate, language) : '')
    : '';
  return { ...state, purchaseStoreId: storeId, priceText: currencyChanged ? '' : state.priceText, fxText };
}

export function addSevenDays(state: ItemFormState, now: Date = new Date()): ItemFormState {
  return { ...state, tradeUnlockAt: addDaysToLocalInput(state.acquiredAt, 7, now) };
}

// --- Montagem dos corpos -----------------------------------------------------------------------------

interface ParsedNumbers {
  errors: FormErrors;
  floatValue: number | null;
  paintSeed: number | null;
  priceCents: number | null;
  fxRate: number | null;
  acquiredIso: string | null;
  tradeUnlockIso: string | null;
}

// Converte os textos numéricos e de data; erros de formato viram chaves de tradução por campo.
function parseNumbers(state: ItemFormState, vis: FieldVisibility, language: string): ParsedNumbers {
  const errors: FormErrors = {};
  let floatValue: number | null = null;
  let paintSeed: number | null = null;
  let priceCents: number | null = null;
  let fxRate: number | null = null;

  if (vis.weapon && state.floatText.trim() !== '') {
    floatValue = parseFloatInput(state.floatText, language);
    if (floatValue === null) errors.floatValue = 'itemForm.invalidNumber';
  }
  if (vis.weapon && state.paintSeedText.trim() !== '') {
    paintSeed = parseIntegerInput(state.paintSeedText);
    if (paintSeed === null) errors.paintSeed = 'itemForm.invalidNumber';
  }
  if (vis.price && state.priceText.trim() !== '') {
    priceCents = parseMoneyToCents(state.priceText, language);
    if (priceCents === null) errors.purchasePriceCents = 'itemForm.invalidMoney';
  }
  if (vis.fx && state.fxText.trim() !== '') {
    fxRate = parseDecimalInput(state.fxText, language);
    if (fxRate === null) errors.fxRateAtPurchase = 'itemForm.invalidNumber';
  }
  let acquiredIso: string | null = null;
  if (state.acquiredAt.trim() !== '') {
    acquiredIso = localInputToIso(state.acquiredAt);
    if (acquiredIso === null) errors.acquiredAt = 'itemForm.invalidDate';
  }
  let tradeUnlockIso: string | null = null;
  if (state.tradeUnlockAt.trim() !== '') {
    tradeUnlockIso = localInputToIso(state.tradeUnlockAt);
    if (tradeUnlockIso === null) errors.tradeUnlockAt = 'itemForm.invalidDate';
  }
  return { errors, floatValue, paintSeed, priceCents, fxRate, acquiredIso, tradeUnlockIso };
}

// Cadastro: só os campos preenchidos (o backend distingue ausente de null).
export function buildCreateBody(state: ItemFormState, ctx: FormContext): BuildResult<ItemCreateBody> {
  const vis = fieldVisibility(state, ctx.stores);
  const parsed = parseNumbers(state, vis, ctx.language);
  if (Object.keys(parsed.errors).length > 0) return { ok: false, errors: parsed.errors };

  const body: ItemCreateBody = { acquisitionType: state.acquisitionType };

  if (state.catalog) {
    body.catalogId = state.catalog.id;
  } else if (state.freeMode) {
    if (state.category !== '') body.category = state.category;
    if (state.name.trim() !== '') body.name = state.name.trim();
  }

  if (vis.weapon) {
    if (state.variant !== '') body.variant = state.variant;
    if (parsed.floatValue !== null) body.floatValue = parsed.floatValue;
    else if (state.exterior !== '') body.exterior = state.exterior;
    if (parsed.paintSeed !== null) body.paintSeed = parsed.paintSeed;
    // Fase travada pelo catálogo nunca é enviada (D78).
    if (!vis.phaseLocked && state.phase.trim() !== '') body.phase = state.phase.trim();
  }

  if (state.purchaseStoreId !== null) body.purchaseStoreId = state.purchaseStoreId;
  if (state.acquisitionType === 'COMPRA') {
    if (parsed.priceCents !== null) body.purchasePriceCents = parsed.priceCents;
    if (vis.fx && parsed.fxRate !== null) body.fxRateAtPurchase = parsed.fxRate;
  }

  if (parsed.acquiredIso) body.acquiredAt = parsed.acquiredIso;
  if (parsed.tradeUnlockIso) body.tradeUnlockAt = parsed.tradeUnlockIso;
  const inspect = trimOrNull(state.inspectLink);
  if (inspect) body.inspectLink = inspect;
  const origin = trimOrNull(state.originDetail);
  if (origin) body.originDetail = origin;
  const asset = trimOrNull(state.assetId);
  if (asset) body.assetId = asset;
  return { ok: true, body };
}

// Edição: PATCH só com o que mudou em relação ao item gravado.
export function buildPatchBody(state: ItemFormState, item: ItemView, ctx: FormContext): BuildResult<ItemPatchBody> {
  const vis = fieldVisibility(state, ctx.stores);
  const parsed = parseNumbers(state, vis, ctx.language);
  if (Object.keys(parsed.errors).length > 0) return { ok: false, errors: parsed.errors };

  const body: ItemPatchBody = {};
  const initial = stateFromItem(item, ctx.language);
  const catalogChanged = (state.catalog?.id ?? null) !== (item.catalogId ?? null);

  // Identidade
  if (catalogChanged && state.catalog) body.catalogId = state.catalog.id;
  if (!state.catalog && state.freeMode) {
    if (state.category !== '' && state.category !== item.category) body.category = state.category;
    if (state.name.trim() !== '' && state.name.trim() !== item.name) body.name = state.name.trim();
  }

  // Atributos de arma (categoria sem arma: o backend limpa, T35)
  if (vis.weapon) {
    if (state.variant !== '' && state.variant !== item.variant) body.variant = state.variant;
    const floatChanged = parsed.floatValue !== item.floatValue;
    if (floatChanged) body.floatValue = parsed.floatValue;
    if (state.floatText.trim() === '') {
      // Sem float o exterior é manual; ao limpar o float, o exterior atual é mantido explicitamente.
      const exteriorValue = state.exterior === '' ? null : state.exterior;
      if (exteriorValue !== item.exterior || (floatChanged && exteriorValue !== null)) body.exterior = exteriorValue;
    }
    if (parsed.paintSeed !== item.paintSeed) body.paintSeed = parsed.paintSeed;
    if (!vis.phaseLocked) {
      const phase = trimOrNull(state.phase);
      if (phase !== item.phase || (catalogChanged && phase !== null)) body.phase = phase;
    }
  }

  // Aquisição
  const typeChanged = state.acquisitionType !== item.acquisitionType;
  if (typeChanged) body.acquisitionType = state.acquisitionType;
  if (state.acquisitionType === 'COMPRA') {
    const storeChanged = state.purchaseStoreId !== item.purchaseStoreId;
    if (storeChanged || typeChanged) body.purchaseStoreId = state.purchaseStoreId;
    if (parsed.priceCents !== null && (typeChanged || state.priceText.trim() !== initial.priceText.trim())) {
      body.purchasePriceCents = parsed.priceCents;
    }
    if (vis.fx && parsed.fxRate !== null && (storeChanged || typeChanged || state.fxText.trim() !== initial.fxText.trim())) {
      body.fxRateAtPurchase = parsed.fxRate;
    }
  } else if (state.purchaseStoreId !== item.purchaseStoreId) {
    body.purchaseStoreId = state.purchaseStoreId;
  }

  // Datas e textos
  if (state.acquiredAt.trim() !== '' && state.acquiredAt !== initial.acquiredAt && parsed.acquiredIso) {
    body.acquiredAt = parsed.acquiredIso;
  }
  if (state.tradeUnlockAt !== initial.tradeUnlockAt) body.tradeUnlockAt = parsed.tradeUnlockIso;
  const inspect = trimOrNull(state.inspectLink);
  if (inspect !== item.inspectLink) body.inspectLink = inspect;
  const origin = trimOrNull(state.originDetail);
  if (origin !== item.originDetail) body.originDetail = origin;
  const asset = trimOrNull(state.assetId);
  if (asset !== item.assetId) body.assetId = asset;
  return { ok: true, body };
}
