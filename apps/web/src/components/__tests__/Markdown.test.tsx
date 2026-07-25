/**
 * Markdown renderer tests — GFM support + XSS safety.
 * Raw HTML must NEVER render (rehype-raw intentionally absent).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '../Markdown';

describe('Markdown', () => {
  it('renders headings, bold, and lists', () => {
    const { container } = render(
      <Markdown content={'## Plan\n\n**Bold point**\n\n- item one\n- item two'} />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Plan');
    expect(container.querySelector('strong')?.textContent).toBe('Bold point');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders GFM tables', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<Markdown content={md} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('renders fenced code blocks as code, not executed content', () => {
    const { container } = render(<Markdown content={'```js\nconsole.log(1)\n```'} />);
    expect(container.querySelector('pre code')?.textContent).toContain('console.log(1)');
  });

  it('does NOT render raw HTML — script/img injection stays inert text', () => {
    const evil = 'Hello <script>window.pwned=true</script> <img src=x onerror="window.pwned=true">';
    const { container } = render(<Markdown content={evil} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('links open in a new tab with rel=noopener', () => {
    const { container } = render(<Markdown content={'[site](https://example.com)'} />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });
});
