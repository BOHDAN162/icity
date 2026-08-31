/* iCITY 113Н — постеры hero-видео.
   Путь в проекте: scripts/hero-poster.mjs
   Запуск: node scripts/hero-poster.mjs

   ЧТО ДЕЛАЕТ. Берёт первый кадр (f_0001) обеих PNG-секвенций рендера
   полёта — общий план облачного моря, башни в кадре нет — и нарезает
   из него постеры первого экрана: несколько ширин в WebP и AVIF плюс
   manifest.json. Схема манифеста та же, что у public/view/manifest.json.

   ЗАЧЕМ ИМЕННО f_0001. Это первый кадр видео: постер и ролик начинаются
   с одного пикселя, поэтому момент старта проигрывания не виден.
   То же правило держит будущий idle-луп облаков: его первый кадр
   обязан совпадать с f_0001 (см. AGENTS.md, раздел про hero).

   ОРИГИНАЛЫ В РЕПОЗИТОРИЙ НЕ ЕДУТ. Секвенции лежат в Blender-проекте,
   путь к источнику пишется в манифест полем `srcPath`. */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import sharp from 'sharp';

const OUT_DIR = resolve(process.cwd(), 'public/video/poster');

/* Ширины по вариантам. Десктоп висит во весь экран (object-fit: cover),
   ретина-десктоп реально просит 2560 — исходник ровно такой.
   Мобильный портрет — 1080, больше у исходника нет.
   Меняешь список — сверь srcset в components/HeroVideo.tsx. */
const RECIPES = {
  'hero-desktop': {
    src: join(homedir(), 'Documents/icity_blender/seq/night_desktop/f_0001.png'),
    widths: [1280, 1920, 2560],
  },
  'hero-mobile': {
    src: join(homedir(), 'Documents/icity_blender/seq/night_mobile/f_0001.png'),
    widths: [640, 1080],
  },
};

const WEBP = { quality: 78, effort: 5 };
const AVIF = { quality: 52, effort: 6 };

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = {};

  for (const [key, recipe] of Object.entries(RECIPES)) {
    const info = await stat(recipe.src).catch(() => null);
    if (!info) throw new Error(`${key}: источник не найден — ${recipe.src}`);

    const src = sharp(recipe.src);
    const meta = await src.metadata();
    const base = await src.toColorspace('srgb').toFormat('png').toBuffer();

    const variants = {};
    for (const w of recipe.widths) {
      const step = sharp(base).resize({ width: w, withoutEnlargement: true });
      const webp = await step.clone().webp(WEBP).toBuffer();
      const avif = await step.clone().avif(AVIF).toBuffer();
      await writeFile(join(OUT_DIR, `${key}-${w}.webp`), webp);
      await writeFile(join(OUT_DIR, `${key}-${w}.avif`), avif);
      variants[w] = {
        webp: Math.round(webp.length / 1024),
        avif: Math.round(avif.length / 1024),
      };
      console.log(
        `  ${key}-${w}: webp ${variants[w].webp} КБ · avif ${variants[w].avif} КБ`,
      );
    }

    manifest[key] = {
      native: [meta.width, meta.height],
      srcPath: recipe.src,
      variants,
    };
  }

  await writeFile(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 1) + '\n',
  );
  console.log(`\nГотово: ${OUT_DIR}/manifest.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
