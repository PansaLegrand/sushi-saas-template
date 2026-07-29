import type { MetadataRoute } from "next";

function publicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = publicBaseUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/account/",
        "/tasks/",
        "/invitations/",
        "/my-invites/",
        "/credits-test/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
