import type { Metadata, Viewport } from "next";
import { geist, geistMono } from "./fonts";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FRADY OS", template: "%s · FRADY OS" },
  description: "Personal operating system for projects, events, social content, deadlines and follow-ups.",
};

export const viewport: Viewport = {
  themeColor: "#0e1014",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} dark h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
