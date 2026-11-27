import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  ExternalLink,
  Info,
  Languages,
  Lock,
  LoaderCircle,
  Minus,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  RefreshCw,
  Rows2,
  Rows3,
  Search,
  ServerOff,
  Settings,
  Store,
  Sun,
  TrendingUp,
  Wallet,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';

// Ponto único dos ícones (D370, 12.2): só importações nomeadas do lucide-react (tree-shaking). Para usar um ícone novo,
// importe-o acima e registre o nome aqui; as telas nunca importam o lucide-react direto.
export const ICONS = {
  alert: AlertTriangle,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  help: CircleHelp,
  info: Info,
  lock: Lock,
  inventory: Package,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  stores: Store,
  profit: TrendingUp,
  wallet: Wallet,
  close: X,
  more: Ellipsis,
  minus: Minus,
  clock: Clock,
  loader: LoaderCircle,
  circleCheck: CircleCheck,
  circleAlert: CircleAlert,
  externalLink: ExternalLink,
  sales: Receipt,
  imports: Download,
  sun: Sun,
  moon: Moon,
  languages: Languages,
  panelClose: PanelLeftClose,
  panelOpen: PanelLeftOpen,
  wifiOff: WifiOff,
  serverOff: ServerOff,
  rows2: Rows2,
  rows3: Rows3,
  eye: Eye,
  eyeOff: EyeOff,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** Lado em px (padrão 16). */
  size?: number;
  /** Texto já traduzido. Sem ele, o ícone é decorativo (aria-hidden); com ele, vira role="img". */
  label?: string;
  className?: string;
}

export default function Icon({ name, size = 16, label, className }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    />
  );
}
