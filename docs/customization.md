# Product Customization

`saas.config.json` is the tracked, reviewable product identity. It keeps the
runtime brand, receipt/metadata slug, style preset, locale routing, support/docs
links, and legal identity aligned without scattering string replacements across
the repository.

## Guided Customization

`./scripts/setup.sh development` and `setup:guided` open the customizer before
environment prompts. Run it independently at any time:

```bash
pnpm customize
```

For automation or a template generator, provide explicit values and `--yes`:

```bash
pnpm customize -- \
  --name "Acme Cloud" \
  --slug acme-cloud \
  --preset glass \
  --locales en,es \
  --default-locale en \
  --support-email support@example.com \
  --docs-url https://docs.example.com \
  --yes
```

Use `--dry-run` to print the candidate JSON without writing. Use `none` to clear
an optional email/URL and `--no-env` to avoid synchronizing existing ignored
profiles.

The write is atomic: a validated temporary file is renamed over
`saas.config.json`. Existing `.env.development.local`, `.env.local`, legacy
`.env`, and `.env.production.local` files receive only matching public identity
and locale values. Secrets and provider credentials are never touched.

## What the Config Owns

| Section                | Runtime consumers                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `product`              | app/site name, provider metadata slug, support link, external docs link            |
| `appearance.preset`    | web and admin semantic theme (`studio`, `glass`, `soft`, `editorial`, `brutalist`) |
| `internationalization` | default locale, enabled locale routing and navigation                              |
| `legal`                | public entity/contact placeholders and effective date                              |

Environment variables may override the public name, slug, docs URL, and locale
set for a deployment. This is useful for preview environments, but production
overrides must agree with the tracked config so receipts, tracing, routes, and UI
do not identify different products.

## Validation and Launch Gate

```bash
pnpm config:check
pnpm config:check:prod
```

The normal check validates structure, supported presets/locales, slug format,
URLs, emails, unique locales, and inclusion of the default locale. It runs as
part of `pnpm lint`.

The production check also requires:

- a non-placeholder product name and slug;
- a support email;
- legal entity, address, privacy/legal contacts, and governing law;
- no disagreement with `.env.production.local` public values.

Passing the gate does not make the legal text correct. The skeleton in
`src/config/legal.ts` and sub-processor list still require counsel and product-
specific review before launch.
