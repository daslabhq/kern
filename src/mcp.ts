// kern MCP server — stdio transport + embedded local HTTP server.
//
// Tools:
//   kern_status    — vault health (secret count, recipient count)
//   kern_list      — list secret names (no values)
//   kern_add       — add a secret via URL-mode elicitation (browser form)
//   kern_rotate    — rotate a secret via URL-mode elicitation
//   kern_remove    — remove a secret
//   kern_recipients — list recipients (public keys)
//
// Credential capture uses MCP URL-mode elicitation:
//   1. kern returns a localhost URL
//   2. MCP client opens the user's browser
//   3. User pastes credential into kern's local form
//   4. Value goes vault → encrypted. Never through the LLM.

import { loadFromHost } from "./identity.js";
import { Vault } from "./vault.js";
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
  const vault = new Vault({ identity, ...(dir ? { dir } : {}) });

  let server: LocalServer | null = null;

  function ensureServer(): LocalServer {
    if (!server) {
      server = startLocalServer({
        vault,
        onAdd: (name) => process.stderr.write(`[kern] encrypted: ${name}\n`),
      });
      process.stderr.write(`[kern] local server at ${server.url}\n`);
    }
    return server;
  }

  const tools: Tool[] = [
    {
      name: "kern_status",
      description: "Vault health: how many secrets, how many recipients, vault directory.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, respond) => {
        const secrets = vault.list();
        let recipients: string[] = [];
        try {
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const r = readFileSync(join(vault.dir, ".recipients"), "utf8");
          recipients = r.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
        } catch {}
        respond(undefined, {
          content: [{ type: "text", text: JSON.stringify({
            secrets: secrets.length,
            recipients: recipients.length,
            names: secrets,
            dir: vault.dir,
          }, null, 2) }],
        });
      },
    },
    {
      name: "kern_list",
      description: "List all secret names in the vault. Returns names only — never values.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, respond) => {
        const secrets = vault.list();
        respond(undefined, {
          content: [{ type: "text", text: secrets.length
            ? `${secrets.length} secrets: ${secrets.join(", ")}`
            : "Vault is empty. Use kern_add to add secrets." }],
        });
      },
    },
    {
      name: "kern_add",
      description: "Add a secret to the vault. Opens a secure browser form where the user pastes the credential. The value never passes through the LLM.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Secret name (e.g. github_token, openai_key)" },
        },
      },
      handler: async (args, respond) => {
        const name = args.name as string;
        const srv = ensureServer();
        const url = `${srv.url}/add?name=${encodeURIComponent(name)}`;

        respond(undefined, {
          content: [{ type: "text", text: `Opening secure form for "${name}". Paste your credential in the browser — it goes directly to the vault, never through this conversation.` }],
          _meta: {
            elicitation: {
              mode: "url",
              url,
              message: `Paste your ${name} credential in the browser form.`,
              elicitationId: `kern-add-${name}-${Date.now()}`,
            },
          },
        });

        // Wait for the user to submit the form
        try {
          await fetch(`${srv.url}/api/wait?name=${encodeURIComponent(name)}`);
        } catch {}
      },
    },
    {
      name: "kern_rotate",
      description: "Rotate a secret — opens browser form for the new value. The old value is replaced.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Secret name to rotate" },
        },
      },
      handler: async (args, respond) => {
        const name = args.name as string;
        const secrets = vault.list();
        if (!secrets.includes(name)) {
          respond(undefined, {
            content: [{ type: "text", text: `Secret "${name}" not found. Available: ${secrets.join(", ")}` }],
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
      description: "Remove a secret from the vault.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Secret name to remove" },
        },
      },
      handler: async (args, respond) => {
        const name = args.name as string;
        try {
          vault.delete(name);
          respond(undefined, {
            content: [{ type: "text", text: `Removed "${name}" from vault.` }],
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
      description: "List vault recipients (public keys that can decrypt). No secret values exposed.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, respond) => {
        try {
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const raw = readFileSync(join(vault.dir, ".recipients"), "utf8");
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

  // MCP stdio transport
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
