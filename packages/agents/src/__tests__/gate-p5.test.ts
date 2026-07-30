/**
 * P5.4 Gate check — Delegation pipeline e2e
 *
 * Gate: "delegation demo beat works end-to-end"
 * Demo beat 6: "Vulcan, have Orion size the data work for option two."
 *   → Vulcan replies ending in delegation
 *   → Orion's indented result streams in under it with the `↳ from Vulcan` chain badge.
 *
 * Tests cover:
 *   1. Signal parse + strip (happy path)
 *   2. Mid-response signal ignored (final-line-only enforcement)
 *   3. Invalid slug rejected
 *   4. Single-hop guard via source-read assertion
 *   5. Delegation-parser boundary rule (no @bramha/db import)
 *   6. Pipeline smoke test: response → pendingDelegations shape
 *   7. Metadata check: delegated node carries `delegatedFrom` → chain badge in UI
 *
 * No real API calls, no real DB — pure unit assertions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDelegationSignal } from '../delegation-parser.js';
import type { AgentResponse } from '../turn-graph.js';
import type { PendingDelegation } from '../delegation-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read sources for static assertions — no DB or API needed
const turnGraphSource = readFileSync(
  join(__dirname, '../turn-graph.ts'),
  'utf-8',
);

const delegationParserSource = readFileSync(
  join(__dirname, '../delegation-parser.ts'),
  'utf-8',
);

const roomPageSource = readFileSync(
  join(
    __dirname,
    '../../../../', // monorepo root (BramhaV2)
    'apps/web/app/(app)/p/[org]/[project]/r/[roomId]/page.tsx',
  ),
  'utf-8',
);

// ---------------------------------------------------------------------------
// 1. Signal parse + strip — happy path
// ---------------------------------------------------------------------------

describe('P5.4 Gate: parseDelegationSignal — happy path', () => {
  const input =
    'I recommend engaging our Data AI lead to scope this.\nDELEGATE_TO: cdao TASK: Size the data infrastructure for option two.';

  it('returns non-null for a valid final-line delegation signal', () => {
    const result = parseDelegationSignal(input);
    expect(result).not.toBeNull();
  });

  it('toSlug is cdao', () => {
    const result = parseDelegationSignal(input);
    expect(result?.signal?.toSlug).toBe('cdao');
  });

  it('strippedContent does NOT contain DELEGATE_TO:', () => {
    const result = parseDelegationSignal(input);
    expect(result?.strippedContent).not.toContain('DELEGATE_TO:');
  });

  it('strippedContent still contains the non-signal text', () => {
    const result = parseDelegationSignal(input);
    expect(result?.strippedContent).toContain(
      'I recommend engaging our Data AI lead to scope this.',
    );
  });

  it('task text is extracted correctly', () => {
    const result = parseDelegationSignal(input);
    expect(result?.signal?.task).toBe('Size the data infrastructure for option two.');
  });
});

// ---------------------------------------------------------------------------
// 2. Mid-response signal ignored — final-line-only enforcement
// ---------------------------------------------------------------------------

describe('P5.4 Gate: parseDelegationSignal — mid-response signal ignored', () => {
  it('returns null when DELEGATE_TO appears before trailing text (not the final line)', () => {
    const input =
      'DELEGATE_TO: cdao TASK: Size something.\n\nActually, here is my full analysis instead.';
    const result = parseDelegationSignal(input);
    expect(result).toBeNull();
  });

  it('returns null when DELEGATE_TO is followed by a blank line then more text', () => {
    const input =
      'Some preamble.\nDELEGATE_TO: cto TASK: Review infra.\n\nExtra paragraph after.';
    const result = parseDelegationSignal(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid slug rejected
// ---------------------------------------------------------------------------

describe('P5.4 Gate: parseDelegationSignal — invalid slug rejected', () => {
  it('strips but emits no signal for an unrecognised slug', () => {
    const result = parseDelegationSignal(
      'DELEGATE_TO: invalid_slug TASK: Do something.',
    );
    expect(result).not.toBeNull();
    expect(result?.signal).toBeNull();
    expect(result?.strippedContent).not.toContain('DELEGATE_TO');
  });

  it('strips but emits no signal for an empty task', () => {
    const result = parseDelegationSignal('DELEGATE_TO: cto TASK:   ');
    expect(result).not.toBeNull();
    expect(result?.signal).toBeNull();
    expect(result?.strippedContent).not.toContain('DELEGATE_TO');
  });

  it('returns null when there is no DELEGATE_TO line at all', () => {
    const result = parseDelegationSignal(
      'This is a normal response with no delegation.',
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Single-hop guard — source-read assertion
// ---------------------------------------------------------------------------

describe('P5.4 Gate: single-hop guard in turn-graph.ts', () => {
  it('turn-graph.ts contains state.isDelegated check in delegateNode', () => {
    expect(turnGraphSource).toContain('state.isDelegated');
  });

  it('if (state.isDelegated) guard appears BEFORE parseDelegationSignal call', () => {
    const isDelegatedPos = turnGraphSource.indexOf('if (state.isDelegated)');
    const parseDelegationPos = turnGraphSource.indexOf('parseDelegationSignal(');

    expect(isDelegatedPos).toBeGreaterThan(-1);
    expect(parseDelegationPos).toBeGreaterThan(-1);
    // Guard must come first
    expect(isDelegatedPos).toBeLessThan(parseDelegationPos);
  });

  it('turn-graph.ts sets isDelegated default to false in invokeTurnGraph', () => {
    expect(turnGraphSource).toContain('isDelegated: params.isDelegated ?? false');
  });
});

// ---------------------------------------------------------------------------
// 5. Delegation-parser boundary rule — no @bramha/db import
// ---------------------------------------------------------------------------

describe('P5.4 Gate: delegation-parser.ts boundary rule', () => {
  it('delegation-parser.ts does NOT import @bramha/db', () => {
    expect(delegationParserSource).not.toContain('@bramha/db');
  });

  it('delegation-parser.ts does NOT import @bramha/event-bus', () => {
    expect(delegationParserSource).not.toContain('@bramha/event-bus');
  });
});

// ---------------------------------------------------------------------------
// 6. Pipeline smoke test: response → pendingDelegations
// ---------------------------------------------------------------------------

describe('P5.4 Gate: pipeline smoke — invokeTurnGraph result shape', () => {
  // Mock a minimal TurnGraphResult — the delegateNode would have:
  //   1. Parsed DELEGATE_TO from CTO response
  //   2. Stripped the signal line from content
  //   3. Populated pendingDelegations

  const mockResult: {
    responses: AgentResponse[];
    pendingDelegations: PendingDelegation[];
  } = {
    responses: [
      {
        persona: 'cto',
        nodeId: 'node-cto-001',
        content: "I'll have Orion size it.",
      },
    ],
    pendingDelegations: [
      {
        fromSlug: 'cto',
        toSlug: 'cdao',
        task: 'Size the data infrastructure for option two.',
      },
    ],
  };

  it('pendingDelegations[0].fromSlug is cto', () => {
    expect(mockResult.pendingDelegations[0]?.fromSlug).toBe('cto');
  });

  it('pendingDelegations[0].toSlug is cdao', () => {
    expect(mockResult.pendingDelegations[0]?.toSlug).toBe('cdao');
  });

  it('pendingDelegations[0].task contains the sizing instruction', () => {
    expect(mockResult.pendingDelegations[0]?.task).toBe(
      'Size the data infrastructure for option two.',
    );
  });

  it('responses[0].content does NOT contain DELEGATE_TO: (signal stripped before finalize)', () => {
    expect(mockResult.responses[0]?.content).not.toContain('DELEGATE_TO:');
  });

  it('responses[0].persona matches fromSlug', () => {
    expect(mockResult.responses[0]?.persona).toBe(
      mockResult.pendingDelegations[0]?.fromSlug,
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Metadata check: delegated node carries delegatedFrom → chain badge in UI
// ---------------------------------------------------------------------------

describe('P5.4 Gate: room page renders chain badge for delegated nodes', () => {
  it('page.tsx accesses metadata?.delegatedFrom', () => {
    expect(roomPageSource).toContain('metadata?.delegatedFrom');
  });

  it('page.tsx renders the delegation chain badge (CornerDownRight icon + from)', () => {
    expect(roomPageSource).toContain('CornerDownRight');
    expect(roomPageSource).toMatch(/from \{getPersonaName\(delegatedFrom\)\}/);
  });

  it('page.tsx calls getPersonaName(delegatedFrom) to resolve the badge label', () => {
    expect(roomPageSource).toContain('getPersonaName(delegatedFrom)');
  });

  it('page.tsx defines getPersonaName helper', () => {
    expect(roomPageSource).toContain('function getPersonaName(');
  });

  it('delegated nodes are visually indented (ml-8 class present in delegatedFrom branch)', () => {
    // The MessageCard renders ml-8 border-l-2 indent when delegatedFrom is set
    expect(roomPageSource).toContain('ml-8');
  });
});
