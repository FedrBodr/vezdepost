#!/usr/bin/env node
// Сообщает поисковикам (Яндекс, Bing и др. через протокол IndexNow) о новых
// или изменённых страницах. Запускать после деплоя новых статей:
//
//   node deploy/blog/indexnow.mjs                      — все URL из sitemap.xml
//   node deploy/blog/indexnow.mjs https://vezdepost.ru/blog/slug/ ...
//
// Ключ публичный по протоколу: файл deploy/landing/<KEY>.txt должен быть
// доступен на https://vezdepost.ru/<KEY>.txt. api.indexnow.org пересылает
// уведомление всем участникам протокола, yandex.com — напрямую в Яндекс.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'vezdepost.ru';
const KEY = 'c53d1c4321133a0c888a6f2abcb20bf5';
const ENDPOINTS = ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow'];

const here = dirname(fileURLToPath(import.meta.url));
const sitemap = readFileSync(join(here, '..', 'landing', 'sitemap.xml'), 'utf8');

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const body = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList: urls,
});

let accepted = 0;
for (const endpoint of ENDPOINTS) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(20000),
    });
    // 200 — принято, 202 — принято, ключ ещё проверяется
    const ok = response.status === 200 || response.status === 202;
    if (ok) accepted++;
    console.log(`${endpoint}: ${response.status}${ok ? '' : ` ${await response.text()}`}`);
  } catch (error) {
    console.log(`${endpoint}: ошибка — ${error.cause?.code || error.message}`);
  }
}
console.log(`URL отправлено: ${urls.length}`);
if (!accepted) process.exit(1);
