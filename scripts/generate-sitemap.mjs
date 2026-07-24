import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PUBLIC_SITEMAP = path.join(ROOT, 'public', 'sitemap.xml');

// The two content collections and the route each is served under.
const COLLECTIONS = [
  { root: path.join(ROOT, 'content', 'docs'), routeSegment: 'docs' },
  { root: path.join(ROOT, 'content', 'blog'), routeSegment: 'blogs' },
];

// Canonical base URL for whoever deploys this. Override per deployment.
const rawBase =
  process.env.SITEMAP_BASE_URL ||
  process.env.NEXT_PUBLIC_WEB_URL ||
  'http://localhost:3000';
const BASE_URL = rawBase.replace(/\/$/, '');

function getMtimeIso(filePath) {
  try {
    const st = fs.statSync(filePath);
    return new Date(st.mtime).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function listLocales() {
  const locales = new Set();
  for (const { root } of COLLECTIONS) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) locales.add(entry.name);
    }
  }
  return [...locales].sort();
}

function collectDocsForLocale(locale, contentRoot, routeSegment) {
  const dir = path.join(contentRoot, locale);
  if (!fs.existsSync(dir)) return [];
  const urls = [];

  const walk = (currentDir) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fp = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fp);
      } else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) {
        // Build a slug from the relative path, removing group segments like "(hands-on)".
        const relParts = path.relative(dir, fp).split(path.sep);
        const filtered = relParts.filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')));
        const filename = filtered.pop();
        if (!filename) continue;
        const nameNoExt = filename.replace(/\.(md|mdx)$/i, '');
        const parts = [...filtered, nameNoExt];
        const slug = parts.map((p) => encodeURIComponent(p)).join('/');
        const loc = `${BASE_URL}/${locale}/${routeSegment}/${slug}`;
        urls.push({ loc, lastmod: getMtimeIso(fp) });
      }
    }
  };

  walk(dir);
  return urls;
}

function buildXml(urls) {
  const lines = [];
  lines.push("<?xml version='1.0' encoding='utf-8' standalone='yes'?>");
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const u of urls) {
    lines.push('  <url>');
    lines.push(`    <loc>${u.loc}</loc>`);
    lines.push(`    <lastmod>${u.lastmod}</lastmod>`);
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const locales = listLocales();
  if (locales.length === 0) {
    console.error('No locales found under content/docs or content/blog');
  }

  const urls = [];
  for (const locale of locales) {
    // Index per locale (canonicalized without trailing slash)
    const localeIndexLoc = `${BASE_URL}/${locale}`;
    urls.push({
      loc: localeIndexLoc,
      lastmod: getMtimeIso(path.join(ROOT, 'src', 'app', locale, 'page.tsx')),
    });
    // Both content collections for the locale
    for (const { root, routeSegment } of COLLECTIONS) {
      urls.push(...collectDocsForLocale(locale, root, routeSegment));
    }
  }

  // De-duplicate and sort
  const seen = new Set();
  const unique = [];
  for (const u of urls) {
    if (!seen.has(u.loc)) {
      seen.add(u.loc);
      unique.push(u);
    }
  }
  unique.sort((a, b) => a.loc.localeCompare(b.loc));

  const xml = buildXml(unique);
  fs.mkdirSync(path.dirname(PUBLIC_SITEMAP), { recursive: true });
  fs.writeFileSync(PUBLIC_SITEMAP, xml);
  console.log(`Wrote ${unique.length} URLs to ${PUBLIC_SITEMAP}`);
}

main();
