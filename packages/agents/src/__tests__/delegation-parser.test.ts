/**
 * P5.1 — delegation signal parser tests
 *
 * Covers: regex detection, content stripping, slug validation,
 * case-insensitive slug matching, and single-hop guard in delegateNode
 * (tested via invokeTurnGraph with isDelegated=true).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDelegationSignal } from '../delegation-parser.js';
import { invokeTurnGraph } from '../turn-graph.js';
import type { PersistResponseFn, EmitStreamingFn, EmitSelectionFn } from '../turn-graph.js';

// ---------------------------------------------------------------------------
// Mock model router before import
// ---------------------------------------------------------------------------

const mockEmbed = vi.fn();
const mockStream = vi.fn();

vi.mock('../model-router.js', () => ({
  getModelRouter: vi.fn(() => ({
    embed: mockEmbed,
    stream: mockStream,
    chat: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// parseDelegationSignal unit tests
// ---------------------------------------------------------------------------

describe('parseDelegationSignal', () => {
  it('detects DELEGATE_TO: cfo TASK: sentence', () => {
    const content = 'Here is my analysis.\nDELEGATE_TO: cfo TASK: Review the burn rate.';
    const result = parseDelegationSignal(content);
    expect(result).not.toBeNull();
    expect(result?.signal.toSlug).toBe('cfo');
    expect(result?.signal.task).toBe('Review the burn rate.');
  });

  it('returns null for no signal', () => {
    const content = 'This is a normal response with no delegation.';
    const result = parseDelegationSignal(content);
    expect(result).toBeNull();
  });

  it('returns null for invalid persona slug', () => {
    const content = 'Some text.\nDELEGATE_TO: wizard TASK: Do something.';
    const result = parseDelegationSignal(content);
    expect(result).toBeNull();
  });

  it('strips the DELEGATE_TO line from content', () => {
    const content = 'Main analysis here.\nDELEGATE_TO: cto TASK: Assess the tech stack.';
    const result = parseDelegationSignal(content);
    expect(result).not.toBeNull();
    expect(result?.strippedContent).toBe('Main analysis here.');
    expect(result?.strippedContent).not.toContain('DELEGATE_TO');
  });

  it('preserves rest of content above the signal line', () => {
    const content =
      'Line one.\nLine two.\nLine three.\nDELEGATE_TO: cmo TASK: Plan the launch campaign.';
    const result = parseDelegationSignal(content);
    expect(result).not.toBeNull();
    expect(result?.strippedContent).toContain('Line one.');
    expect(result?.strippedContent).toContain('Line two.');
    expect(result?.strippedContent).toContain('Line three.');
    expect(result?.strippedContent).not.toContain('DELEGATE_TO');
  });

  it('case-insensitive slug matching (DELEGATE_TO: CFO → cfo)', () => {
    const content = 'Analysis done.\nDELEGATE_TO: CFO TASK: Validate the numbers.';
    const result = parseDelegationSignal(content);
    expect(result).not.toBeNull();
    expect(result?.signal.toSlug).toBe('cfo');
  });

  it('handles all valid persona slugs', () => {
    const slugs = ['ceo', 'cto', 'cmo', 'cfo', 'coo', 'chro', 'cso', 'cdao'];
    for (const slug of slugs) {
      const content = `Some content.\nDELEGATE_TO: ${slug} TASK: Do the task.`;
      const result = parseDelegationSignal(content);
      expect(result?.signal.toSlug).toBe(slug);
    }
  });

  it('trims task text', () => {
    const content = 'Text.\nDELEGATE_TO: coo TASK:   Optimize operations.   ';
    const result = parseDelegationSignal(content);
    expect(result?.signal.task).toBe('Optimize operations.');
  });

  it('returns null when task is empty after trim', () => {
    // Regex requires at least one character after TASK: so empty string won't match
    const content = 'Text.\nDELEGATE_TO: cfo TASK:';
    const result = parseDelegationSignal(content);
    expect(result).toBeNull();
  });

  it('does not match DELEGATE_TO mid-response (must be final line)', () => {
    const content = 'DELEGATE_TO: cfo TASK: Analyse budget.\n\nHowever, here is additional context.';
    expect(parseDelegationSignal(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single-hop guard via invokeTurnGraph
// ---------------------------------------------------------------------------

describe('delegateNode single-hop guard', () => {
  const fakeEmbedding = new Array(1536).fill(0.1);

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([fakeEmbedding]);
    // Stream returns a response with a DELEGATE_TO signal
    mockStream.mockImplementation(async function* () {
      yield 'My financial analysis.\n';
      yield 'DELEGATE_TO: cto TASK: Review infrastructure costs.';
    });
  });

  it('delegateNode returns {} (no pendingDelegations) when isDelegated is true', async () => {
    const persistFn: PersistResponseFn = vi.fn().mockImplementation(
      async (p: { responses: Array<{ persona: string; content: string }> }) =>
        p.responses.map((r, i) => ({ persona: r.persona, nodeId: `node-${r.persona}-${i}` })),
    );
    const emitStreamingFn: EmitStreamingFn = vi.fn();
    const emitSelectionFn: EmitSelectionFn = vi.fn();
    const emitDelegationFn = vi.fn();

    const domainEmbeddings = new Map<string, number[]>([
      ['ceo', new Array(1536).fill(0.1)],
      ['cto', new Array(1536).fill(0.1)],
      ['cmo', new Array(1536).fill(-0.1)],
      ['cfo', new Array(1536).fill(-0.1)],
      ['coo', new Array(1536).fill(-0.1)],
      ['chro', new Array(1536).fill(-0.1)],
      ['cso', new Array(1536).fill(-0.1)],
      ['cdao', new Array(1536).fill(-0.1)],
    ]);

    const result = await invokeTurnGraph({
      projectId: 'proj-1',
      roomId: 'room-1',
      branchId: 'branch-1',
      orgName: 'ACME',
      userNodeId: 'user-node-1',
      userMessage: 'Review our financial infrastructure strategy.',
      roomKind: 'council',
      recentSpeakers: [],
      domainEmbeddings,
      isDelegated: true, // single-hop guard active
      persistFn,
      emitStreamingFn,
      emitSelectionFn,
      emitDelegationFn,
      searchFn: vi.fn().mockResolvedValue([]),
    });

    // Graph runs to completion
    expect(result.responses.length).toBeGreaterThan(0);
    // Single-hop guard: no delegations should be created
    expect(result.pendingDelegations).toHaveLength(0);
    // emitDelegationFn never called
    expect(emitDelegationFn).not.toHaveBeenCalled();
  });

  it('delegateNode detects signal and strips it when isDelegated is false', async () => {
    const persistFn: PersistResponseFn = vi.fn().mockImplementation(
      async (p: { responses: Array<{ persona: string; content: string }> }) =>
        p.responses.map((r, i) => ({ persona: r.persona, nodeId: `node-${r.persona}-${i}` })),
    );
    const emitStreamingFn: EmitStreamingFn = vi.fn();
    const emitSelectionFn: EmitSelectionFn = vi.fn();
    const emitDelegationFn = vi.fn();

    const domainEmbeddings = new Map<string, number[]>([
      ['ceo', new Array(1536).fill(0.1)],
      ['cto', new Array(1536).fill(0.1)],
      ['cmo', new Array(1536).fill(-0.1)],
      ['cfo', new Array(1536).fill(-0.1)],
      ['coo', new Array(1536).fill(-0.1)],
      ['chro', new Array(1536).fill(-0.1)],
      ['cso', new Array(1536).fill(-0.1)],
      ['cdao', new Array(1536).fill(-0.1)],
    ]);

    const result = await invokeTurnGraph({
      projectId: 'proj-1',
      roomId: 'room-1',
      branchId: 'branch-1',
      orgName: 'ACME',
      userNodeId: 'user-node-1',
      userMessage: 'Review our financial infrastructure strategy.',
      roomKind: 'council',
      recentSpeakers: [],
      domainEmbeddings,
      isDelegated: false, // normal turn
      persistFn,
      emitStreamingFn,
      emitSelectionFn,
      emitDelegationFn,
      searchFn: vi.fn().mockResolvedValue([]),
    });

    // Delegation signals detected
    expect(result.pendingDelegations.length).toBeGreaterThan(0);
    // The DELEGATE_TO line is stripped from persisted content
    for (const r of result.responses) {
      expect(r.content).not.toContain('DELEGATE_TO:');
    }
    // emitDelegationFn called at least once
    expect(emitDelegationFn).toHaveBeenCalled();
    // fromSlug and toSlug are valid persona slugs
    for (const d of result.pendingDelegations) {
      expect(d.toSlug).toBe('cto');
      expect(typeof d.fromSlug).toBe('string');
      expect(d.task).toBe('Review infrastructure costs.');
    }
  });
});
