import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "출장 — 영수증을 한곳에",
  description: "KTX, 카카오 T, 티머니 고속버스, 항공, 쏘카 이용내역을 모아 출장별로 정리하세요.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><body className="antialiased">{children}</body></html>;
}
