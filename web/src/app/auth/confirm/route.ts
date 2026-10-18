import type { EmailOtpType } from "@supabase/supabase-js";

import { relativeRedirect } from "@/lib/navigation/relativeRedirect";
import { safeReturnPath } from "@/lib/navigation/returnPath";
import { exchangeGoogleCodeForProviderFreeSession } from "@/lib/supabase/googleSession";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

function noStoreRedirect(destination: string) {
  const response = relativeRedirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function logGoogleFailure(stage: "provider" | "session" | "unexpected") {
  console.warn("Google authentication callback failed.", { stage });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const isGoogle = requestUrl.searchParams.get("provider") === "google";
  const providerError = requestUrl.searchParams.get("error");

  if (isGoogle && providerError) {
    logGoogleFailure("provider");
    return noStoreRedirect("/login?error=google-sign-in");
  }

  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const rawType = requestUrl.searchParams.get("type");
  const next = safeReturnPath(requestUrl.searchParams.get("next"));

  try {
    const supabase = await createClient();
    let error: unknown;

    if (code) {
      if (isGoogle) {
        ({ error } = await exchangeGoogleCodeForProviderFreeSession(
          supabase.auth,
          code,
        ));
      } else {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      }
    } else if (
      tokenHash &&
      rawType &&
      EMAIL_OTP_TYPES.has(rawType as EmailOtpType)
    ) {
      ({ error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: rawType as EmailOtpType,
      }));
    } else {
      error = new Error("Missing authentication callback parameters.");
    }

    if (!error) {
      return noStoreRedirect(next);
    }
    if (isGoogle) {
      logGoogleFailure("session");
    }
  } catch {
    // Configuration and provider errors use the same public failure path.
    if (isGoogle) {
      logGoogleFailure("unexpected");
    }
  }

  return noStoreRedirect(
    `/login?error=${isGoogle ? "google-sign-in" : "expired-link"}`,
  );
}
