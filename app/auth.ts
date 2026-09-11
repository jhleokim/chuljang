import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, aliasFor, readSessionToken, userIdFor } from '@/lib/session';
import { authSecret, trustsPlatformAuth, userAliases } from '@/lib/auth-config';
import { signInPath } from '@/lib/auth-paths';

export type AppUser={
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const PLATFORM_USER_ID_HEADER = "oai-authenticated-user-id";
const PLATFORM_USER_EMAIL_HEADER = "oai-authenticated-user-email";
const PLATFORM_USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const PLATFORM_USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

export async function getUser(): Promise<AppUser | null> {
  const requestHeaders = await headers();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const secret = authSecret(requestHeaders.get("host"));
    const session = secret ? await readSessionToken(secret, token) : null;
    if (session) {
      const userId =
        aliasFor(session.email, userAliases()) ?? (await userIdFor(session.email));
      return {
        userId,
        displayName: session.name ?? session.email,
        email: session.email,
        fullName: session.name,
      };
    }
  }
  return platformUser(requestHeaders);
}

// 기존 ChatGPT Sites 배포를 이어서 쓰는 경우에만 플랫폼이 넣어 주는 헤더를 신뢰한다.
function platformUser(requestHeaders: Headers): AppUser | null {
  if (!trustsPlatformAuth()) return null;

  const userId = requestHeaders.get(PLATFORM_USER_ID_HEADER);
  const email = requestHeaders.get(PLATFORM_USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(PLATFORM_USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(PLATFORM_USER_FULL_NAME_ENCODING_HEADER) ===
      PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return { userId, displayName: fullName ?? email, email, fullName };
}

export async function requireUser(returnTo: string): Promise<AppUser> {
  const user = await getUser();
  if (user) return user;

  redirect(signInPath(returnTo));
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
