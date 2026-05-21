import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { JwtVerifier } from "./jwt-verifier.js";

const secret = "test-secret-32-bytes-minimum-please-yes";
const key = new TextEncoder().encode(secret);
async function mint(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setSubject("worker-abc")
    .sign(key);
}

describe("JwtVerifier", () => {
  it("verifies a valid token and projects to Principal", async () => {
    const v = new JwtVerifier(secret);
    const token = await mint({ scopes: ["vault_recall:*"] });
    const p = await v.verify(token);
    expect(p.agent_id).toBe("worker-abc");
    expect(p.scopes).toEqual(["vault_recall:*"]);
    expect(p.source).toBe("http");
  });
  it("rejects wrong-signature tokens", async () => {
    const v = new JwtVerifier("a-different-secret-also-32-bytes-long");
    const token = await mint({ scopes: [] });
    await expect(v.verify(token)).rejects.toThrow();
  });
  it("throws on missing 'sub' claim", async () => {
    const v = new JwtVerifier(secret);
    const token = await new SignJWT({ scopes: [] }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
    await expect(v.verify(token)).rejects.toThrow(/sub/);
  });
  it("throws on missing 'scopes' claim", async () => {
    const v = new JwtVerifier(secret);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("x").setExpirationTime("1h").sign(key);
    await expect(v.verify(token)).rejects.toThrow(/scopes/);
  });
  it("constructor rejects empty secret", () => {
    expect(() => new JwtVerifier("")).toThrow();
  });
  it("rejects expired tokens", async () => {
    const v = new JwtVerifier(secret);
    const token = await new SignJWT({ scopes: ["vault_recall:*"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("worker-abc")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    await expect(v.verify(token)).rejects.toThrow();
  });
});
