// identity.ts — Kern identity loading & generation.
//
// v0.1 supports two ways to obtain an age keypair:
//   1. generate a fresh one (returns AGE-SECRET-KEY-1...)
//   2. load from a string source (env var, file contents, etc.)
//
// BIP-39 seed-phrase derivation lands in v0.2; for now keys are raw age keys.
// The vault format doesn't care — it sees age recipients regardless of how
// the underlying key was derived. So this is forward-compatible.

import { generateIdentity, identityToRecipient } from "age-encryption";

export interface Identity {
    /** Private age key, "AGE-SECRET-KEY-1..." */
    privateKey: string;
    /** Public age recipient, "age1..." */
    publicKey: string;
}

/** Generate a fresh Kern identity (random age keypair). */
export async function generate(): Promise<Identity> {
    const privateKey = await generateIdentity();
    const publicKey = await identityToRecipient(privateKey);
    return { privateKey, publicKey };
}

/** Load an Identity from a private-key string (AGE-SECRET-KEY-1...). */
export async function load(privateKey: string): Promise<Identity> {
    const trimmed = privateKey.trim();
    if (!trimmed.startsWith("AGE-SECRET-KEY-1")) {
        throw new Error("kern.identity.load: not an age secret key (expected AGE-SECRET-KEY-1...)");
    }
    const publicKey = await identityToRecipient(trimmed);
    return { privateKey: trimmed, publicKey };
}

/**
 * Convenience: load from common host locations in order:
 *   1. process.env[opts.envVar]                (default: KORN_AGE_KEY)
 *   2. file at opts.filePath                   (default: ~/.kern/key)
 * Throws if neither source is set.
 *
 * Used by both the Daslab server (env var on Render) and local dev (~/.kern/key).
 */
export async function loadFromHost(opts: {
    envVar?: string;
    filePath?: string;
} = {}): Promise<Identity> {
    const envVar = opts.envVar ?? "KORN_AGE_KEY";

    const fromEnv = process.env[envVar];
    if (fromEnv && fromEnv.trim()) return load(fromEnv);

    const home = process.env.HOME || process.env.USERPROFILE;
    const filePath = opts.filePath ?? (home ? `${home}/.kern/key` : null);
    if (filePath) {
        try {
            const { readFileSync } = await import("fs");
            const contents = readFileSync(filePath, "utf8");
            return load(contents);
        } catch (e: any) {
            if (e?.code !== "ENOENT") throw e;
        }
    }

    throw new Error(
        `kern.identity.loadFromHost: no key found.\n` +
        `Tried env var ${envVar} and file ${filePath || "(no home)"}.\n` +
        `Generate one with: kern identity init`
    );
}
