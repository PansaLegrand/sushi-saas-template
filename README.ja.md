# Sushi SaaS 🍣

SaaS をより速くリリース — i18n、認証、決済、クレジット、アフィリエイト、MDX ドキュメント、管理ツールを備えたプロダクション向けスターター。

**言語**: [English](./README.md) | [Français](./README.fr.md) | [Español](./README.es.md) | 日本語 | [中文](./README.zh.md)

**Sushi SaaS を選ぶ理由**

- 収益化に直結: Stripe Checkout + クレジット台帳（従量課金に最適）。
- 強い認証: Better Auth + Postgres（Drizzle で型安全・移行容易）。
- 多言語を前提: next‑intl のルーティングとローカライズ済みコンテンツ。
- 成長導線: 招待・アフィリエイトと柔軟な報酬設定。
- コンテンツと SEO: MDX → メタデータ + JSON‑LD を自動生成。
- 管理と RBAC: サーバー保護の管理画面（閲覧専用 / 変更可）。
- 開発体験: pnpm、Turbopack/Webpack、型付き設定、ESLint/Tailwind。
- 運用面: ヘルスチェック、環境テンプレート、明示的なマイグレーション。

---

## ショーケース

- DojoClip — https://dojoclip.com — ブラウザで動く動画編集。多言語字幕に強み。

- Sushi Templates — https://sushi-templates.com — Vercel にデプロイしたときの本サイトの見え方をご確認ください。

---

## 連絡先

このテンプレートを用いたカスタマイズやローンチ支援（実装・機能追加・アドバイザリー）を承ります。プロダクション向けの SaaS を日々構築・出荷しています。

- 対応言語: 日本語、英語、フランス語、中国語
- Email: pansalegrand@gmail.com

---

## コントリビューター向けガイド

変更前に、[Repository Guidelines](./AGENTS.md) を読んで構成・フロー・レビュー方針をご確認ください。

---

## クイックスタート

前提: Node 20+, pnpm 9+

次に、セットアップ手順はこちら:
https://www.sushi-templates.com/ja/blogs/quick-start


---

## プロジェクト構成

```
src/
├─ app/
│  ├─ [locale]/
│  │  ├─ page.tsx           # ランディング (i18n)
│  │  └─ (seo)/blogs/       # MDX ドキュメント (Fumadocs)
│  │     ├─ [[...slug]]/page.tsx
│  │     └─ layout.tsx
│  ├─ api/
│  │  ├─ health/route.ts    # ヘルスエンドポイント
│  │  └─ auth/[...all]/route.ts # Better Auth ハンドラ
│  ├─ globals.css           # Tailwind + テーマ
│  └─ layout.tsx            # ルートレイアウト
├─ i18n/
│  ├─ locale.ts             # locales, defaultLocale, prefix
│  ├─ request.ts            # next-intl 設定
│  ├─ routing.ts            # ルーティングヘルパ
│  └─ navigation.ts         # locale 対応 Link/router
├─ lib/
│  ├─ auth.ts               # Better Auth サーバ設定
│  └─ utils.ts              # 小さなヘルパ
├─ providers/
│  ├─ theme.tsx             # テーマ + Toaster + グローバル Provider
│  ├─ google-analytics.tsx  # GA (本番のみ)
│  └─ affiliate-init.tsx    # アトリビューション確定用フック
└─ contexts/
   └─ app.tsx               # アプリレベルの Provider (placeholder)

content/
└─ docs/<locale>/...        # MDX コンテンツ (/:locale/blogs/...)

messages/
└─ <locale>.json            # ランディング + メタの翻訳
```

---

## 国際化

next‑intl v4 を使用。

- ルーティング設定: `src/i18n/locale.ts`
- メッセージ読み込み: `src/i18n/request.ts`
- Middleware: `src/middleware.ts`（`localePrefix: "always"`）
- メッセージ: `messages/*.json`

言語を追加:

1) `messages/<locale>.json` を作成
2) `src/i18n/locale.ts` の `locales` に追加
3) 必要なら `content/docs/<locale>` に MDX を追加
4) dev を再起動

---

## Docs & MDX (Fumadocs)

- コンテンツ: `content/docs/<locale>/...`
- ルート: `/:locale/blogs/<slugs>`
- 開発時に `.source/index.ts` を自動生成
- Next プラグインで MDX をパース

ページ作成:

