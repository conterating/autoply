import type { Metadata } from "next";
import type { ReactNode } from "react";
import { themeScript } from "@/components/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Autoply", template: "%s · Autoply" },
  description: "Finds jobs that match your profile and applies to them for you.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
