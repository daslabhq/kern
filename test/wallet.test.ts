import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateIdentity, openWallet } from "../src/index.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TMP = join(import.meta.dir, "..", ".wallet-test-tmp");

let echoServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
    echoServer = Bun.serve({
        port: 0,
        fetch: async (req) => {
            const hdrs: Record<string, string> = {};
            req.headers.forEach((v, k) => { hdrs[k] = v; });
            return Response.json({
                headers: hdrs,
                method: req.method,
                path: new URL(req.url).pathname,
                body: req.method !== "GET" ? await req.text() : null,
            });
        },
    });
});

afterAll(() => {
    echoServer?.stop();
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

function fresh() {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    mkdirSync(TMP, { recursive: true });
}

test("wallet.fetch injects Bearer token by default", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");
    const wallet = openWallet({ dir: TMP, identity: id });
    await wallet.put("token", "sk-test-123");

    const resp = await wallet.fetch("token", `http://localhost:${echoServer.port}/test`);
    const body = await resp.json() as any;
    expect(body.headers.authorization).toBe("Bearer sk-test-123");
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/test");
});

test("wallet.fetch with custom auth header", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");
    const wallet = openWallet({ dir: TMP, identity: id });
    await wallet.put("key", "my-key-456");

    const resp = await wallet.fetch("key", `http://localhost:${echoServer.port}/data`, {
        auth: { header: "X-API-Key" },
    });
    const body = await resp.json() as any;
    expect(body.headers["x-api-key"]).toBe("my-key-456");
});

test("wallet.fetch passes through method, body, and headers", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");
    const wallet = openWallet({ dir: TMP, identity: id });
    await wallet.put("token", "sk-post");

    const resp = await wallet.fetch("token", `http://localhost:${echoServer.port}/create`, {
        method: "POST",
        body: JSON.stringify({ name: "test" }),
        headers: { "Content-Type": "application/json" },
    });
    const result = await resp.json() as any;
    expect(result.method).toBe("POST");
    expect(result.body).toBe('{"name":"test"}');
    expect(result.headers.authorization).toBe("Bearer sk-post");
    expect(result.headers["content-type"]).toBe("application/json");
});

test("wallet.fetch throws on missing secret", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");
    const wallet = openWallet({ dir: TMP, identity: id });

    let threw = false;
    try { await wallet.fetch("nonexistent", `http://localhost:${echoServer.port}/test`); }
    catch (e: any) { threw = true; expect(e.message).toMatch(/no such secret/); }
    expect(threw).toBe(true);
});
