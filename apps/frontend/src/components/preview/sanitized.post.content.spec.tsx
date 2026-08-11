// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { SanitizedPostContent } from './sanitized.post.content';

describe('SanitizedPostContent', () => {
  it('renders allowed markup without executable content', () => {
    const { container } = render(
      <SanitizedPostContent
        content={
          '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(2)">link</a>'
        }
      />
    );

    expect(container.querySelector('p')?.textContent).toBe('Hello');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
  });
});
