import crypto from 'crypto';
import http from 'http';
import path from 'path';
import os from 'os';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import open from 'open';
import type { TokenResponse } from '../types.js';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTH_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI_BASE = 'http://localhost';
const SCOPES = 'org:create_api_key user:profile user:inference';
const TOKEN_DIR = path.join(os.homedir(), '.imugi');
const TOKEN_PATH = path.join(TOKEN_DIR, 'auth.json');

export type AuthResult =
  | { type: 'api_key'; apiKey: string }
  | { type: 'oauth'; token: TokenResponse };

export function generateCodeVerifier(): string {
  return crypto
    .randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function startCallbackServer(): Promise<{
  port: number;
  codePromise: Promise<string>;
  close: () => void;
}> {
  return new Promise((resolveServer) => {
    const server = http.createServer();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
      }
    }, 5 * 60 * 1000);

    const codePromise = new Promise<string>((resolveCode, rejectCode) => {
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`);
        const code = url.searchParams.get('code');

        if (code && !settled) {
          settled = true;
          clearTimeout(timeout);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Login successful</h1><p>You can close this tab.</p></body></html>');
          server.close();
          resolveCode(code);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code parameter');
        }
      });

      server.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          rejectCode(err);
        }
      });
    });

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolveServer({
        port,
        codePromise,
        close: () => {
          clearTimeout(timeout);
          server.close();
        },
      });
    });
  });
}

export async function openAuthorizationUrl(
  codeChallenge: string,
  callbackPort: number,
): Promise<void> {
  const redirectUri = `${REDIRECT_URI_BASE}:${callbackPort}/callback`;
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', SCOPES);
  await open(url.toString());
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  callbackPort: number,
): Promise<TokenResponse> {
  const redirectUri = `${REDIRECT_URI_BASE}:${callbackPort}/callback`;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function saveToken(token: TokenResponse): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true });
  const data = { ...token, saved_at: Date.now() };
  await writeFile(TOKEN_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function loadStoredToken(): Promise<TokenResponse | null> {
  try {
    const content = await readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(content) as TokenResponse;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function isTokenExpired(token: TokenResponse): boolean {
  if (!token.saved_at) return true;
  const expiresAt = token.saved_at + token.expires_in * 1000;
  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= expiresAt - bufferMs;
}

export async function ensureAuthenticated(
  apiKey?: string | null,
): Promise<AuthResult> {
  if (apiKey) {
    return { type: 'api_key', apiKey };
  }

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return { type: 'api_key', apiKey: envKey };
  }

  const stored = await loadStoredToken();

  if (stored && !isTokenExpired(stored)) {
    return { type: 'oauth', token: stored };
  }

  if (stored?.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(stored.refresh_token);
      await saveToken(refreshed);
      return { type: 'oauth', token: refreshed };
    } catch {
      // refresh failed, fall through to full flow
    }
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const { port, codePromise, close } = await startCallbackServer();

  try {
    await openAuthorizationUrl(challenge, port);
    const code = await codePromise;
    const token = await exchangeCodeForToken(code, verifier, port);
    await saveToken(token);
    return { type: 'oauth', token };
  } catch (err) {
    close();
    throw err;
  }
}

export function createAuthenticatedFetch(
  auth: AuthResult,
): typeof globalThis.fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);

    if (auth.type === 'api_key') {
      headers.set('x-api-key', auth.apiKey);
      headers.delete('authorization');
    } else {
      headers.set('authorization', `Bearer ${auth.token.access_token}`);
      headers.set('anthropic-beta', 'oauth-2025-04-20');
      headers.delete('x-api-key');
    }

    return globalThis.fetch(input, { ...init, headers });
  };
}

export async function logout(): Promise<void> {
  try {
    await unlink(TOKEN_PATH);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}
