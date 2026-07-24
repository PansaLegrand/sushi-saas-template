# Site content

This directory holds the marketing and editorial content of whoever deploys
this template — articles, SEO pages, announcements. It is served at `/blogs`.

It ships empty on purpose. The template's own documentation lives in
`content/docs` and is served at `/docs`; do not put kit documentation here.

## Adding content

Mirror the locale layout used by `content/docs`:

```
content/blog/
  en/
    _meta.json          # { "title": "Blog", "root": true, "pages": [...] }
    my-first-post.mdx
  zh/
    ...
```

Folders wrapped in parentheses, like `(guides)`, group entries in the sidebar
without appearing in the URL.

Leaving this directory empty is fully supported: `/blogs` renders an empty
index rather than failing to build.
