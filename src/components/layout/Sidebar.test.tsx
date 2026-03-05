import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';
import type { AppSettings, CouncilPreset, SessionSummary } from '../../types';

const resetSpy = vi.fn();
const loadSessionsSpy = vi.fn();
const loadAndSetSessionSpy = vi.fn();
const setActiveSessionSpy = vi.fn();
const deleteSessionSpy = vi.fn();
const updateSettingsSpy = vi.fn();

const basePreset: CouncilPreset = {
  id: 'preset-1',
  name: 'Parallel Council',
  councilModels: [
    { provider: 'openai', model: 'gpt-5.2', displayName: 'GPT-5.2', order: 1 },
  ],
  masterModel: { provider: 'anthropic', model: 'claude-opus-4-6' },
  customSystemPrompts: {},
  discussionMode: 'parallel',
  discussionDepth: 'concise',
  systemPromptMode: 'upfront',
  createdAt: '2026-03-05T00:00:00.000Z',
  updatedAt: '2026-03-05T00:00:00.000Z',
};

let sessionsState: {
  sessions: SessionSummary[];
  activeSession: { id: string } | null;
};

let settingsState: {
  settings: AppSettings;
};

vi.mock('framer-motion', () => ({
  motion: {
    button: (props: React.ComponentProps<'button'>) => <button {...props} />,
    div: (props: React.ComponentProps<'div'>) => <div {...props} />,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn() }),
}));

vi.mock('../presets/PresetEditorModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="preset-editor">{isOpen ? 'open' : 'closed'}</div>
  ),
}));

vi.mock('../../stores/councilStore', () => ({
  useCouncilStore: (selector: (state: { reset: () => void }) => unknown) =>
    selector({ reset: resetSpy }),
}));

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (
    selector?: (state: {
      sessions: SessionSummary[];
      activeSession: { id: string } | null;
      loadSessions: typeof loadSessionsSpy;
      loadAndSetSession: typeof loadAndSetSessionSpy;
      setActiveSession: typeof setActiveSessionSpy;
      deleteSession: typeof deleteSessionSpy;
    }) => unknown,
  ) => {
    const state = {
      sessions: sessionsState.sessions,
      activeSession: sessionsState.activeSession,
      loadSessions: loadSessionsSpy,
      loadAndSetSession: loadAndSetSessionSpy,
      setActiveSession: setActiveSessionSpy,
      deleteSession: deleteSessionSpy,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (
    selector: (state: { settings: AppSettings; updateSettings: typeof updateSettingsSpy }) => unknown,
  ) =>
    selector({
      settings: settingsState.settings,
      updateSettings: updateSettingsSpy,
    }),
}));

describe('Sidebar presets', () => {
  beforeEach(() => {
    resetSpy.mockReset();
    loadSessionsSpy.mockReset();
    loadAndSetSessionSpy.mockReset();
    setActiveSessionSpy.mockReset();
    deleteSessionSpy.mockReset();
    updateSettingsSpy.mockReset();

    sessionsState = {
      sessions: [],
      activeSession: null,
    };

    settingsState = {
      settings: {
        councilModels: [],
        masterModel: { provider: 'anthropic', model: 'claude-opus-4-6' },
        discussionDepth: 'thorough',
        discussionMode: 'sequential',
        theme: 'system',
        cursorStyle: 'orbit',
        sessionSavePath: null,
        setupCompleted: true,
        councilPresets: [basePreset],
        activePresetId: null,
      },
    };
  });

  it('activates preset and copies preset config to top-level settings', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Parallel Council'));

    expect(updateSettingsSpy).toHaveBeenCalledWith({
      councilModels: basePreset.councilModels,
      masterModel: basePreset.masterModel,
      discussionMode: basePreset.discussionMode,
      discussionDepth: basePreset.discussionDepth,
      activePresetId: basePreset.id,
    });
  });

  it('deactivates currently active preset on second click', () => {
    settingsState.settings.activePresetId = basePreset.id;
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Parallel Council'));

    expect(updateSettingsSpy).toHaveBeenCalledWith({ activePresetId: null });
  });
});
