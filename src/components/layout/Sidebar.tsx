import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Plus,
  MessageSquare,
  Trash2,
  Search,
  X,
  Crown,
  Pencil,
} from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCouncilStore } from '../../stores/councilStore';
import PresetEditorModal from '../presets/PresetEditorModal';
import type { CouncilPreset } from '../../types';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Previous 7 Days';
  if (diffDays < 30) return 'Previous 30 Days';
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

interface GroupedSessions {
  label: string;
  sessions: { id: string; title: string; updatedAt: string }[];
}

function groupSessions(
  sessions: { id: string; title: string; updatedAt: string }[],
): GroupedSessions[] {
  const groups: Map<string, GroupedSessions> = new Map();

  for (const session of sessions) {
    const label = formatDate(session.updatedAt);
    if (!groups.has(label)) {
      groups.set(label, { label, sessions: [] });
    }
    groups.get(label)!.sessions.push(session);
  }

  return Array.from(groups.values());
}

export default function Sidebar() {
  const { sessions, activeSession, loadSessions, loadAndSetSession, setActiveSession, deleteSession } =
    useSessionStore();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const sessionSavePath = settings.sessionSavePath;
  const councilReset = useCouncilStore((s) => s.reset);

  // Preset editor state
  const [showPresetEditor, setShowPresetEditor] = useState(false);
  const [editingPreset, setEditingPreset] = useState<CouncilPreset | undefined>(undefined);

  useEffect(() => {
    loadSessions(sessionSavePath);
  }, [sessionSavePath, loadSessions]);

  const handleNewSession = () => {
    setActiveSession(null);
    councilReset();
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSession(null);
    councilReset();
    loadAndSetSession(sessionId, sessionSavePath);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId, sessionSavePath);
  };

  const handleActivatePreset = (preset: CouncilPreset) => {
    if (settings.activePresetId === preset.id) {
      // Deactivate
      updateSettings({ activePresetId: null });
    } else {
      // Activate: copy preset config into top-level settings
      updateSettings({
        councilModels: preset.councilModels,
        masterModel: preset.masterModel,
        discussionMode: preset.discussionMode,
        discussionDepth: preset.discussionDepth,
        activePresetId: preset.id,
      });
    }
  };

  const handleEditPreset = (e: React.MouseEvent, preset: CouncilPreset) => {
    e.stopPropagation();
    setEditingPreset(preset);
    setShowPresetEditor(true);
  };

  const handleNewPreset = () => {
    setEditingPreset(undefined);
    setShowPresetEditor(true);
  };

  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
    : sessions;
  const grouped = groupSessions(filtered);

  return (
    <div className="w-64 h-full flex flex-col bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border-primary)]">
      {/* Spacer for macOS traffic light buttons */}
      <div
        onMouseDown={() => getCurrentWindow().startDragging()}
        className="titlebar-drag-region h-12 flex-shrink-0"
      />

      {/* New session button */}
      <div className="px-3 pb-2">
        <button
          onClick={handleNewSession}
          className="titlebar-no-drag flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-[var(--radius-md)] transition-colors w-full"
        >
          <Plus size={16} />
          <span>New Session</span>
        </button>
      </div>

      {/* Councils section */}
      <div className="px-3 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
            Councils
          </p>
          <button
            onClick={handleNewPreset}
            className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            title="New preset"
          >
            <Plus size={13} />
          </button>
        </div>
        {settings.councilPresets.length > 0 ? (
          <div className="space-y-0.5">
            {settings.councilPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleActivatePreset(preset)}
                className={`group w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded-[var(--radius-md)] transition-all ${
                  settings.activePresetId === preset.id
                    ? 'bg-[var(--color-accent-light)] text-[var(--color-accent)] border border-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] border border-transparent'
                }`}
              >
                <Crown size={12} className="flex-shrink-0 opacity-60" />
                <span className="flex-1 truncate font-medium">{preset.name}</span>
                <button
                  onClick={(e) => handleEditPreset(e, preset)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--color-accent)] transition-all"
                  title="Edit preset"
                >
                  <Pencil size={11} />
                </button>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-[var(--color-text-tertiary)] italic px-1">
            No presets yet
          </p>
        )}
      </div>

      {/* Preset Editor Modal */}
      <PresetEditorModal
        isOpen={showPresetEditor}
        onClose={() => {
          setShowPresetEditor(false);
          setEditingPreset(undefined);
        }}
        preset={editingPreset}
      />

      {/* Search sessions */}
      {sessions.length > 0 && (
        <div className="px-3 pb-2">
          <div className="relative flex items-center">
            <Search
              size={14}
              className="absolute left-2.5 text-[var(--color-text-tertiary)] pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--color-bg-input)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-focus)] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <AnimatePresence>
          {grouped.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-3 py-1 text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {group.label}
              </p>
              {group.sessions.map((session) => (
                <motion.button
                  key={session.id}
                  layout
                  onClick={() => handleSelectSession(session.id)}
                  className={`group w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded-[var(--radius-md)] transition-colors ${
                    activeSession?.id === session.id
                      ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <MessageSquare size={14} className="flex-shrink-0 opacity-50" />
                  <span className="flex-1 truncate">{session.title}</span>
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-[var(--color-error)] transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </motion.button>
              ))}
            </div>
          ))}
        </AnimatePresence>

        {sessions.length === 0 && (
          <p className="px-3 py-8 text-xs text-center text-[var(--color-text-tertiary)]">
            No sessions yet.
            <br />
            Start a conversation!
          </p>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <p className="px-3 py-8 text-xs text-center text-[var(--color-text-tertiary)]">
            No sessions found.
          </p>
        )}
      </div>
    </div>
  );
}
