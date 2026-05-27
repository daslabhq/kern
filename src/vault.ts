// vault.ts — Kern v0.1 vault.
//
// Implements the on-disk layout specified in spec/02-vault.md:
//   vault/
//     .recipients               plaintext, one age pubkey per line, '#' comments OK
//     openai_api_key.age        age-encrypted to all recipients above
//     prod/
//       .recipients             narrower recipient set
//       stripe_live.age
//
// Rules:
//   - filename without ".age" = secret name
//   - nearest enclosing .recipients applies to each file
//   - file format is canonical age (RFC-ish, https://age-encryption.org/v1)
//
// Anything that can read age files can read these vaults given the right
// private key. We do not extend the format.

import { Encrypter, Decrypter } from "age-encryption";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync } from "fs";
import { join, dirname, basename } from "path";

import type { Identity } from "./identity.js";

export interface VaultOpts {
    /** Root vault directory. Default: KERN_VAULT_DIR env var ?? "./secrets" */
    dir?: string;
    /** Identity used to decrypt. */
    identity: Identity;
}

export class Vault {
    readonly dir: string;
    private id: Identity;
    private cache = new Map<string, Uint8Array>();

    constructor(opts: VaultOpts) {
        this.dir = opts.dir ?? process.env.KERN_VAULT_DIR ?? process.env.KORN_VAULT_DIR ?? "./secrets";
        this.id = opts.identity;
    }

    /** Decrypt and return a secret as bytes. */
    async getBytes(name: string): Promise<Uint8Array> {
        const cached = this.cache.get(name);
        if (cached) return cached;

        const path = this.pathFor(name);
        if (!existsSync(path)) {
            throw new Error(`kern.vault: no such secret "${name}" (looked at ${path})`);
        }
        const blob = readFileSync(path);
        const d = new Decrypter();
        d.addIdentity(this.id.privateKey);
        const plain = await d.decrypt(blob);
        this.cache.set(name, plain);
        return plain;
    }

    /** Decrypt and return a secret as a string (UTF-8 decoded). */
    async get(name: string): Promise<string> {
        const bytes = await this.getBytes(name);
        return new TextDecoder().decode(bytes);
    }

    /**
     * Scoped form — plaintext exists only inside the callback. Recommended.
     * Cache is bypassed so plaintext doesn't linger in-memory across calls.
     */
    async with<T>(name: string, fn: (value: string) => T | Promise<T>): Promise<T> {
        const path = this.pathFor(name);
        const blob = readFileSync(path);
        const d = new Decrypter();
        d.addIdentity(this.id.privateKey);
        const bytes = await d.decrypt(blob);
        const value = new TextDecoder().decode(bytes);
        try {
            return await fn(value);
        } finally {
            // best-effort scrub — JS strings are immutable so we can't truly zero,
            // but we drop our reference and pop the byte buffer
            bytes.fill(0);
        }
    }

    /**
     * Encrypt and write a secret. Uses the recipients of the nearest
     * .recipients file (per spec/02-vault.md).
     */
    async put(name: string, value: string | Uint8Array): Promise<void> {
        const path = this.pathFor(name);
        mkdirSync(dirname(path), { recursive: true });
        const recipients = this.recipientsFor(path);
        if (recipients.length === 0) {
            throw new Error(
                `kern.vault: no recipients for ${path}.\n` +
                `Create ${dirname(path)}/.recipients with at least one age pubkey.`
            );
        }
        const e = new Encrypter();
        for (const r of recipients) e.addRecipient(r);
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
        const blob = await e.encrypt(bytes);
        writeFileSync(path, blob);
        this.cache.delete(name);
    }

    /** Delete a secret file. */
    delete(name: string): void {
        const path = this.pathFor(name);
        if (existsSync(path)) rmSync(path);
        this.cache.delete(name);
    }

    /** List all secret names (recursive, relative to vault root). */
    list(): string[] {
        const out: string[] = [];
        const walk = (dir: string, prefix: string) => {
            if (!existsSync(dir)) return;
            for (const ent of readdirSync(dir)) {
                if (ent.startsWith(".")) continue;
                const full = join(dir, ent);
                const st = statSync(full);
                if (st.isDirectory()) walk(full, prefix + ent + "/");
                else if (ent.endsWith(".age")) out.push(prefix + ent.replace(/\.age$/, ""));
            }
        };
        walk(this.dir, "");
        return out.sort();
    }

    /** Re-encrypt every secret to the recipients listed at each level. */
    async rewrap(): Promise<{ rewrapped: number; skipped: { name: string; error: string }[] }> {
        let rewrapped = 0;
        const skipped: { name: string; error: string }[] = [];
        for (const name of this.list()) {
            try {
                const bytes = await this.getBytes(name);
                this.cache.delete(name);
                await this.put(name, bytes);
                rewrapped++;
            } catch (e: any) {
                skipped.push({ name, error: e?.message || String(e) });
            }
        }
        return { rewrapped, skipped };
    }

    /** Path on disk for a given secret name. */
    private pathFor(name: string): string {
        // basic safety: reject path traversal
        if (name.includes("..")) throw new Error(`invalid secret name: ${name}`);
        return join(this.dir, name + ".age");
    }

    /** Read .recipients files from the secret's directory up to the vault root. */
    private recipientsFor(secretPath: string): string[] {
        let dir = dirname(secretPath);
        const stopAt = dirname(this.dir);  // never walk past vault root
        while (dir && dir !== stopAt) {
            const r = join(dir, ".recipients");
            if (existsSync(r)) {
                return readFileSync(r, "utf8")
                    .split("\n")
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith("#"));
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return [];
    }
}
