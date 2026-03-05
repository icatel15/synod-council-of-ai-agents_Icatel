import { memo, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../../stores/settingsStore';

interface StreamingTextProps {
  content: string;
  isStreaming?: boolean;
}

const remarkPlugins = [remarkGfm];

// Throttle interval for markdown parsing during streaming (ms).
// Between parses, new tokens are shown as raw text in a lightweight span.
const PARSE_THROTTLE_MS = 300;

export default memo(function StreamingText({ content, isStreaming = false }: StreamingTextProps) {
  const cursorStyle = useSettingsStore((s) => s.settings.cursorStyle);

  // Track the last committed markdown parse to throttle during streaming
  const lastParseRef = useRef({ content: '', time: 0 });

  // Decide what slice of content to render as parsed markdown.
  // During streaming we only re-parse every PARSE_THROTTLE_MS; between
  // parses the "tail" (new tokens since last parse) renders as raw text.
  let parsedContent: string;
  if (!isStreaming) {
    // Not streaming — always render the full content as markdown
    parsedContent = content;
    lastParseRef.current = { content, time: Date.now() };
  } else {
    const now = Date.now();
    if (
      now - lastParseRef.current.time >= PARSE_THROTTLE_MS ||
      lastParseRef.current.content === ''
    ) {
      // Enough time has passed — commit a new parse
      parsedContent = content;
      lastParseRef.current = { content, time: now };
    } else {
      // Throttled — reuse last parsed content
      parsedContent = lastParseRef.current.content;
    }
  }

  // Tail: tokens received since the last markdown parse (cheap raw text)
  const tail = isStreaming && content.length > parsedContent.length
    ? content.slice(parsedContent.length)
    : '';

  const markdown = useMemo(
    () => <ReactMarkdown remarkPlugins={remarkPlugins}>{parsedContent}</ReactMarkdown>,
    [parsedContent],
  );

  return (
    <div className="markdown-content text-[15px] leading-relaxed text-[var(--color-text-primary)]">
      {markdown}
      {tail && <span className="whitespace-pre-wrap">{tail}</span>}
      {isStreaming && (
        <span
          className={`cursor-${cursorStyle} inline-block w-[3px] h-[1.1em] ml-1 rounded-sm bg-[var(--color-accent)] align-text-bottom`}
        />
      )}
    </div>
  );
});
