# Sushi SaaS 🍣

Construisez et lancez votre SaaS plus vite — base prête pour la prod avec i18n, authentification, paiement, crédits, affiliation, docs MDX et outils admin.

**Langues** : [English](./README.md) | Français | [Español](./README.es.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

**Pourquoi Sushi SaaS**

- Prêt pour le revenu : Stripe Checkout + grand livre de crédits (produits à l’usage).
- Auth robuste : Better Auth + Postgres via Drizzle (typé, migrable).
- Global dès le départ : next‑intl et contenu localisé.
- Boucles de croissance : parrainage/affiliation avec récompenses configurables.
- Contenu & SEO : blogs MDX avec métadonnées + JSON‑LD.
- Admin & RBAC : admin protégé côté serveur (lecture‑seule / lecture‑écriture).
- DX soignée : pnpm, Turbopack/Webpack, configs typées, ESLint/Tailwind.
- Ops‑friendly : endpoint de santé, templates d’env, migrations explicites.

---

## Vitrine

- DojoClip — https://dojoclip.com — Édition vidéo dans le navigateur avec sous‑titres multilingues.

---

## Contact

Je conçois et livre des applications SaaS prêtes pour la production. Si vous voulez de l’aide pour personnaliser ou lancer avec ce template (implémentation, fonctionnalités, conseil), je suis disponible en freelance/mission.

- Langues : français, anglais, chinois
- Email : pansalegrand@gmail.com

---

## Guide Contributeur

Avant toute modification, lisez le fichier [Repository Guidelines](./AGENTS.md) pour connaître la structure, les workflows et les attentes de revue.

---

## Démarrage rapide

Prérequis : Node 20+, pnpm 9+

```bash
pnpm install
pnpm dev
```

Ouvrir :

- Landing : `/fr`, `/en`, `/es`, `/ja`, `/zh`
- Santé : `/api/health`
- Exemple de docs : `/:locale/blogs/quick-start`
- Bac à sable crédits : `/:locale/credits-test`

---

## Structure du projet

```
src/
├─ app/
│  ├─ [locale]/
│  │  ├─ page.tsx           # Page d’accueil (i18n)
│  │  └─ (seo)/blogs/       # Docs/blogs MDX (Fumadocs)
│  │     ├─ [[...slug]]/page.tsx
│  │     └─ layout.tsx
│  ├─ api/
│  │  ├─ health/route.ts    # Endpoint de santé
│  │  └─ auth/[...all]/route.ts # Handler Better Auth
│  ├─ globals.css           # Tailwind + thème
│  └─ layout.tsx            # Layout racine
├─ i18n/
│  ├─ locale.ts             # locales, defaultLocale, prefix
│  ├─ request.ts            # config next-intl
│  ├─ routing.ts            # helper de routing
│  └─ navigation.ts         # Link/router compatible locale
├─ lib/
│  ├─ auth.ts               # config serveur Better Auth
│  └─ utils.ts              # helpers
├─ providers/
│  ├─ theme.tsx             # thème + Toaster + providers globaux
│  ├─ google-analytics.tsx  # GA (prod uniquement)
│  └─ affiliate-init.tsx    # hook client pour finaliser l’attribution
└─ contexts/
   └─ app.tsx               # provider app (placeholder)

content/
└─ docs/<locale>/...        # Contenu MDX (servi sur /:locale/blogs/...)

messages/
└─ <locale>.json            # traductions landing + meta
```

---

## Internationalisation

Cette app utilise next‑intl v4.

- La config statique est dans `src/i18n/locale.ts`.
- Le chargement des messages est dans `src/i18n/request.ts`.
- Le middleware est dans `src/middleware.ts` (routes préfixées). `localePrefix: "always"` rend `/fr`, `/en`, etc. explicites.
- Les messages vivent dans `messages/*.json`.

Ajouter une langue :

1) Créer `messages/<locale>.json`
2) Ajouter le code dans `locales` de `src/i18n/locale.ts`
3) Optionnel : ajouter des pages MDX sous `content/docs/<locale>`
4) Redémarrer le dev

---

## Docs & MDX (Fumadocs)

- Le contenu vit dans `content/docs/<locale>/...`
- Les routes sont `/:locale/blogs/<slugs>`
- Le dev génère `.source/index.ts` automatiquement
- MDX est parsé via le plugin Next de Fumadocs

Créer une page :

```bash
mkdir -p content/docs/fr
cat > content/docs/fr/ma-page.mdx <<'MDX'
---
title: Ma page
---

# Bonjour
MDX
```

