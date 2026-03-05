import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PresetEditorModal from './PresetEditorModal';
import type { AppSettings } from '../../types';

const updateSettingsSpy = vi.fn();
const onCloseSpy = vi.fn();

let settingsState: { settings: AppSettings };

vi.mock('uuid', () => ({
  v4: () => 'preset-fixed-id',
}));

vi.mock('../common/Modal', () => ({
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) => (isOpen ? <div><h1>{title}</h1>{children}</div> : null),
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (
    selector?: (state: { settings: AppSettings; updateSettings: typeof updateSettingsSpy }) => unknown,
  ) => {
    const state = {
      settings: settingsState.settings,
      updateSettings: updateSettingsSpy,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('PresetEditorModal', () => {
  beforeEach(() => {
    updateSettingsSpy.mockReset();
    onCloseSpy.mockReset();

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
        councilPresets: [],
        activePresetId: null,
      },
    };
  });

  it('creates an orchestrator preset and derives fallback systemPromptMode', () => {
    render(<PresetEditorModal isOpen={true} onClose={onCloseSpy} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. Stock Analysis, Code Review...'), {
      target: { value: 'Direct Master Chat' },
    });

    fireEvent.click(screen.getByText('Orchestrator'));

    expect(screen.queryByText('Council Models')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Create Preset'));

    expect(updateSettingsSpy).toHaveBeenCalledTimes(1);
    const payload = updateSettingsSpy.mock.calls[0][0] as { councilPresets: Array<{ discussionMode: string; systemPromptMode: string }> };
    expect(payload.councilPresets[0].discussionMode).toBe('orchestrator');
    expect(payload.councilPresets[0].systemPromptMode).toBe('upfront');
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });
});
