/**
 * Minimal ambient type stub for @monaco-editor/react.
 *
 * @monaco-editor/react is declared in package.json but may not be installed yet
 * (run pnpm install to hydrate node_modules). This stub keeps TypeScript happy
 * for components that reference the package via dynamic import.
 *
 * Once installed, the package's own bundled types take precedence.
 */
declare module '@monaco-editor/react' {
  import type * as React from 'react'

  interface DiffEditorProps {
    original?: string
    modified?: string
    language?: string
    height?: string | number
    width?: string | number
    theme?: string
    options?: Record<string, unknown>
    onMount?: (editor: unknown, monaco: unknown) => void
    className?: string
  }

  export const DiffEditor: React.FC<DiffEditorProps>

  interface EditorProps {
    defaultValue?: string
    value?: string
    language?: string
    height?: string | number
    width?: string | number
    theme?: string
    options?: Record<string, unknown>
    onChange?: (value: string | undefined) => void
    onMount?: (editor: unknown, monaco: unknown) => void
    className?: string
  }

  export const Editor: React.FC<EditorProps>

  export default Editor
}
