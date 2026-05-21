export interface Principal {
  agent_id: string;
  scopes: string[];
  exp?: number;
  source: "stdio" | "http";
}

export interface ToolScope {
  axis: (input: unknown) => string;
  adminOnly?: (input: unknown) => boolean;
  httpForbidden?: boolean;
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export class ScopeDeniedError extends Error {
  constructor(public tool: string, public reason: "admin" | "http_forbidden" | string) {
    super(`scope denied for ${tool}: ${reason}`);
    this.name = "ScopeDeniedError";
  }
}

export class HttpForbiddenError extends Error {
  constructor(public tool: string) {
    super(`tool ${tool} is forbidden over HTTP`);
    this.name = "HttpForbiddenError";
  }
}
