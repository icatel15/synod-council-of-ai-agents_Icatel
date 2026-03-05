import { useSettingsStore } from '../../stores/settingsStore';
import type { DiscussionDepth, DiscussionMode } from '../../types';

export default function AdvancedSettings() {
  const { settings, updateSettings } = useSettingsStore();

  const depths: { id: DiscussionDepth; label: string; description: string }[] = [
    {
      id: 'thorough',
      label: 'Thorough',
      description:
        'Models provide detailed analysis with comprehensive explanations. Best for complex decisions (uses more tokens).',
    },
    {
      id: 'concise',
      label: 'Concise',
      description:
        'Models give brief, focused responses with 2-3 key points only. Great for quick insights (saves tokens).',
    },
  ];

  const discussionModes: { id: DiscussionMode; label: string; description: string }[] = [
    {
      id: 'sequential',
      label: 'Sequential',
      description:
        'Models respond one at a time. The master dynamically steers each turn based on the evolving discussion.',
    },
    {
      id: 'parallel',
      label: 'Parallel',
      description:
        'All models respond simultaneously with independent perspectives. Great for unbiased comparative analysis.',
    },
    {
      id: 'orchestrator',
      label: 'Orchestrator',
      description:
        'Direct 1-on-1 chat with the master model. No council dispatch.',
    },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
        Discussion Mode
      </h3>
      <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
        How models interact during a council discussion
      </p>

      <div className="space-y-2 mb-6">
        {discussionModes.map((dm) => (
          <button
            key={dm.id}
            onClick={() => updateSettings({ discussionMode: dm.id })}
            className={`w-full text-left p-3 rounded-[var(--radius-md)] border transition-all ${
              settings.discussionMode === dm.id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                : 'border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]'
            }`}
          >
            <span
              className={`text-sm font-medium ${
                settings.discussionMode === dm.id
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-primary)]'
              }`}
            >
              {dm.label}
            </span>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {dm.description}
            </p>
          </button>
        ))}
      </div>

      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
        Discussion Depth
      </h3>
      <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
        Control how detailed the council's responses should be
      </p>

      <div className="space-y-2">
        {depths.map((depth) => (
          <button
            key={depth.id}
            onClick={() => updateSettings({ discussionDepth: depth.id })}
            className={`w-full text-left p-3 rounded-[var(--radius-md)] border transition-all ${
              settings.discussionDepth === depth.id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                : 'border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]'
            }`}
          >
            <span
              className={`text-sm font-medium ${
                settings.discussionDepth === depth.id
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-primary)]'
              }`}
            >
              {depth.label}
            </span>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {depth.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
