// Dados e rótulos fictícios do guia vivo (D370, 12.3a). Página de desenvolvedor: os rótulos do guia ficam aqui, em constantes, e não
// passam pelos dicionários (regra da 12.2). Os textos DOS COMPONENTES (tooltip, "Mais detalhes", erros...) vêm dos dicionários.
import type { ComboboxOption } from '@/components/ui/Combobox';

export const GALLERY_LANGUAGES = ['en', 'de', 'ru', 'ja'] as const;
export type GalleryLanguage = (typeof GALLERY_LANGUAGES)[number];

export const FRAME_WIDTHS = [480, 720, 960] as const;

export const FX = {
  title: 'Componentes — interação, formulários, dados e feedback (12.3a e 12.3b)',
  languages: 'Idiomas lado a lado',
  width: 'Largura do quadro',
  widthFree: 'livre',
  note: 'Cada quadro é redimensionável (arraste o canto) e exercita as container queries; as media queries (diálogo, toast, iconOnlyBelow) respondem à janela inteira. Use o botão de tema do cabeçalho para ver o escuro.',
  states: { normal: 'normal', hover: 'hover (simulado)', focus: 'foco (simulado)', disabled: 'desabilitado', loading: 'carregando', error: 'com erro' },
  sections: {
    buttons: 'Button',
    iconButtons: 'IconButton, Tooltip, HelpTip, Spinner',
    fields: 'Field, TextField, NumberField, Select',
    checks: 'Checkbox e Switch',
    errors: 'FormErrorSummary',
    segmented: 'SegmentedControl, Chip, Badge',
    combobox: 'Combobox',
    dialogs: 'Dialog, ConfirmDialog',
    menu: 'Menu',
    tabs: 'Tabs e Disclosure',
    banner: 'Banner',
    toast: 'Toast',
    states: 'EmptyState, ErrorState, Skeleton',
    panel: 'Panel, PositionStrip, StatCard, Equation',
    money: 'Money',
    turnover: 'TurnoverRule, TurnoverLegend',
    balance: 'BalanceBar',
    table: 'DataTable',
    update: 'UpdateModal (estados simulados)',
  },
  // Rótulos de exemplo (texto fictício, em inglês, igual ao que o app teria).
  labels: {
    save: 'Save changes',
    longButton: 'Add the selected items to the holding and recalculate everything',
    sell: 'Sell',
    delete: 'Delete item',
    refresh: 'Refresh prices',
    add: 'Add',
    reload: 'Reload',
    lock: 'Lock',
    helpTopic: 'Break-even price',
    helpText: 'The lowest sale price at which the net amount still covers what you paid.',
    spinnerLabel: 'Fetching prices',
    name: 'Item name',
    search: 'Search by name',
    amount: 'Purchase price',
    amountJpy: 'Purchase price (JPY)',
    rate: 'Exchange rate',
    ambiguous: 'Ambiguous amount',
    float: 'Float',
    integer: 'Pattern',
    theme: 'Theme',
    store: 'Store',
    withHint: 'With a hint',
    hint: 'Shown below the field.',
    errorText: 'This value is not valid.',
    optionalField: 'Optional note',
    requiredField: 'Required field',
    onlyStuck: 'Only stuck',
    forSale: 'For sale',
    holding: 'Holding',
    inLock: 'In trade lock',
    includeSold: 'Include sold items',
    partial: 'Select all',
    activeStore: 'Store is active',
    view: 'View',
    grouped: 'Grouped',
    individual: 'Individual',
    density: 'Density',
    compact: 'Compact',
    comfortable: 'Comfortable',
    filters: 'Filters',
    amountCurrency: 'Currency',
    catalog: 'Catalog item',
    catalogPlaceholder: 'Type an item name',
    openDialog: 'Open dialog',
    openConfirm: 'Open delete confirmation',
    openConfirmError: 'Open confirmation with error',
    dialogTitle: 'Edit item',
    dialogDescription: 'Change the purchase price and the store.',
    dialogBody: 'Dialog body text. It scrolls when it is taller than the window.',
    confirmTitle: 'Delete item',
    confirmMessage: 'AK-47 | Redline (Field-Tested) will be removed from your inventory.',
    confirmError: 'Could not delete the item. Try again.',
    confirmDetails: 'The cost of US$ 12.40 leaves the in-stock total.',
    cancelLike: 'Cancel',
    menuLabel: 'Actions of AK-47 | Redline',
    edit: 'Edit',
    moveToHolding: 'Move to holding',
    sellDisabled: 'Mark as sold',
    sellDisabledReason: 'Still in trade lock for 3 days',
    deleteItem: 'Delete',
    sections: 'Sections',
    tabForSale: 'For sale',
    tabHolding: 'Holding',
    panelA: 'Panel with the items for sale.',
    panelB: 'Panel with the holding items.',
    disclosure: 'Advanced options',
    disclosureBody: 'These settings rarely need changing.',
    badgeNeutral: 'Neutral',
    badgeProfit: 'Profit',
    badgeLoss: 'Loss',
    badgeEstimated: 'Estimated',
    badgePending: 'Pending',
    badgeInfo: 'Info',
    errorsTitleField: 'Purchase price',
    errorsTitleStore: 'Store',
    errorsPriceMessage: 'Invalid amount.',
    errorsStoreMessage: 'Choose a store.',
    noResults: 'Nothing to show',
    reopen: 'reopen',
  },
} as const;

