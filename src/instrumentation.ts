export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { initializeDatabase } = await import("./lib/db");
  const { fillMissingSentenceTitlesAtStartup } = await import("./lib/sentence-translation");

  await runStartupTask("initialize-database", initializeDatabase);
  await runStartupTask("fill-missing-sentence-titles", fillMissingSentenceTitlesAtStartup);
}

async function runStartupTask(taskName: string, task: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();

  try {
    await task();
    console.info("[startup] Task completed", {
      taskName,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[startup] Task failed", {
      taskName,
      durationMs: Date.now() - startedAt,
      error,
    });
  }
}
