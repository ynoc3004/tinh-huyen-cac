import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tĩnh Huyền Các · Đấu trường",
  description: "Điều hành giải cờ vua, lịch đấu, bốc thăm và xếp hạng.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
