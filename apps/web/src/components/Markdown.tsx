'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Safe markdown renderer for agent/user message content.
// react-markdown never emits raw HTML (rehype-raw is NOT installed), so
// injected <script>/<img onerror> in model output renders as literal text.
export function Markdown({ content }: { content: string }) {
  return (
    <div className="md-body text-sm text-[hsl(var(--text-primary))] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[hsl(var(--accent))] underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
