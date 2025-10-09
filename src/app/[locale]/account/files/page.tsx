import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Uploader from "@/components/storage/uploader";
import FilesList from "@/components/storage/files-list";

async function getSession() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export default async function FilesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-4xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">My Files</h1>
        <p className="text-sm text-muted-foreground">Upload materials privately. Only you can access them.</p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
        <Uploader />
        <div className="border-t pt-6">
          <FilesList />
        </div>
      </section>
    </main>
  );
}
