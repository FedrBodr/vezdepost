import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const landingDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(landingDir, '../..');
const sourceLogo = join(
  repositoryRoot,
  'apps/frontend/public/vezdepost.png'
);
const assetsDir = join(landingDir, 'assets');
const landingLogo = join(assetsDir, 'vezdepost-logo.png');
const socialCard = join(assetsDir, 'vezdepost-og.png');

const cardSvg = Buffer.from(`
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="glow" cx="82%" cy="48%" r="55%">
        <stop offset="0" stop-color="#132a43"/>
        <stop offset="0.48" stop-color="#0d1524"/>
        <stop offset="1" stop-color="#070b12"/>
      </radialGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#36d9ff"/>
        <stop offset="1" stop-color="#7568ff"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <rect x="0" y="0" width="9" height="630" fill="url(#accent)"/>
    <text x="72" y="88" fill="#42dcf5" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" letter-spacing="5">VEZDEPOST</text>
    <text x="72" y="222" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="86" font-weight="800" letter-spacing="-3">
      <tspan x="72" dy="0">Один пост.</tspan>
      <tspan x="72" dy="92">30+ платформ.</tspan>
    </text>
    <g transform="translate(72 407)" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="600" fill="#9ceeff">
      <rect x="0" y="0" width="132" height="52" rx="26" fill="#0b1721" stroke="#286676" stroke-width="2"/>
      <text x="66" y="33" text-anchor="middle">Telegram</text>
      <rect x="148" y="0" width="132" height="52" rx="26" fill="#0b1721" stroke="#286676" stroke-width="2"/>
      <text x="214" y="33" text-anchor="middle">LinkedIn</text>
      <rect x="296" y="0" width="88" height="52" rx="26" fill="#0b1721" stroke="#286676" stroke-width="2"/>
      <text x="340" y="33" text-anchor="middle">VK</text>
    </g>
    <text x="72" y="548" fill="#8591a4" font-family="Arial, Helvetica, sans-serif" font-size="22">Публикация по расписанию из одного окна</text>
  </svg>
`);

await mkdir(assetsDir, { recursive: true });
await copyFile(sourceLogo, landingLogo);

const resizedLogo = await sharp(sourceLogo)
  .trim({ background: '#000000', threshold: 8 })
  .resize({ width: 380, height: 380, fit: 'contain' })
  .ensureAlpha()
  .composite([
    {
      input: Buffer.from(
        '<svg width="380" height="380"><rect width="380" height="380" rx="76" fill="white"/></svg>'
      ),
      blend: 'dest-in',
    },
  ])
  .png()
  .toBuffer();

await sharp(cardSvg)
  .composite([{ input: resizedLogo, left: 785, top: 125 }])
  .png({ compressionLevel: 9 })
  .toFile(socialCard);

console.log(`Generated ${landingLogo}`);
console.log(`Generated ${socialCard}`);
