import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateIdentity, openVault } from "../src/index.js";
import { startLocalServer, type LocalServer } from "../src/serve.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TMP = join(import.meta.dir, "..", ".serve-test-tmp");
let srv: LocalServer;
let vault: ReturnType<typeof openVault>;

beforeAll(async () => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP);
  const id = await generateIdentity();
  writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");
  vault = openVault({ dir: TMP, identity: id });
  srv = startLocalServer({ vault, port: 9273 });
});

afterAll(() => {
  srv?.close();
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

test("GET /add?name= serves the credential form", async () => {
  const resp = await fetch(`${srv.url}/add?name=my_token`);
  expect(resp.status).toBe(200);
  const html = await resp.text();
  expect(html).toContain("my_token");
  expect(html).toContain("Paste your credential");
  expect(html).toContain("Encrypt");
});

test("GET /add without name returns 400", async () => {
  const resp = await fetch(`${srv.url}/add`);
  expect(resp.status).toBe(400);
});

test("POST /api/add encrypts into vault", async () => {
  const resp = await fetch(`${srv.url}/api/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "github_token", value: "ghp_test123" }),
  });
  expect(resp.status).toBe(200);
  const stored = await vault.get("github_token");
  expect(stored).toBe("ghp_test123");
});

test("POST /api/add with missing value returns 400", async () => {
  const resp = await fetch(`${srv.url}/api/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x" }),
  });
  expect(resp.status).toBe(400);
});

test("credential value never appears in form HTML", async () => {
  await fetch(`${srv.url}/api/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "secret_key", value: "super_secret_value" }),
  });
  const resp = await fetch(`${srv.url}/add?name=secret_key`);
  const html = await resp.text();
  expect(html).not.toContain("super_secret_value");
});

test("unknown routes return 404", async () => {
  const resp = await fetch(`${srv.url}/nonexistent`);
  expect(resp.status).toBe(404);
});
