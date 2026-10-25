/**
 * AI の発言などの Markdown を表示する（react-markdown + remark-gfm）。
 *
 * HTML はそのまま埋め込まない（react-markdown の既定）。
 * リンクは http(s) だけ既定のブラウザーで開き、ローカルのファイルなどへのリンクは文字として出す
 * （画面の中で別のページに移動しないように）。
 */
import type { ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const COMPONENTS: Components = {
  h1: (props) => <h3 className="mt-2 mb-1 text-base font-bold" {...props} />,
  h2: (props) => <h3 className="mt-2 mb-1 text-sm font-bold" {...props} />,
  h3: (props) => <h4 className="mt-2 mb-1 font-bold" {...props} />,
  h4: (props) => <h4 className="mt-2 mb-1 font-bold" {...props} />,
  p: (props) => <p className="my-1" {...props} />,
  ul: (props) => <ul className="my-1 list-disc pl-5" {...props} />,
  ol: (props) => <ol className="my-1 list-decimal pl-5" {...props} />,
  li: (props) => <li className="my-0.5" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="my-1 border-l-2 border-base-300 pl-3 text-muted"
      {...props}
    />
  ),
  hr: () => <hr className="my-2 border-base-300" />,
  a: ({ href, children }) =>
    href && /^https?:\/\//.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="link link-primary"
      >
        {children}
      </a>
    ) : (
      <span className="underline decoration-dotted" title={href}>
        {children}
      </span>
    ),
  code: ({ className, children }) => (
    // コードブロックの中では pre が囲むので、ここでは行内の見た目だけを付ける
    <code
      className={`rounded bg-base-content/8 px-1 py-px font-mono text-[12px] ${className ?? ''}`}
    >
      {children}
    </code>
  ),
  pre: (props) => (
    <pre
      className="my-1.5 overflow-x-auto rounded-md bg-base-300/60 p-2 font-mono text-[12px] [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  table: (props) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="table-xs table" {...props} />
    </div>
  ),
  input: (props: ComponentProps<'input'>) => (
    // GFM のチェックボックス（表示のみ）
    <input {...props} disabled className="checkbox checkbox-xs align-middle" />
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
