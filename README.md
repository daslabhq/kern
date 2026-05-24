# kern

Secrets for agents. TypeScript SDK + CLI built on [age](https://age-encryption.org/) encryption.

## Why

Every agent stack reinvents secret management (badly): env vars on the
server, plaintext in databases, "share the .env in Slack" for dev. Kern is
the small, composable, standards-aligned alternative — built on
[age](https://age-encryption.org/) and BIP-39, no new crypto.

What you get:

- **One environment variable** in production (the server's age key) instead
  of dozens
- **Encrypted vault committed to your repo** — auditable in git, useless
  to non-recipients
- **Multi-recipient** by default: same secret encrypted to multiple
  identities (team, prod server, your devices) at once
- **No vendor lock-in** — vault files are standard age, readable by the
  `age` CLI / `rage` / any age library

## Install

```bash
bun add @daslab/kern
```

The package is ESM-only; works on Bun, Node 20+, and Deno. age-encryption
0.3+ is the only runtime dependency.

## Programmatic API

```ts
import { loadIdentityFromHost, openVault } from "@daslab/kern";

// load from KORN_AGE_KEY env var, falling back to ~/.kern/key
const id    = await loadIdentityFromHost();
const vault = openVault({ identity: id });  // reads ./secrets by default

// shorthand: returns plaintext string
const openaiKey = await vault.get("openai_api_key");

// scoped form — preferred. Plaintext only lives inside the callback.
const result = await vault.with("anthropic_api_key", async (key) => {
    return await anthropic.messages.create({ ... });
});

// listing, writing, deleting
vault.list();                                      // ["openai_api_key", ...]
await vault.put("slack_webhook", "https://...");   // re-encrypts to current recipients
vault.delete("old_key");
const r = await vault.rewrap();                    // after editing .recipients
console.log(`rewrapped ${r.rewrapped}`);
```

## CLI

```bash
# one-time setup per machine
kern identity init                # writes ~/.kern/key (age private key)
kern identity pubkey              # → "age1..."

# vault management (in your project)
mkdir secrets/
echo "age1yourpubkey..." > secrets/.recipients
kern secret add openai_api_key    # prompts on stdin
kern secret list
kern secret get openai_api_key    # decrypts to stdout

# add a teammate
echo "age1theirpubkey..." >> secrets/.recipients
kern secret rewrap                # re-encrypts every secret to current recipients

# rotate a value
kern secret rotate openai_api_key
```

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `KORN_AGE_KEY` | private age key, used for decryption | (none) |
| `KORN_VAULT_DIR` | vault root directory | `./secrets` |

Production deploys typically set `KORN_AGE_KEY` to the server's own age
private key. Local dev uses the file at `~/.kern/key`. Both work via the
same code path.

## Vault layout

```
secrets/
├── .recipients                 plaintext, one age pubkey per line
├── openai_api_key.age
├── anthropic_api_key.age
└── prod/
    ├── .recipients             narrower recipient set
    └── stripe_live.age
```

Nearest enclosing `.recipients` applies. The format is canonical age
v1, fully interoperable with the upstream `age` binary.

## Roadmap

- **BIP-39 seed derivation** — derive age keys from mnemonic phrases
- **OS Keychain integration** — store the private key in macOS Keychain / Windows Credential Manager
- **Agent grants** — scoped, auditable secret access for sub-agents

## Testing

```bash
bun test ./test/smoke.ts
```

10 tests covering identity generation, round-trip, multi-recipient,
nested recipients, rewrap, scoped `with()`, list, delete, missing-key,
path-traversal rejection.

## License

MIT.
