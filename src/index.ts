// @daslab/kern — TypeScript SDK, v0.1
//
// The minimal embeddable surface for any agent platform that wants
// identity + secrets management without rolling their own crypto.
//
// Usage:
//   import { openVault, loadIdentityFromHost } from "@daslab/kern";
//
//   const id    = await loadIdentityFromHost();        // env var or ~/.kern/key
//   const vault = openVault({ identity: id });          // reads ./secrets/ by default
//
//   const openaiKey = await vault.get("openai_api_key");
//
//   // or scoped (preferred — plaintext scrubbed after callback returns):
//   await vault.with("openai_api_key", async (key) => {
//     await callOpenAI(key, ...);
//   });
//
// Spec: ../../../spec/02-vault.md

export { Vault } from "./vault.js";
export type { VaultOpts } from "./vault.js";

export type { Identity } from "./identity.js";
export {
    generate as generateIdentity,
    load     as loadIdentity,
    loadFromHost as loadIdentityFromHost,
} from "./identity.js";

import { Vault, type VaultOpts } from "./vault.js";
export function openVault(opts: VaultOpts): Vault {
    return new Vault(opts);
}
