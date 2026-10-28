import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-[11px]"
    >
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        title="Switch to Custom Dark theme"
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
          theme === 'dark'
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Moon className="h-3.5 w-3.5" />
        <span>Dark</span>
      </button>
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        title="Switch to Custom Light theme"
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
          theme === 'light'
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Sun className="h-3.5 w-3.5" />
        <span>Light</span>
      </button>
    </div>
  );
}
