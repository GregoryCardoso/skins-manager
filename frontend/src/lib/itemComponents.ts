// Lógica pura dos componentes aplicados no formulário de item (10.1, D353): estado dos rascunhos, montagem do corpo e
// comparação para o PATCH. Nenhuma regra de negócio: limites, categoria e catálogo são validados pelo backend.
import { formatDecimalInput, normalizeNumberText, parseIntegerInput } from '@/lib/numberInput';
import type { AppliedComponentInput, Category, ComponentKind, ItemComponent, ItemComponentInput, ItemView } from '@/types/api';

export const MAX_STICKERS = 5;
export const MAX_PATCHES = 3;
export const PATCH_SLOTS = [0, 1, 2] as const;
export const MAX_PATTERN = 999999;
export const STICKER_SLOTS = [0, 1, 2, 3, 4] as const;
export type HangingKind = 'CHARM' | 'STICKER_SLAB';

// O que o formulário guarda do item do catálogo escolhido (só exibição e o id enviado).
export interface ComponentCatalogChoice {
  id: string;
  name: string;
  namePtBr: string | null;
  imageUrl: string | null;
}

export interface StickerDraft {
  key: string;
  catalog: ComponentCatalogChoice | null;
  // '' = sem slot; senão '0'..'4'.
  slot: string;
  // Desgaste em % (0 a menos de 100), no formato do idioma; '' = não informado.
  wearText: string;
}

export interface HangingDraft {
  kind: HangingKind;
  catalog: ComponentCatalogChoice | null;
  patternText: string;
}

// Patch de agente (10.3, D362): item do catálogo e posição opcional (0 a 2).
export interface PatchDraft {
  key: string;
  catalog: ComponentCatalogChoice | null;
  slot: string;
}

// Componente aplicado do estoque (10.3): só leitura, menos posição, desgaste e pattern (mudam pelo `id`).
export interface AppliedDraft {
  component: ItemComponent;
  slot: string;
  wearText: string;
  patternText: string;
}

export interface ComponentsState {
  stickers: StickerDraft[];
  hanging: HangingDraft | null;
  patches: PatchDraft[];
  applied: AppliedDraft[];
}

export type ComponentsBuild =
  | { ok: true; body: (ItemComponentInput | AppliedComponentInput)[] }
  | { ok: false; errorKey: string; params?: Record<string, string | number> };

// Arma (`SKIN`) aceita stickers e pendurado; agente (`PERSONAGEM`) aceita patches, e a seção só aparece quando o catálogo tem patches
// (ou o agente já tem algum). O backend decide; aqui só se esconde a seção.
export const componentsAllowedFor = (category: Category | '', patchesAvailable = false): boolean =>
  category === 'SKIN' || (category === 'PERSONAGEM' && patchesAvailable);

export function emptyComponentsState(): ComponentsState {
  return { stickers: [], hanging: null, patches: [], applied: [] };
}

let draftCounter = 0;
export function newStickerDraft(): StickerDraft {
  draftCounter += 1;
  return { key: `sticker-${draftCounter}`, catalog: null, slot: '', wearText: '' };
}

export function newPatchDraft(): PatchDraft {
  draftCounter += 1;
  return { key: `patch-${draftCounter}`, catalog: null, slot: '' };
}

const toChoice = (component: { catalogId: string | null; name: string; namePtBr: string | null; imageUrl: string | null }): ComponentCatalogChoice => ({
  id: component.catalogId ?? '',
  name: component.name,
  namePtBr: component.namePtBr,
  imageUrl: component.imageUrl,
});

// Desgaste 0..1 -> texto em % sem ruído de ponto flutuante (0.1 -> "10").
export function wearToText(wear: number, language: string): string {
  return formatDecimalInput(Number((wear * 100).toFixed(4)), language);
}

// Texto em % -> desgaste 0..1; inválido (texto, negativo ou 100 ou mais) -> null.
export function parseWearText(text: string, language: string): number | null {
  const normalized = normalizeNumberText(text, language);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) return null;
  return Number((percent / 100).toFixed(6));
}

