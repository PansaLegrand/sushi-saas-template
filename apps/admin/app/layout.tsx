import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin | Sushi SaaS",
  description: "Operational admin console for Sushi SaaS.",
};

export default function AdminRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
