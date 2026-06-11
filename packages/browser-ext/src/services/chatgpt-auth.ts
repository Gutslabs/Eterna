/**
 * ChatGPT (Codex subscription) OAuth client.
 *
 * Authenticates with the user's ChatGPT Plus/Pro account using OpenAI's Codex
 * OAuth flow so model calls are billed to their subscription instead of a
 * separate API key. Reuses the public Codex client id and talks to the
 * undocumented chatgpt.com/backend-api/codex backend, which may change.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const STORAGE_KEY = "chatgpt_oauth";
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface ChatGptAuth {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generatePkce(): Promise<PkcePair> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

export function createState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");
  return url.toString();
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payloadPart = parts[1];
  if (parts.length !== 3 || !payloadPart) return null;
  try {
    let base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) base64 += "=";
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function extractAccountId(...tokens: Array<string | undefined>): string | null {
  for (const token of tokens) {
    if (!token) continue;
    const payload = decodeJwt(token);
    const claim = payload?.[JWT_CLAIM_PATH] as
      | { chatgpt_account_id?: string }
      | undefined;
    if (claim?.chatgpt_account_id) return claim.chatgpt_account_id;
  }
  return null;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse | null> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      console.error("[chatgpt-auth] token request failed:", response.status);
      return null;
    }
    return (await response.json()) as TokenResponse;
  } catch (error) {
    console.error("[chatgpt-auth] token request error:", error);
    return null;
  }
}

export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<ChatGptAuth | null> {
  const json = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  );
  if (!json?.access_token || typeof json.expires_in !== "number") return null;

  const accountId = extractAccountId(json.id_token, json.access_token);
  if (!accountId) {
    console.error("[chatgpt-auth] could not extract account id from token");
    return null;
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? "",
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

async function refreshTokens(
  current: ChatGptAuth,
): Promise<ChatGptAuth | null> {
  const json = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: current.refresh,
    }),
  );
  if (!json?.access_token || typeof json.expires_in !== "number") return null;
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? current.refresh,
    expires: Date.now() + json.expires_in * 1000,
    accountId:
      extractAccountId(json.id_token, json.access_token) ?? current.accountId,
  };
}

export async function getStoredAuth(): Promise<ChatGptAuth | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as ChatGptAuth | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function setStoredAuth(auth: ChatGptAuth): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: auth });
}

export async function clearStoredAuth(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function isSignedIn(): Promise<boolean> {
  return (await getStoredAuth()) !== null;
}

/**
 * Return a usable access token, refreshing it first if it is expired or about
 * to expire. Clears stored auth and returns null when refresh is impossible.
 */
export async function getValidAccessToken(): Promise<{
  accessToken: string;
  accountId: string;
} | null> {
  const auth = await getStoredAuth();
  if (!auth) return null;

  if (auth.expires - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return { accessToken: auth.access, accountId: auth.accountId };
  }

  if (!auth.refresh) {
    await clearStoredAuth();
    return null;
  }

  const refreshed = await refreshTokens(auth);
  if (!refreshed) {
    await clearStoredAuth();
    return null;
  }
  await setStoredAuth(refreshed);
  return { accessToken: refreshed.access, accountId: refreshed.accountId };
}
