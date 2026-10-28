'use client';

import type { ReactNode } from 'react';

export function Frame({
  kicker,
  title,
  children,
}: {
  kicker?: string;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="frame">
      {(kicker || title) && (
        <header className="frame-head">
          {kicker && <div className="kicker">{kicker}</div>}
          {title && <h2>{title}</h2>}
        </header>
      )}
      <div className="frame-body">{children}</div>
    </div>
  );
}

/** Marks content you still need to replace with your own details. Search the repo for `<Todo` to find them all. */
export function Todo({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return (
    <span className={inline ? 'todo todo-inline' : 'todo'}>
      <span className="todo-tag">Fill in</span>
      {children}
    </span>
  );
}

export function Segmented<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="control">
      {label && <span className="control-label">{label}</span>}
      <div className="seg">
        {options.map((o) => (
          <button
            key={String(o.value)}
            className={o.value === value ? 'on' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="control slider">
      <span className="control-label">
        {label} <b>{format(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
