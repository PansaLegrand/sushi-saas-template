import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import LogoutButton from "@/components/auth/logout-button";
import FeedbackModal from "@/components/feedback/feedback-modal";

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
    </main>
  );
}
