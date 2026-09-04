/* iCITY 113Н — нарезка кадров вида из окна.
   Путь в проекте: scripts/view-images.mjs
   Запуск: node scripts/view-images.mjs [путь к папке или файлу источника]

   ЗАЧЕМ ЭТО СКРИПТ, А НЕ РАЗОВАЯ КОМАНДА. Кадры, которые лежат в
   public/view сейчас, — заглушки: скриншот стороннего панорамного
   просмотрщика. Настоящая съёмка уже прошла, финальные кадры приедут
   позже, и их надо будет прогнать тем же путём. Поэтому здесь конвейер
   с описанием источников, а не одна команда с захардкоженными числами.

   ЧТО ДЕЛАЕТ. Для каждого источника: обрезает служебные поля, кладёт
   четыре ширины в WebP и AVIF, пишет manifest.json — ровно та же схема,
   что у public/interior/renders/manifest.json, откуда lib/interior.ts
   берёт свои ширины.

   ОРИГИНАЛЫ В РЕПОЗИТОРИЙ НЕ ЕДУТ. Исходник — 12 МБ PNG, в git ему
   делать нечего. Путь к нему записан в манифест полем `src`, чтобы
   через полгода было понятно, из чего собрано.

   КАДРИРОВАНИЕ. Поле `crop` — это отступы от кромок исходника в
   пикселях: { top, right, bottom, left }. Оно не про композицию,
   а про мусор: у заглушки по кромкам идёт интерфейс просмотрщика —
   переключатель времени суток, крестик, выбор этажа, водяной знак
   и, что важнее всего, буквы румбов «СЗ» и «С». Стороны света
   в docs/facts.md помечены как гипотеза, и на сайте их быть не должно
   ни строкой, ни пикселем. */

import { mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import sharp from 'sharp';

const OUT_DIR = resolve(process.cwd(), 'public/view');

/** Куда смотреть, если путь не передан аргументом. */
const DEFAULT_SOURCES = [
  join(homedir(), 'Downloads/icity_view'),
  join(homedir(), 'Downloads/icity_view.png'),
];

/* Ширины. Кадр висит во весь экран (object-fit: cover), поэтому верхняя
   ступень выше, чем у рендеров зон: там кадр родной 1664 px, здесь
   исходник 3600 px и ретина-десктоп реально просит 2560.
   Меняешь список — он же уезжает в manifest.json, а компонент
   OfficeStop.tsx сверяется с манифестом, а не угадывает. */
const WIDTHS = [640, 1280, 1920, 2560];

const WEBP = { quality: 78, effort: 5 };
const AVIF = { quality: 52, effort: 6 };

/* Рецепты источников. Ключ — имя файлов на выходе: <key>-<width>.<ext>.

   ЗАГЛУШКА. Оба кадра собраны из скриншотов просмотрщика VirtualLand:
   это панорама комплекса, а не съёмка из помещения 113Н. Обрезка ниже
   снимает интерфейс по всем четырём кромкам. Когда приедут настоящие
   кадры — заменить файлы, обнулить crop и перезапустить скрипт.

   МАНИФЕСТ СОБИРАЕТСЯ ЗА ОДИН ПРОГОН, а не дописывается. `manifest`
   в main() заводится пустым, поэтому запуск на одном файле снёс бы
   ключ второго. Оба исходника лежат в ~/Downloads/icity_view/ —
   это первый из DEFAULT_SOURCES, и `node scripts/view-images.mjs`
   без аргументов обходит папку целиком.

   МАТЧИ С ЯКОРЯМИ, И ЭТО НЕ ПРИДИРКА. Прежний `/icity_view/i` ловил
   бы и `icity_view_b.webp`: перебор идёт по порядку объявления,
   первый совпавший выигрывает, и второй кадр молча собрался бы
   поверх ключа `view`. */
const RECIPES = {
  view: {
    match: /^icity_view\./i,
    crop: { top: 300, right: 0, bottom: 128, left: 140 },
    placeholder: true,
    note:
      'ЗАГЛУШКА: скриншот панорамы VirtualLand, не съёмка из помещения. '
      + 'Обрезка снимает интерфейс просмотрщика и буквы румбов «СЗ»/«С» — '
      + 'стороны света в docs/facts.md помечены как гипотеза.',
  },

  /* Второй ракурс той же панорамы. Исходник снят тем же способом и в том
     же размере, что первый, — 3600×2338, — поэтому и обрезка ТА ЖЕ.
     Никаких своих чисел здесь быть не должно: одно окно просмотрщика,
     один интерфейс по кромкам, один crop.

     ПЕРВЫЙ ЗАХОД БЫЛ СОБРАН ИЗ МЕЛКОГО СКРИНА (2000×1299, ужатый в 1,8
     раза), и качество вышло заметно хуже: после обрезки оставалось
     1922 px, ступень 2560 отваливалась фильтром ниже, и на ретине кадр
     был мягче первого. Мораль простая: исходник обязан приходить в том
     же размере, что icity_view.png. Уменьшенный скрин пересобрать
     обратно нечем.

     Замеры кромок интерфейса по пикселям (3600×2338): компас
     и «Рассвет / Закат» кончаются на y=196, крестик на y=282 (срез 300),
     панель «Этаж» на x=119 (срез 140), плашка «Оставить отзыв»
     начинается на y=2307 (срез 2210). Самый тесный запас — 18 px
     у крестика. */
  view2: {
    match: /^icity_view_b\./i,
    crop: { top: 300, right: 0, bottom: 128, left: 140 },
    placeholder: true,
    note:
      'ЗАГЛУШКА: второй ракурс той же панорамы VirtualLand, не съёмка '
      + 'из помещения. Обрезка снимает интерфейс просмотрщика и буквы '
      + 'румбов «ЮЗ»/«З»/«СЗ» — стороны света в docs/facts.md помечены '
      + 'как гипотеза.',
  },
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp']);

/** Список файлов-источников: путь может быть и папкой, и одним файлом. */
async function collect(input) {
  const info = await stat(input).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [input];
  const names = await readdir(input);
  return names
    .filter((n) => IMAGE_EXT.has(extname(n).toLowerCase()))
    .sort()
    .map((n) => join(input, n));
}

function recipeFor(file) {
  const name = basename(file);
  for (const [key, r] of Object.entries(RECIPES)) {
    if (r.match.test(name)) return [key, r];
  }
  return [null, null];
}

async function main() {
  const arg = process.argv[2];
  const candidates = arg ? [resolve(arg)] : DEFAULT_SOURCES;

  let files = [];
  let usedRoot = null;
  for (const c of candidates) {
    files = await collect(c);
    if (files.length) { usedRoot = c; break; }
  }

  if (!files.length) {
    console.error(
      'Источники не найдены. Искал:\n  ' + candidates.join('\n  ')
      + '\nПередай путь аргументом: node scripts/view-images.mjs <файл|папка>',
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Источник: ${usedRoot}`);

  const manifest = {};

  for (const file of files) {
    const [key, recipe] = recipeFor(file);
    if (!key) {
      console.warn(`— пропущен (нет рецепта): ${basename(file)}`);
      continue;
    }

    const src = sharp(file);
    const meta = await src.metadata();
    const c = recipe.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const region = {
      left: c.left,
      top: c.top,
      width: meta.width - c.left - c.right,
      height: meta.height - c.top - c.bottom,
    };
    if (region.width <= 0 || region.height <= 0) {
      throw new Error(`${key}: обрезка съела кадр целиком`);
    }

    /* Один раз обрезаем в буфер, дальше уменьшаем из него: пересчитывать
       обрезку на каждой ширине — это тот же результат за четыре прохода. */
    const cropped = await src
      .extract(region)
      .toColorspace('srgb')
      .toFormat('png')
      .toBuffer();

    const native = [region.width, region.height];
    const widths = WIDTHS.filter((w) => w <= region.width);
    if (!widths.length) widths.push(region.width);

    const variants = {};
    for (const w of widths) {
      const base = sharp(cropped).resize({ width: w, withoutEnlargement: true });
      const webp = await base.clone().webp(WEBP).toBuffer();
      const avif = await base.clone().avif(AVIF).toBuffer();
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
      native,
      src: basename(file),
      srcPath: file,
      srcNative: [meta.width, meta.height],
      crop: c,
      variants,
      ...(recipe.placeholder ? { placeholder: true } : {}),
      ...(recipe.note ? { note: recipe.note } : {}),
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
