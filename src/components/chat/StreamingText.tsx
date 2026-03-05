import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../../stores/settingsStore';

interface StreamingTextProps {
  content: string;
  isStreaming?: boolean;
}

const remarkPlugins = [remarkGfm];

export default memo(function StreamingText({ content, isStreaming = false }: StreamingTextProps) {
  const cursorStyle = useSettingsStore((s) => s.settings.cursorStyle);

  const markdown = useMemo(
    () => <ReactMarkdown remarkPlugins={remarkPlugins}>{content}</ReactMarkdown>,
    [content],
  );

  return (
    <div className="markdown-content text-[15px] leading-relaxed text-[var(--color-text-primary)]">
      {markdown}
      {isStreaming && (
        <span
          className={`cursor-${cursorStyle} inline-block w-[3px] h-[1.1em] ml-1 rounded-sm bg-[var(--color-accent)] align-text-bottom`}
        />
      )}
    </div>
  );
});
