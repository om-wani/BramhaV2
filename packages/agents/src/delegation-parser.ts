/**
 * Delegation signal parser for the P5 delegation system.
 *
 * Agents end their response with:
 *   DELEGATE_TO: {slug} TASK: {one sentence}
 *
 * This module parses that signal, validates the target slug, and strips the
 * signal line from the content before it is persisted.
 */

import type { PersonaSlug } from '@bramha/shared';
import { PERSONA_SLUGS } from '@bramha/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegationSignal {
  toSlug: PersonaSlug;
  task: string;
}

/** Full delegation record as stored in TurnState — includes fromSlug resolved by delegateNode. */
export interface PendingDelegation {
  fromSlug: PersonaSlug;
  toSlug: PersonaSlug;
  task: string;
}

export interface ParsedDelegation {
  signal: DelegationSignal;
  strippedContent: string;
}

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

// Matches anywhere in the content (agents may put it on its own line anywhere).
// Case-insensitive flag so "DELEGATE_TO: CFO" → "cfo".
const DELEGATION_RE = /^DELEGATE_TO:\s*(\w+)\s+TASK:\s*(.+)$/im;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a DELEGATE_TO signal from agent response content.
 *
 * Returns null if:
 *   - no DELEGATE_TO line is present
 *   - the extracted slug is not a known PersonaSlug
 *   - task text is empty after trim
 *
 * On success returns the parsed signal and the content with the signal line
 * removed (trimmed).
 */
export function parseDelegationSignal(content: string): ParsedDelegation | null {
  const match = content.match(DELEGATION_RE);
  if (!match) return null;

  const slug = match[1]?.toLowerCase();
  const task = match[2]?.trim();

  if (!slug || !task) return null;
  if (!(PERSONA_SLUGS as readonly string[]).includes(slug)) return null;

  // Strip the DELEGATE_TO line and trim surrounding whitespace
  const strippedContent = content.replace(DELEGATION_RE, '').trim();

  return {
    signal: { toSlug: slug as PersonaSlug, task },
    strippedContent,
  };
}
