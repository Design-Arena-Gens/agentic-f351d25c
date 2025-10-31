import { NextResponse } from "next/server";
import { gatherNews } from "@/lib/news";
import { SearchPayload } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SearchPayload;
    const results = await gatherNews(
      payload.keywords.filter((kw) => kw.keyword.trim().length > 0),
      payload.companyTargets.filter(
        (target) => target.url.trim().length > 0,
      ),
      payload.timeRange,
      payload.maxItems ?? 100,
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Failed to run search", error);
    return NextResponse.json(
      { error: "Unable to gather news results." },
      { status: 500 },
    );
  }
}
