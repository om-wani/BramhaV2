/**
 * Ambient type declarations for CSS modules.
 *
 * @xyflow/react and dagre ambient declarations were removed — both packages
 * ship their own types and are installed in node_modules, so the installed
 * types take precedence via moduleResolution: bundler.
 */

// ── CSS modules ────────────────────────────────────────────────────────────────
declare module '*.css' {}
