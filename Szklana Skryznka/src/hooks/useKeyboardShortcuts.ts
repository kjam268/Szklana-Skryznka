import { useEffect, useCallback } from "react";

interface ShortcutOptions {
  allowInInput?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

function isInTextField(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!target?.isContentEditable;
}

export function useKeyboardShortcut(
  key: string,
  handler: (e: KeyboardEvent) => void,
  opts: ShortcutOptions = {}
) {
  const stableHandler = useCallback(handler, [handler]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!opts.allowInInput && isInTextField(e)) return;
      if (opts.ctrl !== undefined && e.ctrlKey !== opts.ctrl) return;
      if (opts.shift !== undefined && e.shiftKey !== opts.shift) return;
      if (opts.alt !== undefined && e.altKey !== opts.alt) return;
      if (e.key === key) stableHandler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, stableHandler, opts.allowInInput, opts.ctrl, opts.shift, opts.alt]);
}

export function useKeyboardShortcuts(
  map: Record<string, (e: KeyboardEvent) => void>,
  opts: ShortcutOptions = {}
) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!opts.allowInInput && isInTextField(e)) return;
      if (opts.ctrl !== undefined && e.ctrlKey !== opts.ctrl) return;
      if (opts.shift !== undefined && e.shiftKey !== opts.shift) return;
      if (opts.alt !== undefined && e.altKey !== opts.alt) return;
      const handler = map[e.key];
      if (handler) handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
