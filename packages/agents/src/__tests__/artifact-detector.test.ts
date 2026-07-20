import { describe, it, expect } from 'vitest';
import { detectArtifact } from '../artifact-detector.js';

describe('detectArtifact', () => {
  it('detects fenced ```html code block', () => {
    const content = 'Here is a widget:\n```html\n<!DOCTYPE html>\n<html><body><h1>Hello</h1></body></html>\n```\nDone.';
    const result = detectArtifact(content);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('html');
    expect(result?.content).toContain('<h1>Hello</h1>');
  });

  it('detects <!DOCTYPE html> standalone', () => {
    const content = '<!DOCTYPE html>\n<html><head><title>T</title></head><body>Hi</body></html>';
    const result = detectArtifact(content);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('html');
    expect(result?.content).toContain('<!DOCTYPE html>');
  });

  it('returns null for plain text response', () => {
    const content = 'The revenue grew 12% YoY and margins improved significantly.';
    expect(detectArtifact(content)).toBeNull();
  });

  it('returns null for non-html code blocks (```python, ```js)', () => {
    const content = 'Here is Python:\n```python\nprint("hello")\n```\nAnd JS:\n```js\nconsole.log("hi");\n```';
    expect(detectArtifact(content)).toBeNull();
  });

  it('returns first artifact when multiple code blocks present', () => {
    const content = [
      'First:',
      '```html',
      '<html><body><p>First</p></body></html>',
      '```',
      'Second:',
      '```html',
      '<html><body><p>Second</p></body></html>',
      '```',
    ].join('\n');
    const result = detectArtifact(content);
    expect(result).not.toBeNull();
    expect(result?.content).toContain('First');
    expect(result?.content).not.toContain('Second');
  });

  it('case-insensitive match for DOCTYPE', () => {
    const content = '<!doctype html>\n<HTML><body>test</body></HTML>';
    const result = detectArtifact(content);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('html');
    expect(result?.content).toContain('<!doctype html>');
  });
});
