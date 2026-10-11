import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM build script without type declarations
import { buildOutputs, loadArticles, parseArticle, renderSitemap } from './build.mjs';

const landingDir = join(process.cwd(), 'deploy/landing');
const articles = loadArticles() as Array<{ slug: string; title: string; description: string }>;
const outputs = buildOutputs() as Map<string, string>;

const page = (path: string) =>
  new JSDOM(readFileSync(join(landingDir, path), 'utf8')).window.document;

const blogPages = ['blog/index.html', ...articles.map((a) => `blog/${a.slug}/index.html`)];

describe('blog build', () => {
  it('committed output matches the article sources', () => {
    for (const [path, content] of outputs) {
      expect(existsSync(path), `${path} is missing — run node deploy/blog/build.mjs`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${path} is stale — run node deploy/blog/build.mjs`).toBe(content);
    }
  });

  it('has the first batch of articles with unique titles', () => {
    expect(articles.length).toBeGreaterThanOrEqual(6);
    expect(new Set(articles.map((a) => a.title)).size).toBe(articles.length);
  });

  it('lists every blog page in the sitemap and keeps the other pages', () => {
    const sitemap = readFileSync(join(landingDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://vezdepost.ru/</loc>');
    expect(sitemap).toContain('<loc>https://vezdepost.ru/privacy/</loc>');
    expect(sitemap).toContain('<loc>https://vezdepost.ru/blog/</loc>');
    for (const article of articles) {
      expect(sitemap).toContain(`<loc>https://vezdepost.ru/blog/${article.slug}/</loc>`);
    }
  });

  it('replaces stale blog entries in the sitemap', () => {
    const current = `<urlset>
  <url><loc>https://vezdepost.ru/</loc><lastmod>2026-10-02</lastmod></url>
  <url><loc>https://vezdepost.ru/blog/removed/</loc><lastmod>2026-01-01</lastmod></url>
</urlset>`;
    const next = renderSitemap(current, []);
    expect(next).toContain('https://vezdepost.ru/</loc>');
    expect(next).not.toContain('/blog/');
  });

  it.each(blogPages)('%s has valid SEO markup', (path) => {
    const document = page(path);
    const url = `https://vezdepost.ru/${path.replace(/index\.html$/, '')}`;
    expect(document.documentElement.lang).toBe('ru');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(url);
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(url);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    expect(description.length).toBeGreaterThan(70);
    expect(description.length).toBeLessThanOrEqual(200);
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      expect(() => JSON.parse(script.textContent || '')).not.toThrow();
    }
    expect(document.head.innerHTML).toContain('GTM-5JNQTLP2');
    expect(document.querySelector('script[src="/blog/blog.js"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://app.vezdepost.ru"]')).not.toBeNull();
  });

  it.each(blogPages)('%s has no broken internal links', (path) => {
    const document = page(path);
    for (const link of document.querySelectorAll('a[href^="/"]')) {
      const href = link.getAttribute('href')!;
      const [pathname, hash] = href.split('#');
      const file = pathname.endsWith('/') ? `${pathname}index.html` : pathname === '/privacy' ? '/privacy/index.html' : pathname;
      expect(existsSync(join(landingDir, file)), `${path}: ${href}`).toBe(true);
      if (hash && pathname === '/' + path.replace(/index\.html$/, '')) {
        expect(document.getElementById(hash), `${path}: ${href}`).not.toBeNull();
      }
    }
  });

  it('builds a table of contents from h2 anchors', () => {
    const document = page(`blog/${articles[0].slug}/index.html`);
    const tocLinks = [...document.querySelectorAll('.toc a')];
    expect(tocLinks.length).toBeGreaterThan(2);
    for (const link of tocLinks) {
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).not.toBeNull();
    }
  });

  it('rejects articles that would break the page contract', () => {
    const meta = JSON.stringify({
      title: 't', h1: 'h', description: 'd', published: '2026-10-07', updated: '2026-10-07', lead: 'l', card: 'c',
    });
    expect(() => parseArticle('x', `<!--${meta}--><h2>No id</h2>`)).toThrow(/id/);
    expect(() => parseArticle('x', `<!--${meta}--><h1>Twice</h1>`)).toThrow(/h1/);
    expect(() => parseArticle('x', '<p>no meta</p>')).toThrow(/метаданных/);
    expect(() => parseArticle('x', `<!--${meta.replace('"lead":"l",', '')}--><p></p>`)).toThrow(/lead/);
  });
});

describe('IndexNow', () => {
  it('serves the key file that indexnow.mjs announces', () => {
    const script = readFileSync(join(process.cwd(), 'deploy/blog/indexnow.mjs'), 'utf8');
    const key = script.match(/const KEY = '([0-9a-f]{32})'/)?.[1];
    expect(key).toBeDefined();
    expect(readFileSync(join(landingDir, `${key}.txt`), 'utf8')).toBe(key);
  });
});

describe('landing links to the blog', () => {
  const landing = readFileSync(join(landingDir, 'index.html'), 'utf8');

  it('shows the blog in the navigation and footer', () => {
    const document = new JSDOM(landing).window.document;
    expect(document.querySelector('.nav-links a[href="/blog/"]')).not.toBeNull();
    expect(document.querySelector('footer a[href="/blog/"]')).not.toBeNull();
  });
});
