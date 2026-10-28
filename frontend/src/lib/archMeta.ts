import {
  Boxes,
  Cog,
  Database,
  FileCode2,
  FlaskConical,
  LayoutDashboard,
  Plug,
  Server,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { GraphNodeDto } from '../types/api';

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
    description: 'A visual screen or component that users see and interact with.',
    icon: LayoutDashboard,
    badge: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
    border: 'border-pink-500/40',
    iconBox: 'bg-pink-500/15 text-pink-300',
    accent: 'bg-pink-500',
  },
  API_CLIENT: {
    label: 'API Client',
    description: 'Frontend HTTP client or bridge that communicates with backend endpoints.',
    icon: Plug,
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    border: 'border-purple-500/40',
    iconBox: 'bg-purple-500/15 text-purple-300',
    accent: 'bg-purple-500',
  },
  CONTROLLER: {
    label: 'Controller / API',
    description: 'Receives incoming requests (endpoints/routes) and returns responses.',
    icon: Server,
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    border: 'border-amber-500/40',
    iconBox: 'bg-amber-500/15 text-amber-300',
    accent: 'bg-amber-500',
  },
  SERVICE: {
    label: 'Service',
    description: 'Contains core business logic, domain orchestration, and workflows.',
    icon: Cog,
    badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    border: 'border-indigo-500/40',
    iconBox: 'bg-indigo-500/15 text-indigo-300',
    accent: 'bg-indigo-500',
  },
  REPOSITORY: {
    label: 'Data Access',
    description: 'Reads from and writes to databases, vector stores, or persistent storage.',
    icon: Database,
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/40',
    iconBox: 'bg-emerald-500/15 text-emerald-300',
    accent: 'bg-emerald-500',
  },
  MODEL: {
    label: 'Data Model',
    description: 'Defines database entities, schemas, DTOs, or domain data structures.',
    icon: Boxes,
    badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    border: 'border-cyan-500/40',
    iconBox: 'bg-cyan-500/15 text-cyan-300',
    accent: 'bg-cyan-500',
  },
  MODULE: {
    label: 'Shared Module',
    description: 'Supporting library, parser, or utility shared across the application.',
    icon: FileCode2,
    badge: 'bg-slate-700/40 text-slate-300 border-slate-600',
    border: 'border-slate-700',
    iconBox: 'bg-slate-700/40 text-slate-300',
    accent: 'bg-slate-500',
  },
  CONFIG: {
    label: 'Configuration',
    description: 'Application settings, dependency wiring, and build configuration.',
    icon: Settings,
    badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    border: 'border-slate-600',
    iconBox: 'bg-slate-500/20 text-slate-300',
    accent: 'bg-slate-400',
  },
  TEST: {
    label: 'Test Suite',
    description: 'Automated unit or integration tests verifying application behavior.',
    icon: FlaskConical,
    badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    border: 'border-slate-600',
    iconBox: 'bg-slate-500/20 text-slate-300',
    accent: 'bg-slate-400',
  },
};

const FALLBACK_ROLE: RoleMeta = ROLE_META.MODULE;

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

/**
 * Top-to-bottom architectural layers.
 * Each layer represents a distinct tier in the request & data flow pipeline.
 */
export const LAYERS: LayerMeta[] = [
  {
    key: 'Frontend / UI Layer',
    title: 'Frontend & UI',
    subtitle: 'Screens, views, and interactive components',
    color: '#ec4899',
  },
  {
    key: 'Client & API Integration Layer',
    title: 'Client & API Bridge',
    subtitle: 'Frontend HTTP clients, state hooks, and UI utilities',
    color: '#a855f7',
  },
  {
    key: 'API / Controller Layer',
    title: 'API & Controllers',
    subtitle: 'REST endpoints, routers, and request entry points',
    color: '#f59e0b',
  },
  {
    key: 'Business Service Layer',
    title: 'Business Services',
    subtitle: 'Core domain rules, orchestrators, and workflows',
    color: '#6366f1',
  },
  {
    key: 'Data Access Layer',
    title: 'Data Access & Storage',
    subtitle: 'Repositories, DAOs, SQLite/SQL, and vector stores',
    color: '#10b981',
  },
  {
    key: 'Domain Model & Entities',
    title: 'Data Models & Schemas',
    subtitle: 'Database entities, DTOs, schemas, and domain types',
    color: '#06b6d4',
  },
  {
    key: 'Modules & Utilities',
    title: 'Shared Modules & Utils',
    subtitle: 'Reusable helpers, parsers, and internal libraries',
    color: '#3b82f6',
  },
  {
    key: 'Configuration & Tests',
    title: 'Configuration & Tests',
    subtitle: 'App settings, build configs, and automated test suites',
    color: '#64748b',
  },
];

const LEGACY_LAYER_MAP: Record<string, string> = {
  'Frontend / Client Layer': 'Frontend / UI Layer',
  'Data Access & Config Layer': 'Data Access Layer',
};

/**
 * Refines a file's architectural role using its path, filename, language, and existing role
 * so both newly indexed and previously cached repositories group accurately into layers.
 */
