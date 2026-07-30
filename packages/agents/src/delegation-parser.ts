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
  /** Non-null only when the target slug is a known persona AND task is present. */
  signal: DelegationSignal | null;
  strippedContent: string;
}

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

// Final-line only — DELEGATE_TO at string start or after a newline, running to
// end (`.` doesn't cross newlines, no /m flag, so a signal mid-response with
// text after it won't match). Two regexes:
//  - STRIP_RE matches ANY trailing DELEGATE_TO line so it never leaks to the
//    user, even when the model emits garbage (invalid slug, {braces}, no task).
//  - PARSE_RE extracts a valid slug + task, tolerating optional {braces} the
//    model sometimes copies from the prompt's `{slug}` placeholder syntax.
const STRIP_RE = /(?:^|\n)[ \t]*DELEGATE_TO:.*$/i;
const PARSE_RE = /(?:^|\n)[ \t]*DELEGATE_TO:\s*\{?\s*(\w+)\s*\}?\s+TASK:\s*(.+?)\s*$/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a DELEGATE_TO signal from agent response content.
 *
 * Returns null ONLY when no DELEGATE_TO line is present at all.
 *
 * When a trailing DELEGATE_TO line IS present it is always stripped from
 * `strippedContent` (so raw signal syntax never leaks to the user), and:
 *   - `signal` is the parsed target when the slug is a known persona and the
 *     task is non-empty;
 *   - `signal` is null when the target is unknown or the task is missing —
 *     the line is still stripped, but nothing is delegated.
 */
export function parseDelegationSignal(content: string): ParsedDelegation | null {
  if (!STRIP_RE.test(content)) return null;

  const strippedContent = content.replace(STRIP_RE, '').trim();

  const parsed = content.match(PARSE_RE);
  const slug = parsed?.[1]?.toLowerCase();
  const task = parsed?.[2]?.trim();

  if (slug && task && (PERSONA_SLUGS as readonly string[]).includes(slug)) {
    return { signal: { toSlug: slug as PersonaSlug, task }, strippedContent };
  }

  // Line present but not a valid, actionable delegation → strip, no signal.
  return { signal: null, strippedContent };
}
