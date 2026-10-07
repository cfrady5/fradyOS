import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { isSignupAllowed } from "./actions";
import { Wordmark } from "@/components/app/wordmark";

export const metadata: Metadata = { title: "Sign in · FRADY OS" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const allowSignup = await isSignupAllowed();
  return (
    <main className="bg-surface-0 flex min-h-svh flex-col px-4 py-8 sm:items-center sm:justify-center">
      <div className="motion-safe:animate-page-in w-full max-w-sm sm:mx-auto">
        <div className="mb-8">
          <Wordmark size="md" />
          <p className="eyebrow mt-6 mb-2">Personal command center</p>
          <h1 className="text-display text-text-1">Welcome back.</h1>
          <p className="text-text-2 mt-2 text-sm">Sign in to pick up where you left off.</p>
        </div>
        <LoginForm initialError={error} next={next} allowSignup={allowSignup} />
      </div>
    </main>
  );
}
