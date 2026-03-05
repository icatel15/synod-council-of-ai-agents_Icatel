import { useState, useEffect, useRef } from 'react';
import { Loader2, Search } from 'lucide-react';

export interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

interface CategorizedSection {
  label: string;
  models: OpenRouterModel[];
}

const CLOSED_LEADERS = ['openai/', 'anthropic/', 'google/'];
const OPENSOURCE_LEADERS = ['meta-llama/', 'qwen/', 'deepseek/', 'mistralai/', 'microsoft/', 'nvidia/'];

function formatContextLength(len: number): string {
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(len % 1_000_000 === 0 ? 0 : 1)}M`;
  if (len >= 1_000) return `${(len / 1_000).toFixed(len % 1_000 === 0 ? 0 : 1)}K`;
  return len.toString();
}

function formatPrice(perToken: string): string {
  const perMillion = parseFloat(perToken) * 1_000_000;
  if (isNaN(perMillion) || perMillion === 0) return 'free';
  if (perMillion < 0.01) return '<$0.01';
  return `$${perMillion.toFixed(2)}`;
}

function categorizeModels(models: OpenRouterModel[]): CategorizedSection[] {
  const closed: OpenRouterModel[] = [];
  const opensource: OpenRouterModel[] = [];
  const others: OpenRouterModel[] = [];

  for (const m of models) {
    if (CLOSED_LEADERS.some((p) => m.id.startsWith(p))) {
      closed.push(m);
    } else if (OPENSOURCE_LEADERS.some((p) => m.id.startsWith(p))) {
      opensource.push(m);
    } else {
      others.push(m);
    }
  }

  const byDate = (a: OpenRouterModel, b: OpenRouterModel) => b.created - a.created;
  closed.sort(byDate);
  opensource.sort(byDate);
  others.sort(byDate);

  return [
    { label: 'Closed Leaders', models: closed },
    { label: 'Open-Source Leaders', models: opensource },
    { label: 'Others', models: others },
  ];
}

// Module-level cache shared across all instances
let modelCache: OpenRouterModel[] | null = null;

export default function OpenRouterModelSearch({ onSelect }: { onSelect: (model: { id: string; name: string }) => void }) {
  const [query, setQuery] = useState('');
  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (modelCache) {
      setAllModels(modelCache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models: OpenRouterModel[] = (data.data ?? []).map((m: Record<string, unknown>) => ({
          id: m.id as string,
          name: m.name as string,
          created: (m.created as number) ?? 0,
          context_length: (m.context_length as number) ?? 0,
          pricing: (m.pricing as { prompt: string; completion: string }) ?? { prompt: '0', completion: '0' },
        }));
        if (!cancelled) {
          modelCache = models;
          setAllModels(models);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load models');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = query
    ? allModels.filter((m) => {
        const q = query.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      })
    : allModels;

  const sections = categorizeModels(filtered);
  const flatFiltered = sections.flatMap((s) => s.models);

  // Reset selection when query changes
  const prevQueryRef = useRef(query);
  if (prevQueryRef.current !== query) {
    prevQueryRef.current = query;
    setSelectedIndex(0);
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatFiltered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && flatFiltered.length > 0) {
        e.preventDefault();
        const model = flatFiltered[selectedIndex];
        if (model) {
          onSelect({ id: model.id, name: model.name });
          setQuery('');
          setIsOpen(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatFiltered, selectedIndex, onSelect]);

  // Scroll selected into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-model-item]');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-tertiary)]">
        <Loader2 size={14} className="animate-spin" />
        Loading OpenRouter models...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-sm text-[var(--color-error)]">
        Failed to load models: {error}
      </div>
    );
  }

  let itemIndex = 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search OpenRouter models..."
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
        />
      </div>

      {isOpen && flatFiltered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] shadow-lg overflow-y-auto"
          style={{ maxHeight: '320px' }}
        >
          {sections.map((section) => {
            if (section.models.length === 0) return null;
            return (
              <div key={section.label}>
                <div className="sticky top-0 z-10 px-3 py-1.5 text-xs font-semibold text-[var(--color-text-tertiary)] bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)]">
                  {section.label}
                </div>
                {section.models.map((model) => {
                  const idx = itemIndex++;
                  const promptPrice = formatPrice(model.pricing.prompt);
                  const completionPrice = formatPrice(model.pricing.completion);
                  return (
                    <button
                      key={model.id}
                      data-model-item
                      onClick={() => {
                        onSelect({ id: model.id, name: model.name });
                        setQuery('');
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        idx === selectedIndex
                          ? 'bg-[var(--color-bg-hover)]'
                          : 'hover:bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {model.name}
                        </span>
                        <span className="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                          {formatContextLength(model.context_length)} ctx
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs text-[var(--color-text-tertiary)] truncate">
                          {model.id}
                        </span>
                        <span className="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                          {promptPrice} / {completionPrice} /M
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {isOpen && flatFiltered.length === 0 && query && (
        <div className="absolute z-50 left-0 right-0 mt-1 px-3 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] shadow-lg">
          <p className="text-sm text-[var(--color-text-tertiary)] text-center">No models match &quot;{query}&quot;</p>
        </div>
      )}
    </div>
  );
}
