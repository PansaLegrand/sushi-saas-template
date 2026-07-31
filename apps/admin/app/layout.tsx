import "./globals.css";

import type { Metadata } from "next";
import { stylePreset } from "@/config/style";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "Your SaaS";

export const metadata: Metadata = {
  title: `Admin | ${appName}`,
  description: `Operational admin console for ${appName}.`,
};

export default function AdminRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-style={stylePreset} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
