import Link from "next/link";

import styles from "@/app/auth.module.css";
import { updateUserOpenAiLimit } from "@/app/admin/actions";
import { ensureUsersTable, getDb } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin-auth";

interface AdminUsersPageProps {
  searchParams: Promise<{ saved?: string }>;
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  await requireAdminUser();
  await ensureUsersTable();
  const db = getDb();
  const params = await searchParams;

  const users = await db
    .selectFrom("users")
    .select(["id", "email", "openai_monthly_limit_usd", "openai_api_key"])
    .orderBy("id", "asc")
    .execute();

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Admin</span>
        <h1>User OpenAI budgets</h1>
        <p>Set monthly OpenAI spending limits for platform keys (defaults to 0 for new users).</p>

        {params.saved === "1" ? <p className={styles.helperText}>Saved.</p> : null}

        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>User</th>
                <th>Platform limit (USD)</th>
                <th>Own API key</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    <form className={styles.topicActions} action={updateUserOpenAiLimit}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="number"
                        name="openAiMonthlyLimitUsd"
                        min="0"
                        step="0.01"
                        defaultValue={user.openai_monthly_limit_usd}
                      />
                      <button className={styles.primaryButton} type="submit">Save</button>
                    </form>
                  </td>
                  <td>{user.openai_api_key ? "Configured" : "Not set"}</td>
                  <td>User #{user.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.topicActions}>
          <Link className={styles.helperLink} href="/admin">
            ← Back to admin
          </Link>
          <Link className={styles.helperLink} href="/">
            ← Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}

