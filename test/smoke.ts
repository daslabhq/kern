// smoke.ts — end-to-end test of the v0.1 TS SDK.

import { generateIdentity, openVault } from "../src/index.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { test, expect } from "bun:test";

const TMP = join(import.meta.dir, "..", ".smoke-tmp");

function fresh() {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    mkdirSync(TMP, { recursive: true });
}

test("generate identity returns valid age key pair", async () => {
    const id = await generateIdentity();
    expect(id.privateKey).toStartWith("AGE-SECRET-KEY-1");
    expect(id.publicKey).toStartWith("age1");
    expect(id.privateKey.length).toBeGreaterThan(40);
    expect(id.publicKey.length).toBeGreaterThan(40);
});

test("vault round-trip: put → get returns same plaintext", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");

    const vault = openVault({ dir: TMP, identity: id });
    await vault.put("openai", "sk-test-123");

    expect(existsSync(join(TMP, "openai.age"))).toBe(true);

    const got = await vault.get("openai");
    expect(got).toBe("sk-test-123");
});

test("scoped form (with) returns value + survives async work", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");

    const vault = openVault({ dir: TMP, identity: id });
    await vault.put("api_key", "xyz789");

    const result = await vault.with("api_key", async (key) => {
        await new Promise(r => setTimeout(r, 10));
        return `bearer:${key}`;
    });
    expect(result).toBe("bearer:xyz789");
});

test("multi-recipient: secret encrypted to two identities, either can decrypt", async () => {
    fresh();
    const a = await generateIdentity();
    const b = await generateIdentity();

    writeFileSync(join(TMP, ".recipients"),
        `${a.publicKey}\n${b.publicKey}\n# a comment\n\n`);

    const vaultA = openVault({ dir: TMP, identity: a });
    await vaultA.put("shared", "team-secret");

    const vaultB = openVault({ dir: TMP, identity: b });
    expect(await vaultB.get("shared")).toBe("team-secret");
});

test("list returns all secret names sorted", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");

    const vault = openVault({ dir: TMP, identity: id });
    await vault.put("zebra", "z");
    await vault.put("apple", "a");
    await vault.put("mango", "m");

    expect(vault.list()).toEqual(["apple", "mango", "zebra"]);
});

test("nested scope: subdirectory .recipients overrides root", async () => {
    fresh();
    const root = await generateIdentity();
    const prod = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), root.publicKey + "\n");
    mkdirSync(join(TMP, "prod"), { recursive: true });
    writeFileSync(join(TMP, "prod", ".recipients"), prod.publicKey + "\n");

    const rootVault = openVault({ dir: TMP, identity: root });
    await rootVault.put("base/db_url", "postgres://...");  // uses root recipients

    const prodVault = openVault({ dir: TMP, identity: prod });
    await prodVault.put("prod/stripe", "sk_live_xxx");      // uses prod recipients

    // root identity CANNOT read prod secret (not a recipient)
    let prodLeaked = false;
    try { await rootVault.get("prod/stripe"); prodLeaked = true; } catch { /* expected */ }
    expect(prodLeaked).toBe(false);

    // prod identity CAN read its own secret
    expect(await prodVault.get("prod/stripe")).toBe("sk_live_xxx");

    // root identity CAN read base secret it wrote
    expect(await rootVault.get("base/db_url")).toBe("postgres://...");
});

test("rewrap: add a recipient, rewrap, new recipient now decrypts existing secrets", async () => {
    fresh();
    const a = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), a.publicKey + "\n");

    const vaultA = openVault({ dir: TMP, identity: a });
    await vaultA.put("k1", "v1");
    await vaultA.put("k2", "v2");

    // add new recipient
    const b = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), `${a.publicKey}\n${b.publicKey}\n`);

    // before rewrap, b can't read
    const vaultB = openVault({ dir: TMP, identity: b });
    let beforeWorks = false;
    try { await vaultB.get("k1"); beforeWorks = true; } catch { /* expected */ }
    expect(beforeWorks).toBe(false);

    // rewrap from a's perspective
    const r = await vaultA.rewrap();
    expect(r.rewrapped).toBe(2);
    expect(r.skipped).toEqual([]);

    // now b can read
    expect(await vaultB.get("k1")).toBe("v1");
    expect(await vaultB.get("k2")).toBe("v2");
});

test("delete removes the secret file", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");

    const vault = openVault({ dir: TMP, identity: id });
    await vault.put("ephemeral", "soon-gone");
    expect(vault.list()).toContain("ephemeral");

    vault.delete("ephemeral");
    expect(vault.list()).not.toContain("ephemeral");
});

test("missing secret throws clear error", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");

    const vault = openVault({ dir: TMP, identity: id });
    let threw = false;
    try { await vault.get("nope"); }
    catch (e: any) { threw = true; expect(e.message).toMatch(/no such secret/); }
    expect(threw).toBe(true);
});

test("path traversal in name is rejected", async () => {
    fresh();
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");

    const vault = openVault({ dir: TMP, identity: id });
    let threw = false;
    try { await vault.put("../etc/passwd", "bad"); }
    catch (e: any) { threw = true; expect(e.message).toMatch(/invalid/); }
    expect(threw).toBe(true);
});
