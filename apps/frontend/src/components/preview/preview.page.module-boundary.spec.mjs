import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the preview Server Component does not import the browser sanitizer', async () => {
  const source = await readFile(
    new URL('../../app/(app)/(preview)/p/[id]/page.tsx', import.meta.url),
    'utf8'
  );

  expect(source).not.toMatch(/sanitize\.post\.content/);
  expect(source).toMatch(/PostContentClient/);
});

test('the preview content client component sanitizes post HTML', async () => {
  const source = await readFile(
    new URL('./post.content.client.tsx', import.meta.url),
    'utf8'
  );

  expect(source).toMatch(/^'use client';/);
  expect(source).toMatch(/sanitizePostContent\(content\)/);
});
