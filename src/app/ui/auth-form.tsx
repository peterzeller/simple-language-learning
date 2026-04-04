"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  INITIAL_AUTH_FORM_STATE,
  type AuthFormState,
} from "@/app/auth-form-state";
import styles from "@/app/auth.module.css";

type Action = (
  prevState: AuthFormState,
  formData: FormData,
) => Promise<AuthFormState>;

interface AuthFormProps {
  action: Action;
  submitLabel: string;
  title: string;
  description: string;
  alternateHref: string;
  alternateLabel: string;
  alternateText: string;
  appName: string;
  emailLabel: string;
  passwordLabel: string;
  workingLabel: string;
  isRegister: boolean;
}

export function AuthForm({
  action,
  submitLabel,
  title,
  description,
  alternateHref,
  alternateLabel,
  alternateText,
  appName,
  emailLabel,
  passwordLabel,
  workingLabel,
  isRegister,
}: AuthFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <section className={styles.card}>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{appName}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <form className={styles.form} action={formAction}>
        <label className={styles.field}>
          <span>{emailLabel}</span>
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label className={styles.field}>
          <span>{passwordLabel}</span>
          <input
            type="password"
            name="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </label>
        {state.error ? (
          <p className={styles.error} role="alert">
            {state.error}
          </p>
        ) : null}
        <button className={styles.primaryButton} type="submit" disabled={pending}>
          {pending ? workingLabel : submitLabel}
        </button>
      </form>
      <p className={styles.helperText}>
        {alternateText} <Link href={alternateHref}>{alternateLabel}</Link>
      </p>
    </section>
  );
}
