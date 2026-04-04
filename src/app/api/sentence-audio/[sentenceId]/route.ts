import { getCurrentUser } from "@/lib/auth";
import { getOrCreateSentenceAudio } from "@/lib/sentence-translation";

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

  const audio = await getOrCreateSentenceAudio({ sentenceId });

  if (!audio) {
    return new Response("Audio not found", { status: 404 });
  }

  return new Response(new Uint8Array(audio.audio), {
    status: 200,
    headers: {
      "Content-Type": audio.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
