import dayjs from 'dayjs';
import { BadBody, RefreshToken } from '../social.abstract';
import type { AnalyticsData } from './social.integrations.interface';

type VkEnvelope<T> = {
  response?: T;
  error?: { error_code?: number; error_msg?: string };
};

export function unwrapVkResponse<T>(payload: unknown, method: string): T {
  const envelope = (payload || {}) as VkEnvelope<T>;
  if (envelope.error) {
    const code = Number(envelope.error.error_code || 0);
    const message = `VK ${method} failed with error ${code}`;
    if (code === 5) {
      throw new RefreshToken(
        'vk',
        JSON.stringify({ code }),
        {} as BodyInit,
        message
      );
    }
    // rate limits (too many requests, flood control, method limit): nothing
    // was created, so a plain error lets the activity retry later
    if ([6, 9, 29].includes(code)) {
      throw new Error(message);
    }
    throw new BadBody('vk', JSON.stringify({ code }), {} as BodyInit, message);
  }
  if (envelope.response === undefined || envelope.response === null) {
    throw new BadBody(
      'vk',
      '{}',
      {} as BodyInit,
      `VK ${method} returned no response`
    );
  }
  return envelope.response;
}

export function parseVkPositiveIntegerId(
  value: unknown,
  method: string,
  field: string
): string {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value) && /[1-9]/.test(value)) {
    return value;
  }

  throw new BadBody(
    'vk',
    '{}',
    {} as BodyInit,
    `VK ${method} returned invalid ${field}`
  );
}

type VkWallPost = Record<string, unknown>;

const VK_POST_COUNTERS = [
  ['Views', 'views'],
  ['Likes', 'likes'],
  ['Reposts', 'reposts'],
  ['Comments', 'comments'],
] as const;

// VK wall posts publish counters as `{ count: number }` objects
const vkCounter = (value: unknown): number | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const count = Number((value as { count?: unknown }).count);
  return Number.isFinite(count) && count >= 0 ? count : undefined;
};

// wall.get / wall.getById answer with `{ items }` (older versions: a bare array)
export function vkWallItems(response: unknown): VkWallPost[] {
  const items = Array.isArray(response)
    ? response
    : (response as { items?: unknown } | undefined)?.items;
  return Array.isArray(items)
    ? items.filter(
        (item): item is VkWallPost => !!item && typeof item === 'object'
      )
    : [];
}

// Lifetime counters of one wall post as a single data point dated today
export function vkPostAnalytics(post: VkWallPost | undefined): AnalyticsData[] {
  if (!post) return [];
  const today = dayjs().format('YYYY-MM-DD');
  return VK_POST_COUNTERS.flatMap(([label, key]) => {
    const total = vkCounter(post[key]);
    return total === undefined
      ? []
      : [
          {
            label,
            percentageChange: 0,
            data: [{ total: String(total), date: today }],
          },
        ];
  });
}

// Reads the wall newest-first until the posts are older than `since` (unix
// seconds). A pinned post can sit on top out of order, so a page only ends
// the scan when its last post is old.
export async function collectVkWallPosts(
  loadPage: (offset: number) => Promise<unknown>,
  since: number,
  pageSize = 100,
  maxPages = 5
): Promise<VkWallPost[]> {
  const posts: VkWallPost[] = [];
  for (let page = 0; page < maxPages; page++) {
    const items = vkWallItems(await loadPage(page * pageSize));
    posts.push(...items.filter((item) => Number(item.date) >= since));
    const last = items.at(-1);
    if (items.length < pageSize || !last || Number(last.date) < since) break;
  }
  return posts;
}

// Channel analytics: audience size today plus per-day totals of the posts
// published in the last `days` days. A day's Views/Likes are the current
// counters of posts published that day, not activity that happened that day
export function vkWallAnalytics(
  posts: VkWallPost[],
  days: number,
  audience?: { label: string; total: number }
): AnalyticsData[] {
  const dates = Array.from({ length: days }, (_, index) =>
    dayjs()
      .subtract(days - 1 - index, 'day')
      .format('YYYY-MM-DD')
  );
  const series = (value: (post: VkWallPost) => number) => {
    const totals = new Map(dates.map((date) => [date, 0]));
    for (const post of posts) {
      const date = dayjs.unix(Number(post.date)).format('YYYY-MM-DD');
      if (totals.has(date)) totals.set(date, totals.get(date)! + value(post));
    }
    return dates.map((date) => ({ date, total: String(totals.get(date)) }));
  };

  return [
    ...(audience
      ? [
          {
            label: audience.label,
            percentageChange: 0,
            data: [
              {
                total: String(audience.total),
                date: dayjs().format('YYYY-MM-DD'),
              },
            ],
          },
        ]
      : []),
    { label: 'Posts', percentageChange: 0, data: series(() => 1) },
    ...VK_POST_COUNTERS.map(([label, key]) => ({
      label,
      percentageChange: 0,
      data: series((post) => vkCounter(post[key]) || 0),
    })),
  ];
}

const VK_GROUP_STATS = [
  ['Reach', (period: VkGroupStatsPeriod) => period.reach?.reach],
  ['Visitors', (period: VkGroupStatsPeriod) => period.visitors?.visitors],
  [
    'New subscribers',
    (period: VkGroupStatsPeriod) => period.activity?.subscribed,
  ],
  [
    'Unsubscribed',
    (period: VkGroupStatsPeriod) => period.activity?.unsubscribed,
  ],
] as const;

type VkGroupStatsPeriod = {
  period_from?: number | string;
  reach?: { reach?: number };
  visitors?: { visitors?: number };
  activity?: { subscribed?: number; unsubscribed?: number };
};

// Community statistics from stats.get (needs the `stats` scope): one value per
// day, so unlike vkWallAnalytics this is activity that happened that day
export function vkGroupStatsAnalytics(
  response: unknown,
  days: number
): AnalyticsData[] {
  const periods = (Array.isArray(response) ? response : []).filter(
    (period): period is VkGroupStatsPeriod =>
      !!period && typeof period === 'object'
  );
  const dates = Array.from({ length: days }, (_, index) =>
    dayjs()
      .subtract(days - 1 - index, 'day')
      .format('YYYY-MM-DD')
  );

  return VK_GROUP_STATS.flatMap(([label, value]) => {
    const totals = new Map<string, number>();
    for (const period of periods) {
      const total = Number(value(period));
      if (!Number.isFinite(total) || total < 0) continue;
      const date = dayjs.unix(Number(period.period_from)).format('YYYY-MM-DD');
      totals.set(date, (totals.get(date) || 0) + total);
    }
    if (!totals.size) return [];
    return [
      {
        label,
        percentageChange: 0,
        data: dates.map((date) => ({
          date,
          total: String(totals.get(date) || 0),
        })),
      },
    ];
  });
}
