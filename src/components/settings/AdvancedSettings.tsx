import { useSettingsStore } from '../../stores/settingsStore';
import type { SystemPromptMode, DiscussionDepth, DiscussionMode } from '../../types';

export default function AdvancedSettings() {
  const { settings, updateSettings } = useSettingsStore();

  const modes: { id: SystemPromptMode; label: string; description: string }[] = [
    {
      id: 'upfront',
      label: 'Generate All Upfront',
      description:
        'Master model generates system prompts for all council models before the discussion starts. One API call, faster overall.',
    },
    {
      id: 'dynamic',
      label: 'Generate Dynamically Per Turn',
      description:
        'Master model generates each system prompt right before that model responds, incorporating context from previous responses. More adaptive but uses more API calls.',
    },
  ];

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
        'Models respond one at a time. Each model sees previous responses, building on the discussion.',
    },
    {
      id: 'parallel',
      label: 'Parallel',
      description:
        'All models respond simultaneously with independent perspectives. The orchestrator asks clarifying questions before dispatching.',
    },
  ];

  const isParallel = settings.discussionMode === 'parallel';

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

      <div className="space-y-2 mb-6">
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

      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
        System Prompt Generation
      </h3>
      <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
        How the master model creates system prompts for council members
      </p>

      {isParallel && (
        <p className="text-xs text-[var(--color-text-tertiary)] italic mb-3">
          Parallel mode always generates system prompts upfront.
        </p>
      )}

      <div className={`space-y-2 ${isParallel ? 'opacity-50 pointer-events-none' : ''}`}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => updateSettings({ systemPromptMode: mode.id })}
            className={`w-full text-left p-3 rounded-[var(--radius-md)] border transition-all ${
              settings.systemPromptMode === mode.id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                : 'border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]'
            }`}
          >
            <span
              className={`text-sm font-medium ${
                settings.systemPromptMode === mode.id
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-primary)]'
              }`}
            >
              {mode.label}
            </span>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {mode.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
