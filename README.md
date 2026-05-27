# kern

[![tests](https://github.com/daslabhq/kern/actions/workflows/test.yml/badge.svg)](https://github.com/daslabhq/kern/actions/workflows/test.yml)

The agent wallet. Hold credentials — agents use them without seeing them.

```bash
npm install @daslab/kern
```

Requires [Bun](https://bun.sh).

## The problem

Agents need API keys. Today those live in env vars — plaintext, unscoped, every process sees everything. The agent calling Stripe has your production secret key in its context window. Every credential is one prompt injection away from exfiltration.

## How kern works

Kern is a credential wallet backed by [age encryption](https://age-encryption.org/). Credentials are encrypted files, organized in folders, committed to git. The wallet holds them. Agents use them two ways:

**Proxy** — the credential never leaves the wallet. The agent asks kern to make the API call; kern injects the auth and returns the response.

```typescript
import { openWallet, loadIdentityFromHost } from "@daslab/kern";

const wallet = openWallet({ identity: await loadIdentityFromHost() });

// wallet injects the Bearer token — agent never sees it
const resp = await wallet.fetch("tokens/github", "https://api.github.com/user/repos");
const repos = await resp.json();
```

**Direct** — for SDKs and non-HTTP protocols where you need the raw credential.

```typescript
const key = await wallet.get("tokens/openai");
const client = new OpenAI({ apiKey: key });
```

Both read from the same encrypted vault. You choose per credential.

## Quick start

```bash
# create your identity (age keypair)
kern identity init

# create the vault
mkdir -p secrets
kern identity pubkey >> secrets/.recipients

# add credentials
kern secret add tokens/github
kern secret add tokens/openai

# proxy request — credential stays in the wallet
kern fetch tokens/github https://api.github.com/user
```

## Agent integration (MCP)

Add kern as an MCP server. The agent talks to the wallet — never holds the keys.

```json
{
  "mcpServers": {
    "kern": {
      "command": "npx",
      "args": ["@daslab/kern", "mcp"]
    }
  }
}
```

```
Agent: "Fetch my GitHub repos"

→ kern_fetch(secret: "tokens/github", url: "https://api.github.com/user/repos")
→ wallet decrypts tokens/github, injects Bearer token, makes the request
→ returns JSON response to agent

Agent got the data. Never saw the token.
```

```
Agent: "Add my Stripe test key"

→ kern_add(name: "testing/stripe")
→ browser opens kern's local form
→ you paste the key
→ encrypted into secrets/testing/stripe.age

Credential went: browser → wallet → encrypted file. Agent never saw it.
```

### MCP tools

| Tool | Mode | Description |
|------|------|-------------|
| `kern_fetch` | proxy | Authenticated HTTP request. Credential stays in the wallet. |
| `kern_get` | direct | Decrypt and return a credential value. |
| `kern_add` | — | Add a credential via browser form. Agent never sees it. |
| `kern_rotate` | — | Replace a credential via browser form. |
| `kern_remove` | — | Delete a credential. |
| `kern_list` | — | List credential names (never values). |
| `kern_status` | — | Wallet health check. |
| `kern_recipients` | — | List recipients (public keys). |

## Vault layout

Credentials are age-encrypted files in folders. Each folder has a `.recipients` file controlling who can decrypt. Commit the whole thing to git — it's ciphertext without the private key.

```
secrets/
├── .recipients              # all nodes
│
├── tokens/                  # API credentials
│   ├── github.age
│   ├── openai.age
│   └── stripe.age
│
├── infra/                   # production infrastructure
│   ├── database_url.age
│   └── redis_url.age
│
└── testing/                 # dev + CI only
    ├── .recipients          # narrower: Alice + CI (not prod)
    ├── stripe_test.age
    └── llm.age
```

### Scoping rules

- Each folder can have its own `.recipients`
- No `.recipients`? Inherits from parent
- Prod server decrypts `tokens/` and `infra/` — never sees test keys
- CI decrypts `testing/` — never touches prod credentials

## Nodes

A node is any machine with an age keypair — your laptop, CI, a production server.

### Add a teammate

```bash
# Bob generates his identity
kern identity init && kern identity pubkey
# → age1xyz...

echo "age1xyz..." >> secrets/.recipients
echo "age1xyz..." >> secrets/testing/.recipients
kern secret rewrap
git commit -am "add Bob"
```

### Add CI

```bash
kern identity init --save /tmp/ci-key
echo "$(kern identity pubkey)" >> secrets/.recipients
echo "$(kern identity pubkey)" >> secrets/testing/.recipients
kern secret rewrap
gh secret set KERN_AGE_KEY < /tmp/ci-key
rm /tmp/ci-key
```

One secret in CI. Everything else decrypts from git.

### Revoke access

```bash
kern recipients remove age1xyz...
kern secret rewrap
kern secret rotate tokens/github  # rotate what they had access to
```

## Machine payments

The same proxy that protects API keys protects payment credentials. An agent that purchases compute, calls paid APIs, or manages subscriptions needs payment keys — but shouldn't hold them.

```typescript
// agent charges a customer — never sees sk_live_*
const resp = await wallet.fetch("tokens/stripe", "https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "amount=2000&currency=usd&automatic_payment_methods[enabled]=true",
});
```

Works with [Stripe MPP](https://docs.stripe.com/payments/machine/mpp) for machine-to-machine payments and any API that takes Bearer auth. [x402](https://www.x402.org/) support — auto-negotiating `402 Payment Required` responses — is on the roadmap.

## CLI

```bash
kern identity init [--save PATH]   # create age keypair
kern identity pubkey               # print public key

kern secret add [FOLDER/]NAME      # encrypt and store
kern secret get [FOLDER/]NAME      # decrypt to stdout
kern secret list                   # show all names
kern secret rotate [FOLDER/]NAME   # replace a value
kern secret delete [FOLDER/]NAME   # remove
kern secret rewrap                 # re-encrypt for current recipients

kern fetch SECRET URL [OPTIONS]    # proxy request (credential stays in wallet)
  --method POST                    # HTTP method (default GET)
  --body '{"key": "val"}'          # request body

kern recipients                    # list all recipients
kern recipients remove KEY         # remove from all folders

kern mcp                           # start MCP server
kern serve                         # start local credential form
```

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `KERN_AGE_KEY` | age private key | `~/.kern/key` |
| `KERN_VAULT_DIR` | vault directory | `./secrets` |

## How it compares

| | .env | SOPS | Vault | kern |
|---|---|---|---|---|
| Encrypted at rest | | ✓ | ✓ | ✓ |
| Lives in git | | ✓ | | ✓ |
| Folder scoping | | | ✓ | ✓ |
| No server | ✓ | ✓ | | ✓ |
| Proxy mode | | | | ✓ |
| Agent-native (MCP) | | | | ✓ |
| TypeScript SDK | | | | ✓ |

## License

MIT
