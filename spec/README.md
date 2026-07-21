# Kern specs

This directory contains the on-the-wire and on-the-disk specs that any
*Kern implementation* must follow. The TypeScript implementation in this
repository (`@daslabhq/kern`) is one; Korn, an experimental Lua agent
runtime (archived at [mirkokiefer/korn](https://github.com/mirkokiefer/korn)),
was the first. The specs are written so anyone can build an alternative
implementation — in any language, on any platform — and have it
interoperate.

| Spec | Subject | Status |
| --- | --- | --- |
| [00-architecture.md](00-architecture.md) | the Kern/Korn split, what each layer owns, FFI surface | draft |
| [01-identity.md](01-identity.md) | BIP-39 seed → derived identity / wallet / age keys | draft |
| [02-vault.md](02-vault.md) | the per-file age-encrypted secret vault layout | draft |
| [03-capabilities.md](03-capabilities.md) | UCAN profile used by Kern for signed grants | draft |
| [04-signing.md](04-signing.md) | signed agent file format and verification | draft |
| [05-audit-log.md](05-audit-log.md) | hash-chained, receipt-signed audit log of credentialed calls | draft |

The leaf specs (01–05) lean on existing standards wherever possible —
BIP-39, age, UCAN, libsodium primitives — and only specify the *profile*
Kern uses. We invent as little new cryptography as we can get away with.

Stability: everything in this directory is `v0.1` and may change. Spec
revisions are documented at the top of each file. Stable specs will be
moved to `v1/`.
