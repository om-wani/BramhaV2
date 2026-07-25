/**
 * Toast system tests — appearance, kinds, auto-dismiss, click-dismiss.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast } from '../Toaster';

function Trigger({ text, kind }: { text: string; kind?: 'info' | 'success' | 'error' }) {
  const toast = useToast();
  return (
    <button onClick={() => toast(text, kind ? { kind } : undefined)}>fire</button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup(); // globals:false → RTL auto-cleanup is not hooked
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('throws when useToast is used outside the provider', () => {
    const Bad = () => {
      useToast();
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/inside <ToastProvider>/);
  });

  it('shows a toast on fire and auto-dismisses after 4s', () => {
    render(
      <ToastProvider>
        <Trigger text="saved!" />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText('fire').click();
    });
    expect(screen.getByText('saved!')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByText('saved!')).toBeNull();
  });

  it('dismisses on click', () => {
    render(
      <ToastProvider>
        <Trigger text="click me away" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('fire').click();
    });
    act(() => {
      screen.getByText('click me away').click();
    });
    expect(screen.queryByText('click me away')).toBeNull();
  });

  it('caps the visible stack at 5 toasts', () => {
    render(
      <ToastProvider>
        <Trigger text="dup" />
      </ToastProvider>,
    );
    act(() => {
      for (let i = 0; i < 8; i++) screen.getByText('fire').click();
    });
    expect(screen.getAllByText('dup').length).toBeLessThanOrEqual(5);
  });

  it('error kind gets error styling', () => {
    render(
      <ToastProvider>
        <Trigger text="boom" kind="error" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('fire').click();
    });
    expect(screen.getByText('boom').className).toContain('red');
  });
});
