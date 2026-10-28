'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { slides, TALK_TITLE } from '@/slides';

// Slides are authored on a fixed 1600×900 stage and scaled to fit the window.
export const STAGE_W = 1600;
export const STAGE_H = 900;

const clamp = (i: number) => Math.min(slides.length - 1, Math.max(0, i));

function Stage({ index, width, active }: { index: number; width: number; active: boolean }) {
  const scale = width / STAGE_W;
  const slide = slides[index];
  return (
    <div className="stage-box" style={{ width, height: STAGE_H * scale }}>
      <div className="stage" style={{ transform: `scale(${scale})` }}>
        <slide.Component key={slide.id} active={active} />
        {index > 0 && (
          <footer className="stage-footer">
            <span>{TALK_TITLE}</span>
            <span>
              {index + 1} / {slides.length}
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}

export default function Deck() {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [print, setPrint] = useState(false);
  const [viewport, setViewport] = useState({ w: STAGE_W, h: STAGE_H });
  const [help, setHelp] = useState(true);
  const typed = useRef({ digits: '', at: 0 });

  useEffect(() => {
    const fromHash = () => {
      const n = parseInt(window.location.hash.slice(1), 10);
      if (n >= 1 && n <= slides.length) setIndex(n - 1);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    setPrint(new URLSearchParams(window.location.search).has('print'));

    const fit = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    fit();
    window.addEventListener('resize', fit);

    // Clicking a demo button or slider leaves it focused, which would swallow
    // the arrow/space keys used for navigation.
    const unfocus = () =>
      requestAnimationFrame(() => {
        const el = document.activeElement as HTMLInputElement | null;
        if (el && (el.tagName === 'BUTTON' || el.type === 'range')) el.blur();
      });
    document.addEventListener('pointerup', unfocus);

    const hideHelp = setTimeout(() => setHelp(false), 6000);
    setReady(true);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('hashchange', fromHash);
      document.removeEventListener('pointerup', unfocus);
      clearTimeout(hideHelp);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const hash = `#${index + 1}`;
    try {
      window.history.replaceState(null, '', `${window.location.search}${hash}`);
    } catch {
      // Some browsers refuse history updates on file:// pages; a fragment change still works.
      if (window.location.hash !== hash) window.location.replace(hash);
    }
  }, [index, ready]);

  const go = useCallback((to: (i: number) => number) => setIndex((i) => clamp(to(i))), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Type a slide number, then Enter, to jump (e.g. to the references during Q&A).
      if (/^[0-9]$/.test(e.key)) {
        const now = Date.now();
        typed.current = { digits: (now - typed.current.at < 1500 ? typed.current.digits : '') + e.key, at: now };
        return;
      }
      if (e.key === 'Enter' && typed.current.digits) {
        const n = parseInt(typed.current.digits, 10);
        typed.current.digits = '';
        if (n >= 1 && n <= slides.length) go(() => n - 1);
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          go((i) => i + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          go((i) => i - 1);
          break;
        case 'Home':
          go(() => 0);
          break;
        case 'End':
          go(() => slides.length - 1);
          break;
        case 'f': {
          // Older WebKit (the macOS app on macOS 12/13) only has the prefixed API.
          const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
          const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
          if (document.fullscreenElement || doc.webkitFullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen();
            else doc.webkitExitFullscreen?.();
          } else if (el.requestFullscreen) el.requestFullscreen();
          else el.webkitRequestFullscreen?.();
          break;
        }
        case '?':
        case 'h':
          setHelp((h) => !h);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!ready) return <main className="deck" />;

  // ?print lays every slide out as its own 1600×900 page, for Save as PDF (see scripts/build-pdf.mjs).
  if (print) {
    return (
      <main className="print-deck">
        {slides.map((s, i) => (
          <Stage key={s.id} index={i} width={STAGE_W} active />
        ))}
      </main>
    );
  }

  const width = Math.min(viewport.w, (viewport.h * STAGE_W) / STAGE_H);
  return (
    <main className="deck">
      <Stage index={index} width={width} active />
      {help && (
        <div className="help">
          <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>12</kbd> <kbd>Enter</kbd> jump · <kbd>F</kbd> fullscreen ·{' '}
          <kbd>H</kbd> hide
        </div>
      )}
    </main>
  );
}
