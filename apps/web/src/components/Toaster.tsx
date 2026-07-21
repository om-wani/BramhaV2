'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Lightweight app-wide toast system.
// Usage: const toast = useToast(); toast('Branch created');
//        toast('Upload failed', { kind: 'error' });
// ---------------------------------------------------------------------------

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

type ToastFn = (text: string, opts?: { kind?: ToastKind; durationMs?: number }) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error('useToast must be used inside <ToastProvider>');
  return fn;
}

const KIND_STYLES: Record<ToastKind, string> = {
  info: 'border-[hsl(var(--border))] text-[hsl(var(--text-primary))]',
  success: 'border-emerald-600/40 text-emerald-400',
  error: 'border-red-600/40 text-red-400',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>((text, opts) => {
    const id = nextId.current++;
    const kind = opts?.kind ?? 'info';
    const durationMs = opts?.durationMs ?? 4000;
    setToasts((prev) => [...prev.slice(-4), { id, text, kind }]);
    window.setTimeout(() => dismiss(id), durationMs);
  }, [dismiss]);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Stack above the status bar, bottom-right */}
      <div
        aria-live="polite"
        role="status"
        className="fixed bottom-10 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto text-left max-w-xs px-3 py-2 rounded-lg text-xs shadow-lg border bg-[hsl(var(--surface))] animate-toast-in ${KIND_STYLES[t.kind]}`}
          >
            {t.text}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
