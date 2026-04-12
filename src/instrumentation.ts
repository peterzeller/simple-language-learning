export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { initializeDatabase } = await import("./lib/db");
  const { fillMissingSentenceTitlesAtStartup } = await import("./lib/sentence-translation");

  await initializeDatabase();
  await fillMissingSentenceTitlesAtStartup();
}
