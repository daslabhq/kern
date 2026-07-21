# Kern vault (v0.1, draft)

## Concept

The vault is a directory of age-encrypted blobs, one per secret,
encrypted to N recipient pubkeys. **It is safe to commit to a public
git repository** — encrypted bytes reveal only the recipient set.

## On-disk layout

```
vault/                              ← root (configurable; default ./vault)
├── .recipients                     ← plaintext: one age pubkey per line
├── openai_api_key.age              ← age-encrypted bytes, recipients-of-record
├── anthropic_api_key.age
├── slack_webhook.age
└── prod/                           ← subdirectory = narrower recipient set
    ├── .recipients                 ← prod-only recipient list
    └── stripe_live.age
```

Rules:

- Filenames map directly to secret names: `vault/openai_api_key.age`
  holds the secret named `openai_api_key`. Underscore, dash, dot, slash
  permitted in names.
- Each directory may carry its own `.recipients`. **Nearest enclosing
  `.recipients` applies.** Files inherit from their parent dir if no
  local list.
- `.age` extension is mandatory — Kern refuses to touch files without
  it (defense against accidental plaintext).
- All other files in the vault directory are ignored by Kern.

## `.recipients` format

Plain text, one age pubkey per line, blank lines and `#` comments
allowed:

```
# Mirko's MacBook
age1abcdefghijklmnopqrstuvwxyz0123456789...
# Mirko's iPhone
age1zyxwvutsrqponmlkjihgfedcba9876543210...
# Render production server
age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq...
```

Recipients are added/removed by editing the file. After any change to
`.recipients`, `kern secrets rewrap` re-encrypts every secret in that
directory to the new list.

## File format

Each `.age` file is a standard
[age encryption file](https://age-encryption.org/v1) — Kern does **not**
extend age. Any tool that can read age files (the canonical `age`
binary, `rage`, language libraries) can read Kern vaults given the
right private key.

Layout (per age v1 spec):

```
age-encryption.org/v1
-> X25519 <recipient1-wrap>
<base64 ephemeral pubkey + base64 wrapped file key>
-> X25519 <recipient2-wrap>
<base64 ephemeral pubkey + base64 wrapped file key>
... (one stanza per recipient)
--- <base64 MAC>
<binary ciphertext: ChaCha20-Poly1305 of plaintext, in 64-KiB chunks>
```

The payload is the raw secret value. Kern does not impose JSON, binary,
or any encoding — what you put in is what you get out.

## Multi-environment pattern

Use directories to scope recipient sets:

```
vault/
├── .recipients              ← all team members (dev access)
├── dev/                     ← (inherits root recipients)
│   ├── test_api_key.age
│   └── ngrok_token.age
└── prod/
    ├── .recipients          ← only owner + production server
    ├── stripe_live.age
    └── postgres_url.age
```

Adding a teammate to `dev` but not `prod`: just edit `vault/.recipients`,
not `vault/prod/.recipients`. Re-wrap. Done.

## CLI verbs (reference impl)

```bash
kern identity init                       # generate mnemonic, store in OS keychain
kern identity pubkey                     # print age + npub
kern identity import "...24 words..."    # restore from mnemonic

kern secrets add NAME [--scope DIR]      # prompt for value, encrypt, write
kern secrets get NAME                    # print plaintext to stdout (machine consumption)
kern secrets edit NAME                   # open in $EDITOR with plaintext
kern secrets rotate NAME                 # like add, but warns on existing value
kern secrets delete NAME

kern secrets list                        # tree view, with recipient counts
kern secrets reveal NAME                 # show value + recipient list (for audit)

kern secrets rewrap [--scope DIR]        # re-encrypt to current .recipients
kern secrets share NAME --to PUBKEY      # add recipient to one file only
kern secrets revoke --from PUBKEY        # remove pubkey from all .recipients; rewrap; warn to rotate

kern secrets audit                       # local log of recent get/with calls
```

## API the agent code calls

Two patterns, both in the Kern FFI surface:

```c
/* shorthand: returns plaintext, caller MUST zero with kern_secret_zero */
int kern_secrets_get(kern_t *k, const char *name, uint8_t **out, size_t *out_len);

/* scoped form: plaintext lives only inside the callback */
typedef int (*kern_secrets_with_fn)(void *ctx, const uint8_t *value, size_t len);
int kern_secrets_with(kern_t *k, const char *name,
                      kern_secrets_with_fn fn, void *ctx);
```

Higher-level SDKs sugar these:

```ts
// TS
const k = await kern.secrets.with("openai", async (value) => {
    return openai.chat.completions.create({ ... });
});

// Lua (Korn)
secrets.with("openai", function(k)
    return http.fetch(url, { headers = { Authorization = "Bearer " .. k } })
end)
```

The scoped form is the documented preferred path. Korn's `secrets.get`
returns a *tainted userdata* that refuses `tostring`/`print`/`encode`
without explicit `:reveal()`. Other SDKs are encouraged to provide
equivalent at-use protection.

## Sync mechanism

Kern is sync-agnostic. The vault is just files. Pull it via:

- **git** (recommended for repos): `git pull` / `git push`
- **rsync / scp** (for ad hoc)
- **mesh push** (Korn-specific): `device.push_repo(":secrets", peer)`
  uses the existing Korn mesh repo primitives — no new wire format
- **object storage** (S3, R2): for self-hosted server deploys

In all cases the encrypted bytes are what travel; the unwrap key never
leaves the recipient device.

## Conflict handling

Per-file layout means concurrent adds never conflict. Concurrent edits
to the *same* file create a normal git conflict on the (encrypted)
bytes; resolution is "manually decrypt both, re-encrypt the merged
plaintext." `kern secrets resolve NAME` walks the user through this.

## Defense-in-depth

What the vault format protects against:

| Threat | Protection |
|---|---|
| Repo / disk leaked | ✓ encrypted at rest |
| Recipient revoked, future secrets read | ✓ as long as values rotate |
| Recipient revoked, past secrets still readable | partial — past git blobs still decryptable by ex-recipient. `kern secrets rotate` after `revoke` is essential. |
| Server compromised, env vars dumped | ✓ — only the server's age key was there; other recipients unaffected |
| Filename reveals what services you use | none in v0.1; consider opaque-ID extension in v1 |
| Recipient list reveals trust graph | none in v0.1 |
| Forced disclosure / coercion | none — encryption does not help here |

The vault format addresses at-rest. At-use protection (taint, scoped
unwrap, memory scrubbing) lives in the host runtime — see Korn's
implementation for one example.

## Open

- Opaque filenames (`vault/abc123.age` with encrypted name-index) —
  worth the friction?
- Encrypted `.recipients` (hide trust graph) — needs a separate wrap
  key for the recipients file itself.
- Capability-conditioned secrets (secret X readable only if you can
  present capability token Y) — composes with spec 03.
