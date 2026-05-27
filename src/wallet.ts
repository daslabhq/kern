import { Vault, type VaultOpts } from "./vault.js";

export type WalletOpts = VaultOpts;

export interface FetchOptions extends RequestInit {
    auth?: "bearer" | { header: string };
}

export class Wallet extends Vault {
    async fetch(secret: string, url: string, options?: FetchOptions): Promise<Response> {
        const token = (await this.get(secret)).trim();
        const { auth = "bearer", ...init } = options ?? {};
        const headers = new Headers(init.headers);
        if (auth === "bearer") {
            headers.set("Authorization", `Bearer ${token}`);
        } else {
            headers.set(auth.header, token);
        }
        return globalThis.fetch(url, { ...init, headers });
    }
}