```bash
mkdir -p content/docs/ja
cat > content/docs/ja/マイページ.mdx <<'MDX'
---
title: マイページ
---

# こんにちは
MDX
```

`/ja/blogs/マイページ` を開く。

スタイル

- Blogs セグメントは `fumadocs-ui/css/style.css` を読み込み、`DocsLayout` でラップします。
- `fumadocs-ui/css/*.css` を読み込んでテーマを切り替え可能。

---

## 認証 (Better Auth)

Better Auth はサーバー API と UI フロー（サインアップ/ログイン/プロフィール）を提供します。

- サーバ設定: `src/lib/auth.ts`
- API ルート: `src/app/api/auth/[...all]/route.ts`
- クライアントヘルパ: `src/lib/auth-client.ts`
- UI ルート: `/:locale/login`, `/:locale/signup`, `/:locale/me`
- 有効なエンドポイント: Email & Password（セッションは Postgres）

環境変数:

```env
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_BASE_URL=http://localhost:3000
```

### データベース設定

Better Auth は Drizzle 経由で Postgres に users/sessions/accounts/verifications を保存します。

1. `.env` に `DATABASE_URL` を定義
2. スキーマ変更後に SQL を生成:

   ```bash
   pnpm drizzle-kit generate --config src/db/config.ts
   ```

3. マイグレーションを適用:

   ```bash
   pnpm drizzle-kit migrate --config src/db/config.ts
   ```

4. dev サーバーを再起動

完全ガイド: `/ja/blogs/database-setup`

---

## アフィリエイト / リファラル

紹介登録や購入に報酬を与える仕組みを有効化。

- リンク: `/:locale/i/<inviteCode>` が 30 日の `ref` Cookie を設定しリダイレクト。
- ログイン/登録後に `/api/affiliate/update-invite` で確定。
- 支払い時の報酬は `src/services/affiliate.ts`（固定/％/ハイブリッド、注文単位で重複防止）。
- ユーザー: `/:locale/my-invites`、管理: `/admin/affiliates`。

設定: `src/data/affiliate.ts`

- プログラム: `enabled`, `attributionWindowDays`, `allowSelfReferral`, `attributionModel`
- 報酬: `commissionMode`（fixed_only | percent_only | greater_of | sum）、`signup`, `paid`
- 支払い種別: `payoutType = "cash"`（最小単位） or `"credits"`（アプリ内クレジット）
- 共有パス: `sharePath`（デフォルト `/i`）、ベース URL は `NEXT_PUBLIC_WEB_URL`

ローカル検証

1. `/:locale/my-invites` を開きリンクをコピー
2. シークレットウィンドウで登録 → 戻って確認
3. Stripe テスト決済を実行し、管理画面で報酬を確認

注意

- `NEXT_PUBLIC_WEB_URL` がローカルのオリジンと一致していること
- クライアントフックは 200 で成功マーク。ログイン前に発火した場合は後で再試行

---

## ヘルスチェック

`GET /api/health` はステータス・タイムスタンプ・環境を返します。

---

## スクリプト

- `pnpm dev` – MDX マップ生成 + Next（Turbopack）
- `pnpm dev:webpack` – Webpack で起動
- `pnpm build` / `pnpm start` – 本番ビルド＆起動

---

## メール (Resend)

Resend を使ったトランザクションメール統合。

- コード
  - サービス: `src/services/email/send.ts`
  - テンプレ: `src/services/email/templates/*`
  - トリガ: ユーザー作成時の歓迎、Stripe Webhook の決済成功
- 環境

```env
RESEND_API_KEY=...
EMAIL_FROM="Your Name <founder@your-domain.com>"
```

- メモ
  - Resend でドメインを検証（`send.` サブドメイン推奨）
  - 送り主はフレンドリーに（`no-reply@` は避ける）
  - メール送信はバックグラウンド、Webhook 応答は迅速

完全ガイド: `/ja/blogs/email-service`（他言語版あり）

---

## トラブルシュート

- MDX “Unknown module type”: `next.config.ts` の Fumadocs プラグインを確認し再起動。
- `/zh` が英語表示: `localePrefix = "always"` と `messages/zh.json` を確認。
- Docs 404: `content/docs/<locale>/...` のパスとスラッグを確認。

---

## Stripe

```bash
stripe login
stripe listen --forward-to localhost:3000/api/pay/callback/stripe
stripe trigger payment_intent.succeeded
```

---

## ライセンス

MIT. コントリビューション歓迎。
