import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../types';

const tauriMocks = vi.hoisted(() => ({
  loadSettings: vi.fn<() => Promise<AppSettings>>(),
  saveSettings: vi.fn<() => Promise<void>>(),
}));

const themeMocks = vi.hoisted(() => ({
  applyTheme: vi.fn<(theme: 'light' | 'dark' | 'system') => void>(),
  watchSystemTheme: vi.fn<(callback: (isDark: boolean) => void) => () => void>(),
}));

vi.mock('../lib/tauri', () => tauriMocks);
vi.mock('../lib/theme', () => themeMocks);

async function loadStore() {
  vi.resetModules();
  const module = await import('./settingsStore');
  return module.useSettingsStore;
}

describe('settingsStore', () => {
  beforeEach(() => {
    tauriMocks.loadSettings.mockReset();
    tauriMocks.saveSettings.mockReset();
    themeMocks.applyTheme.mockReset();
    themeMocks.watchSystemTheme.mockReset().mockReturnValue(() => {});
  });

  it('loads settings and merges defaults for new preset fields', async () => {
    tauriMocks.loadSettings.mockResolvedValue({
      councilModels: [],
      masterModel: { provider: 'openai', model: 'gpt-5.2' },
      discussionDepth: 'concise',
      discussionMode: 'parallel',
      theme: 'dark',
      cursorStyle: 'ripple',
      sessionSavePath: null,
      setupCompleted: true,
      // Intentionally omitted in persisted payload from older versions
    } as unknown as AppSettings);

    const useSettingsStore = await loadStore();
    await useSettingsStore.getState().loadSettings();

    const state = useSettingsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.settings.masterModel.provider).toBe('openai');
    expect(state.settings.discussionMode).toBe('parallel');
    expect(state.settings.councilPresets).toEqual([]);
    expect(state.settings.activePresetId).toBeNull();
    expect(themeMocks.applyTheme).toHaveBeenCalledWith('dark');
  });

  it('falls back to system theme when loading settings fails', async () => {
    tauriMocks.loadSettings.mockRejectedValue(new Error('boom'));
    const useSettingsStore = await loadStore();

    await useSettingsStore.getState().loadSettings();

    const state = useSettingsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(themeMocks.applyTheme).toHaveBeenCalledWith('system');
  });

  it('updates settings and persists merged state', async () => {
    tauriMocks.loadSettings.mockResolvedValue({
      councilModels: [],
      masterModel: { provider: 'anthropic', model: 'claude-opus-4-6' },
      discussionDepth: 'thorough',
      discussionMode: 'sequential',
      theme: 'system',
      cursorStyle: 'orbit',
      sessionSavePath: null,
      setupCompleted: false,
      councilPresets: [],
      activePresetId: null,
    });

    const useSettingsStore = await loadStore();
    await useSettingsStore.getState().loadSettings();
    await useSettingsStore.getState().updateSettings({
      discussionMode: 'orchestrator',
      activePresetId: 'preset-1',
    });

    const state = useSettingsStore.getState();
    expect(state.settings.discussionMode).toBe('orchestrator');
    expect(state.settings.activePresetId).toBe('preset-1');
    expect(tauriMocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(tauriMocks.saveSettings).toHaveBeenCalledWith(state.settings);
  });

  it('setTheme applies theme immediately and persists', async () => {
    tauriMocks.loadSettings.mockResolvedValue({
      councilModels: [],
      masterModel: { provider: 'anthropic', model: 'claude-opus-4-6' },
      discussionDepth: 'thorough',
      discussionMode: 'sequential',
      theme: 'system',
      cursorStyle: 'orbit',
      sessionSavePath: null,
      setupCompleted: false,
      councilPresets: [],
      activePresetId: null,
    });

    const useSettingsStore = await loadStore();
    await useSettingsStore.getState().loadSettings();
    await useSettingsStore.getState().setTheme('light');

    expect(themeMocks.applyTheme).toHaveBeenCalledWith('light');
    expect(tauriMocks.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'light' }),
    );
  });
});
