import type { Owner } from "../../packages/contracts/index.js";

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;

export const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;

export type Authenticate = (
  request: Request,
) => Owner | undefined | Promise<Owner | undefined>;

export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) return undefined;

  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization);
  return match?.[1];
}

export function validateLocalRequest(
  request: Request,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS,
): Response | undefined {
  const allowed = new Set(allowedHosts.map(normalizeHostname));
  const requestUrl = safelyParseUrl(request.url);
  const hostHeader = parseHostHeader(request.headers.get("host"));

  if (
    !requestUrl ||
    !hostHeader ||
    !allowed.has(normalizeHostname(requestUrl.hostname)) ||
    !allowed.has(normalizeHostname(hostHeader.hostname)) ||
    normalizeHostname(requestUrl.hostname) !==
      normalizeHostname(hostHeader.hostname) ||
    normalizedPort(requestUrl.protocol, requestUrl.port) !==
      normalizedPort(requestUrl.protocol, hostHeader.port)
  ) {
    return jsonError(403, "Forbidden");
  }

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    const origin = safelyParseUrl(originHeader);
    const requestOrigin = new URL(requestUrl);
    requestOrigin.host = request.headers.get("host")!;
    if (
      !origin ||
      !allowed.has(normalizeHostname(origin.hostname)) ||
      origin.origin !== requestOrigin.origin
    ) {
      return jsonError(403, "Forbidden");
    }
  }

  return undefined;
}

export async function boundedRequest(
  request: Request,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
): Promise<Request | Response> {
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 0) {
    throw new TypeError("maxRequestBytes must be a non-negative safe integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      return jsonError(400, "Invalid Content-Length");
    }
    if (declaredLength > maxRequestBytes)
      return jsonError(413, "Request body too large");
  }

  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.body === null
  )
    return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (byteLength + value.byteLength > maxRequestBytes) {
        await reader.cancel("Request body too large");
        return jsonError(413, "Request body too large");
      }
      byteLength += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(request, { body });
}

export function unauthorizedResponse(): Response {
  return jsonError(401, "Unauthorized", {
    "www-authenticate": 'Bearer realm="amazon-shopping-mcp"',
  });
}

export function jsonError(
  status: number,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...headers,
      },
    },
  );
}

function parseHostHeader(
  value: string | null,
): { hostname: string; port?: string } | undefined {
  if (!value || /[\s/@\\]/.test(value)) return undefined;

  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/")
      return undefined;
    return { hostname: parsed.hostname, port: parsed.port || undefined };
  } catch {
    return undefined;
  }
}

function safelyParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function normalizedPort(protocol: string, port: string | undefined): string {
  if (port) return port;
  if (protocol === "http:") return "80";
  if (protocol === "https:") return "443";
  return "";
}
