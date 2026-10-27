import {
  Boxes,
  Cog,
  Database,
  FileCode2,
  LayoutDashboard,
  Plug,
  Server,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface RoleMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  badge: string;
  border: string;
  iconBox: string;
  accent: string;
}

const ROLE_META: Record<string, RoleMeta> = {
  UI_COMPONENT: {
    label: 'Screen / UI',
    description: 'A visual piece of the app that users see and interact with.',
    icon: LayoutDashboard,
    badge: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
    border: 'border-pink-500/40',
    iconBox: 'bg-pink-500/15 text-pink-300',
    accent: 'bg-pink-500',
  },
  API_CLIENT: {
    label: 'API Client',
    description: 'Sends requests from the frontend to the backend.',
    icon: Plug,
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    border: 'border-purple-500/40',
    iconBox: 'bg-purple-500/15 text-purple-300',
    accent: 'bg-purple-500',
  },
  CONTROLLER: {
    label: 'Controller',
    description: 'Receives web requests (endpoints) and sends back responses.',
    icon: Server,
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    border: 'border-amber-500/40',
    iconBox: 'bg-amber-500/15 text-amber-300',
    accent: 'bg-amber-500',
  },
  SERVICE: {
    label: 'Service',
    description: 'Contains the main business logic and rules of the app.',
    icon: Cog,
    badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    border: 'border-indigo-500/40',
    iconBox: 'bg-indigo-500/15 text-indigo-300',
    accent: 'bg-indigo-500',
  },
  REPOSITORY: {
    label: 'Data Access',
    description: 'Reads from and writes to the database.',
    icon: Database,
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/40',
    iconBox: 'bg-emerald-500/15 text-emerald-300',
    accent: 'bg-emerald-500',
  },
  MODEL: {
    label: 'Data Model',
    description: 'Describes the shape of the data the app works with.',
    icon: Boxes,
    badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    border: 'border-cyan-500/40',
    iconBox: 'bg-cyan-500/15 text-cyan-300',
    accent: 'bg-cyan-500',
  },
  CONFIG: {
    label: 'Configuration',
    description: 'Settings and wiring that control how the app starts and behaves.',
    icon: Settings,
    badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    border: 'border-slate-600',
    iconBox: 'bg-slate-500/20 text-slate-300',
    accent: 'bg-slate-400',
  },
};

const FALLBACK_ROLE: RoleMeta = {
  label: 'Module',
  description: 'A supporting file or utility.',
  icon: FileCode2,
  badge: 'bg-slate-700/40 text-slate-300 border-slate-600',
  border: 'border-slate-700',
  iconBox: 'bg-slate-700/40 text-slate-300',
  accent: 'bg-slate-500',
};

export function getRoleMeta(role: string): RoleMeta {
  return ROLE_META[role] ?? { ...FALLBACK_ROLE, label: prettify(role) };
}

function prettify(role: string): string {
  if (!role) return FALLBACK_ROLE.label;
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface LayerMeta {
  key: string;
  title: string;
  subtitle: string;
  color: string;
}

/** Top-to-bottom order of the architecture map. `key` matches the tier name sent by the backend. */
export const LAYERS: LayerMeta[] = [
  { key: 'Frontend / Client Layer', title: 'Frontend', subtitle: 'What users see and click', color: '#ec4899' },
  { key: 'API / Controller Layer', title: 'API', subtitle: 'Receives requests from the frontend', color: '#f59e0b' },
  { key: 'Business Service Layer', title: 'Business logic', subtitle: 'Where the main rules live', color: '#6366f1' },
  { key: 'Data Access & Config Layer', title: 'Data access & config', subtitle: 'Talks to the database and settings', color: '#10b981' },
  { key: 'Domain Model & Entities', title: 'Data models', subtitle: 'The shape of the data the app uses', color: '#06b6d4' },
  { key: 'Modules & Utilities', title: 'Other modules', subtitle: 'Supporting files and utilities', color: '#64748b' },
];

export function getLayerMeta(tier: string): LayerMeta {
  return (
    LAYERS.find((l) => l.key === tier) ?? {
      key: tier,
      title: tier,
      subtitle: '',
      color: '#64748b',
    }
  );
}

export function layerOrder(tier: string): number {
  const idx = LAYERS.findIndex((l) => l.key === tier);
  return idx === -1 ? LAYERS.length : idx;
}

export const RELATION_LABELS: Record<string, string> = {
  IMPORT: 'imports',
  INJECTION: 'injects',
  API_CALL: 'calls API',
};

export function relationLabel(type: string): string {
  return RELATION_LABELS[type] ?? type.toLowerCase();
}