Puis ouvrir `/fr/blogs/ma-page`.

Style

- Le layout des blogs importe `fumadocs-ui/css/style.css` et utilise `DocsLayout`.
- Vous pouvez changer de thème en important une palette `fumadocs-ui/css/*.css`.

---

## Authentification (Better Auth)

Better Auth alimente les endpoints serveur et les flux UI (inscription, connexion, profil).

- Config serveur : `src/lib/auth.ts`
- Handler Next API : `src/app/api/auth/[...all]/route.ts`
- Helpers client : `src/lib/auth-client.ts`
- Routes UI : `/:locale/login`, `/:locale/signup`, `/:locale/me`
- Endpoints activés : Email & Mot de passe (sessions en Postgres)

Variables d’environnement :

```env
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_BASE_URL=http://localhost:3000
```

### Base de données

Better Auth persiste users, sessions, accounts et verifications dans Postgres via Drizzle.

1. Définir `DATABASE_URL` dans `.env` (voir `.env.example`).
2. Générer le SQL après changement de schéma :

   ```bash
   pnpm drizzle-kit generate --config src/db/config.ts
   ```

3. Appliquer les migrations :

   ```bash
   pnpm drizzle-kit migrate --config src/db/config.ts
   ```

4. Redémarrer le serveur dev pour charger les tables.

Voir `/fr/blogs/database-setup` pour le guide complet.

---

## Affiliation & Parrainage

Activez les parrainages pour récompenser les inscriptions et achats.

- Liens : `/:locale/i/<inviteCode>` pose un cookie `ref` (30 jours) et redirige.
- Finalisation après login/inscription via `/api/affiliate/update-invite`.
- Récompenses sur commandes payées via `src/services/affiliate.ts` (fixe/pourcentage/hybride, dédup par commande).
- Page utilisateur : `/:locale/my-invites`. Admin : `/admin/affiliates`.

Configuration : `src/data/affiliate.ts`

- Programme : `enabled`, `attributionWindowDays`, `allowSelfReferral`, `attributionModel`
- Récompenses : `commissionMode` (fixed_only | percent_only | greater_of | sum), `signup`, `paid`
- Type de paiement : `payoutType = "cash"` (centimes) ou `"credits"` (crédits in‑app)
- Chemin de partage : `sharePath` (`/i`) ; base URL via `NEXT_PUBLIC_WEB_URL`

Test local

1. Visiter `/:locale/my-invites`, copier le lien
2. Ouvrir en navigation privée, s’inscrire, puis revenir
3. Simuler un paiement Stripe et vérifier les récompenses en admin

Notes

- Assurez‑vous que `NEXT_PUBLIC_WEB_URL` correspond à votre origine locale.
- Le hook client ne marque le succès que si l’API renvoie 200 ; il réessaie après login si besoin.

---

## Health Check

`GET /api/health` renvoie le statut, l’horodatage et l’environnement. Utile pour les probes.

---

## Scripts

- `pnpm dev` – génère la map MDX et démarre Next (Turbopack)
- `pnpm dev:webpack` – idem avec Webpack
- `pnpm build` / `pnpm start` – build & start prod

---

## Email (Resend)

Intégration d’emails transactionnels via Resend.

- Code
  - Service : `src/services/email/send.ts`
  - Templates : `src/services/email/templates/*`
  - Déclencheurs : bienvenue à la création (`src/lib/auth.ts`), confirmation de paiement (webhook Stripe)
- Env

```env
RESEND_API_KEY=...
EMAIL_FROM="Your Name <founder@your-domain.com>"
```

- Notes
  - Vérifiez votre domaine (idéalement un sous‑domaine `send.`) et copiez les DNS.
  - Utilisez un expéditeur convivial (évitez `no-reply@`).
  - Les emails partent en tâche de fond ; les webhooks répondent vite.

Guide complet : `/fr/blogs/email-service` (aussi en en/es/ja/zh).

---

## Dépannage

- MDX « Unknown module type » : vérifiez le plugin Fumadocs dans `next.config.ts` puis redémarrez.
- `/zh` affiche l’anglais : vérifiez `localePrefix = "always"` et `messages/zh.json`.
- 404 docs : confirmez le chemin sous `content/docs/<locale>/...`.

---

## Stripe

```bash
stripe login
stripe listen --forward-to localhost:3000/api/pay/callback/stripe
stripe trigger payment_intent.succeeded
```

---

## Licence

MIT. Contributions bienvenues.
