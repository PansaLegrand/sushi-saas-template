# Sushi SaaS 🍣

Construye y lanza tu SaaS más rápido — base lista para producción con i18n, autenticación, pagos, créditos, afiliados, docs MDX y panel admin.

**Idiomas**: [English](./README.md) | [Français](./README.fr.md) | Español | [日本語](./README.ja.md) | [中文](./README.zh.md)

**Por qué Sushi SaaS**

- Listo para ingresos: Stripe Checkout + libro mayor de créditos (productos por uso).
- Autenticación sólida: Better Auth + Postgres con Drizzle (tipado, migrable).
- Global desde el día uno: next‑intl y contenido localizado.
- Crecimiento: referidos/afiliados con recompensas configurables.
- Contenido y SEO: blogs MDX con metadatos + JSON‑LD.
- Admin y RBAC: admin protegido en el servidor (solo lectura / lectura‑escritura).
- DX cuidada: pnpm, Turbopack/Webpack, configs tipadas, ESLint/Tailwind.
- Operación: endpoint de salud, plantillas de entorno, migraciones explícitas.

---

## Vitrina

- DojoClip — https://dojoclip.com — Edición de video en el navegador con subtítulos multilingües.

- Sushi Templates — https://sushi-templates.com — Mira cómo se ve este sitio cuando se despliega en Vercel.

---

## Contacto

Construyo y lanzo aplicaciones SaaS en producción. Si necesitas ayuda para personalizar o lanzar con este template (implementación, features o asesoría), estoy disponible en freelance/contrato.

- Idiomas: español, inglés, francés, chino
- Email: pansalegrand@gmail.com

---

## Guía para contribuidores

Antes de cambiar algo, revisa [Repository Guidelines](./AGENTS.md) para estructura del proyecto, flujos y expectativas de revisión.

---

## Inicio rápido

Requisitos: Node 20+, pnpm 9+

Luego, sigue la guía de configuración en:

https://www.sushi-templates.com/es/blogs/quick-start


---

## Estructura del proyecto

```
src/
├─ app/
│  ├─ [locale]/
│  │  ├─ page.tsx           # Landing (i18n)
│  │  └─ (seo)/blogs/       # Docs/blogs MDX (Fumadocs)
│  │     ├─ [[...slug]]/page.tsx
│  │     └─ layout.tsx
│  ├─ api/
│  │  ├─ health/route.ts    # Endpoint de salud
│  │  └─ auth/[...all]/route.ts # Handler Better Auth
│  ├─ globals.css           # Tailwind + tema
│  └─ layout.tsx            # Layout raíz
├─ i18n/
│  ├─ locale.ts             # locales, defaultLocale, prefix
│  ├─ request.ts            # config next-intl
│  ├─ routing.ts            # helper de routing
│  └─ navigation.ts         # Link/router con locale
├─ lib/
│  ├─ auth.ts               # config servidor Better Auth
│  └─ utils.ts              # helpers
├─ providers/
│  ├─ theme.tsx             # tema + Toaster + providers globales
│  ├─ google-analytics.tsx  # GA (solo prod)
│  └─ affiliate-init.tsx    # hook cliente para finalizar atribución
└─ contexts/
   └─ app.tsx               # provider app (placeholder)

content/
└─ docs/<locale>/...        # Contenido MDX (/:locale/blogs/...)

messages/
└─ <locale>.json            # traducciones de landing + metadatos
```

---

## Internacionalización

Esta app usa next‑intl v4.

- Config estática: `src/i18n/locale.ts`.
- Carga de mensajes: `src/i18n/request.ts`.
- Middleware en `src/middleware.ts` (rutas con prefijo). Usamos `localePrefix: "always"` para rutas como `/es`.
- Mensajes en `messages/*.json`.

Añadir un idioma:

1) Crear `messages/<locale>.json`
2) Agregar el código a `locales` en `src/i18n/locale.ts`
3) (Opcional) MDX localizados en `content/docs/<locale>`
4) Reiniciar dev

---

## Docs & MDX (Fumadocs)

- Contenido en `content/docs/<locale>/...`
- Rutas: `/:locale/blogs/<slugs>`
- El dev genera `.source/index.ts` automáticamente
- El plugin de Fumadocs parsea el MDX

Crear una página:

```bash
mkdir -p content/docs/es
cat > content/docs/es/mi-pagina.mdx <<'MDX'
---
title: Mi página
---

# Hola
MDX
```

