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
// Import the persona configs from the source module (not the ./index.js barrel)
// to avoid a circular import — index.js re-exports this file.
import { PERSONAS } from './personas/index.js';

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
// Target resolution
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function wordTokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 3);
}

// Two role words match if identical, one contains the other (len ≥ 4), or they
// share a 5-char stem ("analyst" ↔ "analytics"). Keeps mapping tolerant of the
// loose role names a model invents without matching unrelated short words.
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  if (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)) return true;
  return false;
}

/**
 * Resolves whatever target token a model emitted to a REAL persona slug.
 *
 * A primary agent should never delegate to a non-existent role, but models
 * still hallucinate ones like "research_analyst". Rather than drop the
 * delegation (losing the intent), map it to the closest real persona by
 * lexical overlap against each persona's slug/name/title/domain/keywords.
 * Returns null only when nothing plausibly matches.
 */
export function resolvePersonaSlug(raw: string): PersonaSlug | null {
  const configs = Object.values(PERSONAS);
  const norm = normalize(raw);

  // Fast path: exact slug or name.
  const exact = configs.find(
    (p) => p.slug === norm || p.name.toLowerCase() === norm,
  );
  if (exact) return exact.slug;

  const rawTokens = wordTokens(raw);
  if (rawTokens.length === 0) return null;

  let best: PersonaSlug | null = null;
  let bestScore = 0;
  for (const p of configs) {
    const blobTokens = wordTokens(
      [p.slug, p.name, p.title, p.domain, ...p.keywords].join(' '),
    );
    let score = 0;
    for (const rt of rawTokens) {
      if (blobTokens.some((bt) => wordsMatch(rt, bt))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p.slug;
    }
  }
  return bestScore > 0 ? best : null;
}

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
  const rawSlug = parsed?.[1];
  const task = parsed?.[2]?.trim();

  if (rawSlug && task) {
    const toSlug = resolvePersonaSlug(rawSlug);
    if (toSlug) {
      return { signal: { toSlug, task }, strippedContent };
    }
  }

  // Line present but the target can't be resolved to a real persona (or the
  // task is empty) → strip it so it never leaks, but delegate nothing.
  return { signal: null, strippedContent };
}
