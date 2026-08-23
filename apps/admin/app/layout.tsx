import "./globals.css";

import type { Metadata } from "next";
import { runtimeProductName } from "@/config/product";
import { stylePreset } from "@/config/style";

const appName = runtimeProductName();

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
