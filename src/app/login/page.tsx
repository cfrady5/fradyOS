import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · FRADY OS" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
            F
          </div>
          <h1 className="text-xl font-semibold tracking-tight">FRADY OS</h1>
          <p className="text-muted-foreground mt-1 text-sm">Your private workspace. Sign in to continue.</p>
        </div>
        <LoginForm initialError={error} next={next} />
      </div>
    </main>
  );
}
