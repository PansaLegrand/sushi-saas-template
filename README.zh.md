# Sushi SaaS 🍣

更快地构建并上线你的 SaaS —— 面向生产的模板：内置多语言、认证、支付、积分、推广、MDX 文档与管理后台。

**语言**： [English](./README.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | 中文

**为什么选择 Sushi SaaS**

- 直连收入：Stripe Checkout + 积分台账（适合按量计费）。
- 稳健认证：Better Auth + Postgres（Drizzle 类型安全与可迁移）。
- 全球化优先：next‑intl 路由与本地化内容。
- 增长闭环：邀请/推广与可配置奖励。
- 内容与 SEO：MDX 博客自动生成元数据与 JSON‑LD。
- 管理与 RBAC：服务端防护的管理台（只读/读写）。
- 开发体验：pnpm、Turbopack/Webpack、强类型配置、ESLint/Tailwind。
- 运维友好：健康检查、环境模板、显式迁移。

---

## 案例

- DojoClip — https://dojoclip.com — 基于浏览器的视频编辑，支持多语言字幕。

---

## 联系方式

我长期构建并交付生产级 SaaS 应用。如需基于本模板的定制或上线支持（实现、功能、咨询），可提供自由职业/外包服务。

- 语言：中文、英文、法文
- Email：pansalegrand@gmail.com

---

## 贡献指南

修改前请先阅读 [Repository Guidelines](./AGENTS.md)，了解项目结构、工作流与评审要求。

---

## 快速开始

前置：Node 20+，pnpm 9+

```bash
pnpm install
pnpm dev
```

访问：

- 首页：`/zh`、`/en`、`/fr`、`/ja`、`/es`
- 健康检查：`/api/health`
- 文档示例：`/:locale/blogs/quick-start`
- 积分沙盒：`/:locale/credits-test`

---

## 项目结构

```
src/
├─ app/
│  ├─ [locale]/
│  │  ├─ page.tsx           # 多语言首页
│  │  └─ (seo)/blogs/       # MDX 文档 (Fumadocs)
│  │     ├─ [[...slug]]/page.tsx
│  │     └─ layout.tsx
│  ├─ api/
│  │  ├─ health/route.ts    # 健康检查
│  │  └─ auth/[...all]/route.ts # Better Auth
│  ├─ globals.css           # Tailwind + 主题
│  └─ layout.tsx            # 根布局
├─ i18n/
│  ├─ locale.ts             # locales, defaultLocale, prefix
│  ├─ request.ts            # next-intl 配置
│  ├─ routing.ts            # 路由助手
│  └─ navigation.ts         # 支持 locale 的 Link/router
├─ lib/
│  ├─ auth.ts               # Better Auth 服务端配置
│  └─ utils.ts              # 工具
├─ providers/
│  ├─ theme.tsx             # 主题 + Toaster + 全局 Provider
│  ├─ google-analytics.tsx  # 生产注入 GA
│  └─ affiliate-init.tsx    # 归因收尾的客户端 hook
└─ contexts/
   └─ app.tsx               # 应用级 Provider (占位)

content/
└─ docs/<locale>/...        # MDX 内容 (/:locale/blogs/...)

messages/
└─ <locale>.json            # 文案与元数据翻译
```

---

## 国际化

使用 next‑intl v4。

- 静态路由配置：`src/i18n/locale.ts`
- 运行时加载：`src/i18n/request.ts`
- 中间件：`src/middleware.ts`（使用 `localePrefix: "always"`）
- 文案：`messages/*.json`

新增语言：

1）新增 `messages/<locale>.json`
2）在 `src/i18n/locale.ts` 的 `locales` 中加入
3）可在 `content/docs/<locale>` 下添加 MDX
4）重启 dev

---

## Docs & MDX (Fumadocs)

- 内容位置：`content/docs/<locale>/...`
- 访问路径：`/:locale/blogs/<slugs>`
- 开发时自动生成 `.source/index.ts`
- 由 Fumadocs Next 插件解析 MDX

创建页面：

```bash
mkdir -p content/docs/zh
cat > content/docs/zh/我的页面.mdx <<'MDX'
---
title: 我的页面
---

# 你好
MDX
```

打开 `/zh/blogs/我的页面`。

样式

- Blogs 段的 layout 引入 `fumadocs-ui/css/style.css` 并使用 `DocsLayout`。
- 通过引入 `fumadocs-ui/css/*.css` 切换主题。

---

## 认证（Better Auth）

Better Auth 同时支持后端接口与前端 UI 流程（注册、登录、个人页）。

- 服务端配置：`src/lib/auth.ts`
- Next API 路由：`src/app/api/auth/[...all]/route.ts`
- 客户端辅助：`src/lib/auth-client.ts`
- UI 路由：`/:locale/login`、`/:locale/signup`、`/:locale/me`
- 启用的端点：邮箱 + 密码（会话存于 Postgres）

环境变量：

```env
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_BASE_URL=http://localhost:3000
```

### 数据库设置

Better Auth 通过 Drizzle 将 users/sessions/accounts/verifications 存入 Postgres。

1. 在 `.env` 定义 `DATABASE_URL`（见 `.env.example`）
2. 修改表后生成 SQL：

   ```bash
   pnpm drizzle-kit generate --config src/db/config.ts
   ```

3. 执行迁移：

   ```bash
   pnpm drizzle-kit migrate --config src/db/config.ts
   ```

4. 重启 dev 以加载最新表结构

完整指南：`/zh/blogs/database-setup`

---

## 推广 / 邀请

开启推广，奖励注册与支付。

- 分享链接：`/:locale/i/<inviteCode>` 设置 30 天 `ref` Cookie 并重定向。
- 登录/注册后通过 `/api/affiliate/update-invite` 最终归因。
- 支付奖励：`src/services/affiliate.ts`（固定/百分比/混合，按订单去重）。
- 用户页：`/:locale/my-invites`；管理页：`/admin/affiliates`。

配置：`src/data/affiliate.ts`

- 项目：`enabled`、`attributionWindowDays`、`allowSelfReferral`、`attributionModel`
- 奖励：`commissionMode`（fixed_only | percent_only | greater_of | sum）、`signup`、`paid`
- 发放类型：`payoutType = "cash"`（分）或 `"credits"`（站内积分）
- 分享路径：`sharePath`（默认 `/i`）；基地址 `NEXT_PUBLIC_WEB_URL`

本地测试

1. 访问 `/:locale/my-invites` 复制链接
2. 无痕窗口注册，再回到邀请页
3. 执行 Stripe 测试支付；在后台查看奖励

注意

 - 确认 `NEXT_PUBLIC_WEB_URL` 与本地访问一致
 - 客户端 hook 仅在 200 时标记成功；若登录前触发会在登录后重试

---

## 健康检查

`GET /api/health` 返回服务状态、时间戳与环境，可用于监控探针。

---

## Scripts

- `pnpm dev` – 生成 MDX 映射并以 Turbopack 启动 Next
- `pnpm dev:webpack` – 使用 Webpack 启动
- `pnpm build` / `pnpm start` – 生产构建与启动

---

## 邮件（Resend）

集成 Resend 发送事务性邮件。

- 代码
  - 服务：`src/services/email/send.ts`
  - 模板：`src/services/email/templates/*`
  - 触发：用户创建欢迎邮件、Stripe Webhook 支付成功
- 环境

```env
RESEND_API_KEY=...
EMAIL_FROM="Your Name <founder@your-domain.com>"
```

- 提示
  - 在 Resend 验证域名（建议 `send.` 子域）并配置 DNS
  - 发件人尽量友好（避免 `no-reply@`）
  - 邮件后台发送；Webhook 快速响应

完整指南：`/zh/blogs/email-service`（多语言可用）

---

## 故障排查

- MDX “Unknown module type”：检查 `next.config.ts` 中 Fumadocs 插件并重启
- `/zh` 显示英文：确认 `localePrefix = "always"` 与 `messages/zh.json`
- 文档 404：确认 `content/docs/<locale>/...` 路径与 URL slugs 保持一致

---

## Stripe

```bash
stripe login
stripe listen --forward-to localhost:3000/api/pay/callback/stripe
stripe trigger payment_intent.succeeded
```

---

## 许可协议

MIT。欢迎贡献。
