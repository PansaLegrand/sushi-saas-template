import { source } from "@/lib/source";
import type { Metadata } from "next";
import { locales as supportedLocales } from "@/i18n/locale";
import { baseUrlFallback } from "@/lib/seo";
import Script from "next/script";
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/mdx-components";

export default async function DocsContentPage(props: {
  params: Promise<{ slug?: string[]; locale?: string }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug, params.locale);

  if (!page) notFound();

  const MDXContent = page.data.body;
  const base = baseUrlFallback;
  const slugPath = (params.slug ?? []).join("/");
  const baseOrigin = new URL(base);
  const normalizeCanonical = (value?: string) => {
    if (!value?.trim()) return null;
    try {
      const url = new URL(value.trim());
      if (url.host !== baseOrigin.host) return null;
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  };

  // Basic BlogPosting JSON-LD to help search engines understand the content
  const fm: any = page.data;
  const canonicalUrl =
    normalizeCanonical(fm.canonical as string | undefined) ??
    `${base}/${params.locale ?? "en"}/blogs/${slugPath}`;
  const authors = Array.isArray(fm.authors)
    ? fm.authors
    : fm.author
    ? Array.isArray(fm.author)
      ? fm.author
      : [fm.author]
    : undefined;
  const image = fm.image as string | undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: page.data.title,
    description: page.data.description,
    datePublished: fm.publishedAt,
    dateModified: fm.updatedAt ?? fm.publishedAt,
    inLanguage: params.locale,
    author: authors?.map((name: string) => ({ "@type": "Person", name })),
    image: image ? [image.startsWith("http") ? image : `${base}${image}`] : undefined,
    mainEntityOfPage: canonicalUrl,
  };

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{
        style: "clerk",
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <Script
        id="blog-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams("slug", "locale");
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[]; locale?: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug, params.locale);
  if (!page) notFound();

  const fm: any = page.data;
  const base = baseUrlFallback;
  const slugPath = (params.slug ?? []).join("/");
  const baseOrigin = new URL(base);
  const normalizeCanonical = (value?: string) => {
    if (!value?.trim()) return null;
    try {
      const url = new URL(value.trim());
      if (url.host !== baseOrigin.host) return null;
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  };

  const canonical =
    normalizeCanonical(fm.canonical as string | undefined) ??
    `${base}/${params.locale ?? "en"}/blogs/${slugPath}`;

  const keywords: string[] | undefined = Array.isArray(fm.keywords)
    ? fm.keywords
    : typeof fm.keywords === "string"
    ? fm.keywords.split(",").map((s: string) => s.trim()).filter(Boolean)
    : Array.isArray(fm.tags)
    ? fm.tags
    : undefined;

  const authors = Array.isArray(fm.authors)
    ? fm.authors
    : fm.author
    ? Array.isArray(fm.author)
      ? fm.author
      : [fm.author]
    : undefined;
  const image = fm.image as string | undefined;
  const noindex = fm.noindex === true;
  const publishedTime = fm.publishedAt as string | undefined;
  const modifiedTime = (fm.updatedAt as string | undefined) ?? publishedTime;

  const languages: Record<string, string> = {};
  for (const loc of supportedLocales) {
    const localized = source.getPage(params.slug, loc);
    if (localized) {
      languages[loc] = `${base}/${loc}/blogs/${slugPath}`;
    }
  }

  return {
    metadataBase: new URL(base),
    title: page.data.title,
    description: page.data.description,
    keywords,
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      type: "article",
      url: canonical,
      title: page.data.title,
      description: page.data.description,
      siteName: process.env.NEXT_PUBLIC_APP_NAME || "Sushi SaaS",
      locale: params.locale,
      images: image ? [{ url: image }] : undefined,
      publishedTime,
      modifiedTime,
      authors,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: page.data.title,
      description: page.data.description,
      images: image ? [image] : undefined,
    },
    robots: noindex ? { index: false, follow: true } : undefined,
  } satisfies Metadata;
}