Abre `/es/blogs/mi-pagina`.

Estilos

- El layout de blogs importa `fumadocs-ui/css/style.css` y usa `DocsLayout`.
- Cambia el tema importando una paleta `fumadocs-ui/css/*.css`.

---

## Autenticación (Better Auth)

Better Auth alimenta endpoints del servidor y flujos UI (registro, login, perfil).

- Config servidor: `src/lib/auth.ts`
- Handler Next API: `src/app/api/auth/[...all]/route.ts`
- Helpers cliente: `src/lib/auth-client.ts`
- Rutas UI: `/:locale/login`, `/:locale/signup`, `/:locale/me`
- Endpoints activos: Email y Password (sesiones en Postgres)

Variables de entorno:

```env
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_BASE_URL=http://localhost:3000
```

### Base de datos

Better Auth persiste usuarios, sesiones, cuentas y verificaciones en Postgres con Drizzle.

1. Define `DATABASE_URL` en `.env` (ver `.env.example`).
2. Genera SQL tras cambios de esquema:

   ```bash
   pnpm drizzle-kit generate --config src/db/config.ts
   ```

3. Aplica migraciones:

   ```bash
   pnpm drizzle-kit migrate --config src/db/config.ts
   ```

4. Reinicia dev para que Better Auth detecte las tablas.

Consulta `/es/blogs/database-setup` para la guía completa.

---

## Afiliados y referidos

Activa referidos para recompensar registros y compras.

- Enlaces: `/:locale/i/<inviteCode>` fija cookie `ref` (30 días) y redirige.
- Finaliza la atribución tras login/registro vía `/api/affiliate/update-invite`.
- Recompensas en pedidos pagados con `src/services/affiliate.ts` (fijo/%/híbrido, sin duplicar por pedido).
- Usuario: `/:locale/my-invites`. Admin: `/admin/affiliates`.

Configuración: `src/data/affiliate.ts`

- Programa: `enabled`, `attributionWindowDays`, `allowSelfReferral`, `attributionModel`
- Recompensas: `commissionMode` (fixed_only | percent_only | greater_of | sum), `signup`, `paid`
- Tipo de pago: `payoutType = "cash"` (centavos) o `"credits"` (créditos)
- Ruta de compartir: `sharePath` (`/i`); base usa `NEXT_PUBLIC_WEB_URL`

Prueba local

1. Visita `/:locale/my-invites`, copia tu enlace
2. Abre en incógnito, regístrate y vuelve a `my-invites`
3. Ejecuta un pago de prueba en Stripe; revisa recompensas en admin

Notas

- Asegúrate de que `NEXT_PUBLIC_WEB_URL` coincide con tu origen local.
- El hook cliente marca éxito sólo con 200; reintenta tras login si disparó antes.

---

## Health Check

`GET /api/health` devuelve estado, timestamp y entorno. Úsalo para probes.

---

## Scripts

- `pnpm dev` – genera el mapa MDX y arranca Next con Turbopack
- `pnpm dev:webpack` – igual con Webpack
- `pnpm build` / `pnpm start` – build & start prod

---

## Email (Resend)

Email transaccional con Resend.

- Código
  - Servicio: `src/services/email/send.ts`
  - Plantillas: `src/services/email/templates/*`
  - Disparadores: bienvenida (creación de usuario), confirmación de pago (webhook)
- Entorno

```env
RESEND_API_KEY=...
EMAIL_FROM="Your Name <founder@your-domain.com>"
```

- Notas
  - Verifica tu dominio; usa subdominio `send.` y copia DNS.
  - Usa un remitente amigable (evita `no-reply@`).
  - Los emails se envían en background; los webhooks responden rápido.

Lee `/es/blogs/email-service` (también en en/fr/ja/zh).

---

## Solución de problemas

- MDX “Unknown module type”: revisa el plugin Fumadocs en `next.config.ts` y reinicia.
- `/zh` muestra inglés: verifica `localePrefix = "always"` y `messages/zh.json`.
- Docs 404: verifica la ruta `content/docs/<locale>/...`.

---

## Stripe

```bash
stripe login
stripe listen --forward-to localhost:3000/api/pay/callback/stripe
stripe trigger payment_intent.succeeded
```

---

## Licencia

MIT. PRs bienvenidos.
