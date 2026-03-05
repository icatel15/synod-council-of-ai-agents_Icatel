import { describe, expect, it } from 'vitest';
import {
  deriveSystemPromptMode,
  getProviderColor,
  getProviderInfo,
  type DiscussionMode,
  type Provider,
  PROVIDERS,
} from './index';

describe('types/index', () => {
  it('derives system prompt mode from discussion mode', () => {
    const matrix: Array<{ mode: DiscussionMode; expected: 'dynamic' | 'upfront' | null }> = [
      { mode: 'sequential', expected: 'dynamic' },
      { mode: 'parallel', expected: 'upfront' },
      { mode: 'orchestrator', expected: null },
    ];

    for (const item of matrix) {
      expect(deriveSystemPromptMode(item.mode)).toBe(item.expected);
    }
  });

  it('returns provider metadata for all provider ids', () => {
    for (const provider of PROVIDERS) {
      const info = getProviderInfo(provider.id);
      expect(info.id).toBe(provider.id);
      expect(info.keychainService).toContain(provider.id);
    }
  });

  it('returns a color for every provider', () => {
    const providers: Provider[] = [
      'anthropic',
      'openai',
      'google',
      'xai',
      'deepseek',
      'mistral',
      'together',
      'cohere',
      'openrouter',
    ];

    for (const provider of providers) {
      const color = getProviderColor(provider);
      expect(color).toMatch(/^#/);
    }
  });
});

