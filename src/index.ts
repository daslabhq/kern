// kern — the agent wallet

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
