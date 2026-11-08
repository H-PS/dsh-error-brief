/**
 * dsh-error-brief — browser half.
 *
 * Two capture paths:
 *  1. Poll the host route /api/dsh-error-brief/errors (turn/end failure reason).
 *  2. Intercept non-2xx fetch responses and read error.message from the body.
 *
 * The newest real upstream error is (a) shown in a dismissible badge and
 * (b) substituted in place of the misleading "API 密钥无效" label.
 * No DOM ids/classes from DSH are relied on: only the visible label text.
 */
window.__ModuleLoader__.load({
  id: "dsh-error-brief",
  factory: () => {
    const LABELS = [
      "API \u5bc6\u94a5\u65e0\u6548",
      "API key is invalid",
    ];
    const MARK = "[\u4e0a\u6e38\u9519\u8bef]";

    let latest = null;
    let replaceLabel = true;
    let pollMs = 3000;
    let observers = [];
    let timers = [];
    let badge = null;
    const nativeFetch = window.fetch;

    function short(text, limit) {
      const value = String(text || "").replace(/\s+/g, " ").trim();
      return value.length > limit ? value.slice(0, limit) + "\u2026" : value;
    }

    function headline(entry) {
      const code = entry.code ? " " + entry.code : "";
      return MARK + code + " " + short(entry.message, 220);
    }

    function setLatest(entry) {
      if (!entry || !entry.message) return;
      if (latest && latest.at && entry.at && entry.at <= latest.at) return;
      latest = entry;
      showBadge(entry);
      if (replaceLabel) replaceIn(document.body);
    }

    function showBadge(entry) {
      if (!document.body) return;
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "dsh-error-brief-badge";
        badge.setAttribute(
          "style",
          "position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:min(560px,90vw);" +
            "padding:12px 14px;border-radius:10px;background:#4a1d1d;color:#ffe9e9;" +
            "box-shadow:0 6px 24px rgba(0,0,0,.45);font:13px/1.6 system-ui,sans-serif;cursor:pointer",
        );
        badge.title = "\u70b9\u51fb\u5173\u95ed";
        badge.addEventListener("click", () => {
          badge.style.display = "none";
        });
        document.body.appendChild(badge);
      }
      const time = new Date(entry.at || Date.now()).toLocaleTimeString();
      const code = entry.code ? " \u00b7 " + entry.code : "";
      badge.textContent =
        "\u4e0a\u6e38\u771f\u5b9e\u9519\u8bef " + time + code + "\n" + short(entry.message, 600);
      badge.style.whiteSpace = "pre-wrap";
      badge.style.display = "block";
    }

    function replaceIn(root) {
      if (!root || !latest || !replaceLabel) return;
      let text = root.textContent || "";
      if (!LABELS.some((label) => text.includes(label))) return;
      const replacement = headline(latest);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const value = node.nodeValue || "";
        if (value.includes(MARK)) continue;
        let next = value;
        for (const label of LABELS) next = next.split(label).join(replacement);
        if (next !== value) node.nodeValue = next;
      }
    }

    function interceptFetch() {
      const wrapped = function (...args) {
        const pending = nativeFetch.apply(this, args);
        return pending.then(async (response) => {
          if (response && !response.ok) {
            try {
              const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
              if (url.indexOf("/api/dsh-error-brief/") === -1) {
                const body = await response.clone().text();
                let message = body.slice(0, 1200);
                try {
                  const parsed = JSON.parse(body);
                  message =
                    (parsed.error && parsed.error.message) || parsed.message || message;
                } catch {
                  /* keep raw body */
                }
                if (message && /(error|failed|\u5931\u8d25|\u989d\u5ea6|quota|invalid)/i.test(message)) {
                  const entry = {
                    at: Date.now(),
                    kind: "http",
                    code: "HTTP " + response.status,
                    message: message,
                    raw: body.slice(0, 2000),
                  };
                  setLatest(entry);
                  nativeFetch
                    .call(window, "/api/dsh-error-brief/report", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(entry),
                    })
                    .catch(() => {});
                }
              }
            } catch {
              /* never break the original request */
            }
          }
          return response;
        });
      };
      window.fetch = wrapped;
      return () => {
        window.fetch = nativeFetch;
      };
    }

    async function pollHost() {
      try {
        const response = await nativeFetch.call(window, "/api/dsh-error-brief/errors");
        if (!response.ok) return;
        const data = await response.json();
        const entry = data && data.errors && data.errors[0];
        if (entry) setLatest(entry);
      } catch {
        /* host half not mounted yet */
      }
    }

    function apply(ctx, config = {}) {
      if (typeof config.replaceLabel === "boolean") replaceLabel = config.replaceLabel;
      if (Number.isFinite(config.pollMs)) pollMs = Math.max(1000, config.pollMs);

      const start = () => {
        observers.push(interceptFetch());
        const observer = new MutationObserver(() => {
          if (replaceLabel && document.body) replaceIn(document.body);
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        observers.push(() => observer.disconnect());
        pollHost();
        timers.push(setInterval(pollHost, pollMs));
      };
      const stop = () => {
        timers.forEach(clearInterval);
        observers.forEach((dispose) => dispose && dispose());
        timers = [];
        observers = [];
        if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
        badge = null;
      };

      if (ctx && typeof ctx.effect === "function") {
        ctx.effect(() => {
          start();
          return stop;
        }, "dsh-error-brief: upstream error brief");
      } else {
        start();
      }
    }

    return { inject: [], apply };
  },
});
