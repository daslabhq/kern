# Kern — architecture (v0.1, draft)

## What Kern is

**Kern is an embeddable C library and accompanying spec for the three
primitives every agent platform reinvents badly:**

1. **Identity** — one keypair per actor, deterministically derived from a
   seed phrase the user owns.
2. **Secrets** — encrypted-at-rest vault, decrypted only inside the
   process at use, scrubbed after.
3. **Capabilities** — signed grants of permission from one identity to
   another, time-bounded and revocable.

Kern is **not** an agent runtime. It carries no notion of "tool",
"agent", "prompt", or "model". It is the thin trust layer below those
concepts. Any agent platform — LangChain, MCP servers, Cloudflare
Agents, Vercel AI SDK, or a custom Lua VM like Korn — can embed Kern
and inherit the three primitives without rewriting them.

## What Korn is

Korn is a specific agent runtime that uses Kern. The relationship is the
same as Linux to POSIX, or Postgres to SQL:

```
┌────────────────────────────────────────────────────────────┐
│  Korn — agent runtime                                      │
│  .korn files, Lua VM, CAS, repo, tools, mesh transport     │
│  one opinionated way to build agents                       │
└──────────────────────┬─────────────────────────────────────┘
                       │ links + calls
                       ▼
┌────────────────────────────────────────────────────────────┐
│  Kern — identity + secrets + capabilities                  │
│  embeddable C lib + protocol spec                          │
│  used by Korn AND by any other agent platform              │
└────────────────────────────────────────────────────────────┘
```

Other agent platforms can adopt Kern incrementally: start with secrets,
add identity later, capabilities last. They never have to switch to
Korn the runtime. Korn just happens to be the first and most complete
user of Kern.

## What Kern is NOT

To keep the surface tight, Kern explicitly does not:

- Embed any scripting language (no Lua, no JS, no Python).
- Define an agent file format.
- Define a tool-call format.
- Provide a runtime / scheduler / event loop.
- Talk to LLM APIs.
- Define transports (mesh, BLE, mDNS — those belong above Kern, in
  Korn or in whatever runtime is using Kern).

If a feature has nothing to do with "*who* and *what they can do*", it
does not belong in Kern.

## The FFI surface

Kern exposes one C header (`kern.h`) with ~12 functions. Other-language
SDKs (TypeScript, Rust, Python, Swift, Kotlin) wrap this header. The
header is the canonical source of truth; the SDKs are thin.

```c
/* lifecycle */
kern_t *kern_open_from_seed(const char *bip39_mnemonic, const char *passphrase);
kern_t *kern_open_from_keychain(const char *app_id);
void    kern_close(kern_t *k);

/* identity */
const char *kern_identity_pubkey(kern_t *k);          /* "npub1..." */
int         kern_sign(kern_t *k, const uint8_t *data, size_t len,
                      uint8_t *sig_out64);
int         kern_verify(const char *pubkey, const uint8_t *sig64,
                        const uint8_t *data, size_t len);

/* secrets */
int   kern_secrets_get(kern_t *k, const char *name, uint8_t **out, size_t *out_len);
int   kern_secrets_put(kern_t *k, const char *name, const uint8_t *value, size_t len);
int   kern_secrets_delete(kern_t *k, const char *name);
void  kern_secret_zero(uint8_t *secret, size_t len);

/* capabilities */
char *kern_cap_issue(kern_t *k, const char *audience_pubkey,
                     const char *capability, int64_t expires_unix);
int   kern_cap_verify(const char *token, const char *expected_audience,
                      const char *expected_capability);

/* free anything Kern allocated */
void kern_free(void *p);
```

Twelve functions. Plus storage- and identity-backend hooks (next section).
That's the entire Kern API.

## Pluggable backends

The two things that vary across hosts:

1. **Storage backend** — where vault files live: filesystem, IndexedDB,
   ESP32 NVS, S3, etc.
2. **Identity-key backend** — where the master seed key lives: macOS
   Keychain, file, TPM, YubiKey, derived-from-passphrase, etc.

Both are pluggable via vtables:

```c
typedef struct kern_storage_backend {
    void *ctx;
    int (*read) (void *ctx, const char *path, uint8_t **out, size_t *out_len);
    int (*write)(void *ctx, const char *path, const uint8_t *data, size_t len);
    int (*list) (void *ctx, const char *prefix, char ***out_names, size_t *out_count);
    int (*remove)(void *ctx, const char *path);
} kern_storage_backend;

typedef struct kern_key_backend {
    void *ctx;
    int (*get_master)(void *ctx, uint8_t *out64);   /* returns ed25519 seed */
} kern_key_backend;

void kern_set_storage(kern_t *k, kern_storage_backend b);
void kern_set_keystore(kern_t *k, kern_key_backend b);
```

Kern ships with a default filesystem storage backend and a
passphrase-derived key backend. Host-native backends (Keychain, NVS,
etc.) are written per host.

## What it composes from

Where Kern leans on existing standards rather than inventing:

| Layer | Standard | Used for |
|---|---|---|
| Seed → keys | BIP-39 → SLIP-0010 | identity / wallet / age key derivation |
| Symmetric crypto | libsodium (ChaCha20-Poly1305) | vault payload encryption |
| Asymmetric crypto | libsodium (X25519, Ed25519) | recipient wrapping, signing |
| File encryption | **age** | vault file format |
| Capability tokens | **UCAN** | signed permission grants |
| Mnemonic encoding | BIP-39 (24-word English) | seed backup |

We **do not** ship our own crypto. Anything in Kern that looks like a
new format is a thin convention on top of these primitives.

## Versioning & stability

- v0.x: anything may change. Specs and FFI revised in lockstep.
- v1.0: FFI is frozen. Wire formats (vault file layout, capability
  token, signed agent envelope) are frozen for backwards
  compatibility.
- v2+: additive only. Deprecated functions remain. Old wire formats
  remain readable.

Spec drift between language SDKs is prevented by: (a) all SDKs wrap the
canonical C library, and (b) a conformance test suite (`spec/tests/`)
that every implementation runs.

## Footprint targets

| Target | libkern size | RAM at use |
|---|---|---|
| Bare C lib + libsodium statically linked | < 200 KB | < 64 KB |
| ESP32-S3 firmware delta | < 80 KB additional flash | < 16 KB additional RAM |
| TypeScript SDK (browser, gzipped) | < 30 KB | n/a |

These are aspirational v1 targets. v0.1 may be larger as we iterate.

## Open questions to resolve before v1

- Exact UCAN profile — full UCAN-1.0 or a stricter subset?
- Post-quantum migration path (Kyber wrap, ML-KEM-768, when?).
- Recovery story — social recovery primitive in Kern or above it?
- Audit log — local-only file or queryable structured store?
- Multi-seed support (for users who want strict separation, e.g.
  personal vs. work identities on one device)?

Each gets its own RFC as we approach v1.