export function refineArchitecturalRole(
  path: string,
  currentRole: string,
  language?: string
): string {
  const lower = '/' + path.toLowerCase();
  const fileName = lower.substring(lower.lastIndexOf('/') + 1);

  // 1. Tests always belong in TEST
  if (
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/') ||
    fileName.endsWith('test.java') ||
    fileName.endsWith('tests.java') ||
    fileName.startsWith('test_') ||
    fileName.endsWith('_test.py') ||
    fileName.endsWith('_test.go') ||
    fileName.includes('.spec.') ||
    fileName.includes('.test.')
  ) {
    return 'TEST';
  }

  // 2. Config, build & documentation files
  if (
    currentRole === 'CONFIG' ||
    lower.includes('/config/') ||
    lower.includes('/configs/') ||
    lower.includes('/settings/') ||
    fileName.endsWith('config.java') ||
    fileName === 'config.py' ||
    fileName === 'settings.py' ||
    fileName.includes('.config.') ||
    language === 'Configuration' ||
    language === 'Markdown' ||
    fileName.endsWith('.yml') ||
    fileName.endsWith('.yaml') ||
    fileName.endsWith('.json') ||
    fileName.endsWith('.xml') ||
    fileName.endsWith('.md')
  ) {
    return 'CONFIG';
  }

  const isFrontendPath =
    lower.includes('/frontend/') ||
    lower.includes('/client/') ||
    lower.includes('/web/') ||
    lower.includes('/ui/');

  // 3. Frontend UI components & views
  if (
    currentRole === 'UI_COMPONENT' ||
    lower.includes('/components/') ||
    lower.includes('/pages/') ||
    lower.includes('/views/') ||
    lower.includes('/screens/') ||
    fileName.endsWith('.tsx') ||
    fileName.endsWith('.jsx') ||
    fileName.endsWith('.vue') ||
    fileName.endsWith('.svelte')
  ) {
    return 'UI_COMPONENT';
  }

  // 4. Frontend API clients & frontend support modules
  if (
    isFrontendPath ||
    fileName.endsWith('api.ts') ||
    fileName.endsWith('api.js') ||
    fileName.endsWith('client.ts') ||
    fileName.endsWith('client.js')
  ) {
    if (lower.includes('/types/') || lower.includes('/models/')) {
      return 'MODEL';
    }
    return 'API_CLIENT';
  }

  // 5. Data models, entities, schemas & DTOs
  if (
    currentRole === 'MODEL' ||
    lower.includes('/model/') ||
    lower.includes('/models/') ||
    lower.includes('/entity/') ||
    lower.includes('/entities/') ||
    lower.includes('/domain/') ||
    lower.includes('/schema/') ||
    lower.includes('/schemas/') ||
    lower.includes('/dto/') ||
    lower.includes('/dtos/') ||
    lower.includes('/types/') ||
    fileName.endsWith('.sql') ||
    fileName.endsWith('.prisma')
  ) {
    return 'MODEL';
  }

  // 6. Data access, repositories, stores & DAOs
  if (
    currentRole === 'REPOSITORY' ||
    lower.includes('/repository/') ||
    lower.includes('/repositories/') ||
    lower.includes('/dao/') ||
    lower.includes('/store/') ||
    lower.includes('/stores/') ||
    lower.includes('/db/') ||
    lower.includes('/database/') ||
    fileName.endsWith('repository.java') ||
    fileName.endsWith('store.py') ||
    fileName.endsWith('vectorstore.py')
  ) {
    return 'REPOSITORY';
  }

  // 7. Backend controllers, routers & entrypoints
  if (
    currentRole === 'CONTROLLER' ||
    lower.includes('/controller/') ||
    lower.includes('/controllers/') ||
    lower.includes('/routes/') ||
    lower.includes('/routers/') ||
    lower.includes('/endpoints/') ||
    fileName.endsWith('controller.java') ||
    fileName.includes('router') ||
    fileName === 'app.py' ||
    fileName === 'main.py' ||
    fileName === 'server.py' ||
    fileName === 'server.ts' ||
    fileName === 'server.js'
  ) {
    return 'CONTROLLER';
  }

  // 8. Business services, orchestrators & pipelines
  if (
    currentRole === 'SERVICE' ||
    lower.includes('/service/') ||
    lower.includes('/services/') ||
    lower.includes('/usecase/') ||
    lower.includes('/usecases/') ||
    lower.includes('/rag/') ||
    lower.includes('/pipeline/') ||
    fileName.endsWith('service.java') ||
    fileName.endsWith('_service.py')
  ) {
    return 'SERVICE';
  }

  if (currentRole === 'API_CLIENT') {
    return 'API_CLIENT';
  }

  return 'MODULE';
}

export function roleToLayerKey(role: string): string {
  switch (role) {
    case 'UI_COMPONENT':
      return 'Frontend / UI Layer';
    case 'API_CLIENT':
      return 'Client & API Integration Layer';
    case 'CONTROLLER':
      return 'API / Controller Layer';
    case 'SERVICE':
      return 'Business Service Layer';
    case 'REPOSITORY':
      return 'Data Access Layer';
    case 'MODEL':
      return 'Domain Model & Entities';
    case 'CONFIG':
    case 'TEST':
      return 'Configuration & Tests';
    case 'MODULE':
    default:
      return 'Modules & Utilities';
  }
}

export function resolveNodeLayerKey(node: Pick<GraphNodeDto, 'path' | 'architecturalRole' | 'language' | 'tier'>): string {
  const refinedRole = refineArchitecturalRole(node.path, node.architecturalRole, node.language);
  return roleToLayerKey(refinedRole);
}

export function getLayerMeta(tier: string): LayerMeta {
  const normalized = LEGACY_LAYER_MAP[tier] ?? tier;
  return (
    LAYERS.find((l) => l.key === normalized) ?? {
      key: normalized,
      title: normalized,
      subtitle: '',
      color: '#64748b',
    }
  );
}

export function layerOrder(tier: string): number {
  const normalized = LEGACY_LAYER_MAP[tier] ?? tier;
  const idx = LAYERS.findIndex((l) => l.key === normalized);
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
