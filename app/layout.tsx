import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruang — Chat real-time",
  description: "Aplikasi chat real-time dengan Next.js dan Firebase.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
