// kern — the agent wallet

export { Vault } from "./vault.js";
export type { VaultOpts } from "./vault.js";

export { Wallet } from "./wallet.js";
export type { WalletOpts, FetchOptions } from "./wallet.js";

export type { Identity } from "./identity.js";
export {
    generate as generateIdentity,
    load     as loadIdentity,
    loadFromHost as loadIdentityFromHost,
} from "./identity.js";

import { Vault, type VaultOpts } from "./vault.js";
import { Wallet, type WalletOpts } from "./wallet.js";

export function openVault(opts: VaultOpts): Vault {
    return new Vault(opts);
}

export function openWallet(opts: WalletOpts): Wallet {
    return new Wallet(opts);
}
