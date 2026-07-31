import Link from "next/link";

import { absoluteLocaleUrl } from "@/i18n/locale";
import { getAppEnv } from "@/lib/env";
import { getAdminIdentity } from "@admin/lib/authz";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export default async function AdminMfaRequiredPage() {
  const identity = await getAdminIdentity();
  const accountUrl = absoluteLocaleUrl(
    getAppEnv().NEXT_PUBLIC_WEB_URL,
    "en",
    "/me",
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Two-factor authentication required
          </h1>
          <CardDescription className="text-base leading-relaxed">
            Admin access requires two-factor authentication. Enable it from your
            account page, then return to the admin console.
          </CardDescription>
          {identity ? (
            <p className="text-sm text-muted-foreground">
              Signed in as {identity.email} ({identity.role}).
            </p>
          ) : null}
        </CardHeader>

        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={accountUrl}>Open account settings</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