export function componentsStateFromItem(item: ItemView, language: string): ComponentsState {
  // Só o que veio junto é editável como lista; os aplicados do estoque ficam à parte (D362).
  const cameWith = item.components.filter((c) => c.origin !== 'APPLIED_FROM_STOCK');
  const applied = item.components
    .filter((c) => c.origin === 'APPLIED_FROM_STOCK')
    .map((c): AppliedDraft => ({
      component: c,
      slot: c.slot === null ? '' : String(c.slot),
      wearText: c.wear === null ? '' : wearToText(c.wear, language),
      patternText: c.pattern === null ? '' : String(c.pattern),
    }));
  const patches = cameWith
    .filter((c) => c.kind === 'PATCH')
    .map((c): PatchDraft => ({ ...newPatchDraft(), catalog: toChoice(c), slot: c.slot === null ? '' : String(c.slot) }));
  const stickers = cameWith
    .filter((c) => c.kind === 'STICKER')
    .map((c): StickerDraft => ({
      ...newStickerDraft(),
      catalog: toChoice(c),
      slot: c.slot === null ? '' : String(c.slot),
      wearText: c.wear === null ? '' : wearToText(c.wear, language),
    }));
  const hangingComponent = cameWith.find((c) => c.kind === 'CHARM' || c.kind === 'STICKER_SLAB');
  const hanging: HangingDraft | null = hangingComponent
    ? {
      kind: hangingComponent.kind as HangingKind,
      catalog: toChoice(hangingComponent),
      patternText: hangingComponent.pattern === null ? '' : String(hangingComponent.pattern),
    }
    : null;
  return { stickers, hanging, patches, applied };
}

// Corpo `components` do formulário. O slab guarda o sticker de dentro como `catalogId`.
export function buildComponentsBody(state: ComponentsState, language: string): ComponentsBuild {
  const body: (ItemComponentInput | AppliedComponentInput)[] = [];
  for (let index = 0; index < state.stickers.length; index += 1) {
    const draft = state.stickers[index];
    if (!draft.catalog) return { ok: false, errorKey: 'itemForm.components.chooseSticker', params: { n: index + 1 } };
    const entry: ItemComponentInput = { kind: 'STICKER', catalogId: draft.catalog.id };
    if (draft.slot !== '') entry.slot = Number(draft.slot);
    if (draft.wearText.trim() !== '') {
      const wear = parseWearText(draft.wearText, language);
      if (wear === null) return { ok: false, errorKey: 'itemForm.components.invalidWear', params: { n: index + 1 } };
      entry.wear = wear;
    }
    body.push(entry);
  }
  if (state.hanging) {
    const { kind, catalog, patternText } = state.hanging;
    if (!catalog) return { ok: false, errorKey: kind === 'CHARM' ? 'itemForm.components.chooseCharm' : 'itemForm.components.chooseSlab' };
    const entry: ItemComponentInput = { kind, catalogId: catalog.id };
    if (patternText.trim() !== '') {
      const pattern = parseIntegerInput(patternText);
      if (pattern === null || pattern > MAX_PATTERN) return { ok: false, errorKey: 'itemForm.components.invalidPattern' };
      entry.pattern = pattern;
    }
    body.push(entry);
  }
  for (let index = 0; index < state.patches.length; index += 1) {
    const draft = state.patches[index];
    if (!draft.catalog) return { ok: false, errorKey: 'itemForm.components.choosePatch', params: { n: index + 1 } };
    const entry: ItemComponentInput = { kind: 'PATCH', catalogId: draft.catalog.id };
    if (draft.slot !== '') entry.slot = Number(draft.slot);
    body.push(entry);
  }
  // Aplicados do estoque: só entram (por `id`) os que mudaram de posição, desgaste ou pattern.
  for (const draft of state.applied) {
    const changes = appliedChanges(draft, language);
    if (changes === 'invalidWear') return { ok: false, errorKey: 'itemForm.components.invalidWear', params: { n: 1 } };
    if (changes === 'invalidPattern') return { ok: false, errorKey: 'itemForm.components.invalidPattern' };
    if (changes) body.push(changes);
  }
  return { ok: true, body };
}

