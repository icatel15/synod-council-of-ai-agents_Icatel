import { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Trash2, GripVertical, Sparkles, Send } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import OpenRouterModelSearch from '../common/OpenRouterModelSearch';
import { useSettingsStore } from '../../stores/settingsStore';
import { getApiKey, streamChat, onStreamToken } from '../../lib/tauri';
import type {
  CouncilPreset,
  ModelConfig,
  MasterModelConfig,
  Provider,
  DiscussionMode,
  DiscussionDepth,
} from '../../types';
import { PROVIDERS, getProviderInfo, deriveSystemPromptMode } from '../../types';

interface PresetEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  preset?: CouncilPreset;
}

interface PromptGenMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function PresetEditorModal({ isOpen, onClose, preset }: PresetEditorModalProps) {
  const { settings, updateSettings } = useSettingsStore();

  const [name, setName] = useState('');
  const [councilModels, setCouncilModels] = useState<ModelConfig[]>([]);
  const [masterModel, setMasterModel] = useState<MasterModelConfig>({
    provider: 'anthropic',
    model: 'claude-opus-4-6',
  });
  const [customSystemPrompts, setCustomSystemPrompts] = useState<Record<string, string>>({});
  const [discussionMode, setDiscussionMode] = useState<DiscussionMode>('sequential');
  const [discussionDepth, setDiscussionDepth] = useState<DiscussionDepth>('thorough');

  // Model adder state
  const [addProvider, setAddProvider] = useState<Provider>('anthropic');
  const [addModel, setAddModel] = useState('');
  const [orWebSearch, setOrWebSearch] = useState(false);

  // AI Prompt Generator state
  const [showPromptGen, setShowPromptGen] = useState(false);
  const [promptGenMessages, setPromptGenMessages] = useState<PromptGenMessage[]>([]);
  const [promptGenInput, setPromptGenInput] = useState('');
  const [promptGenStreaming, setPromptGenStreaming] = useState('');
  const [isPromptGenBusy, setIsPromptGenBusy] = useState(false);
  const [promptGenError, setPromptGenError] = useState('');
  const [promptsGenerated, setPromptsGenerated] = useState(false);
  const streamingRef = useRef('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Sync form state when modal opens (setState-during-render pattern)
  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    if (preset) {
      setName(preset.name);
      setCouncilModels([...preset.councilModels]);
      setMasterModel({ ...preset.masterModel });
      setCustomSystemPrompts({ ...preset.customSystemPrompts });
      setDiscussionMode(preset.discussionMode);
      setDiscussionDepth(preset.discussionDepth);
    } else {
      setName('');
      setCouncilModels([...settings.councilModels]);
      setMasterModel({ ...settings.masterModel });
      setCustomSystemPrompts({});
      setDiscussionMode(settings.discussionMode);
      setDiscussionDepth(settings.discussionDepth);
    }
    // Reset prompt generator state
    setShowPromptGen(false);
    setPromptGenMessages([]);
    setPromptGenInput('');
    setPromptGenStreaming('');
    setIsPromptGenBusy(false);
    setPromptGenError('');
    setPromptsGenerated(false);
  }
  if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  const isOrchestrator = discussionMode === 'orchestrator';

  const getModelsForProvider = (provider: Provider) => {
    const info = getProviderInfo(provider);
    return info.models;
  };

  const handleAddModel = () => {
    if (!addModel) return;
    const providerInfo = getProviderInfo(addProvider);
    const modelInfo = providerInfo.models.find(m => m.id === addModel);
    if (!modelInfo) return;

    const newModel: ModelConfig = {
      provider: addProvider,
      model: addModel,
      displayName: modelInfo.name,
      order: councilModels.length,
    };
    setCouncilModels([...councilModels, newModel]);
    setAddModel('');
  };

  const handleRemoveModel = (index: number) => {
    const updated = councilModels.filter((_, i) => i !== index);
    setCouncilModels(updated.map((m, i) => ({ ...m, order: i })));
  };

