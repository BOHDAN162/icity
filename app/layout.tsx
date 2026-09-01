import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { EB_Garamond } from "next/font/google";
import Preloader from "@/components/Preloader";
import "./globals.css";

/* ВТОРАЯ ГАРНИТУРА — осознанное исключение из «Чего на сайте не будет»
   (AGENTS.md), снятое заказчиком под первый экран. Живёт ровно в двух
   местах: заголовок и знак-столбик в HeroVideo.module.css. Условия,
   на которых она здесь:
   - один вес 400 и только normal. Курсив система запрещает, а static-
     инстанс его физически не отдаёт — нарушить нечем;
   - сабсеты ровно под то, чем она набрана: кириллица для заголовка,
     латиница для знака «iCITY / SPACE TOWER»;
   - третья точка применения = исключение обсуждается заново.
   Next 16 — свежая мажорная версия, сигнатура сверена по
   node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts,
   а не по памяти. */
const ebGaramond = EB_Garamond({
  subsets: ["cyrillic", "latin"],
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-eb-garamond",
});

export const metadata: Metadata = {
  title: "Офис 244,1 м² на 23 этаже в iCITY — Space Tower, Москва-Сити",
  description:
    "Помещение 113Н, 244,1 м², 23 этаж из 61. Потолки 3,8 м, открывающиеся окна, отделка и мебель. Прямая аренда от собственника, показ в день обращения.",
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
      className={`${GeistSans.variable} ${GeistMono.variable} ${ebGaramond.variable}`}
    >
      <body>
        <Preloader />
        {children}
      </body>
    </html>
  );
}
