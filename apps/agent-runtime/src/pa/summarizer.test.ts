import { describe, it, expect } from 'vitest'
import { estimateTokenCount } from '@bramha/agents'
import { checkSummaryThreshold, SUMMARY_THRESHOLD_TOKENS } from './summarizer.js'
import type { ThreadNode } from './context-bundle.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeNode(nodeId: string, text: string): ThreadNode {
  return { nodeId, authorKind: 'user', authorName: 'Alice', text, type: 'user_message' }
}

/** Build a node whose text is exactly `tokens` estimated tokens long. */
function nodeWithTokens(nodeId: string, tokens: number): ThreadNode {
  // estimateTokenCount(text) = ceil(text.length / 4)
  // To get exactly `tokens`: use text.length = tokens * 4
  return makeNode(nodeId, 'a'.repeat(tokens * 4))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('checkSummaryThreshold', () => {
  it('21: below threshold → shouldSummarize false', () => {
    const nodes = [
      makeNode('n1', 'Hello'),
      makeNode('n2', 'World'),
      makeNode('n3', 'Short message'),
    ]
    const result = checkSummaryThreshold(nodes, null, 'conv-1', 'branch-1', 'proj-1')

    expect(result.shouldSummarize).toBe(false)
    expect(result.jobPayload).toBeUndefined()
    expect(result.unsummarizedTokens).toBeLessThan(SUMMARY_THRESHOLD_TOKENS)
  })

  it('22: at or above threshold → shouldSummarize true', () => {
    // One node of exactly SUMMARY_THRESHOLD_TOKENS tokens
    const nodes = [nodeWithTokens('n1', SUMMARY_THRESHOLD_TOKENS)]
    const result = checkSummaryThreshold(nodes, null, 'conv-1', 'branch-1', 'proj-1')

    expect(result.shouldSummarize).toBe(true)
    expect(result.jobPayload).toBeDefined()
    expect(result.jobPayload!.conversationId).toBe('conv-1')
    expect(result.jobPayload!.branchId).toBe('branch-1')
    expect(result.jobPayload!.projectId).toBe('proj-1')
  })

  it('23: idempotent — calling twice with same args returns same result', () => {
    const nodes = [nodeWithTokens('n1', SUMMARY_THRESHOLD_TOKENS + 100)]

    const r1 = checkSummaryThreshold(nodes, null, 'conv-2', 'branch-2', 'proj-2')
    const r2 = checkSummaryThreshold(nodes, null, 'conv-2', 'branch-2', 'proj-2')

    expect(r1.shouldSummarize).toBe(r2.shouldSummarize)
    expect(r1.unsummarizedTokens).toBe(r2.unsummarizedTokens)
    expect(r1.jobPayload?.estimatedTokens).toBe(r2.jobPayload?.estimatedTokens)
    expect(r1.jobPayload?.nodesSince).toBe(r2.jobPayload?.nodesSince)
  })

  it('24: lastSummaryNode null → counts all nodes', () => {
    const nodes = [
      makeNode('n1', 'aaa'),
      makeNode('n2', 'bbb'),
      makeNode('n3', 'ccc'),
    ]
    const expectedTotal =
      estimateTokenCount('aaa') +
      estimateTokenCount('bbb') +
      estimateTokenCount('ccc')

    const result = checkSummaryThreshold(nodes, null, 'conv-3', 'branch-3', 'proj-3')

    expect(result.unsummarizedTokens).toBe(expectedTotal)
  })

  it('25: lastSummaryNode set → counts only nodes after it', () => {
    const nodes = [
      makeNode('n1', 'first message'),
      makeNode('n2', 'second message'),
      makeNode('n3', 'third message'),
      makeNode('n4', 'fourth message'),
    ]
    // Only count n3 and n4 (nodes after n2)
    const expectedTokens =
      estimateTokenCount('third message') + estimateTokenCount('fourth message')

    const result = checkSummaryThreshold(nodes, 'n2', 'conv-4', 'branch-4', 'proj-4')

    expect(result.unsummarizedTokens).toBe(expectedTokens)
  })

  it('jobPayload nodesSince is null when lastSummaryNode is null', () => {
    const nodes = [nodeWithTokens('n1', SUMMARY_THRESHOLD_TOKENS + 1)]
    const result = checkSummaryThreshold(nodes, null, 'conv-5', 'b5', 'p5')

    expect(result.shouldSummarize).toBe(true)
    expect(result.jobPayload!.nodesSince).toBeNull()
  })

  it('jobPayload nodesSince equals lastSummaryNode when set', () => {
    const nodes = [
      makeNode('n1', 'a'.repeat(4000)),
      nodeWithTokens('n2', SUMMARY_THRESHOLD_TOKENS + 1),
    ]
    const result = checkSummaryThreshold(nodes, 'n1', 'conv-6', 'b6', 'p6')

    expect(result.shouldSummarize).toBe(true)
    expect(result.jobPayload!.nodesSince).toBe('n1')
  })

  it('lastSummaryNode not found → treats as null (counts all)', () => {
    const nodes = [makeNode('n1', 'short text')]
    const expectedTokens = estimateTokenCount('short text')

    const result = checkSummaryThreshold(nodes, 'n-nonexistent', 'conv-7', 'b7', 'p7')

    expect(result.unsummarizedTokens).toBe(expectedTokens)
  })
})
