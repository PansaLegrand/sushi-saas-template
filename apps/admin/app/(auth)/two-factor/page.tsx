import { AdminTwoFactorForm } from "@admin/components/admin-two-factor-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export default function AdminTwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Confirm it’s you
          </h1>
          <CardDescription className="text-base">
            Enter your authenticator code to finish signing in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminTwoFactorForm />
        </CardContent>
      </Card>
    </main>
  );
}
