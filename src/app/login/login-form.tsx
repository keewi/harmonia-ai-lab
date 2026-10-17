"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { btn, field, label } from "@/components/ui";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="password" className={label}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className={field}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "password-error" : undefined}
        />
        {state.error ? (
          <p id="password-error" className="mt-1.5 text-sm text-brand">
            {state.error}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={`${btn.primary} w-full`}>
        {pending ? "Checking…" : "Enter the lab"} <ArrowRight size={16} aria-hidden />
      </button>
    </form>
  );
}
