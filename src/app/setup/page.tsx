import { isSupabaseConfigured } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">FRADY OS needs a Supabase project</h1>
      <p className="text-muted-foreground text-sm">
        The app could not find <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. Copy <code>.env.example</code> to{" "}
        <code>.env.local</code>, fill in your project values, apply the migrations in{" "}
        <code>supabase/migrations</code>, and restart the server.
      </p>
      <p className="text-muted-foreground text-sm">See the README for step-by-step setup.</p>
    </main>
  );
}
