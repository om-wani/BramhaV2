/**
 * ArtifactFrame — sandbox escape-attempt and security tests
 *
 * Tests verify that:
 *  1. The iframe always has sandbox="allow-scripts" only (never allow-same-origin)
 *  2. postMessages from wrong origins are silently ignored
 *  3. Malformed/erroring content surfaces as an error overlay, not a blank pane
 *  4. NEXT_PUBLIC_ARTIFACT_ORIGIN is used for origin validation (production config)
 */

import React from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ArtifactFrame } from './ArtifactFrame'

// ── Helpers ────────────────────────────────────────────────────────────────────

function dispatchMessage(data: unknown, origin: string) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin,
    }),
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ArtifactFrame — iframe sandbox attribute', () => {
  it('has sandbox="allow-scripts" and ONLY allow-scripts', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=code" />)
    const iframe = container.querySelector('iframe')

    expect(iframe).not.toBeNull()
    // The attribute value must be exactly "allow-scripts" — no additional tokens
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    // Explicitly assert dangerous tokens are absent
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-top-navigation')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-forms')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-popups')
  })
})

describe('ArtifactFrame — postMessage origin validation', () => {
  afterEach(() => {
    // Reset ARTIFACT_ORIGIN between tests
    delete process.env.NEXT_PUBLIC_ARTIFACT_ORIGIN
  })

  it('ignores postMessage from a wrong origin — error overlay does not appear', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=html" />)

    act(() => {
      dispatchMessage({ type: 'error', message: 'injected via evil origin' }, 'https://evil.com')
    })

    // Wrong-origin message must be ignored — no error overlay
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('ignores postMessage from null origin (opaque origin)', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=html" />)

    act(() => {
      dispatchMessage({ type: 'error', message: 'null origin attack' }, 'null')
    })

    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('accepts postMessage from the expected origin and shows error overlay', () => {
    // In jsdom, window.location.origin is 'http://localhost'
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=react" />)

    act(() => {
      dispatchMessage(
        { type: 'error', message: 'Component crashed' },
        window.location.origin,
      )
    })

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('Component crashed')
  })

  it('accepts resize message from expected origin and removes loading spinner', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=code" />)

    // Loading spinner should be present initially
    expect(container.querySelector('[role="status"]')).not.toBeNull()

    act(() => {
      dispatchMessage({ type: 'resize', height: 400 }, window.location.origin)
    })

    // After resize message from correct origin, spinner should disappear
    const spinners = container.querySelectorAll('[role="status"]')
    // There should be no "Loading artifact" spinner (it can be replaced by the iframe)
    const loadingSpinner = Array.from(spinners).find(
      (el) => el.getAttribute('aria-label') === 'Loading artifact',
    )
    expect(loadingSpinner).toBeUndefined()
  })
})

describe('ArtifactFrame — error overlay (not blank pane)', () => {
  it('shows error overlay with the message text on error postMessage', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=react" />)

    act(() => {
      dispatchMessage(
        { type: 'error', message: 'ReferenceError: App is not defined' },
        window.location.origin,
      )
    })

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('ReferenceError: App is not defined')
  })

  it('hides the iframe when an error is shown (not blank — replaced by overlay)', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=react" />)

    act(() => {
      dispatchMessage(
        { type: 'error', message: 'runtime error' },
        window.location.origin,
      )
    })

    const iframe = container.querySelector('iframe')
    // iframe must have display:none when an error overlay is shown
    expect(iframe?.style.display).toBe('none')
    // Error overlay must be visible
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('does not show error when message is from wrong origin (blank-pane escape attempt fails)', () => {
    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=html" />)

    act(() => {
      // Attacker tries to inject an error to confuse the UI
      dispatchMessage(
        { type: 'error', message: 'fake error to blank pane' },
        'https://attacker.example.com',
      )
    })

    expect(container.querySelector('[role="alert"]')).toBeNull()
    // iframe should still be in the DOM (not hidden)
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.style.display).not.toBe('none')
  })
})

describe('ArtifactFrame — production ARTIFACT_ORIGIN config', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_ARTIFACT_ORIGIN
  })

  /**
   * Production config assertion:
   *
   * When NEXT_PUBLIC_ARTIFACT_ORIGIN is set (e.g. "https://artifacts.bramhav2.com"),
   * the ArtifactFrame component validates postMessages against that origin instead
   * of window.location.origin.
   *
   * This test verifies the behavior: messages from the current window origin are
   * rejected when ARTIFACT_ORIGIN is set to a different domain.
   *
   * In production deployments, set:
   *   NEXT_PUBLIC_ARTIFACT_ORIGIN=https://artifacts.bramhav2.com
   * and serve /artifact-frame from that domain to achieve cross-origin isolation.
   */
  it('when NEXT_PUBLIC_ARTIFACT_ORIGIN is set, messages from window.location.origin are ignored', () => {
    // Set BEFORE render so useEffect captures the value
    process.env.NEXT_PUBLIC_ARTIFACT_ORIGIN = 'https://artifacts.bramhav2.com'

    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=html" />)

    // Message from current window origin should be IGNORED
    // (not from the configured ARTIFACT_ORIGIN)
    act(() => {
      dispatchMessage(
        { type: 'error', message: 'should be rejected — wrong origin' },
        window.location.origin, // 'http://localhost' in jsdom ≠ 'https://artifacts.bramhav2.com'
      )
    })

    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('when NEXT_PUBLIC_ARTIFACT_ORIGIN is set, messages from that origin are accepted', () => {
    const artifactOrigin = 'https://artifacts.bramhav2.com'
    process.env.NEXT_PUBLIC_ARTIFACT_ORIGIN = artifactOrigin

    const { container } = render(<ArtifactFrame src="/artifact-frame?url=x&kind=html" />)

    act(() => {
      dispatchMessage({ type: 'error', message: 'from artifact origin' }, artifactOrigin)
    })

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('from artifact origin')
  })
})
