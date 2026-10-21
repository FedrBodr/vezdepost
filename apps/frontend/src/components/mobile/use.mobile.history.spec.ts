import { describe, expect, it } from 'vitest';
import { flattenHistory, historyKey } from './use.mobile.history';

const page = (hasMore: boolean, ids: string[]) => ({
  hasMore,
  posts: ids.map((id) => ({ id })),
});

describe('historyKey', () => {
  it('asks for the first past page', () => {
    expect(historyKey(0, null)).toBe(
      '/posts/list?state=past&limit=20&page=0'
    );
  });

  it('stops when the previous page has no more', () => {
    expect(historyKey(1, page(false, ['a']))).toBeNull();
  });

  it('continues while the previous page has more', () => {
    expect(historyKey(2, page(true, ['a']))).toBe(
      '/posts/list?state=past&limit=20&page=2'
    );
  });
});

describe('flattenHistory', () => {
  it('concatenates pages and reports whether more exist', () => {
    expect(flattenHistory([page(true, ['a']), page(false, ['b', 'c'])])).toEqual(
      { posts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], hasMore: false }
    );
  });

  it('treats no pages as empty with nothing more', () => {
    expect(flattenHistory(undefined)).toEqual({ posts: [], hasMore: false });
  });
});