export const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System default' },
];

export const STORE_OPTIONS = [
  { value: 'steam', label: 'Steam' },
  { value: 'csfloat', label: 'CSFloat' },
  { value: 'csmoney', label: 'CS.MONEY', disabled: true },
];

// Catálogo fictício com imagem (um quadrado de cor por token) para o Combobox do catálogo.
export const CATALOG_OPTIONS: ComboboxOption[] = [
  { value: 'ak47-redline', label: 'AK-47 | Redline', description: 'Rifle' },
  { value: 'awp-asiimov', label: 'AWP | Asiimov', description: 'Sniper rifle' },
  { value: 'karambit-doppler', label: '★ Karambit | Doppler', description: 'Knife' },
  { value: 'usp-kill-confirmed', label: 'USP-S | Kill Confirmed', description: 'Pistol' },
  { value: 'sticker-slab', label: 'Sticker Slab | Katowice 2014', description: 'Sticker Slab', disabled: true },
];

// ---- 12.3b: dados e feedback ----
export const L2 = {
  bannerInfo: 'Prices were updated a few minutes ago.',
  bannerSuccess: 'Sale registered. The balance of the store was updated.',
  bannerWarning: 'Some prices could not be fetched, so the market value is incomplete for these items.',
  bannerDanger: 'Could not reach the backend. Check that the app is running and try again.',
  bannerTitle: 'Exchange rate not set',
  bannerLong: 'The rate of this currency is older than seven days, and the estimated values with ≈ may differ a lot from what you would get today when converting at your bank or marketplace.',
  bannerAction: 'Open settings',
  bannerActionHref: 'Go to Settings',
  toastSuccess: 'Show success toast',
  toastInfo: 'Show info toast',
  toastDanger: 'Show error toast (stays)',
  toastAction: 'Show toast with action',
  toastMsgSuccess: 'Item saved.',
  toastMsgInfo: 'Prices refreshed in the background.',
  toastMsgDanger: 'Could not save the item. The backend did not answer.',
  toastMsgAction: 'Sale undone.',
  toastUndo: 'Undo',
  emptyTitle: 'No items for sale yet',
  emptyText: 'Register your first item to see it here, with its break-even price and how long it has been on sale.',
  emptyAction: 'Register item',
  errorTitle: 'Could not load the inventory',
  errorMessage: 'The backend did not answer in time.',
  skeletonText: 'Text lines',
  skeletonBlock: 'Block',
  panelTitle: 'Balance of the stores',
  panelHint: 'Calculated from deposits, sales, purchases and withdrawals.',
  panelAction: 'Register deposit',
  panelBody: 'Panel content goes here.',
  stripLabel: 'Inventory position',
  inStock: 'Stock for sale',
  holding: 'In holding',
  inLock: 'In trade lock',
  stuck: 'Stuck',
  unitsText: '3 units',
  nextRelease: 'next one releases in 2 days',
  stuckNote: 'on sale for more than 21 days',
  helpStat: 'Items in stock that are not in the holding, at their purchase cost.',
  eqPaid: 'Withdrawals received',
  eqPaidNote: 'after the fee of each withdrawal',
  eqBalance: 'Balance in the stores',
  eqBalanceNote: 'available and pending',
  eqStock: 'Stock, at cost',
  eqStockNote: 'for sale US$ 1,842.30 · in the holding US$ 615.00',
  eqDeposited: 'Total deposited',
  eqDepositedNote: 'sum of the deposits',
  eqResult: 'Real profit',
  eqFee: 'of which withdrawal fees',
  moneyUsd: 'US$ with conversion',
  moneyEstimated: 'Estimated',
  moneyJpy: 'Yen, no decimals',
  moneyNegative: 'Signed values',
  moneyUnavailable: 'Unavailable',
  moneyStale: 'With the old-rate note',
  moneyInline: 'Inline layout',
  moneySizes: 'Sizes',
  staleNote: 'The rate was fetched 9 days ago.',
  ruleSm: 'Small (size sm)',
  ruleNarrow: 'Narrow cell (150 px)',
  ruleScale: 'Scale only (kind scale)',
  ruleExtreme: 'Extreme limits',
  balanceEmpty: 'Empty store',
  availableText: 'US$ 842.10',
  pendingText: 'US$ 190.00',
  tableCaption: 'Inventory, grouped by item',
  colItem: 'Item',
  colQty: 'Qty.',
  colCost: 'Average cost',
  colMin: 'Break-even price',
  colTurnover: 'Turnover',
  colStore: 'Store',
  colActions: 'Actions',
  sellAction: 'Sell',
  tableLoading: 'Loading state',
  tableEmpty: 'Empty state',
  tableEmptyText: 'No items match the filters.',
  tableSelect: 'With selection',
  tableComfortable: 'Comfortable density',
  tableExpanded: 'Expandable rows (units)',
  tableTone: 'Row tones',
  unitFloat: 'Float 0.2371 · pattern 661 · 4 stickers',
  unitFloat2: 'Float 0.1854 · pattern 102',
  legendNote: 'Legend in the footer',
  sortedBy: 'Sorted by',
  lastSeen: 'Last check',
} as const;

