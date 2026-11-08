/**
 * dsh-error-brief — host half.
 *
 * DSH renders every error whose code is AUTH as the fixed string
 * "API 密钥无效" and throws away the upstream message. This plugin keeps the
 * original failure detail (turn/end reason + HTTP error body seen by the
 * browser half) in memory and exposes it to the browser half via one route.
 *
 * Nothing is written to disk: the ring buffer lives in the host process.
 * No node builtins at module scope (the client bundler also parses this file).
 */

const VERSION = "0.1.0";
const DEFAULT_MAX = 20;
const errors = [];

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickMessage(reason, raw) {
  const candidates = [
    reason && reason.message,
    reason && reason.error && reason.error.message,
    reason && reason.cause && reason.cause.message,
    reason && reason.detail,
    reason && reason.details && reason.details.message,
  ];
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  // Last resort: pull the first "message":"..." out of the serialized reason.
  const match = /"message"\s*:\s*"((?:[^"\\]|\\.){4,600})"/.exec(raw || "");
  if (match) {
    try {
      return JSON.parse('"' + match[1] + '"');
    } catch {
      return match[1];
    }
  }
  return raw || "(no upstream message captured)";
}

function recordError(session, event, max) {
  const reason = event && event.data && event.data.reason;
  if (!reason || reason.kind !== "error") return;
  const raw = safeStringify(reason);
  const entry = {
    at: Date.now(),
    sessionId: (session && session.id) || "",
    kind: reason.kind || "error",
    code: reason.code || (reason.error && reason.error.code) || "",
    message: pickMessage(reason, raw),
    raw,
  };
  errors.unshift(entry);
  if (errors.length > max) errors.length = max;
}

function apply(ctx, config = {}) {
  const max = Number.isFinite(config.maxErrors) ? config.maxErrors : DEFAULT_MAX;

  ctx.on("session/event", (session, event) => {
    if (event && event.type === "turn/end") recordError(session, event, max);
  });

  ctx.inject(["webServer"], (scoped) => {
    scoped.effect(() => {
      const disposers = [];
      disposers.push(
        scoped.webServer.register({
          kind: "exact",
          path: "/api/dsh-error-brief/errors",
          handler: async (_req, res) => {
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ version: VERSION, errors }));
          },
        }),
      );
      // Browser-caught HTTP bodies (when the core does not surface them in
      // turn/end). Kept in the same in-memory ring, no file writes.
      disposers.push(
        scoped.webServer.register({
          kind: "exact",
          path: "/api/dsh-error-brief/report",
          handler: async (req, res) => {
            if (req.method !== "POST") {
              res.writeHead(405);
              res.end();
              return;
            }
            let body = "";
            req.on("data", (chunk) => {
              body += chunk;
              if (body.length > 8000) req.destroy();
            });
            req.on("end", () => {
              try {
                const payload = JSON.parse(body || "{}");
                const message = String(payload.message || "").slice(0, 1200);
                if (message) {
                  errors.unshift({
                    at: Date.now(),
                    sessionId: String(payload.sessionId || ""),
                    kind: "http",
                    code: String(payload.code || ""),
                    message,
                    raw: String(payload.raw || message).slice(0, 2000),
                  });
                  if (errors.length > max) errors.length = max;
                }
              } catch {
                /* ignore malformed reports */
              }
              res.writeHead(200, { "content-type": "application/json" });
              res.end("{}");
            });
          },
        }),
      );
      return () => disposers.forEach((dispose) => dispose && dispose());
    });
  });
}

export { apply };
export default { name: "dsh-error-brief", inject: [], apply };
