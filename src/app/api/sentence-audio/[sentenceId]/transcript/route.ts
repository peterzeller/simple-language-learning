import { getCurrentUser } from "@/lib/auth";
import { getOrCreateSentenceWordTimestamps } from "@/lib/sentence-translation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sentenceId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { sentenceId: sentenceIdParam } = await params;
  const sentenceId = Number(sentenceIdParam);

  if (!Number.isFinite(sentenceId) || sentenceId <= 0) {
    return new Response("Invalid sentence id", { status: 400 });
  }

  const words = await getOrCreateSentenceWordTimestamps({ sentenceId, userId: user.id });

  return Response.json({ words });
}
