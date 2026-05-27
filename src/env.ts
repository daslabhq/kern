// @daslab/kern/env — side-effect import that hydrates process.env from the vault.
//
// Usage:
//   import "@daslab/kern/env";
//
// Must be the first import in your entry point. Discovers identity from
// KERN_AGE_KEY env var or ~/.kern/key, opens the vault at KERN_VAULT_DIR
// (default ./secrets), decrypts every .age file, and sets the result as
// UPPER_SNAKE process.env vars. Vault wins over existing env vars.
//
// Silent no-op if no identity or vault is found — server continues with
// whatever is already in process.env.

import { loadFromHost } from "./identity.js";
import { Vault } from "./vault.js";
import { join } from "path";

const TAG = "[kern/env]";

async function hydrate() {
  let identity;
  try {
    identity = await loadFromHost();
  } catch {
    return;
  }

  const dir = process.env.KERN_VAULT_DIR ?? process.env.KORN_VAULT_DIR ?? join(process.cwd(), "secrets");
  const vault = new Vault({ dir, identity });

  const names = vault.list();
  if (names.length === 0) return;

  const loaded: string[] = [];
  const overridden: string[] = [];

  for (const name of names) {
    const envName = name.toUpperCase();
    const had = !!process.env[envName];
    try {
      process.env[envName] = await vault.get(name);
      (had ? overridden : loaded).push(envName);
    } catch {
      // skip unreadable secrets
    }
  }

  if (loaded.length + overridden.length > 0) {
    console.log(
      `${TAG} ${loaded.length + overridden.length} secret(s): ${[...loaded, ...overridden].join(", ")}` +
      (overridden.length ? ` (${overridden.length} overrode env)` : ""),
    );
  }
}

await hydrate();
