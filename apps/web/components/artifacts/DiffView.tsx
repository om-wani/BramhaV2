'use client'

/**
 * DiffView — Monaco side-by-side diff editor (lazy-loaded via next/dynamic)
 *
 * This module is NOT imported directly. ArtifactPane uses:
 *   const DiffView = dynamic(() => import('./DiffView').then(m => ({ default: m.DiffView })), { ssr: false })
 *
 * Monaco is ~3 MB; dynamic import ensures it never appears in the initial bundle.
 */

import { DiffEditor } from '@monaco-editor/react'

// ── Language map ──────────────────────────────────────────────────────────────

/** Best-effort Monaco language ID per artifact kind */
export const KIND_LANGUAGE: Record<string, string> = {
  code: 'typescript',
  react: 'typescript',
  html: 'html',
  document: 'markdown',
  markdown: 'markdown',
  svg: 'xml',
  mermaid: 'javascript', // closest approximation
  csv: 'plaintext',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiffViewProps {
  /** Content of the older version (left/original pane) */
  original: string
  /** Content of the newer version (right/modified pane) */
  modified: string
  /** Monaco language id, e.g. "typescript", "markdown", "plaintext" */
  language: string
  /** Editor height in pixels (default 500) */
  height?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DiffView({ original, modified, language, height = 500 }: DiffViewProps) {
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      height={height}
      theme="vs-dark"
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        lineNumbers: 'on',
        wordWrap: 'off',
        // Reduce visual noise in diff view
        renderIndicators: true,
        ignoreTrimWhitespace: false,
      }}
    />
  )
}
