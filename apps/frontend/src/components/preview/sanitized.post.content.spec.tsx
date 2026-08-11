// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SanitizedPostContent } from './sanitized.post.content';

const maliciousContent =
  '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(2)">link</a>';

describe('SanitizedPostContent', () => {
  it('renders allowed markup without executable content', () => {
    const { container } = render(
      <SanitizedPostContent content={maliciousContent} />
    );

    expect(container.querySelector('p')?.textContent).toBe('Hello');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('keeps malicious content sanitized through SSR and hydration', async () => {
    const initialHtml = renderToString(
      <SanitizedPostContent content={maliciousContent} />
    );

    expect(initialHtml).not.toContain('<script');
    expect(initialHtml).not.toContain('javascript:');

    const container = document.createElement('div');
    container.innerHTML = initialHtml;
    document.body.appendChild(container);
    const recoverableErrors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <SanitizedPostContent content={maliciousContent} />,
          {
            onRecoverableError: (error) => recoverableErrors.push(error),
          }
        );
      });

      expect(recoverableErrors).toEqual([]);
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
