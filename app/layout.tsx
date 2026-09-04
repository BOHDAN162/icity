import type { Metadata } from "next";
import { Literata, Golos_Text, JetBrains_Mono } from "next/font/google";
import Cursor from "@/components/Cursor";
import FocusRing from "@/components/FocusRing";
import ScrollTrip from "@/components/ScrollTrip";
import "./globals.css";

/* ТИПОГРАФИКА ПРОЕКТА — три гарнитуры с жёстко разведёнными ролями.
   Все вариативные, все OFL 1.1, у всех кириллица нарисована профильными
   типографами, а не автоконвертирована из латиницы.

   Literata — заголовки и первый экран. Кириллица Веры Евстафьевой
     (консультант Кирилл Златков, ассистент Елена Новосёлова), золото
     Modern Cyrillic 2021; латиница Вероники Буриан и Хосе Скальоне,
     TypeTogether.
   Golos Text — основной текст и интерфейс. Александра Королькова
     и Виталий Кузьмин, Paratype. Диапазон веса 400–900: значения ниже
     400 физически недоступны, 350 схлопнется в 400 молча.
   JetBrains Mono — цифры, метрики, подписи. Табличные цифры по умолчанию.

   Сабсеты ровно два: кириллица — весь контент сайта, латиница — знак
   «iCITY / SPACE TOWER», единицы измерения и латинские вкрапления.
   Греческий и вьетнамский не подключаем: лишний вес без применения.

   Вес не указываем ни у одной — тогда Next отдаёт вариативный файл
   с полной осью, и любой вес внутри диапазона доступен бесплатно.

   Next 16 — свежая мажорная версия, сигнатуры сверены по
   node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts,
   а не по памяти. */

/* axes: ['opsz'] — не украшение, а условие работы font-optical-sizing
   в tokens.css. Без явного перечисления Next скачивает вариативный файл
   с одной осью wght, оптическая ось в него не попадает вовсе, и правило
   font-optical-sizing: auto оказывается мёртвой строкой: браузеру нечем
   его исполнить. Проверяется в браузере — см. tokens.css. */
const literata = Literata({
  subsets: ["cyrillic", "latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-literata",
});

const golosText = Golos_Text({
  subsets: ["cyrillic", "latin"],
  display: "swap",
  variable: "--font-golos",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["cyrillic", "latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Офис 244,1 м² на 23 этаже в iCITY — Space Tower, Москва-Сити",
  description:
    "Помещение 113Н, 244,1 м², 23 этаж из 61. Потолки 3,8 м, открывающиеся окна, отделка и мебель. Прямая аренда от собственника, показ в день обращения.",
  /* iOS Safari сам детектит цифровые диапазоны вида «80 000–100 000»
     как номер телефона и красит их синим кликабельным tel:-линком —
     ровно это и произошло в абзаце экономики сделки. Выключаем детектор
     целиком, а не для одного абзаца: настоящие номера идут через
     явный tel: в lib/contacts.ts и в детекторе не нуждаются. */
  formatDetection: {
    telephone: false,
  },
};

/* viewport-fit: cover — страница раскладывается на весь физический экран
   и уходит под панель браузера и под домашний индикатор. Так и задумано:
   полноэкранный кадр обязан доходить до самого низа. Снимал 5 сентября
   2026 на пробу, когда искал полосу внизу, — заказчик вернул в тот же
   час: «Safari позволяет делать до самого низа». Причина полосы была
   не здесь. */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#F2F4F5",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`${literata.variable} ${golosText.variable} ${jetBrainsMono.variable}`}
    >
      <head>
        {/* ВЫСОТА ЭКРАНА МЕРЯЕТСЯ У БРАУЗЕРА ЧИСЛОМ, ПОТОМУ ЧТО НИ ОДНА
            CSS-ЕДИНИЦА ЕЁ НЕ ДАЁТ. Замер в симуляторе iOS 26.5 (iPhone 17
            Pro): физический экран 874 pt, `100lvh` — 754, `100dvh` и
            `100svh` — 714, `env(safe-area-inset-bottom)` — ноль. То есть
            САМАЯ БОЛЬШАЯ единица короче экрана на 120 pt, и всё, что
            считалось в ней, обрывалось выше низа: под панелью Safari
            вместо кадра оказывался фон страницы — та самая светлая полоса,
            которую заказчик ловил шесть заходов подряд. Панель эту область
            не закрашивает, она полупрозрачная, и полоса читается сквозь неё.

            Единственное число, равное экрану, — screen.height. Скрипт
            инлайновый и в <head>: он обязан отработать ДО первой отрисовки,
            иначе первый кадр уедет по короткой единице и мигнёт.

            ТОЛЬКО НА ТАЧ-УСТРОЙСТВАХ. На десктопе screen.height — это
            высота монитора, а не окна; там переменная не ставится вовсе
            и работает запасное значение 100lvh из tokens.css (на десктопе
            оно равно окну). Предохранитель на 250 pt отсекает нелепые
            значения, если движок отдаст что-то своё.

            ЗНАЧЕНИЕ ЕДЕТ СВОИМ <style>, А НЕ СТИЛЕМ НА <html>. Атрибут
            style на корне принадлежит React, и дописанный скриптом он
            даёт расхождение при гидрации: сервер такого атрибута
            не рендерил. Свой узел в <head> React не трогает, а правило
            :root применяется ровно так же. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){"
              + "if(!matchMedia('(hover: none) and (pointer: coarse)').matches)return;"
              + "var el=document.createElement('style');document.head.appendChild(el);"
              + "function s(){var p=innerHeight>=innerWidth;"
              + "var f=Math.max(p?screen.height:screen.width,innerHeight);"
              + "var e=f-innerHeight;if(e<0||e>250)f=innerHeight;"
              + "el.textContent=':root{--screen-h:'+f+'px}';}"
              + "s();addEventListener('resize',s);addEventListener('orientationchange',s);})()",
          }}
        />
      </head>
      <body>
        {/* Preloader живёт не здесь, а в app/(landing)/layout.tsx: он
            привязан к hero и не должен встречать зрителя на /privacy.
            Порядок узлов от этого не изменился — он по-прежнему первым
            в <body> на посадочной странице, просто приезжает внутри
            {children}. */}
        {children}
        {/* Свой курсор — последним узлом body и поверх всего (z-index
            2000). Компонент сам решает, работать ли: на тач-устройстве
            и при prefers-reduced-motion он не стартует и системную
            стрелку не трогает. */}
        <Cursor />
        {/* Плавная прокрутка: та же постоянная времени, что у кольца
            курсора, — страница и указатель едут одним характером.
            Ничего не рисует и на тач-устройстве не делает ничего:
            touch-события модуль не слушает вовсе. */}
        <ScrollTrip />
        {/* Кольцо фокуса следует способу прихода фокуса, а не последней
            нажатой клавише: Chrome поднимает :focus-visible у уже
            сфокусированного мышью элемента на любом нажатии, и Escape
            обводил чёрной рамкой то, по чему только что кликнули.
            Ничего не рисует и ни одной клавиши не отбирает. */}
        <FocusRing />
      </body>
    </html>
  );
}
