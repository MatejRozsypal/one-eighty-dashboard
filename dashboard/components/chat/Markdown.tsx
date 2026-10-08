"use client";

/**
 * The agent's answers are markdown: lists, bold numbers, and tables when it
 * compares clients or periods. Rendered, not shown raw, because a pipe table
 * as plain text is unreadable. GFM for the tables; no raw HTML is allowed
 * through (react-markdown drops it by default), so nothing the model writes
 * can inject markup into the page.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-[14.5px] leading-[1.7] text-content-strong">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="m-0">{children}</p>,
          ul: ({ children }) => <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
          h1: ({ children }) => <h3 className="m-0 text-[15.5px] font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="m-0 text-[15.5px] font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="m-0 text-[14.5px] font-semibold">{children}</h3>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded-sm bg-surface-card px-1 py-[1px] font-mono text-[12.5px]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="m-0 overflow-x-auto rounded-card border border-hairline bg-surface-card p-3 font-mono text-[12.5px] leading-[1.6]">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-card border border-hairline">
              <table className="w-full border-collapse text-[13px] tabular-nums">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-hairline bg-surface-card px-3 py-2 text-left font-semibold text-content-body">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-hairline px-3 py-2 align-top last:border-b-0">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
