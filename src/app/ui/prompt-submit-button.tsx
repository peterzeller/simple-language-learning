"use client";

import { useFormStatus } from "react-dom";

import styles from "@/app/auth.module.css";

interface PromptSubmitButtonProps {
  action: (formData: FormData) => void | Promise<void>;
}

export function PromptSubmitButton({ action }: PromptSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.primaryButton} disabled={pending} formAction={action} type="submit">
      <span className={styles.buttonContent}>
        {pending && <span aria-hidden="true" className={styles.inlineSpinner} />}
        {pending ? "Generating sentence..." : "Create sentence from prompt"}
      </span>
    </button>
  );
}
