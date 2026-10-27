import type { Metadata, Viewport } from "next";
import { geist, geistMono } from "./fonts";
import { tokensToCss } from "@/lib/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FRADY · Caleb Frady", template: "%s · FRADY" },
  description: "Caleb Frady. Rooted in nature, engineered in code. Content, systems, ventures and motion.",
};

export const viewport: Viewport = {
  themeColor: "#09090B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: tokensToCss() }} />
      </head>
      <body className="bg-ground font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
