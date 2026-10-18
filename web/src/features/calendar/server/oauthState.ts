import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { safeReturnPath } from "@/lib/navigation/returnPath";

import { readCalendarConfig } from "./config";
import {
  createOAuthStateStore,
  type OAuthStateStore,
} from "./oauthStateRepository";
import {
  decryptSecret,
  encryptSecret,
  type SecretEnvelopeV1,
} from "./secretEnvelope";

const STATE_LIFETIME_MS = 10 * 60 * 1000;
const STATE_ERROR = "Google authorization state is invalid.";

type OAuthStatePayload = {
  ownerId: string;
  state: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
};

type OAuthStateOptions = {
  key?: Buffer;
  nowMs?: number;
  state?: string;
  verifier?: string;
  store?: OAuthStateStore;
};

function tokenKey(options: OAuthStateOptions) {
  return options.key ?? readCalendarConfig().tokenKey;
}

function stateStore(options: OAuthStateOptions) {
  return options.store ?? createOAuthStateStore();
}

function isExactString(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function stateDigest(state: string) {
  return createHash("sha256").update(state).digest("base64url");
}

function encodeEnvelope(envelope: SecretEnvelopeV1) {
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

function decodeEnvelope(value: string): SecretEnvelopeV1 {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error();

  const parsed = JSON.parse(decoded.toString("utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== 1 ||
    typeof parsed.iv !== "string" ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.tag !== "string"
  ) {
    throw new Error();
  }
  return parsed as SecretEnvelopeV1;
}

function readPayload(value: string): OAuthStatePayload {
  const parsed = JSON.parse(value) as Partial<OAuthStatePayload>;
  if (
    !parsed ||
    typeof parsed.ownerId !== "string" ||
    !parsed.ownerId ||
    typeof parsed.state !== "string" ||
    !parsed.state ||
    typeof parsed.verifier !== "string" ||
    !parsed.verifier ||
    typeof parsed.returnTo !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    !Number.isSafeInteger(parsed.expiresAt)
  ) {
    throw new Error();
  }
  return parsed as OAuthStatePayload;
}

export async function createOAuthState(
  ownerId: string,
  returnTo: string,
  options: OAuthStateOptions = {},
) {
  try {
    if (!ownerId || safeReturnPath(returnTo) !== returnTo) throw new Error();

    const nowMs = options.nowMs ?? Date.now();
    const state = options.state ?? randomBytes(32).toString("base64url");
    const verifier = options.verifier ?? randomBytes(32).toString("base64url");
    if (!state || !verifier || !Number.isSafeInteger(nowMs)) throw new Error();

    const expiresAt = nowMs + STATE_LIFETIME_MS;
    const payload: OAuthStatePayload = {
      ownerId,
      state,
      verifier,
      returnTo,
      expiresAt,
    };
    const sealedState = encodeEnvelope(
      encryptSecret(JSON.stringify(payload), tokenKey(options), "oauth-state"),
    );

    await stateStore(options).register({
      ownerId,
      stateDigest: stateDigest(state),
      expiresAt,
    });

    return {
      state,
      codeChallenge: createHash("sha256")
        .update(verifier)
        .digest("base64url"),
      sealedState,
    };
  } catch {
    throw new Error(STATE_ERROR);
  }
}

export async function consumeOAuthState(
  sealedState: string,
  returnedState: string,
  ownerId: string,
  options: OAuthStateOptions = {},
) {
  try {
    const nowMs = options.nowMs ?? Date.now();
    const payload = readPayload(
      decryptSecret(
        decodeEnvelope(sealedState),
        tokenKey(options),
        "oauth-state",
      ),
    );
    if (
      !isExactString(payload.state, returnedState) ||
      !isExactString(payload.ownerId, ownerId) ||
      payload.expiresAt <= nowMs ||
      safeReturnPath(payload.returnTo) !== payload.returnTo
    ) {
      throw new Error();
    }

    const claimed = await stateStore(options).claim({
      ownerId,
      stateDigest: stateDigest(payload.state),
      nowMs,
    });
    if (!claimed) throw new Error();

    return { verifier: payload.verifier, returnTo: payload.returnTo };
  } catch {
    throw new Error(STATE_ERROR);
  }
}
