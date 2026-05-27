// kern MCP server — stdio transport + embedded local HTTP server.
//
// Tools:
//   kern_status    — wallet health (credential count, recipient count)
//   kern_list      — list credential names (no values)
//   kern_fetch     — proxy HTTP request (credential stays in wallet)
//   kern_add       — add a credential via browser form (never through LLM)
//   kern_rotate    — rotate a credential via browser form
//   kern_remove    — remove a credential
//   kern_recipients — list recipients (public keys)

import { loadFromHost } from "./identity.js";
import { Wallet } from "./wallet.js";
import { startLocalServer, type LocalServer } from "./serve.js";

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: any, respond: RespondFn) => Promise<void>;
}

type RespondFn = (id: string | number | undefined, result: any) => void;

export async function startMcpServer() {
  const identity = await loadFromHost();
  const dir = process.env.KERN_VAULT_DIR ?? process.env.KORN_VAULT_DIR;
  const wallet = new Wallet({ identity, ...(dir ? { dir } : {}) });

  let server: LocalServer | null = null;

  function ensureServer(): LocalServer {
    if (!server) {
      server = startLocalServer({
        vault: wallet,
        onAdd: (name) => process.stderr.write(`[kern] encrypted: ${name}\n`),
      });
      process.stderr.write(`[kern] local server at ${server.url}\n`);
    }
    return server;
  }

  const tools: Tool[] = [
    {
      name: "kern_status",
      description: "Wallet health: how many credentials, how many recipients, vault directory.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, respond) => {
        const secrets = wallet.list();
        let recipients: string[] = [];
        try {
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const r = readFileSync(join(wallet.dir, ".recipients"), "utf8");
          recipients = r.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
        } catch {}
        respond(undefined, {
          content: [{ type: "text", text: JSON.stringify({
            secrets: secrets.length,
            recipients: recipients.length,
            names: secrets,
            dir: wallet.dir,
          }, null, 2) }],
        });
      },
    },
    {
      name: "kern_list",
      description: "List all credential names in the wallet. Returns names only — never values.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, respond) => {
        const secrets = wallet.list();
        respond(undefined, {
          content: [{ type: "text", text: secrets.length
            ? `${secrets.length} credentials: ${secrets.join(", ")}`
            : "Wallet is empty. Use kern_add to add credentials." }],
        });
      },
    },
    {
      name: "kern_fetch",
      description: "Make an authenticated HTTP request. The credential stays in the wallet — you get the response without seeing the key.",
      inputSchema: {
        type: "object",
        required: ["secret", "url"],
        properties: {
          secret: { type: "string", description: "Credential name (e.g. tokens/github)" },
          url: { type: "string", description: "Full URL to request" },
          method: { type: "string", description: "HTTP method (default: GET)" },
          body: { type: "string", description: "Request body for POST/PUT" },
        },
      },
      handler: async (args, respond) => {
        const { secret, url, method, body } = args as {
          secret: string; url: string; method?: string; body?: string;
        };
        try {
          const resp = await wallet.fetch(secret, url, {
            method: method ?? "GET",
            body: body ?? undefined,
          });
          const text = await resp.text();
          respond(undefined, {
            content: [{ type: "text", text: `${resp.status} ${resp.statusText}\n\n${text}` }],
          });
        } catch (e: any) {
          respond(undefined, {
            content: [{ type: "text", text: `Error: ${e.message}` }],
            isError: true,
          });
        }
      },
    },
    {
      name: "kern_add",
      description: "Add a credential to the wallet. Opens a secure browser form where the user pastes the value. It never passes through the LLM.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Credential name (e.g. tokens/github, testing/openai)" },
        },
      },
      handler: async (args, respond) => {
        const name = args.name as string;
        const srv = ensureServer();
        const url = `${srv.url}/add?name=${encodeURIComponent(name)}`;

        respond(undefined, {
          content: [{ type: "text", text: `Opening secure form for "${name}". Paste your credential in the browser — it goes directly to the wallet, never through this conversation.` }],
          _meta: {
            elicitation: {
              mode: "url",
              url,
              message: `Paste your ${name} credential in the browser form.`,
              elicitationId: `kern-add-${name}-${Date.now()}`,
            },
          },
        });

        try {
          await fetch(`${srv.url}/api/wait?name=${encodeURIComponent(name)}`);
        } catch {}
      },
    },
    {
      name: "kern_rotate",
      description: "Rotate a credential — opens browser form for the new value. The old value is replaced.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Credential name to rotate" },
        },
      },
      handler: async (args, respond) => {
        const name = args.name as string;
        const secrets = wallet.list();
        if (!secrets.includes(name)) {
          respond(undefined, {
            content: [{ type: "text", text: `Credential "${name}" not found. Available: ${secrets.join(", ")}` }],
          });
          return;
        }
        const srv = ensureServer();
        const url = `${srv.url}/add?name=${encodeURIComponent(name)}`;

        respond(undefined, {
          content: [{ type: "text", text: `Opening secure form to rotate "${name}".` }],
          _meta: {
            elicitation: {
              mode: "url",
              url,
              message: `Paste the new value for ${name}.`,
              elicitationId: `kern-rotate-${name}-${Date.now()}`,
            },
          },
        });

        try {
          await fetch(`${srv.url}/api/wait?name=${encodeURIComponent(name)}`);
        } catch {}
      },
    },
    {
      name: "kern_remove",
      description: "Remove a credential from the wallet.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Credential name to remove" },
        },
      },
      handler: async (args, respond) => {
        const name = args.name as string;
        try {
          wallet.delete(name);
          respond(undefined, {
            content: [{ type: "text", text: `Removed "${name}" from wallet.` }],
          });
        } catch (e: any) {
          respond(undefined, {
            content: [{ type: "text", text: `Error: ${e.message}` }],
            isError: true,
          });
        }
      },
    },
    {
      name: "kern_recipients",
      description: "List wallet recipients (public keys that can decrypt). No credential values exposed.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, respond) => {
        try {
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const raw = readFileSync(join(wallet.dir, ".recipients"), "utf8");
          const keys = raw.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
          respond(undefined, {
            content: [{ type: "text", text: `${keys.length} recipients:\n${keys.map(k => `  ${k}`).join("\n")}` }],
          });
        } catch {
          respond(undefined, {
            content: [{ type: "text", text: "No .recipients file found." }],
          });
        }
      },
    },
  ];

  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  function respond(id: string | number | undefined, result: any) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  function respondError(id: string | number | undefined, code: number, message: string) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  }

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) handleMessage(line);
    }
  });

  function handleMessage(line: string) {
    let req: { jsonrpc: string; id?: string | number; method: string; params?: any };
    try { req = JSON.parse(line); } catch { respondError(undefined, -32700, "Parse error"); return; }

    switch (req.method) {
      case "initialize":
        respond(req.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, elicitation: { url: {} } },
          serverInfo: { name: "kern", version: "0.2.0" },
        });
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        break;
      case "ping":
        respond(req.id, {});
        break;
      case "tools/list":
        respond(req.id, { tools: toolDefs });
        break;
      case "tools/call": {
        const name = req.params?.name;
        const args = req.params?.arguments ?? {};
        const tool = tools.find(t => t.name === name);
        if (!tool) { respondError(req.id, -32602, `Unknown tool: ${name}`); return; }
        tool.handler(args, (_, result) => respond(req.id, result))
          .catch((err: any) => respond(req.id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          }));
        break;
      }
      default:
        respondError(req.id, -32601, `Method not found: ${req.method}`);
    }
  }

  process.on("exit", () => server?.close());
  process.stderr.write("[kern] MCP server ready\n");
}
