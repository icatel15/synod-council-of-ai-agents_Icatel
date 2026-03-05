import { memo, useState } from 'react';
import { Bot, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import StreamingText from './StreamingText';
import ThinkingIndicator from './ThinkingIndicator';
import { getProviderColor } from '../../types';
import type { Provider } from '../../types';

interface ModelResponseProps {
  provider: string;
  model: string;
  displayName: string;
  content: string;
  systemPrompt?: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  isFollowUp?: boolean;
  clarifyingExchange?: { question: string; answer: string }[];
}

export default memo(function ModelResponse({
  provider,
  displayName,
  content,
  systemPrompt,
  isStreaming = false,
  isThinking = false,
  isFollowUp = false,
  clarifyingExchange,
}: ModelResponseProps) {
  const color = getProviderColor(provider as Provider);
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  // Completed (non-streaming) responses start collapsed
  const [expanded, setExpanded] = useState(isStreaming || isThinking);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePromptClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPrompt((v) => !v);
  };

  // Always show content while streaming/thinking
  const showContent = isStreaming || isThinking || expanded;

  return (
    <div className="model-response-enter">
      {/* Sticky header — clickable to expand/collapse */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg-primary)]">
        <div
          className={`px-6 py-2.5 flex items-center gap-3 ${
            !isStreaming && !isThinking ? 'cursor-pointer hover:bg-[var(--color-bg-hover)]' : ''
          } transition-colors`}
          onClick={() => {
            if (!isStreaming && !isThinking) setExpanded((v) => !v);
          }}
        >
          {/* Expand/collapse chevron for completed responses */}
          {!isStreaming && !isThinking && (
            <span className="flex-shrink-0 text-[var(--color-text-tertiary)]">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${color}20` }}
          >
            <Bot size={14} style={{ color }} />
          </div>
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {displayName}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: `${color}15`,
              color,
            }}
          >
            {provider}
          </span>
          {isFollowUp && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              Follow-up
            </span>
          )}
          {systemPrompt && !isStreaming && (
            <button
              onClick={handlePromptClick}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title={showPrompt ? 'Hide system prompt' : 'View system prompt'}
            >
              {showPrompt ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Prompt
            </button>
          )}
          {content && !isThinking && (
            <button
              onClick={handleCopy}
              className="ml-auto p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title={copied ? 'Copied!' : 'Copy response'}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
        <div className="h-px bg-[var(--color-border-primary)]" />
      </div>

      {/* Content area — collapsible */}
      {showContent && (
        <div className="px-6 py-4">
          {isThinking && !content ? (
            <ThinkingIndicator modelName={displayName} color={color} />
          ) : (
            <>
              {showPrompt && systemPrompt && (
                <div className="mb-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)]">
                  <p className="text-xs font-semibold text-[var(--color-text-tertiary)] mb-1.5 uppercase tracking-wide">
                    System Prompt
                  </p>
                  <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">
                    {systemPrompt}
                  </p>
                </div>
              )}
              {clarifyingExchange && clarifyingExchange.length > 0 && (
                <div className="mb-3 space-y-2">
                  {clarifyingExchange.map((exchange, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)]"
                    >
                      <p className="text-sm text-[var(--color-text-secondary)] mb-1">
                        <span className="font-medium">Q:</span> {exchange.question}
                      </p>
                      <p className="text-sm text-[var(--color-text-primary)]">
                        <span className="font-medium">A:</span> {exchange.answer}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <StreamingText content={content} isStreaming={isStreaming} />
            </>
          )}
        </div>
      )}
    </div>
  );
});
