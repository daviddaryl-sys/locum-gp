import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.LOCUM_E2E_AUTH_BYPASS === "responsive-shell" &&
    request.headers.get("x-locum-e2e-auth") === "responsive-shell"
  ) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const client = await createClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Sign out could not be completed." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