// Entrada do PATCH de um componente aplicado se algo mudou; null se nada mudou; texto se o valor digitado é inválido.
export function appliedChanges(draft: AppliedDraft, language: string): AppliedComponentInput | 'invalidWear' | 'invalidPattern' | null {
  const { component } = draft;
  const slot = draft.slot === '' ? null : Number(draft.slot);
  let wear: number | null = component.wear;
  if (component.kind === 'STICKER') {
    if (draft.wearText.trim() === '') wear = null;
    else {
      const parsed = parseWearText(draft.wearText, language);
      if (parsed === null) return 'invalidWear';
      wear = parsed;
    }
  }
  let pattern: number | null = component.pattern;
  if (component.kind === 'CHARM' || component.kind === 'STICKER_SLAB') {
    if (draft.patternText.trim() === '') pattern = null;
    else {
      const parsed = parseIntegerInput(draft.patternText);
      if (parsed === null || parsed > MAX_PATTERN) return 'invalidPattern';
      pattern = parsed;
    }
  }
  if (slot === component.slot && wear === component.wear && pattern === component.pattern) return null;
  const entry: AppliedComponentInput = { id: component.id, slot };
  if (component.kind === 'STICKER') entry.wear = wear;
  else if (component.kind !== 'PATCH') entry.pattern = pattern;
  return entry;
}

const KIND_RANK: Record<ComponentKind, number> = { STICKER: 0, CHARM: 1, STICKER_SLAB: 2, PATCH: 3 };

// Forma canônica (ordem estável) para saber se a lista mudou em relação à gravada.
function canonical(list: ItemComponentInput[]): string {
  const rows = list.map((c) => JSON.stringify([KIND_RANK[c.kind], c.slot ?? -1, c.catalogId, c.wear ?? -1, c.pattern ?? -1]));
  rows.sort();
  return rows.join('|');
}

const isNewEntry = (c: ItemComponentInput | AppliedComponentInput): c is ItemComponentInput => 'kind' in c;

// O corpo do formulário é igual ao que está gravado? Entradas de componente aplicado (por `id`) só existem quando algo mudou.
export function sameComponents(a: (ItemComponentInput | AppliedComponentInput)[], b: ItemComponentInput[]): boolean {
  if (a.some((c) => !isNewEntry(c))) return false;
  return canonical(a.filter(isNewEntry)) === canonical(b);
}

// A lista gravada do item como corpo (para comparar com o formulário): só o que veio junto; os aplicados do estoque ficam de fora.
export function componentsBodyFromItem(item: ItemView): ItemComponentInput[] {
  return item.components.filter((c) => c.origin !== 'APPLIED_FROM_STOCK').map((c) => {
    const entry: ItemComponentInput = { kind: c.kind, catalogId: c.catalogId ?? '' };
    if (c.slot !== null) entry.slot = c.slot;
    if (c.wear !== null) entry.wear = c.wear;
    if (c.pattern !== null) entry.pattern = c.pattern;
    return entry;
  });
}

// Texto curto de um componente para o `title` das miniaturas (nome, slot, desgaste e pattern).
export function componentTooltip(
  component: { name: string; namePtBr: string | null; slot: number | null; wear: number | null; pattern: number | null },
  language: string,
  labels: { slot: string; wear: string; pattern: string },
): string {
  const name = language === 'pt-BR' ? component.namePtBr ?? component.name : component.name;
  const parts = [name];
  if (component.slot !== null) parts.push(`${labels.slot} ${component.slot}`);
  if (component.wear !== null) parts.push(`${labels.wear} ${wearToText(component.wear, language)}%`);
  if (component.pattern !== null) parts.push(`${labels.pattern} ${component.pattern}`);
  return parts.join(' · ');
}