  const handleMoveModel = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === councilModels.length - 1) return;
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...councilModels];
    [updated[index], updated[swapIdx]] = [updated[swapIdx], updated[index]];
    setCouncilModels(updated.map((m, i) => ({ ...m, order: i })));
  };

  const handlePromptChange = (key: string, value: string) => {
    setCustomSystemPrompts(prev => ({ ...prev, [key]: value }));
  };

  const getPromptPlaceholder = (modelIndex: number): string => {
    if (discussionMode === 'sequential') {
      return modelIndex === 0
        ? 'Set the stage for the discussion. This model speaks first...'
        : 'Build on previous analysis. Challenge or add unique perspectives...';
    }
    return 'Provide an independent perspective on the topic...';
  };

  // ── AI Prompt Generator handlers ────────────────────────────────────

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    });
  };

  const handlePromptGenSend = async () => {
    const input = promptGenInput.trim();
    if (!input || isPromptGenBusy || councilModels.length === 0) return;

    setPromptGenInput('');
    setIsPromptGenBusy(true);
    setPromptGenError('');
    setPromptsGenerated(false);

    const newMessages: PromptGenMessage[] = [...promptGenMessages, { role: 'user', content: input }];
    setPromptGenMessages(newMessages);
    scrollChatToBottom();

    try {
      const apiKeyValue = await getApiKey(`com.council-of-ai-agents.${masterModel.provider}`);
      if (!apiKeyValue) {
        setPromptGenError('No API key found for the master model. Configure it in Settings.');
        setIsPromptGenBusy(false);
        return;
      }

      const chatMessages = newMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      const modelList = councilModels.map((m, i) => `${i + 1}. ${m.displayName} (${m.provider})`).join('\n');

      const systemPrompt = `You are an AI council architect helping a user design a council of ${councilModels.length} AI models:
${modelList}

The council will operate in ${discussionMode} mode.

Your job is to interview the user to understand what they need from this council. Ask 2-3 focused, specific questions about:
- The domain, use case, or problem they want the council to address
- What unique perspectives or roles each model should play
- Any preferences for analysis style, depth, or output format
- How the models should complement each other

Be conversational, warm, and concise. Number your questions. Don't overwhelm — ask just enough to craft great prompts.`;

      const streamId = uuidv4();
      streamingRef.current = '';
      setPromptGenStreaming('');

      const unlisten = await onStreamToken(streamId, (token) => {
        if (!token.done && !token.error) {
          streamingRef.current += token.token;
          setPromptGenStreaming(streamingRef.current);
          scrollChatToBottom();
        }
      });

      const result = await streamChat(
        masterModel.provider as Provider,
        masterModel.model,
        chatMessages,
        systemPrompt,
        apiKeyValue,
        streamId,
      );

      unlisten();
      setPromptGenStreaming('');
      setPromptGenMessages([...newMessages, { role: 'assistant', content: result.content }]);
      setIsPromptGenBusy(false);
      scrollChatToBottom();
    } catch (err) {
      setPromptGenError(`Interview failed: ${err}`);
      setIsPromptGenBusy(false);
    }
  };

  const handlePromptGenGenerate = async () => {
    if (isPromptGenBusy || councilModels.length === 0) return;

    setIsPromptGenBusy(true);
    setPromptGenError('');

    try {
      const apiKeyValue = await getApiKey(`com.council-of-ai-agents.${masterModel.provider}`);
      if (!apiKeyValue) {
        setPromptGenError('No API key found for the master model.');
        setIsPromptGenBusy(false);
        return;
      }

      const chatMessages = promptGenMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      const modelList = councilModels
        .map((m, i) => `${i + 1}. ${m.displayName} (key: "${m.provider}:${m.model}")`)
        .join('\n');

      const modeGuidance = discussionMode === 'sequential'
        ? 'Sequential mode: Model 1 speaks first and sets the stage for the discussion. Later models see previous responses and should build on, challenge, or add unique perspectives to the evolving discussion.'
        : 'Parallel mode: All models respond independently and simultaneously — they cannot see each other. Each prompt should encourage a fully independent, self-contained perspective.';

      chatMessages.push({
        role: 'user',
        content: `Based on our conversation, generate a tailored system prompt for each council model.

Models:
${modelList}

${modeGuidance}

Requirements for each prompt:
- Give each model a clear, distinct role that serves the council's purpose
- Be specific and actionable (not generic)
- Reference the domain and preferences we discussed
- Encourage unique contributions that complement (not duplicate) other models

Return ONLY valid JSON mapping each model's key to its prompt:
${JSON.stringify(
  councilModels.reduce(
    (acc, m) => ({ ...acc, [`${m.provider}:${m.model}`]: 'system prompt here' }),
    {},
  ),
  null,
  2,
)}`,
      });

      const streamId = uuidv4();
      streamingRef.current = '';
      setPromptGenStreaming('');

      const unlisten = await onStreamToken(streamId, (token) => {
        if (!token.done && !token.error) {
          streamingRef.current += token.token;
          setPromptGenStreaming(streamingRef.current);
          scrollChatToBottom();
        }
      });

      const result = await streamChat(
        masterModel.provider as Provider,
        masterModel.model,
        chatMessages,
        'Generate system prompts for council models based on the interview. Return valid JSON only, no markdown fences.',
        apiKeyValue,
        streamId,
      );

      unlisten();
      setPromptGenStreaming('');

      // Parse JSON response and populate prompts
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const prompts = JSON.parse(jsonMatch[0]);
        setCustomSystemPrompts(prompts);
        setPromptsGenerated(true);
      } else {
        setPromptGenError('Failed to parse generated prompts. Try again.');
      }

      setIsPromptGenBusy(false);
    } catch (err) {
      setPromptGenError(`Prompt generation failed: ${err}`);
      setIsPromptGenBusy(false);
    }
  };

  const resetPromptGen = () => {
    setPromptGenMessages([]);
    setPromptGenInput('');
    setPromptGenStreaming('');
    setIsPromptGenBusy(false);
    setPromptGenError('');
    setPromptsGenerated(false);
  };

  // ── Save / Delete handlers ──────────────────────────────────────────

  const handleSave = () => {
    if (!name.trim()) return;

    const now = new Date().toISOString();
    const newPreset: CouncilPreset = {
      id: preset?.id || uuidv4(),
      name: name.trim(),
      councilModels,
      masterModel,
      customSystemPrompts,
      discussionMode,
      discussionDepth,
      systemPromptMode: deriveSystemPromptMode(discussionMode) ?? 'upfront',
      createdAt: preset?.createdAt || now,
      updatedAt: now,
    };

    const existingPresets = settings.councilPresets;
    let updatedPresets: CouncilPreset[];

    if (preset) {
      updatedPresets = existingPresets.map(p => (p.id === preset.id ? newPreset : p));
    } else {
      updatedPresets = [...existingPresets, newPreset];
    }

    updateSettings({ councilPresets: updatedPresets });
    onClose();
  };

  const handleDelete = () => {
    if (!preset) return;
    const updatedPresets = settings.councilPresets.filter(p => p.id !== preset.id);
    const updatedActiveId = settings.activePresetId === preset.id ? null : settings.activePresetId;
    updateSettings({ councilPresets: updatedPresets, activePresetId: updatedActiveId });
    onClose();
  };

  const availableModels = getModelsForProvider(addProvider);
  const hasInterviewHistory = promptGenMessages.some(m => m.role === 'assistant');

  const modeOptions: { id: DiscussionMode; label: string; description: string }[] = [
    { id: 'sequential', label: 'Sequential', description: 'Models respond one at a time. The master dynamically steers each turn based on the evolving discussion.' },
    { id: 'parallel', label: 'Parallel', description: 'All models respond simultaneously with independent perspectives. Great for unbiased comparative analysis.' },
    { id: 'orchestrator', label: 'Orchestrator', description: 'Direct 1-on-1 chat with the master model. No council dispatch.' },
  ];

  const depthOptions: { id: DiscussionDepth; label: string; description: string }[] = [
    { id: 'thorough', label: 'Thorough', description: 'Detailed analysis with comprehensive explanations' },
    { id: 'concise', label: 'Concise', description: 'Brief responses with 2-3 key points only' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={preset ? 'Edit Council Preset' : 'New Council Preset'} size="lg">
      <div className="space-y-6">
        {/* 1. Preset Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
            Preset Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Stock Analysis, Code Review..."
            className="w-full px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-focus)]"
          />
        </div>

        {/* 2. Discussion Mode — the foundational choice */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Discussion Mode
          </label>
          <div className="space-y-1.5">
            {modeOptions.map(opt => (
              <button
                key={opt.id}
                onClick={() => setDiscussionMode(opt.id)}
                className={`w-full text-left p-2.5 rounded-[var(--radius-md)] border transition-all ${
                  discussionMode === opt.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                    : 'border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]'
                }`}
              >
                <span className={`text-xs font-medium ${
                  discussionMode === opt.id
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-primary)]'
                }`}>
                  {opt.label}
                </span>
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Council Models — hidden when Orchestrator */}
        {!isOrchestrator && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              Council Models
            </label>
            <div className="space-y-1.5 mb-3">
              {councilModels.map((model, idx) => (
                <div
                  key={`${model.provider}:${model.model}-${idx}`}
                  className="flex items-center gap-2 p-2 bg-[var(--color-bg-secondary)] rounded-[var(--radius-md)] border border-[var(--color-border-primary)]"
                >
                  <button
                    onClick={() => handleMoveModel(idx, 'up')}
                    disabled={idx === 0}
                    className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
                  >
                    <GripVertical size={14} />
                  </button>
                  <span className="flex-1 text-sm text-[var(--color-text-primary)]">
                    {model.displayName}
                    <span className="ml-1.5 text-xs text-[var(--color-text-tertiary)]">
                      ({getProviderInfo(model.provider).name})
                    </span>
                  </span>
                  <button
                    onClick={() => handleRemoveModel(idx)}
                    className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add model row */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={addProvider}
                  onChange={e => {
                    setAddProvider(e.target.value as Provider);
                    setAddModel('');
                  }}
                  className="px-2 py-1.5 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
                >
                  {PROVIDERS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {addProvider === 'openrouter' ? (
                  <div className="flex-1" />
                ) : (
                  <>
                    <select
                      value={addModel}
                      onChange={e => setAddModel(e.target.value)}
                      className="flex-1 px-2 py-1.5 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
                    >
                      <option value="">Select model...</option>
                      {availableModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={handleAddModel} disabled={!addModel}>
                      <Plus size={14} />
                    </Button>
                  </>
                )}
              </div>
              {addProvider === 'openrouter' && (
                <>
                  <label className="flex items-center gap-2 px-1">
                    <input
                      type="checkbox"
                      checked={orWebSearch}
                      onChange={e => setOrWebSearch(e.target.checked)}
                      className="rounded border-[var(--color-border-primary)]"
                    />
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      Enable web search
                    </span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      (~$0.02/request)
                    </span>
                  </label>
                  <OpenRouterModelSearch
                    onSelect={(model) => {
                      const modelId = orWebSearch ? `${model.id}:online` : model.id;
                      const displayName = orWebSearch ? `${model.name} (Web)` : model.name;
                      const exists = councilModels.some(
                        m => m.provider === 'openrouter' && m.model === modelId,
                      );
                      if (!exists) {
                        setCouncilModels([
                          ...councilModels,
                          {
                            provider: 'openrouter',
                            model: modelId,
                            displayName,
                            order: councilModels.length,
                          },
                        ]);
                      }
                    }}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* 4. Master Model */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Master Model
          </label>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={masterModel.provider}
                onChange={e => {
                  const provider = e.target.value as Provider;
                  const models = getModelsForProvider(provider);
                  setMasterModel({ provider, model: models[0]?.id || '' });
                }}
                className="px-2 py-1.5 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
              >
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {masterModel.provider !== 'openrouter' && (
                <select
                  value={masterModel.model}
                  onChange={e => setMasterModel({ ...masterModel, model: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
                >
                  {getModelsForProvider(masterModel.provider).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
            {masterModel.provider === 'openrouter' && (
              <div>
                <label className="flex items-center gap-2 px-1 mb-1.5">
                  <input
                    type="checkbox"
                    checked={orWebSearch}
                    onChange={e => setOrWebSearch(e.target.checked)}
                    className="rounded border-[var(--color-border-primary)]"
                  />
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    Enable web search
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    (~$0.02/request)
                  </span>
                </label>
                {masterModel.model && (
                  <p className="text-xs text-[var(--color-text-secondary)] mb-1">
                    Selected: <span className="font-medium">{masterModel.model}</span>
                  </p>
                )}
                <OpenRouterModelSearch
                  onSelect={(model) => {
                    const modelId = orWebSearch ? `${model.id}:online` : model.id;
                    setMasterModel({ provider: 'openrouter', model: modelId });
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* 5. Per-Model System Prompts + AI Generator — hidden when Orchestrator */}
        {!isOrchestrator && councilModels.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              Per-Model System Prompts
            </label>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
              Custom instructions for each council model. Leave empty to auto-generate, or use the AI assistant to craft them.
            </p>

            {/* ── AI Prompt Assistant ── */}
            {!showPromptGen ? (
              <button
                onClick={() => setShowPromptGen(true)}
                className="flex items-center gap-2 w-full p-2.5 text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent-light)] rounded-[var(--radius-md)] border border-dashed border-[var(--color-accent)] hover:opacity-80 transition-all mb-4"
              >
                <Sparkles size={14} />
                Generate prompts with AI assistant
              </button>
            ) : (
              <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-bg-secondary)] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-accent-light)] border-b border-[var(--color-accent)]">
                  <span className="text-xs font-medium text-[var(--color-accent)] flex items-center gap-1.5">
                    <Sparkles size={12} />
                    AI Prompt Assistant
                  </span>
                  <div className="flex items-center gap-2">
                    {promptGenMessages.length > 0 && (
                      <button
                        onClick={resetPromptGen}
                        className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        Start over
                      </button>
                    )}
                    <button
                      onClick={() => { setShowPromptGen(false); resetPromptGen(); }}
                      className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="p-3">
                  {/* Intro text */}
                  {promptGenMessages.length === 0 && !isPromptGenBusy && (
                    <p className="text-[11px] text-[var(--color-text-tertiary)] mb-2">
                      Describe what this council should do. The AI will interview you to understand your needs, then generate tailored prompts for each model.
                    </p>
                  )}

                  {/* Chat messages */}
                  {promptGenMessages.length > 0 && (
                    <div ref={chatScrollRef} className="max-h-52 overflow-y-auto space-y-2 mb-3">
                      {promptGenMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`text-xs p-2.5 rounded-[var(--radius-md)] ${
                            msg.role === 'user'
                              ? 'bg-[var(--color-accent-light)] text-[var(--color-text-primary)] ml-6'
                              : 'bg-[var(--color-bg-input)] text-[var(--color-text-secondary)] mr-6'
                          }`}
                        >
                          <span className="font-medium block mb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                            {msg.role === 'user' ? 'You' : 'AI Architect'}
                          </span>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Streaming response */}
                  {isPromptGenBusy && promptGenStreaming && (
                    <div className="text-xs p-2.5 rounded-[var(--radius-md)] bg-[var(--color-bg-input)] text-[var(--color-text-secondary)] mr-6 mb-3">
                      <span className="font-medium block mb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                        AI Architect
                      </span>
                      <p className="whitespace-pre-wrap leading-relaxed">{promptGenStreaming}</p>
                    </div>
                  )}

                  {/* Loading indicator */}
                  {isPromptGenBusy && !promptGenStreaming && (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)] mb-3 px-1">
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] thinking-dot" />
                        ))}
                      </div>
                      Thinking...
                    </div>
                  )}

                  {/* Success message */}
                  {promptsGenerated && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mb-3 px-1">
                      <Sparkles size={12} />
                      Prompts generated! Review and edit them below.
                    </div>
                  )}

                  {/* Error */}
                  {promptGenError && (
                    <p className="text-xs text-red-500 dark:text-red-400 mb-3 px-1">{promptGenError}</p>
                  )}

                  {/* Input + actions */}
                  {!isPromptGenBusy && (
                    <div className="space-y-2">
                      <div className="flex items-end gap-2">
                        <textarea
                          value={promptGenInput}
                          onChange={e => setPromptGenInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handlePromptGenSend();
                            }
                          }}
                          placeholder={
                            promptGenMessages.length === 0
                              ? 'e.g. "I want a council that reviews code for security, performance, and maintainability..."'
                              : 'Answer the questions above...'
                          }
                          rows={2}
                          className="flex-1 px-2.5 py-2 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-focus)] resize-none"
                        />
                        <Button size="sm" onClick={handlePromptGenSend} disabled={!promptGenInput.trim()}>
                          <Send size={12} />
                        </Button>
                      </div>

                      {/* Generate button — appears after at least one AI response */}
                      {hasInterviewHistory && (
                        <button
                          onClick={handlePromptGenGenerate}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-md)] hover:opacity-90 transition-all"
                        >
                          <Sparkles size={12} />
                          Generate Prompts from Interview
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Per-model prompt textareas */}
            <div className="space-y-3">
              {councilModels.map((model, idx) => {
                const key = `${model.provider}:${model.model}`;
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      {model.displayName}
                      <span className="ml-1 text-[var(--color-text-tertiary)]">
                        ({getProviderInfo(model.provider).name})
                      </span>
                    </label>
                    <textarea
                      value={customSystemPrompts[key] || ''}
                      onChange={e => handlePromptChange(key, e.target.value)}
                      placeholder={getPromptPlaceholder(idx)}
                      rows={2}
                      className="w-full px-3 py-2 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-focus)] resize-none"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 6. Discussion Depth */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Discussion Depth
          </label>
          <div className="space-y-1.5">
            {depthOptions.map(opt => (
              <button
                key={opt.id}
                onClick={() => setDiscussionDepth(opt.id)}
                className={`w-full text-left p-2.5 rounded-[var(--radius-md)] border transition-all ${
                  discussionDepth === opt.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)]'
                    : 'border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]'
                }`}
              >
                <span className={`text-xs font-medium ${
                  discussionDepth === opt.id
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-primary)]'
                }`}>
                  {opt.label}
                </span>
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border-primary)]">
          {preset && (
            <Button variant="ghost" onClick={handleDelete} className="text-[var(--color-error)] hover:bg-red-50 dark:hover:bg-red-950">
              <Trash2 size={14} className="mr-1.5" />
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {preset ? 'Save Changes' : 'Create Preset'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
