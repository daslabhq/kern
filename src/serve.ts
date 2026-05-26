// kern serve — local HTTP server for secure credential capture.
//
// Serves a minimal form at /add?name=<secret_name> where the user
// pastes credentials. The value goes directly into the vault — never
// through the LLM or MCP client.
//
// Used by URL-mode elicitation: the MCP server returns
// http://localhost:<port>/add?name=github_token and the MCP client
// opens the user's browser.

import { Vault } from "./vault.js";

const FORM_HTML = (name: string, port: number) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>kern — add ${name}</title>
  <style>
    * { margin: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e8e8e8; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; padding: 32px; width: 400px; }
    h1 { font-size: 14px; font-weight: 500; color: #888; margin-bottom: 4px; }
    .name { font-size: 24px; font-weight: 600; margin-bottom: 24px; }
    textarea { width: 100%; min-height: 80px; background: #0a0a0a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px; color: #e8e8e8; font-family: monospace; font-size: 14px; resize: vertical; }
    textarea:focus { outline: none; border-color: #555; }
    button { width: 100%; margin-top: 16px; padding: 12px; background: #fff; color: #000; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: #ddd; }
    .done { text-align: center; }
    .done .check { font-size: 48px; margin-bottom: 12px; }
    .done p { color: #888; }
  </style>
</head>
<body>
  <div class="card" id="form-view">
    <h1>kern</h1>
    <div class="name">${name}</div>
    <form id="f">
      <textarea id="val" placeholder="Paste your credential here" autofocus></textarea>
      <button type="submit">Encrypt &amp; Store</button>
    </form>
  </div>
  <div class="card done" id="done-view" style="display:none">
    <div class="check">&#10003;</div>
    <div class="name">${name}</div>
    <p>Encrypted and stored. You can close this tab.</p>
  </div>
  <script>
    document.getElementById("f").onsubmit = async (e) => {
      e.preventDefault();
      const val = document.getElementById("val").value.trim();
      if (!val) return;
      const resp = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "${name}", value: val }),
      });
      if (resp.ok) {
        document.getElementById("form-view").style.display = "none";
        document.getElementById("done-view").style.display = "block";
      }
    };
  </script>
</body>
</html>`;

export interface ServeOptions {
  port?: number;
  vault: Vault;
  onAdd?: (name: string) => void;
}

export interface LocalServer {
  port: number;
  url: string;
  close: () => void;
}

export function startLocalServer(opts: ServeOptions): LocalServer {
  const port = opts.port ?? 9271;
  const pending = new Map<string, { resolve: () => void }>();

  const server = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/add" && req.method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return new Response("Missing ?name=", { status: 400 });
        return new Response(FORM_HTML(name, port), {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (url.pathname === "/api/add" && req.method === "POST") {
        const { name, value } = await req.json() as { name: string; value: string };
        if (!name || !value) return Response.json({ error: "missing name or value" }, { status: 400 });
        await opts.vault.put(name, value);
        opts.onAdd?.(name);
        const p = pending.get(name);
        if (p) { p.resolve(); pending.delete(name); }
        return Response.json({ ok: true });
      }

      if (url.pathname === "/api/wait" && req.method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return Response.json({ error: "missing ?name=" }, { status: 400 });
        await new Promise<void>((resolve) => {
          pending.set(name, { resolve });
          setTimeout(() => { pending.delete(name); resolve(); }, 120_000);
        });
        return Response.json({ ok: true, name });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    port,
    url: `http://localhost:${port}`,
    close: () => server.stop(),
  };
}
