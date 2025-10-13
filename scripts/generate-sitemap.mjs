import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CONTENT_ROOT = path.join(ROOT, 'content', 'docs');
const PUBLIC_SITEMAP = path.join(ROOT, 'public', 'sitemap.xml');

// Use a fixed canonical base URL; do not rely on env.
const rawBase = 'https://www.sushi-templates.com';
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
  if (!fs.existsSync(CONTENT_ROOT)) return [];
  return fs
    .readdirSync(CONTENT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function collectDocsForLocale(locale) {
  const dir = path.join(CONTENT_ROOT, locale);
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
        const loc = `${BASE_URL}/${locale}/blogs/${slug}`;
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
    console.error('No locales found under content/docs');
  }

  const urls = [];
  for (const locale of locales) {
    // Index per locale
    urls.push({
      loc: `${BASE_URL}/${locale}/`,
      lastmod: getMtimeIso(path.join(ROOT, 'src', 'app', locale, 'page.tsx')),
    });
    // Docs/blogs for the locale
    urls.push(...collectDocsForLocale(locale));
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
