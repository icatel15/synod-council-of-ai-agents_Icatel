import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscussionEntry, MasterModelConfig, ModelConfig, UsageData } from '../types';

const tauriMocks = vi.hoisted(() => ({
  onStreamToken: vi.fn(),
  streamChat: vi.fn(),
}));

const uuidMocks = vi.hoisted(() => ({
  v4: vi.fn(),
}));

vi.mock('../lib/tauri', () => tauriMocks);
vi.mock('uuid', () => uuidMocks);

async function loadStore() {
  vi.resetModules();
  const module = await import('./councilStore');
  return module.useCouncilStore;
}

function usage(inputTokens = 1, outputTokens = 2): UsageData {
  return { inputTokens, outputTokens };
}

describe('councilStore', () => {
  beforeEach(() => {
    tauriMocks.onStreamToken.mockReset().mockResolvedValue(vi.fn());
    tauriMocks.streamChat.mockReset();
    uuidMocks.v4.mockReset().mockReturnValue('stream-1');
  });

  it('runs orchestrator mode through startDiscussion and emits orchestrator message', async () => {
    const useCouncilStore = await loadStore();
    const entries: DiscussionEntry[] = [];
    const masterModel: MasterModelConfig = { provider: 'openai', model: 'gpt-5.2' };

    tauriMocks.streamChat.mockResolvedValue({
      content: 'orchestrator answer',
      usage: usage(),
    });

    const getApiKey = vi.fn(async () => 'key');
    await useCouncilStore.getState().startDiscussion(
      'How should we prioritize roadmap items?',
      [],
      masterModel,
      'thorough',
      'orchestrator',
      getApiKey,
      (entry) => entries.push(entry),
    );

    expect(entries.map((e) => e.role)).toEqual(['user', 'orchestrator_message']);
    expect(tauriMocks.streamChat).toHaveBeenCalledTimes(1);
    expect(useCouncilStore.getState().state).toBe('complete');
  });

  it('sendOrchestratorFollowUp builds history from user + orchestrator messages only', async () => {
    const useCouncilStore = await loadStore();
    const masterModel: MasterModelConfig = { provider: 'anthropic', model: 'claude-opus-4-6' };
    const entries: DiscussionEntry[] = [];

    tauriMocks.streamChat.mockResolvedValue({
      content: 'continuation',
      usage: usage(10, 11),
    });

    const existing: DiscussionEntry[] = [
      { role: 'user', content: 'Initial question' },
      {
        role: 'model',
        provider: 'openai',
        model: 'gpt-5.2',
        displayName: 'GPT-5.2',
        content: 'Council member response',
      },
      {
        role: 'orchestrator_message',
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        content: 'Prior orchestrator answer',
      },
    ];

    await useCouncilStore.getState().sendOrchestratorFollowUp(
      'Can you simplify that?',
      existing,
      masterModel,
      async () => 'master-key',
      (entry) => entries.push(entry),
    );

    const streamArgs = tauriMocks.streamChat.mock.calls[0];
    const messages = streamArgs[2] as Array<{ role: string; content: string }>;
    expect(messages).toEqual([
      { role: 'user', content: 'Initial question' },
      { role: 'assistant', content: 'Prior orchestrator answer' },
      { role: 'user', content: 'Can you simplify that?' },
    ]);
    expect(entries.map((e) => e.role)).toEqual(['user', 'orchestrator_message']);
    expect(useCouncilStore.getState().state).toBe('complete');
  });

  it('uses custom preset system prompt for sequential council runs', async () => {
    const useCouncilStore = await loadStore();
    const entries: DiscussionEntry[] = [];

    const model: ModelConfig = {
      provider: 'openai',
      model: 'gpt-5.2',
      displayName: 'GPT-5.2',
      order: 1,
    };
    const masterModel: MasterModelConfig = { provider: 'anthropic', model: 'claude-opus-4-6' };
    const customPrompt = 'Custom preset prompt for first model.';

    uuidMocks.v4
      .mockReturnValueOnce('model-stream')
      .mockReturnValueOnce('classify-stream')
      .mockReturnValueOnce('verdict-stream');

    tauriMocks.streamChat
      .mockResolvedValueOnce({ content: 'model response', usage: usage(1, 2) })
      .mockResolvedValueOnce({ content: '{"needsClarification": false}' })
      .mockResolvedValueOnce({ content: 'master verdict', usage: usage(3, 4) });

    const getApiKey = vi.fn(async () => 'api-key');
    await useCouncilStore.getState().startDiscussion(
      'What should we do next?',
      [model],
      masterModel,
      'thorough',
      'sequential',
      getApiKey,
      (entry) => entries.push(entry),
      { 'openai:gpt-5.2': customPrompt },
    );

    const modelEntry = entries.find((e) => e.role === 'model');
    expect(modelEntry && modelEntry.role === 'model' ? modelEntry.systemPrompt : undefined).toBe(customPrompt);
    expect(tauriMocks.streamChat.mock.calls[0][3]).toBe(customPrompt);
    expect(entries.map((e) => e.role)).toEqual(['user', 'model', 'master_verdict']);
    expect(useCouncilStore.getState().state).toBe('complete');
  });
});

