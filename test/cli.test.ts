import { test, expect, afterAll } from "bun:test";
import { generateIdentity } from "../src/index.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

// These spawn the real CLI with a real pipe on stdin. That is the point: the
// bug this guards against (a floating main() letting the process exit before
// the vault write landed) only reproduces off a TTY, so an in-process test
// cannot see it. The failure mode was exit 0 with nothing written.

const CLI = join(import.meta.dir, "..", "bin", "kern.ts");
const TMP = join(import.meta.dir, "..", ".cli-test-tmp");

afterAll(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

async function freshVault() {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    mkdirSync(TMP, { recursive: true });
    const id = await generateIdentity();
    writeFileSync(join(TMP, ".recipients"), id.publicKey + "\n");
    return { dir: TMP, env: { ...process.env, KERN_VAULT_DIR: TMP, KERN_AGE_KEY: id.privateKey } };
}

async function runCli(env: Record<string, string>, args: string[], stdin?: string) {
    const proc = Bun.spawn(["bun", CLI, ...args], {
        env,
        stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { stdout, stderr, exitCode };
}

test("secret add persists a value piped on stdin", async () => {
    const { env } = await freshVault();

    const add = await runCli(env, ["secret", "add", "piped_key"], "s3cret-value\n");
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("✓ added piped_key");

    const get = await runCli(env, ["secret", "get", "piped_key"]);
    expect(get.exitCode).toBe(0);
    expect(get.stdout).toBe("s3cret-value");
});

test("secret add accepts input with no trailing newline", async () => {
    const { env } = await freshVault();

    // The documented recipe is `printf '%s' "$VALUE" | kern secret add NAME`,
    // which sends no newline — the reader must fall back to EOF.
    const add = await runCli(env, ["secret", "add", "no_newline_key"], "no-trailing-newline");
    expect(add.exitCode).toBe(0);

    const get = await runCli(env, ["secret", "get", "no_newline_key"]);
    expect(get.stdout).toBe("no-trailing-newline");
});

test("secret rotate replaces a piped value", async () => {
    const { env } = await freshVault();

    await runCli(env, ["secret", "add", "rot_key"], "before\n");
    const rot = await runCli(env, ["secret", "rotate", "rot_key"], "after\n");
    expect(rot.exitCode).toBe(0);
    expect(rot.stdout).toContain("✓ rotated rot_key");

    const get = await runCli(env, ["secret", "get", "rot_key"]);
    expect(get.stdout).toBe("after");
});

test("only the first line of piped input is taken", async () => {
    const { env } = await freshVault();

    await runCli(env, ["secret", "add", "multiline_key"], "first-line\nsecond-line\n");
    const get = await runCli(env, ["secret", "get", "multiline_key"]);
    expect(get.stdout).toBe("first-line");
});

test("secret get on a missing name exits non-zero", async () => {
    const { env } = await freshVault();

    const get = await runCli(env, ["secret", "get", "absent_key"]);
    expect(get.exitCode).not.toBe(0);
    expect(get.stderr).toContain("no such secret");
});
