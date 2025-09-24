import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig = {
  experimental: {
    optimizePackageImports: ["sonner"],
  },
};

export default withNextIntl(nextConfig);
