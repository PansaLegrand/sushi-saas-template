import createNextIntlPlugin from "next-intl/plugin";
import { securityHeadersRoute } from "./src/config/security-headers.js";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig = {
  experimental: {
    optimizePackageImports: ["sonner"],
  },
  async headers() {
    return [securityHeadersRoute()];
  },
};

export default withNextIntl(nextConfig);
