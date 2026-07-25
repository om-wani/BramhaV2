/**
 * stripArtifactBlock tests — the artifact renders as its own card, so the raw
 * HTML must be removed from message prose (otherwise it double-renders as a
 * giant code block once markdown rendering is on).
 */

import { describe, it, expect } from 'vitest';
import { stripArtifactBlock, detectArtifact } from '../artifact-detector.js';

const MARKER = '*(interactive artifact attached below)*';

describe('stripArtifactBlock', () => {
  it('replaces a fenced ```html block with the marker, keeping surrounding prose', () => {
    const content = 'Here is the diagram:\n\n```html\n<!DOCTYPE html><html><body>hi</body></html>\n```\n\nLet me know.';
    const out = stripArtifactBlock(content);
    expect(out).toContain('Here is the diagram:');
    expect(out).toContain(MARKER);
    expect(out).toContain('Let me know.');
    expect(out).not.toContain('<!DOCTYPE');
    expect(out).not.toContain('```html');
  });

  it('handles a bare (unfenced) full HTML document', () => {
    const content = 'Intro text\n<!DOCTYPE html>\n<html><body>x</body></html>\nOutro';
    const out = stripArtifactBlock(content);
    expect(out).toContain('Intro text');
    expect(out).toContain(MARKER);
    expect(out).toContain('Outro');
    expect(out).not.toContain('<body>');
  });

  it('handles a TRUNCATED bare document (no closing </html>)', () => {
    // finish_reason=length can cut the document mid-tag
    const content = 'Diagram below\n<!DOCTYPE html>\n<html><body><div class="x';
    const out = stripArtifactBlock(content);
    expect(out).toContain('Diagram below');
    expect(out).toContain(MARKER);
    expect(out).not.toContain('<div');
  });

  it('returns content unchanged when there is no artifact', () => {
    const content = 'Plain answer, `inline code`, and a ```js\nconsole.log(1)\n``` block.';
    expect(stripArtifactBlock(content)).toBe(content);
  });

  it('strips only the FIRST fenced html block (matches detectArtifact)', () => {
    const content = '```html\n<html>one</html>\n```\nmiddle\n```html\n<html>two</html>\n```';
    const out = stripArtifactBlock(content);
    expect(out).toContain(MARKER);
    expect(out).toContain('two'); // second block untouched
    expect(out).not.toContain('one');
  });

  it('round-trips with detectArtifact: detected content never remains in prose', () => {
    const content = 'Text\n```html\n<!DOCTYPE html><html><body>artifact</body></html>\n```';
    const artifact = detectArtifact(content);
    expect(artifact).not.toBeNull();
    const out = stripArtifactBlock(content);
    expect(out).not.toContain(artifact!.content);
  });
});
