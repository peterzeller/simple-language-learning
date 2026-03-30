import Link from "next/link";

import { redirectLoggedInUsers, register } from "@/app/actions";
import styles from "@/app/auth.module.css";
import { AuthForm } from "@/app/ui/auth-form";

export default async function RegisterPage() {
  await redirectLoggedInUsers();

  return (
    <main className={styles.page}>
      <AuthForm
        action={register}
        submitLabel="Create account"
        title="Create your account"
        description="Start with just an email address and password. We’ll keep the rest lightweight."
        alternateHref="/"
        alternateLabel="Log in"
        alternateText="Already registered?"
      />
      <Link href="/" hidden>
        Back to login
      </Link>
    </main>
  );
}

