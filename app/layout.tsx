import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Офис 244,1 м² на 23 этаже в iCITY — Space Tower, Москва-Сити",
  description:
    "Помещение 113Н, 244,1 м², 23 этаж из 61. Потолки 3,8 м, открывающиеся окна, дизайнерская отделка и мебель. Прямая аренда от собственника, показ в день обращения.",
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
    <html lang="ru" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
