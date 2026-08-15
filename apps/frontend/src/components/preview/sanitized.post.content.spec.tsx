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

  it('keeps only explicitly allowed data attributes', () => {
    const { container } = render(
      <SanitizedPostContent
        content={
          '<mark data-tooltip-id="tooltip" ' +
          'data-tooltip-content="This text will be cropped" ' +
          'data-tooltip-html="<strong>hostile</strong>" ' +
          'data-arbitrary="hostile">cropped</mark>' +
          '<span data-mention-id="123" data-mention-label="@Ada" ' +
          'data-arbitrary="hostile">@Ada</span>'
        }
      />
    );
    const mark = container.querySelector('mark');
    const mention = container.querySelector('span');

    expect(mark?.dataset.tooltipId).toBe('tooltip');
    expect(mark?.dataset.tooltipContent).toBe('This text will be cropped');
    expect(mark?.hasAttribute('data-tooltip-html')).toBe(false);
    expect(mark?.hasAttribute('data-arbitrary')).toBe(false);
    expect(mention?.dataset.mentionId).toBe('123');
    expect(mention?.dataset.mentionLabel).toBe('@Ada');
    expect(mention?.hasAttribute('data-arbitrary')).toBe(false);
  });

  it('keeps only exact preview decoration class tokens', () => {
    const { container } = render(
      <SanitizedPostContent
        content={
          '<span class="fixed inset-0 z-[9999] font-bold font-[arial] ' +
          'text-[#ae8afc] font-boldness">@Ada</span>' +
          '<mark class="absolute hidden opacity-0 bg-red-500">cropped</mark>'
        }
      />
    );
    const mention = container.querySelector('span');
    const mark = container.querySelector('mark');

    expect(mention?.className).toBe('font-bold font-[arial] text-[#ae8afc]');
    expect(mark?.className).toBe('bg-red-500');
  });
});
