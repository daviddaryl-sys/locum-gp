import { NextResponse } from "next/server";

export function relativeRedirect(destination: string) {
  return new NextResponse(null, {
    status: 307,
    headers: { location: destination },
  });
}
