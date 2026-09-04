import type { Metadata } from "next";
import { Literata, Golos_Text, JetBrains_Mono } from "next/font/google";
import Cursor from "@/components/Cursor";
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
      </body>
    </html>
  );
}
