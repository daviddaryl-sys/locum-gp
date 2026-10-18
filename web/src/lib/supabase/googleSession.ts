interface GoogleSessionAuth {
  exchangeCodeForSession(code: string): Promise<{
    data: {
      session: {
        access_token: string;
        refresh_token: string;
      } | null;
    };
    error: unknown;
  }>;
  setSession(tokens: {
    access_token: string;
    refresh_token: string;
  }): Promise<{
    data: { session: unknown | null };
    error: unknown;
  }>;
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
}

function missingSessionError() {
  return new Error("A provider-free Supabase session was not persisted.");
}

async function clearUnsafeSession(auth: GoogleSessionAuth) {
  // Local scope removes persisted storage even when server-side revocation
  // returns an auth error, and the SSR adapter then deletes every cookie chunk.
  await auth.signOut({ scope: "local" });
}

export async function exchangeGoogleCodeForProviderFreeSession(
  auth: GoogleSessionAuth,
  code: string,
): Promise<{ error: unknown | null }> {
  const exchange = await auth.exchangeCodeForSession(code);

  if (exchange.error) {
    return { error: exchange.error };
  }

  const session = exchange.data.session;
  if (!session?.access_token || !session.refresh_token) {
    if (session) {
      await clearUnsafeSession(auth);
    }
    return { error: missingSessionError() };
  }

  let persisted: Awaited<ReturnType<GoogleSessionAuth["setSession"]>>;
  try {
    persisted = await auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  } catch (error) {
    await clearUnsafeSession(auth);
    return { error };
  }

  if (persisted.error) {
    await clearUnsafeSession(auth);
    return { error: persisted.error };
  }

  if (!persisted.data.session) {
    const error = missingSessionError();
    await clearUnsafeSession(auth);
    return { error };
  }

  return { error: null };
}
