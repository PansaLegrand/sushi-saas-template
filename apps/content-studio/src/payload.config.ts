import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig, type PayloadRequest } from "payload";
import sharp from "sharp";
import { AutomationRequests } from "@/collections/automation-requests";
import { ContentBriefs } from "@/collections/content-briefs";
import { Media } from "@/collections/media";
import { MarketingCampaigns } from "@/collections/marketing-campaigns";
import { MarketingEmailTemplates } from "@/collections/marketing-email-templates";
import { Pages } from "@/collections/pages";
import { Posts } from "@/collections/posts";
import { ServiceAccounts } from "@/collections/service-accounts";
import { Users } from "@/collections/users";
import { contentApiEndpoints } from "@/content-api/endpoints";
import { marketingApiEndpoints } from "@/marketing-api/endpoints";
import { importContentTask } from "@/jobs/import-content";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const cors = (process.env.CONTENT_CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const s3Enabled = Boolean(
  process.env.CONTENT_STORAGE_BUCKET &&
    process.env.CONTENT_STORAGE_REGION &&
    process.env.CONTENT_STORAGE_ACCESS_KEY &&
    process.env.CONTENT_STORAGE_SECRET_KEY
);

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: {
      titleSuffix: " · Sushi Content Studio",
      description: "Editorial and SEO content workspace"
    },
    components: {
      beforeDashboard: ["@/components/studio-welcome"]
    },
    livePreview: {
      breakpoints: [
        { name: "mobile", label: "Mobile", width: 390, height: 844 },
        { name: "tablet", label: "Tablet", width: 820, height: 1180 },
        { name: "desktop", label: "Desktop", width: 1440, height: 900 }
      ]
    }
  },
  db: postgresAdapter({
    pool: { connectionString: process.env.CONTENT_DATABASE_URL ?? "" },
    migrationDir: path.resolve(dirname, "migrations")
  }),
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET ?? "",
  sharp,
  cors,
  csrf: cors,
  experimental: {
    localizeStatus: true
  },
  localization: {
    locales: [
      { code: "en", label: "English" },
      { code: "zh", label: "中文" },
      { code: "es", label: "Español" },
      { code: "fr", label: "Français" },
      { code: "ja", label: "日本語" }
    ],
    defaultLocale: "en",
    fallback: false
  },
  collections: [
    Pages,
    Posts,
    Media,
    ContentBriefs,
    MarketingEmailTemplates,
    MarketingCampaigns,
    Users,
    ServiceAccounts,
    AutomationRequests
  ],
  endpoints: [...contentApiEndpoints, ...marketingApiEndpoints],
  plugins: [
    s3Storage({
      enabled: s3Enabled,
      collections: { media: { prefix: "media" } },
      bucket: process.env.CONTENT_STORAGE_BUCKET ?? "",
      config: {
        credentials: {
          accessKeyId: process.env.CONTENT_STORAGE_ACCESS_KEY ?? "",
          secretAccessKey: process.env.CONTENT_STORAGE_SECRET_KEY ?? ""
        },
        region: process.env.CONTENT_STORAGE_REGION ?? "auto",
        endpoint: process.env.CONTENT_STORAGE_ENDPOINT || undefined,
        forcePathStyle: process.env.CONTENT_STORAGE_FORCE_PATH_STYLE === "true"
      }
    })
  ],
  jobs: {
    access: {
      run: ({ req }: { req: PayloadRequest }) => {
        if (req.user?.collection === "users") return true;
        const secret = process.env.CRON_SECRET;
        return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
      }
    },
    tasks: [importContentTask],
    autoRun: [{ cron: "* * * * *", queue: "content", limit: 5 }]
  },
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts")
  }
});
