#!/usr/bin/env bun
// kern CLI — the agent wallet

import { generateIdentity, loadIdentityFromHost, openVault, openWallet } from "../src/index.js";
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
        case "fetch":    return cmdFetch(args.slice(1));
        case "mcp":      return cmdMcp();
        case "serve":    return cmdServe();
        default:
            console.error(`unknown command: ${cmd}`);
            help();
            process.exit(1);
    }
}

function help() {
    process.stdout.write(`kern v0.2 — the agent wallet\n\n` +
`  kern mcp                        start MCP server (for Claude Code, Cursor, etc.)\n` +
`  kern serve                      start local credential form\n\n` +
`  kern identity init [--save PATH]\n` +
`  kern identity pubkey\n\n` +
`  kern secret add NAME\n` +
`  kern secret get NAME\n` +
`  kern secret list\n` +
`  kern secret rotate NAME\n` +
`  kern secret delete NAME\n` +
`  kern secret rewrap\n\n` +
`  kern fetch SECRET URL [--method METHOD] [--body BODY]\n\n` +
`  kern recipients\n\n` +
`env: KERN_AGE_KEY (private key)  KERN_VAULT_DIR (default ./secrets)\n`);
}

async function cmdMcp() {
    const { startMcpServer } = await import("../src/mcp.js");
    await startMcpServer();
}

async function cmdServe() {
    const { loadFromHost } = await import("../src/identity.js");
    const { Wallet } = await import("../src/wallet.js");
    const { startLocalServer } = await import("../src/serve.js");
    const identity = await loadFromHost();
    const dir = process.env.KERN_VAULT_DIR ?? process.env.KORN_VAULT_DIR;
    const wallet = new Wallet({ identity, ...(dir ? { dir } : {}) });
    const srv = startLocalServer({
        vault: wallet,
        onAdd: (name) => console.log(`✓ encrypted: ${name}`),
    });
    console.log(`kern wallet at ${srv.url}`);
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

async function cmdFetch(rest: string[]) {
    const secret = rest[0];
    const url = rest[1];
    if (!secret || !url) {
        console.error("usage: kern fetch SECRET URL [--method METHOD] [--body BODY]");
        process.exit(1);
    }
    const id = await loadIdentityFromHost();
    const wallet = openWallet({ identity: id });
    const methodIdx = rest.indexOf("--method");
    const method = methodIdx >= 0 ? rest[methodIdx + 1] : "GET";
    const bodyIdx = rest.indexOf("--body");
    const body = bodyIdx >= 0 ? rest[bodyIdx + 1] : undefined;
    const resp = await wallet.fetch(secret, url, { method, body });
    const text = await resp.text();
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
    process.exit(resp.ok ? 0 : 1);
}

function cmdRecipients() {
    const dir = process.env.KERN_VAULT_DIR ?? process.env.KORN_VAULT_DIR ?? "./secrets";
    const file = join(dir, ".recipients");
    if (!existsSync(file)) {
        console.error(`no ${file} — create it with one age pubkey per line`);
        process.exit(1);
    }
    process.stdout.write(readFileSync(file, "utf8"));
}

async function readSecretInput(prompt: string): Promise<string> {
    process.stderr.write(prompt);
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
