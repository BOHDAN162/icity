/* iCITY 113Н — заглушки для секции «Комплекс iCITY».
   Путь в проекте: scripts/gen-complex-placeholders.mjs
   Запуск: node scripts/gen-complex-placeholders.mjs

   ЗАЧЕМ ЭТО СКРИПТ. Пять кадров комплекса — атриум, сад на стилобате,
   торговая галерея, паркинг и Smart Building — ещё не сняты. Секция
   уже собрана и читает файлы по фиксированным именам, поэтому вместо
   пустых рамок здесь лежат заведомо-фальшивые кадры: холодный серый
   градиент, одна красная линия и крупная надпись «ФОТО: <ИМЯ>».
   Перепутать такой кадр с настоящим невозможно.

   КАК ЗАМЕНИТЬ НА НАСТОЯЩИЕ. Положить снимок под тем же именем
   в public/complex и убрать ключ из public/complex/placeholders.json
   (или прогнать скрипт заново — он не трогает файлы, которых нет
   в списке ниже, и переписывает манифест по факту наличия). Кода
   менять не нужно ни строки: Complex.tsx берёт и пути, и признак
   заглушки из манифеста.

   ЦВЕТА. Не из головы: --paper-2 → --alu по app/tokens.css, красная
   линия — --frit #ED1C29. В спецификации блока стоял #D6001C, но
   второго акцентного красного в проекте нет (AGENTS.md, «Чего на
   сайте не будет»), поэтому линия идёт на токен. */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT_DIR = path.join(process.cwd(), 'public', 'complex');

const W = 1600;
const H = 1200;

/* холодный серый градиент из токенов дизайн-системы */
const GRAD_FROM = '#dfe6ea';
const GRAD_TO = '#aeb9c0';
const RED = '#ED1C29';   /* --frit, линии 1–2 px и растр */
const INK60 = '#566065'; /* --ink-60 */

/* Ширина красной линии. Не косметика: это единственное красное пятно
   на заглушке, и на нём проверяется, что красная ветка растра
   (lib/halftone.ts, порог r>170 && g<90) вообще живая.

   Считается от шага сетки растра, а не от вкуса. Кадр 1600 px ложится
   в рамку 558 px, это сжатие в 2,87 раза; шаг сетки — 8 CSS-пикселей.
   Чтобы хотя бы один узел сетки попал внутрь линии, а не на её
   размытую кромку, линия должна быть шире 8 px уже ПОСЛЕ сжатия:
   32 / 2,87 ≈ 11 px. Проверено на 6 и 16 px — обе давали чёрные точки
   вместо красных. Два процента ширины кадра, линия остаётся тонкой. */
const BAR = 32;

/* Порядок тот же, что в components/Complex.tsx. Ключ = имя файла. */
const AMENITIES = [
  { key: 'atrium', name: 'АТРИУМ' },
  { key: 'garden', name: 'САД НА СТИЛОБАТЕ' },
  { key: 'gallery', name: 'ТОРГОВАЯ ГАЛЕРЕЯ' },
  { key: 'parking', name: 'ПАРКИНГ' },
  { key: 'smart', name: 'SMART BUILDING' },
];

/* Кегль подгоняется под длину строки: «SMART BUILDING» и «САД НА
   СТИЛОБАТЕ» шире «АТРИУМА», фиксированный размер вылезал бы за кромку. */
function fontSize(text) {
  const full = `ФОТО: ${text}`;
  return Math.min(96, Math.floor((W * 0.82) / (full.length * 0.56)));
}

function svg(name, file) {
  const full = `ФОТО: ${name}`;
  const fs = fontSize(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GRAD_FROM}"/>
      <stop offset="1" stop-color="${GRAD_TO}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="${Math.round(W * 0.18)}" y="0" width="${BAR}" height="${H}" fill="${RED}"/>
  <text x="${W / 2}" y="${H / 2}" fill="${INK60}"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="${fs}" font-weight="600" letter-spacing="2"
        text-anchor="middle" dominant-baseline="central">${full}</text>
  <text x="${W / 2}" y="${H / 2 + fs * 1.25}" fill="${INK60}"
        font-family="Menlo, DejaVu Sans Mono, monospace"
        font-size="26" letter-spacing="3" opacity="0.75"
        text-anchor="middle" dominant-baseline="central">public/complex/${file}</text>
</svg>`;
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/* Настоящий кадр мог приехать в любом из двух расширений — секция
   читает то, что записано в манифесте, поэтому проверяем оба. */
async function realShot(key) {
  for (const ext of ['jpg', 'webp']) {
    if (await exists(path.join(OUT_DIR, `${key}.${ext}`))) {
      return { file: `${key}.${ext}`, generated: false };
    }
  }
  return null;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const manifest = { generatedBy: 'scripts/gen-complex-placeholders.mjs', items: {} };

  for (const { key, name } of AMENITIES) {
    const already = await realShot(key);
    if (already) {
      /* Файл на месте. Заглушка это или настоящий кадр — решает
         прежний манифест: перезаписав его вслепую, мы бы объявили
         настоящую съёмку плейсхолдером или наоборот. */
      const prev = await readPrev();
      const wasPlaceholder = prev?.items?.[key]?.placeholder === true;
      manifest.items[key] = { file: already.file, placeholder: wasPlaceholder };
      console.log(`= ${already.file} — на месте, ${wasPlaceholder ? 'заглушка' : 'настоящий кадр'}`);
      continue;
    }

    const file = `${key}.jpg`;
    const buf = await sharp(Buffer.from(svg(name, file)))
      .jpeg({ quality: 82, chromaSubsampling: '4:4:4' })
      .toBuffer();
    await writeFile(path.join(OUT_DIR, file), buf);
    manifest.items[key] = { file, placeholder: true };
    console.log(`+ ${file} — заглушка ${W}×${H}`);
  }

  await writeFile(
    path.join(OUT_DIR, 'placeholders.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  console.log('манифест: public/complex/placeholders.json');
}

async function readPrev() {
  const p = path.join(OUT_DIR, 'placeholders.json');
  if (!(await exists(p))) return null;
  const { readFile } = await import('node:fs/promises');
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
