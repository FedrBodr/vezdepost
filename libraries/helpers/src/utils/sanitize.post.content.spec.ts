import { describe, expect, it } from 'vitest';
import { sanitizePostContent } from './sanitize.post.content';

describe('sanitizePostContent', () => {
  it('keeps inline italic and strikethrough marks', () => {
    const html =
      '<p><em>italic</em> <i>also italic</i> <s>strike</s> <strike>also strike</strike> <del>deleted</del></p>';

    expect(sanitizePostContent(html)).toBe(html);
  });

  it('keeps ordered lists with list items', () => {
    const html = '<ol><li>one</li><li>two</li></ol>';

    expect(sanitizePostContent(html)).toBe(html);
  });

  it('keeps previously supported formatting', () => {
    const html =
      '<h1>Title</h1><p><strong>bold</strong> <u>underline</u> <a href="https://example.com">link</a></p><ul><li>item</li></ul>';

    expect(sanitizePostContent(html)).toBe(html);
  });

  it('removes disallowed tags and scripts', () => {
    const html = '<p>safe</p><script>alert(1)</script><style>x</style><p>tail</p>';

    expect(sanitizePostContent(html)).toBe('<p>safe</p><p>tail</p>');
  });

  it('keeps nested formatting inside ordered list items', () => {
    const html = '<ol><li><em>a</em> and <strong>b</strong></li></ol>';

    expect(sanitizePostContent(html)).toBe(html);
  });

  it('drops javascript urls', () => {
    expect(sanitizePostContent('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a>x</a>'
    );
  });
});