// Moeda de conversão do guia (o "≈").
export const CONVERSION = 'BRL';

export const GALLERY_LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };
export const GALLERY_LIMITS_WIDE = { fastTurnoverDays: 1, slowItemDays: 365 };
export const GALLERY_LIMITS_TIGHT = { fastTurnoverDays: 20, slowItemDays: 21 };

export type GalleryBucket = 'RECENTE' | 'EM_GIRO' | 'AGARRADO' | 'EM_TRADE_LOCK' | 'FORA_DE_VENDA' | 'CONSUMIDO';

export interface GalleryRow {
  id: string;
  name: string;
  meta: string;
  qty: number;
  costCents: number;
  minCents: number;
  approxMinCents: number;
  bucket: GalleryBucket;
  days: number | null;
  store: string;
}

export const GALLERY_ROWS: GalleryRow[] = [
  { id: 'ak', name: 'AK-47 | Redline', meta: 'Field-Tested · StatTrak™', qty: 3, costCents: 3840, minCents: 4415, approxMinCents: 23986, bucket: 'AGARRADO', days: 26, store: 'CSFloat' },
  { id: 'kara', name: '★ Karambit | Doppler', meta: 'Factory New · Phase 2', qty: 1, costCents: 61200, minCents: 70380, approxMinCents: 382337, bucket: 'RECENTE', days: 4, store: 'Steam' },
  { id: 'awp', name: 'AWP | Asiimov', meta: 'Field-Tested', qty: 2, costCents: 9610, minCents: 11052, approxMinCents: 60040, bucket: 'EM_GIRO', days: 13, store: 'CSFloat' },
  { id: 'vice', name: '★ Sport Gloves | Vice', meta: 'Minimal Wear', qty: 1, costCents: 114000, minCents: 131100, approxMinCents: 712213, bucket: 'EM_TRADE_LOCK', days: null, store: 'CS.MONEY' },
  { id: 'fade', name: 'Glock-18 | Fade', meta: 'Factory New', qty: 1, costCents: 61500, minCents: 70725, approxMinCents: 384210, bucket: 'FORA_DE_VENDA', days: null, store: 'Steam' },
];
