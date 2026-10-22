#!/usr/bin/env node
// Сборщик блога vezdepost.ru. Без зависимостей: читает статьи из
// deploy/blog/articles/*.html (JSON-метаданные в первом комментарии + тело
// статьи), пишет готовые страницы в deploy/landing/blog/ и обновляет
// deploy/landing/sitemap.xml. Исходники лежат вне deploy/landing, поэтому
// Caddy их не раздаёт.
//
//   node deploy/blog/build.mjs          — собрать
//   node deploy/blog/build.mjs --check  — проверить, что сборка актуальна

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://vezdepost.ru';
const AUTHOR = 'Дмитрий Федоренко';
const AUTHOR_URL = 'https://t.me/FedrBodr';
const OG_IMAGE = `${SITE}/assets/vezdepost-og.png`;

const here = dirname(fileURLToPath(import.meta.url));
const articlesDir = join(here, 'articles');
const landingDir = join(here, '..', 'landing');
const blogDir = join(landingDir, 'blog');
const sitemapPath = join(landingDir, 'sitemap.xml');

const REQUIRED = ['title', 'h1', 'description', 'published', 'updated', 'lead', 'card'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const formatDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// JSON внутри <script> не должен содержать «</» — экранируем «<».
const jsonLd = (data) => JSON.stringify(data, null, 2).replace(/</g, '\\u003c');

export const parseArticle = (slug, source) => {
  const match = source.match(/^\s*<!--([\s\S]*?)-->\s*([\s\S]*)$/);
  if (!match) throw new Error(`${slug}: нет блока метаданных <!-- {...} -->`);
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${slug}: метаданные не JSON — ${error.message}`);
  }
  for (const key of REQUIRED) {
    if (!meta[key]) throw new Error(`${slug}: не заполнено поле «${key}»`);
  }
  for (const key of ['published', 'updated']) {
    if (!DATE_RE.test(meta[key])) throw new Error(`${slug}: ${key} должен быть YYYY-MM-DD`);
  }
  if (meta.updated < meta.published) throw new Error(`${slug}: updated раньше published`);
  const body = match[2].trim();
  const toc = [...body.matchAll(/<h2 id="([a-z0-9-]+)">([\s\S]*?)<\/h2>/g)].map((m) => ({
    id: m[1],
    text: stripTags(m[2]),
  }));
  const h2Count = (body.match(/<h2[\s>]/g) || []).length;
  if (h2Count !== toc.length) throw new Error(`${slug}: у каждого <h2> должен быть id из [a-z0-9-]`);
  if (/<h1[\s>]/.test(body)) throw new Error(`${slug}: <h1> собирается из метаданных, в теле его быть не должно`);
  const words = stripTags(body).split(' ').length;
  return { slug, ...meta, related: meta.related || [], body, toc, minutes: Math.max(1, Math.round(words / 180)) };
};

export const loadArticles = () => {
  const articles = readdirSync(articlesDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => {
      const slug = name.replace(/\.html$/, '');
      if (!SLUG_RE.test(slug)) throw new Error(`${name}: slug только из латиницы, цифр и дефисов`);
      return parseArticle(slug, readFileSync(join(articlesDir, name), 'utf8'));
    })
    // новые сверху; при одной дате — по необязательному полю order, затем по slug
    .sort((a, b) =>
      b.published.localeCompare(a.published) || (a.order ?? 99) - (b.order ?? 99) || a.slug.localeCompare(b.slug)
    );
  const slugs = new Set(articles.map((a) => a.slug));
  for (const article of articles) {
    for (const rel of article.related) {
      if (!slugs.has(rel)) throw new Error(`${article.slug}: related ссылается на несуществующую статью «${rel}»`);
    }
    for (const m of article.body.matchAll(/href="\/blog\/([^"#/]+)\/?(?:#[^"]*)?"/g)) {
      if (!slugs.has(m[1])) throw new Error(`${article.slug}: ссылка на несуществующую статью /blog/${m[1]}/`);
    }
  }
  return articles;
};

const GTM_HEAD = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-5JNQTLP2');</script>
<!-- End Google Tag Manager -->
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-NG6Q7F0Z9N"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','G-NG6Q7F0Z9N');</script>
<!-- End Google Analytics 4 -->`;

const GTM_BODY = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-5JNQTLP2"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

const head = ({ title, description, url, ogType, ld, extra = '' }) => `<!doctype html>
<html lang="ru">
<head>
${GTM_HEAD}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-192.png">
<link rel="icon" type="image/png" sizes="120x120" href="/assets/favicon-120.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Vezdepost">
<meta property="og:locale" content="ru_RU">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
${extra}<link rel="stylesheet" href="/blog/blog.css">
<script type="application/ld+json">
${jsonLd(ld)}
</script>
</head>
<body>
${GTM_BODY}

<header class="site-header">
  <div class="wrap nav">
    <a class="nav-logo" href="/" aria-label="Vezdepost — на главную">
      <img src="/assets/vezdepost-logo.png" alt="" width="28" height="28">
      <span class="grad-text">Vezdepost</span>
    </a>
    <nav class="nav-links" aria-label="Разделы сайта">
      <a href="/blog/">Блог</a>
      <a href="/#platforms">Платформы</a>
      <a href="/#pricing">Цены</a>
    </nav>
    <a class="btn btn-primary btn-small" href="https://app.vezdepost.ru">Открыть приложение</a>
  </div>
</header>
`;

const footer = `
<footer class="site-footer">
  <div class="wrap">
    <p>Vezdepost — открытый планировщик постов для Telegram, MAX, VK и 30+ платформ. Форк <a href="https://github.com/gitroomhq/postiz-app">Postiz</a> (AGPL-3.0), исходный код — <a href="https://github.com/FedrBodr/vezdepost">github.com/FedrBodr/vezdepost</a>.</p>
    <p><a href="/">Главная</a> · <a href="/blog/">Блог</a> · <a href="/privacy">Политика конфиденциальности</a> · <a href="https://t.me/FedrBodr">Написать автору</a></p>
    <p>ИП Федоренко Дмитрий Александрович · ИНН 772373964340 · ОГРНИП 326774600702237<br>г. Москва, ул. Люблинская, д. 129/2 · <a href="tel:+79265803341">+7 (926) 580-33-41</a></p>
  </div>
</footer>

<script src="/blog/blog.js" defer></script>
</body>
</html>
`;

const cta = `
<aside class="cta" aria-label="Попробовать Vezdepost">
  <p class="cta-title">Один пост — сразу в Telegram, MAX и VK</p>
  <p>Vezdepost публикует по расписанию во все подключённые каналы из одного окна. Сейчас бесплатно, код открыт.</p>
  <a class="btn btn-primary" href="https://app.vezdepost.ru">Запланировать первый пост</a>
</aside>
`;

export const renderArticle = (article, bySlug) => {
  const url = `${SITE}/blog/${article.slug}/`;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: article.h1,
      description: article.description,
      datePublished: article.published,
      dateModified: article.updated,
      inLanguage: 'ru',
      mainEntityOfPage: url,
      image: OG_IMAGE,
      author: { '@type': 'Person', name: AUTHOR, url: AUTHOR_URL },
      publisher: { '@type': 'Organization', name: 'Vezdepost', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/assets/vezdepost-logo.png` } },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Vezdepost', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Блог', item: `${SITE}/blog/` },
        { '@type': 'ListItem', position: 3, name: article.h1, item: url },
      ],
    },
  ];
  const extra = `<meta property="article:published_time" content="${article.published}">
<meta property="article:modified_time" content="${article.updated}">
`;
  const dates =
    article.updated === article.published
      ? `<time datetime="${article.published}">${formatDate(article.published)}</time>`
      : `обновлено <time datetime="${article.updated}">${formatDate(article.updated)}</time>`;
  const toc = article.toc.length
    ? `<nav class="toc" aria-label="Содержание">
  <p class="toc-title">Содержание</p>
  <ol>
${article.toc.map((item) => `    <li><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`).join('\n')}
  </ol>
</nav>
`
    : '';
  const related = article.related.length
    ? `<section class="related" aria-label="Читайте также">
  <h2 class="related-title">Читайте также</h2>
  <ul class="cards">
${article.related.map((slug) => card(bySlug.get(slug))).join('\n')}
  </ul>
</section>
`
    : '';
  return `${head({ title: article.title, description: article.description, url, ogType: 'article', ld, extra })}
<main class="wrap article-wrap">
  <nav class="breadcrumbs" aria-label="Навигационная цепочка"><a href="/">Vezdepost</a> <span aria-hidden="true">/</span> <a href="/blog/">Блог</a></nav>
  <article class="article">
    <h1>${escapeHtml(article.h1)}</h1>
    <p class="meta">${escapeHtml(AUTHOR)} · ${dates} · ${article.minutes} мин чтения</p>
    <p class="lead">${article.lead}</p>
${toc}
${article.body}
${cta}
  </article>
${related}</main>
${footer}`;
};

const card = (article) => `    <li class="card">
      <a href="/blog/${article.slug}/">
        <span class="card-title">${escapeHtml(article.h1)}</span>
        <span class="card-text">${escapeHtml(article.card)}</span>
        <span class="card-meta">${formatDate(article.updated)} · ${article.minutes} мин</span>
      </a>
    </li>`;

export const renderIndex = (articles) => {
  const url = `${SITE}/blog/`;
  const title = 'Блог Vezdepost — отложенный постинг в Telegram, MAX и VK';
  const description = 'Практические гайды: как планировать посты в Telegram, MAX и VK, вести каналы на нескольких площадках и не делать одну работу трижды.';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Блог Vezdepost',
    url,
    inLanguage: 'ru',
    publisher: { '@type': 'Organization', name: 'Vezdepost', url: `${SITE}/` },
    blogPost: articles.map((a) => ({
      '@type': 'BlogPosting',
      headline: a.h1,
      url: `${SITE}/blog/${a.slug}/`,
      datePublished: a.published,
      dateModified: a.updated,
    })),
  };
  return `${head({ title, description, url, ogType: 'website', ld })}
<main class="wrap">
  <section class="blog-hero">
    <h1>Блог <span class="grad-text">Vezdepost</span></h1>
    <p>Гайды по отложенному постингу и кросспостингу в Telegram, MAX и VK — коротко, по шагам и без воды.</p>
  </section>
  <ul class="cards cards-index">
${articles.map(card).join('\n')}
  </ul>
${cta}</main>
${footer}`;
};

export const renderSitemap = (currentSitemap, articles) => {
  const kept = [...currentSitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>\s*)?<\/url>/g)]
    .map((m) => ({ loc: m[1], lastmod: m[2] }))
    .filter((entry) => !entry.loc.startsWith(`${SITE}/blog/`));
  const newest = articles.reduce((max, a) => (a.updated > max ? a.updated : max), '0000-00-00');
  const entries = [
    ...kept,
    ...(articles.length ? [{ loc: `${SITE}/blog/`, lastmod: newest }] : []),
    ...articles.map((a) => ({ loc: `${SITE}/blog/${a.slug}/`, lastmod: a.updated })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n${e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : ''}  </url>`)
  .join('\n')}
</urlset>
`;
};

export const buildOutputs = () => {
  const articles = loadArticles();
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  const outputs = new Map();
  outputs.set(join(blogDir, 'index.html'), renderIndex(articles));
  for (const article of articles) {
    outputs.set(join(blogDir, article.slug, 'index.html'), renderArticle(article, bySlug));
  }
  outputs.set(sitemapPath, renderSitemap(readFileSync(sitemapPath, 'utf8'), articles));
  return outputs;
};

const main = () => {
  const check = process.argv.includes('--check');
  const outputs = buildOutputs();
  const stale = [];
  for (const [path, content] of outputs) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    if (check) {
      stale.push(path);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`записан ${path}`);
    }
  }
  if (check && stale.length) {
    console.error(`Блог не пересобран, запустите node deploy/blog/build.mjs:\n${stale.join('\n')}`);
    process.exit(1);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
