import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { Command } from "commander";

interface MintOpts {
  agentId: string;
  scope: string;
  ttl: string;
}

export function registerMintTokenCommand(program: Command): void {
  program
    .command("mint-token")
    .requiredOption("--agent-id <id>", "principal subject")
    .requiredOption("--scope <list>", "comma-separated scope strings")
    .option("--ttl <duration>", "e.g. 30m, 24h, 30d", "30m")
    .action(async (opts: MintOpts) => {
      const secret = process.env.STOA_TOKEN_SIGNING_SECRET;
      if (!secret) {
        process.stderr.write("error: STOA_TOKEN_SIGNING_SECRET env var is required\n");
        process.exit(2);
      }
      const key = new TextEncoder().encode(secret);
      const jwt = await new SignJWT({ scopes: opts.scope.split(",").map((s) => s.trim()) })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(opts.ttl)
        .setSubject(opts.agentId)
        .setJti(randomUUID())
        .sign(key);
      process.stdout.write(jwt + "\n");
    });
}
