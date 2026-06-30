import {
  Activity,
  BarChart3,
  Bell,
  Book,
  Bookmark,
  BookOpen,
  Box,
  Calendar,
  Check,
  Clock,
  Cloud,
  Code,
  Compass,
  Cpu,
  CreditCard,
  Database,
  Download,
  FileText,
  Flag,
  Folder,
  GitBranch,
  Globe,
  Heart,
  HelpCircle,
  Home,
  Info,
  Key,
  Layers,
  Lightbulb,
  Link as LinkIcon,
  Lock,
  type LucideIcon,
  Mail,
  MessageSquare,
  Package,
  Palette,
  PenLine,
  Play,
  Plug,
  Puzzle,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Star,
  Table,
  Tag,
  Terminal,
  Upload,
  User,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

/**
 * A curated name→icon map for page/Card icons authored as strings (e.g.
 * `icon="rocket"`), mirroring the common subset of Mintlify's icon set. Kept
 * curated (not the full Lucide bundle) so the published-site bundle stays small.
 */
const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'bar-chart': BarChart3,
  'bar-chart-3': BarChart3,
  bell: Bell,
  book: Book,
  'book-open': BookOpen,
  bookmark: Bookmark,
  box: Box,
  calendar: Calendar,
  check: Check,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  compass: Compass,
  cpu: Cpu,
  'credit-card': CreditCard,
  database: Database,
  download: Download,
  file: FileText,
  'file-text': FileText,
  flag: Flag,
  folder: Folder,
  'git-branch': GitBranch,
  globe: Globe,
  heart: Heart,
  help: HelpCircle,
  'help-circle': HelpCircle,
  home: Home,
  info: Info,
  key: Key,
  layers: Layers,
  lightbulb: Lightbulb,
  link: LinkIcon,
  lock: Lock,
  mail: Mail,
  'message-square': MessageSquare,
  package: Package,
  palette: Palette,
  pen: PenLine,
  'pen-line': PenLine,
  play: Play,
  plug: Plug,
  puzzle: Puzzle,
  rocket: Rocket,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  sparkles: Sparkles,
  star: Star,
  table: Table,
  tag: Tag,
  terminal: Terminal,
  upload: Upload,
  user: User,
  users: Users,
  wrench: Wrench,
  zap: Zap,
};

/** Normalize an authored icon name to the map key (lower-kebab). */
const normalize = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

/** Render the named icon, or null when the name is empty/unrecognized so callers
 *  can decide on a fallback. */
export function PageIcon({ name, className }: { name?: string | null; className?: string }) {
  if (!name) {
    return null;
  }
  const Icon = ICONS[normalize(name)];
  return Icon ? <Icon className={className} aria-hidden /> : null;
}

/** Whether an authored icon name resolves to a real icon. */
export const hasIcon = (name?: string | null): boolean => Boolean(name && ICONS[normalize(name)]);

