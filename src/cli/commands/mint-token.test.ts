import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { jwtVerify } from "jose";
import { registerMintTokenCommand } from "./mint-token.js";

const SECRET = "test-secret-32-bytes-please-please-yes";
const key = new TextEncoder().encode(SECRET);

describe("mint-token CLI", () => {
  let originalSecret: string | undefined;
  let originalWrite: typeof process.stdout.write;
  let captured: string;
  beforeEach(() => {
    originalSecret = process.env.STOA_TOKEN_SIGNING_SECRET;
    process.env.STOA_TOKEN_SIGNING_SECRET = SECRET;
    captured = "";
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => { captured += chunk; return true; }) as any;
  });
  afterEach(() => {
    process.stdout.write = originalWrite;
    if (originalSecret === undefined) delete process.env.STOA_TOKEN_SIGNING_SECRET;
    else process.env.STOA_TOKEN_SIGNING_SECRET = originalSecret;
  });

  it("emits a verifiable JWT with sub + scopes + exp", async () => {
    const program = new Command();
    registerMintTokenCommand(program);
    await program.parseAsync(["node", "stoa", "mint-token", "--agent-id=worker-1", "--scope=vault_recall:*,vault_task-claim:tasks/abc"]);
    const token = captured.trim();
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    expect(payload.sub).toBe("worker-1");
    expect(payload.scopes).toEqual(["vault_recall:*", "vault_task-claim:tasks/abc"]);
    expect(payload.exp).toBeTypeOf("number");
    expect(payload.jti).toBeTypeOf("string");
  });
});
