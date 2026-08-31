/**
 * iron-session cookie session (§4.3). Holds the SIWE nonce during login and,
 * once verified, the player's address + userId. The session address is the ONLY
 * address the backend will credit deposits from or pay out to.
 */
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { sessionSecret } from "./env";

export interface SessionData {
  nonce?: string;
  address?: string; // lowercase
  userId?: string;
}

function options(): SessionOptions {
  return {
    password: sessionSecret(),
    cookieName: "lendcasino_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}
