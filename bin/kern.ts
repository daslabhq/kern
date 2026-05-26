#!/usr/bin/env bun
// kern CLI — v0.1
//
// Commands:
//   kern identity init [--save ~/.kern/key]   generate an age key, write to file
//   kern identity pubkey                       print the public recipient
//
//   kern secret add NAME                       prompt for value, encrypt, write
//   kern secret get NAME                       print plaintext (machine consumption)
//   kern secret list                           tree of secret names
//   kern secret rotate NAME                    same as add, but with rotation log
//   kern secret delete NAME
//
//   kern secret rewrap                         re-encrypt all secrets to current .recipients
//   kern recipients                            print the active recipients
//
// Env:
//   KORN_AGE_KEY        the private key (AGE-SECRET-KEY-1...)
//   KORN_VAULT_DIR      vault root (default ./secrets)

import { generateIdentity, loadIdentityFromHost, openVault } from "../src/index.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

async function main() {
    if (!cmd || cmd === "-h" || cmd === "--help") return help();
    switch (cmd) {
        case "identity": return cmdIdentity(sub, args.slice(2));
        case "secret":
        case "secrets":  return cmdSecret(sub, args.slice(2));
        case "recipients": return cmdRecipients();
        case "mcp":      return cmdMcp();
        case "serve":    return cmdServe();
        default:
            console.error(`unknown command: ${cmd}`);
            help();
            process.exit(1);
    }
}

function help() {
    process.stdout.write(`kern v0.2 — the agent credential manager\n\n` +
`  kern mcp                        start MCP server (for Claude Code, Cursor, etc.)\n` +
`  kern serve                      start local form server only\n\n` +
`  kern identity init [--save PATH]\n` +
`  kern identity pubkey\n\n` +
`  kern secret add NAME\n` +
`  kern secret get NAME\n` +
`  kern secret list\n` +
`  kern secret rotate NAME\n` +
`  kern secret delete NAME\n` +
`  kern secret rewrap\n\n` +
`  kern recipients\n\n` +
`env: KERN_AGE_KEY (private key)  KERN_VAULT_DIR (default ./secrets)\n`);
}

async function cmdMcp() {
    const { startMcpServer } = await import("../src/mcp.js");
    await startMcpServer();
}

async function cmdServe() {
    const { loadFromHost } = await import("../src/identity.js");
    const { Vault } = await import("../src/vault.js");
    const { startLocalServer } = await import("../src/serve.js");
    const identity = await loadFromHost();
    const dir = process.env.KERN_VAULT_DIR ?? process.env.KORN_VAULT_DIR;
    const vault = new Vault({ identity, ...(dir ? { dir } : {}) });
    const srv = startLocalServer({
        vault,
        onAdd: (name) => console.log(`✓ encrypted: ${name}`),
    });
    console.log(`kern form server at ${srv.url}`);
    console.log(`Open ${srv.url}/add?name=YOUR_SECRET to add a credential`);
}

async function cmdIdentity(sub: string | undefined, rest: string[]) {
    if (sub === "init") {
        const saveIdx = rest.indexOf("--save");
        const savePath = saveIdx >= 0 ? rest[saveIdx + 1] : join(homedir(), ".kern", "key");
        const id = await generateIdentity();
        mkdirSync(dirname(savePath), { recursive: true });
        if (existsSync(savePath)) {
            console.error(`refusing to overwrite ${savePath} — move it aside first`);
            process.exit(1);
        }
        writeFileSync(savePath, id.privateKey + "\n", { mode: 0o600 });
        console.log(`✓ wrote private key: ${savePath}`);
        console.log(`  pubkey: ${id.publicKey}`);
        console.log(`\nadd this to your vault's .recipients file:\n  ${id.publicKey}`);
        return;
    }
    if (sub === "pubkey") {
        const id = await loadIdentityFromHost();
        console.log(id.publicKey);
        return;
    }
    console.error("usage: kern identity {init,pubkey}");
    process.exit(1);
}

async function cmdSecret(sub: string | undefined, rest: string[]) {
    const id = await loadIdentityFromHost();
    const vault = openVault({ identity: id });

    if (sub === "add" || sub === "rotate") {
        const name = rest[0];
        if (!name) { console.error(`usage: kern secret ${sub} NAME`); process.exit(1); }
        const value = await readSecretInput(`${sub === "rotate" ? "new " : ""}value for ${name}: `);
        await vault.put(name, value);
        console.log(`✓ ${sub === "rotate" ? "rotated" : "added"} ${name}`);
        return;
    }
    if (sub === "get") {
        const name = rest[0];
        if (!name) { console.error("usage: kern secret get NAME"); process.exit(1); }
        process.stdout.write(await vault.get(name));
        return;
    }
    if (sub === "list") {
        for (const n of vault.list()) console.log(n);
        return;
    }
    if (sub === "delete") {
        const name = rest[0];
        if (!name) { console.error("usage: kern secret delete NAME"); process.exit(1); }
        vault.delete(name);
        console.log(`✓ deleted ${name}`);
        return;
    }
    if (sub === "rewrap") {
        const r = await vault.rewrap();
        console.log(`✓ rewrapped ${r.rewrapped} secrets (${r.skipped} skipped)`);
        return;
    }
    console.error("usage: kern secret {add,get,list,rotate,delete,rewrap}");
    process.exit(1);
}

function cmdRecipients() {
    const dir = process.env.KORN_VAULT_DIR ?? "./secrets";
    const file = join(dir, ".recipients");
    if (!existsSync(file)) {
        console.error(`no ${file} — create it with one age pubkey per line`);
        process.exit(1);
    }
    process.stdout.write(readFileSync(file, "utf8"));
}

async function readSecretInput(prompt: string): Promise<string> {
    process.stderr.write(prompt);
    // for v0.1 we read a line from stdin — pipe-friendly. tty masking is a v0.2 polish.
    const decoder = new TextDecoder();
    let acc = "";
    for await (const chunk of (process.stdin as any)) {
        acc += decoder.decode(chunk);
        const nl = acc.indexOf("\n");
        if (nl >= 0) return acc.slice(0, nl);
    }
    return acc;
}

main().catch(e => {
    console.error("kern: " + (e?.message || e));
    process.exit(1);
});
