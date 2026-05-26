import { jwtVerify } from "jose";
import type { Principal, TokenVerifier } from "./types.js";

export class JwtVerifier implements TokenVerifier {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    if (!secret) throw new Error("JwtVerifier: signing secret is required");
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<Principal> {
    const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") throw new Error("JWT missing 'sub' claim");
    if (!Array.isArray(payload.scopes)) throw new Error("JWT missing 'scopes' claim");
    return {
      agent_id: payload.sub,
      scopes: payload.scopes as string[],
      exp: payload.exp,
      source: "http",
    };
  }
}
