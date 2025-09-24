import createNextIntlPlugin from "next-intl/plugin";
import { createMDX as createFumadocsMDX } from "fumadocs-mdx/next";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const nextConfig = {
  experimental: {
    optimizePackageImports: ["sonner"],
  },
  pageExtensions: ["ts", "tsx", "md", "mdx"],
};
const withFuma = createFumadocsMDX();
export default withFuma(withNextIntl(nextConfig));
