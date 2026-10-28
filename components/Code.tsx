import type { ReactNode } from 'react';

/** Minimal code panel: `//` comments are dimmed and the listed API names are highlighted. */
export default function Code({
  code,
  title,
  highlight = [],
}: {
  code: string;
  title?: ReactNode;
  highlight?: string[];
}) {
  const api = highlight.length ? new RegExp(`\\b(${highlight.join('|')})\\b`) : null;
  const lines = code.replace(/^\n+|\s+$/g, '').split('\n');

  return (
    <figure className="code">
      {title && <figcaption>{title}</figcaption>}
      <pre>
        {lines.map((line, i) => {
          const c = line.indexOf('//');
          const body = c >= 0 ? line.slice(0, c) : line;
          const comment = c >= 0 ? line.slice(c) : '';
          const parts = api ? body.split(api) : [body];
          return (
            <div key={i} className="code-line">
              {parts.map((p, j) =>
                j % 2 ? (
                  <span key={j} className="code-api">
                    {p}
                  </span>
                ) : (
                  p
                ),
              )}
              {comment && <span className="code-comment">{comment}</span>}
              {!line && ' '}
            </div>
          );
        })}
      </pre>
    </figure>
  );
}
