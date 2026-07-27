import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import LogoutButton from "@/components/auth/logout-button";
import FeedbackModal from "@/components/feedback/feedback-modal";
import TwoFactorSetupPanel from "@/components/auth/two-factor-setup-panel";
import { findUserByUuid } from "@/models/user";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/me",
    title: `Account | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

async function getSession() {
  const requestHeaders = await headers();
  return auth.api.getSession({
    headers: requestHeaders,
  });
}

export default async function ProfilePage() {
  const result = await getSession();

  if (!result) {
    redirect("/login");
  }

  const { user, session } = result;

  // The two-factor panel exists to satisfy the admin-console MFA requirement
  // (see apps/admin/lib/authz.ts). Regular users never reach that console, so
  // showing them the setup form is confusing noise — gate it on an admin role.
  //
  // Resolve the role from the database rather than the session copy: like the
  // admin authz path, the session field can be stale or absent, which would
  // silently hide the panel from a genuine admin.
  const userUuid = (user as any).uuid as string | undefined;
  const dbUser = userUuid ? await findUserByUuid(userUuid) : undefined;
  const role = dbUser?.role;
  const isAdmin = role === "admin_ro" || role === "admin_rw";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-2xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">
          You are signed in as {user.email}.
        </p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-3 text-sm">
          <div>
            <p className="font-medium text-muted-foreground">Name</p>
            <p>{user.name ?? "—"}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Email</p>
            <p>{user.email}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">User ID</p>
            <p>{user.id}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Email verified</p>
            <p>{user.emailVerified ? "Yes" : "No"}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Session created</p>
            <p>{session.createdAt.toISOString()}</p>
          </div>
        </div>
        <div className="flex items-center justify-between pt-4">
          <FeedbackModal />
          <LogoutButton />
        </div>
      </section>

      {isAdmin ? (
        <TwoFactorSetupPanel
          initialEnabled={Boolean((dbUser as any).two_factor_enabled)}
        />
      ) : null}
    </main>
  );
}
