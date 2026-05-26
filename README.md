# kern

[![tests](https://github.com/daslabhq/kern/actions/workflows/test.yml/badge.svg)](https://github.com/daslabhq/kern/actions/workflows/test.yml)

Encrypted secrets in git. Scoped by folder. Managed by agents.

```bash
npm install @daslab/kern
```

## The problem

91 API keys in a `.env` file. Shared over Slack. Copied between machines. Half of them are test keys that shouldn't be in production. New teammate joins — "ask the lead dev for the keys." Rotate one key — update it in 7 places, miss 2.

## How kern solves it

Secrets are age-encrypted files organized in folders. Each folder has a `.recipients` file that controls who can decrypt. Commit the whole thing to git — it's useless without a private key.

```
secrets/
├── .recipients                  # everyone (Alice + Production + CI)
├── .nodes                       # who's who
│
├── infra/                       # prod runtime
│   ├── database_url.age
│   ├── redis_url.age
│   ├── jwt_secret.age
│   └── r2.age                   # { access_key_id, secret, account_id }
│
├── oauth/                       # prod OAuth app credentials
│   ├── github.age               # { client_id, client_secret, app_id }
│   ├── google.age
│   └── slack.age
│
├── testing/                     # local dev + CI only
│   ├── .recipients              # Alice + CI (NOT production server)
│   ├── llm.age                  # { anthropic, openai, gemini }
│   ├── elevenlabs.age
│   ├── stripe_test.age
│   └── ci_demo.age
│
└── deploy/                      # CI/CD only
    ├── .recipients              # Alice + CI
    ├── apple_signing.age
    └── tauri_signing.age
```

Your production server only decrypts `infra/` and `oauth/` — it never sees test keys or deploy secrets. CI decrypts `testing/` and `deploy/` but never touches production database credentials. Each node sees only what it should.

## Quick start

```bash
# create your identity
kern identity init

# create the vault
mkdir -p secrets
kern identity pubkey >> secrets/.recipients

# add your first secret
kern secret add github_token

# group related credentials
mkdir -p secrets/testing
cp secrets/.recipients secrets/testing/.recipients
kern secret add testing/llm    # { "anthropic": "sk-...", "openai": "sk-..." }
```

## Use from code

```typescript
import { loadIdentityFromHost, openVault } from "@daslab/kern";

const vault = openVault({ identity: await loadIdentityFromHost() });

// simple value
const dbUrl = await vault.get("infra/database_url");

// grouped credentials
const llm = JSON.parse(await vault.get("testing/llm"));
const anthropicKey = llm.anthropic;
```

## Use from Claude Code

Add kern as an MCP server:

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
You: "Set up secrets for this project — I need GitHub OAuth,
      an OpenAI key for testing, and Stripe test credentials"

Claude → kern_add("oauth/github")
  → browser opens kern's local form
  → you paste client_id + client_secret
  → encrypted into secrets/oauth/github.age

Claude → kern_add("testing/openai")
  → same flow
  → encrypted into secrets/testing/openai.age

Claude → kern_add("testing/stripe")
  → same flow

"3 secrets added. testing/ is scoped to Alice + CI.
 oauth/ is available to all nodes."
```

Credentials go: browser form → kern → encrypted vault. The LLM never sees them.

## Nodes

A node is any machine with an age keypair — your laptop, CI, a server. Add a `.nodes` file to track them:

```
# secrets/.nodes
age1abc...  Alice          owner
age1def...  Production         server
age1ghi...  GitHub CI      ci
```

### Add a teammate

```bash
# Bob generates his keypair
kern identity init && kern identity pubkey
# → age1xyz...

# You add him to the folders he needs
echo "age1xyz..." >> secrets/.recipients
echo "age1xyz..." >> secrets/testing/.recipients
kern secret rewrap
git commit -am "add Bob"

# Bob clones, everything works
```

### Add CI

```bash
# generate a keypair for CI
kern identity init --save /tmp/ci-key
# add to the folders CI needs
echo "$(kern identity pubkey)" >> secrets/.recipients
echo "$(kern identity pubkey)" >> secrets/testing/.recipients
echo "$(kern identity pubkey)" >> secrets/deploy/.recipients
kern secret rewrap
# set the one CI secret
gh secret set KERN_AGE_KEY < /tmp/ci-key
rm /tmp/ci-key
```

One secret in CI. Everything else decrypts from git.

### Revoke access

```bash
# remove Bob's key from all .recipients files
kern recipients remove age1xyz...
kern secret rewrap
# rotate any secrets Bob had access to
kern secret rotate testing/openai
```

## Scoping rules

- Each folder can have its own `.recipients`
- A secret is encrypted to the `.recipients` in its folder
- If no `.recipients` in a folder, it inherits from the parent
- Root `.recipients` is the default for everything

This means:
- Secrets in `infra/` → encrypted to root recipients (everyone)
- Secrets in `testing/` → encrypted to testing's recipients (dev + CI, not prod)
- Secrets in `deploy/` → encrypted to deploy's recipients (dev + CI)

No duplication. No complex config. Just folders and recipient files.

## Local form server

```bash
kern serve
# → http://localhost:9271
```

Dashboard shows all secrets (names only), all nodes, folder structure. Add, edit, rotate secrets through the browser. Same server that MCP elicitation uses.

## CLI reference

```bash
kern identity init [--save PATH]   # create age keypair
kern identity pubkey               # print public key

kern secret add [FOLDER/]NAME      # encrypt and store
kern secret get [FOLDER/]NAME      # decrypt to stdout
kern secret list                   # show all names
kern secret rotate [FOLDER/]NAME   # replace a value
kern secret delete [FOLDER/]NAME   # remove
kern secret rewrap                 # re-encrypt for current recipients

kern recipients list               # show all nodes
kern recipients remove KEY         # remove a node from all folders

kern mcp                           # start MCP server
kern serve                         # start local form + dashboard
```

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `KERN_AGE_KEY` | age private key | `~/.kern/key` |
| `KERN_VAULT_DIR` | vault directory | `./secrets` |

## How it compares

| | .env | SOPS | Vault | 1Password | kern |
|---|---|---|---|---|---|
| Encrypted in git | no | yes | no | no | yes |
| Folder scoping | no | no | yes | yes | yes |
| No server needed | yes | yes | no | no | yes |
| TypeScript SDK | no | no | no | no | yes |
| Agent integration (MCP) | no | no | no | no | yes |
| Grouped credentials | no | yes | yes | yes | yes |

## Building on kern

kern is the encryption + scoping primitive. Build governance on top:

```typescript
import { loadIdentityFromHost, openVault } from "@daslab/kern";

// your platform wraps kern with policy
const vault = openVault({ identity: await loadIdentityFromHost() });

// kern handles: encrypted storage, folder scoping, recipients
const creds = await vault.get("oauth/github");

// you add: RBAC, approval flows, audit trails, asset-level permissions
await checkPolicy(user, "oauth/github", "read");
await auditLog(user, "oauth/github", "read");
```

The folder structure maps naturally to governance scopes — `testing/` is one access tier, `deploy/` is another, `infra/` is another. The primitive is simple; the policy layer is yours.

## License

MIT
