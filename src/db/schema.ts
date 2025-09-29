import {
  pgTable,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Users table
export const users = pgTable(
  "users",
  {
    id: varchar({ length: 255 }).primaryKey(),
    uuid: varchar({ length: 255 }).notNull().unique(),
    email: varchar({ length: 255 }).notNull(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    nickname: varchar({ length: 255 }).notNull().default(""),
    avatar_url: varchar({ length: 255 }),
    locale: varchar({ length: 50 }),
    signin_type: varchar({ length: 50 }),
    signin_ip: varchar({ length: 255 }),
    signin_provider: varchar({ length: 50 }),
    signin_openid: varchar({ length: 255 }),
    invite_code: varchar({ length: 255 }).notNull().default(""),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    invited_by: varchar({ length: 255 }).notNull().default(""),
    is_affiliate: boolean().notNull().default(false),
    email_verified: boolean().notNull().default(false),
    // Role-based access control: "user" | "admin_ro" | "admin_rw"
    role: varchar({ length: 50 }).notNull().default("user"),
  },
  (table) => [
    uniqueIndex("email_provider_unique_idx").on(
      table.email,
      table.signin_provider
    ),
  ]
);

// Sessions table (Better Auth core)
export const sessions = pgTable(
  "sessions",
  {
    id: varchar({ length: 255 }).primaryKey(),
    user_id: varchar({ length: 255 }).notNull(),
    token: varchar({ length: 512 }).notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    ip_address: varchar({ length: 255 }),
    user_agent: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_unique_idx").on(table.token),
    index("sessions_user_id_idx").on(table.user_id),
  ]
);

// Accounts table (Better Auth core)
export const accounts = pgTable(
  "accounts",
  {
    id: varchar({ length: 255 }).primaryKey(),
    user_id: varchar({ length: 255 }).notNull(),
    account_id: varchar({ length: 255 }).notNull(),
    provider_id: varchar({ length: 255 }).notNull(),
    access_token: text(),
    refresh_token: text(),
    id_token: text(),
    scope: text(),
    password: text(),
    access_token_expires_at: timestamp({ withTimezone: true }),
    refresh_token_expires_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_unique_idx").on(
      table.provider_id,
      table.account_id
    ),
    index("accounts_user_id_idx").on(table.user_id),
  ]
);

// Verifications table (Better Auth core)
export const verifications = pgTable(
  "verifications",
  {
    id: varchar({ length: 255 }).primaryKey(),
    identifier: varchar({ length: 255 }).notNull(),
    value: text().notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("verifications_identifier_value_unique_idx").on(
      table.identifier,
      table.value
    ),
    index("verifications_expires_at_idx").on(table.expires_at),
  ]
);

// Orders table
export const orders = pgTable("orders", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  order_no: varchar({ length: 255 }).notNull().unique(),
  created_at: timestamp({ withTimezone: true }),
  user_uuid: varchar({ length: 255 }).notNull().default(""),
  user_email: varchar({ length: 255 }).notNull().default(""),
  amount: integer().notNull(),
  interval: varchar({ length: 50 }),
  expired_at: timestamp({ withTimezone: true }),
  status: varchar({ length: 50 }).notNull(),
  stripe_session_id: varchar({ length: 255 }),
  credits: integer().notNull(),
  currency: varchar({ length: 50 }),
  sub_id: varchar({ length: 255 }),
  sub_interval_count: integer(),
  sub_cycle_anchor: integer(),
  sub_period_end: integer(),
  sub_period_start: integer(),
  sub_times: integer(),
  product_id: varchar({ length: 255 }),
  product_name: varchar({ length: 255 }),
  valid_months: integer(),
  order_detail: text(),
  paid_at: timestamp({ withTimezone: true }),
  paid_email: varchar({ length: 255 }),
  paid_detail: text(),
});

// API Keys table
export const apikeys = pgTable("apikeys", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  api_key: varchar({ length: 255 }).notNull().unique(),
  title: varchar({ length: 100 }),
  user_uuid: varchar({ length: 255 }).notNull(),
  created_at: timestamp({ withTimezone: true }),
  status: varchar({ length: 50 }),
});

// Credits table
export const credits = pgTable("credits", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  trans_no: varchar({ length: 255 }).notNull().unique(),
  created_at: timestamp({ withTimezone: true }),
  user_uuid: varchar({ length: 255 }).notNull(),
  trans_type: varchar({ length: 50 }).notNull(),
  credits: integer().notNull(),
  order_no: varchar({ length: 255 }),
  expired_at: timestamp({ withTimezone: true }),
});

// Posts table
export const posts = pgTable("posts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uuid: varchar({ length: 255 }).notNull().unique(),
  slug: varchar({ length: 255 }),
  title: varchar({ length: 255 }),
  description: text(),
  content: text(),
  created_at: timestamp({ withTimezone: true }),
  updated_at: timestamp({ withTimezone: true }),
  status: varchar({ length: 50 }),
  cover_url: varchar({ length: 255 }),
  author_name: varchar({ length: 255 }),
  author_avatar_url: varchar({ length: 255 }),
  locale: varchar({ length: 50 }),
});

// Affiliates table
export const affiliates = pgTable("affiliates", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_uuid: varchar({ length: 255 }).notNull(),
  created_at: timestamp({ withTimezone: true }),
  status: varchar({ length: 50 }).notNull().default(""),
  invited_by: varchar({ length: 255 }).notNull(),
  paid_order_no: varchar({ length: 255 }).notNull().default(""),
  paid_amount: integer().notNull().default(0),
  reward_percent: integer().notNull().default(0),
  reward_amount: integer().notNull().default(0),
});

// Feedbacks table
export const feedbacks = pgTable("feedbacks", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp({ withTimezone: true }),
  status: varchar({ length: 50 }),
  user_uuid: varchar({ length: 255 }),
  content: text(),
  rating: integer(),
});

// Reservation Services (demo feature)
export const reservationServices = pgTable(
  "reservation_services",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: varchar({ length: 255 }).notNull().unique(),
    title: varchar({ length: 255 }).notNull(),
    description: text(),
    duration_min: integer().notNull().default(30),
    price: integer().notNull().default(0), // cents
    currency: varchar({ length: 10 }).notNull().default("usd"),
    deposit_amount: integer().notNull().default(0), // cents
    require_deposit: boolean().notNull().default(true),
    cancellation_window_hours: integer().notNull().default(24),
    buffer_before_min: integer().notNull().default(0),
    buffer_after_min: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reservation_services_active_idx").on(table.active),
  ]
);

// Reservations (demo feature)
export const reservations = pgTable(
  "reservations",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    reservation_no: varchar({ length: 255 }).notNull().unique(),
    user_uuid: varchar({ length: 255 }).notNull(),
    service_id: integer().notNull(),
    start_at: timestamp({ withTimezone: true }).notNull(),
    end_at: timestamp({ withTimezone: true }).notNull(),
    timezone: varchar({ length: 64 }).notNull(),
    status: varchar({ length: 32 }).notNull().default("pending"), // pending|confirmed|canceled|expired
    hold_expires_at: timestamp({ withTimezone: true }),
    order_no: varchar({ length: 255 }),
    contact_email: varchar({ length: 255 }),
    contact_phone: varchar({ length: 64 }),
    notes: text(),
    policy_snapshot: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reservations_service_time_idx").on(table.service_id, table.start_at),
    index("reservations_user_idx").on(table.user_uuid),
  ]
);
