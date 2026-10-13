# Independent encrypted recovery (fictional data only)

`encrypted-backup.mjs` adds a provider-neutral foundation: original binary images stream through authenticated AES-256-GCM frames, with a unique per-archive key derived using HKDF-SHA256. The separate 32-byte recovery key is never put inside the archive. Every frame authenticates its archive header and position; a required authenticated completion record rejects incomplete, reordered and appended files. SHA-256 also verifies every original against the canonical attachment record.

Restoration runs with Node 22.13+ and its built-in SQLite; no Firebase, AI provider, account or network is needed. It preserves canonical JSON, authorship, corrections, agreement approvals, adventure event chains and exact originals, and creates a searchable SQLite database. Failed authentication removes private staging files and never publishes a recovery directory. Existing backups and recovery destinations are never overwritten.

The streaming API accepts an async sequence of `{id, mime, stream}` images. An authorised export adapter can supply one original at a time without base64 or keeping a photo collection in memory. This version bounds canonical metadata at 64 MiB and each binary at 2 GiB. Those are explicit format limits, not a claim of an unlimited archive. The current browser’s unencrypted JSON download remains a local demonstration; it is not the production backup workflow. The fictional Firebase adapter now takes a single read-only metadata snapshot with paginated queries and feeds immutable binary streams directly to encryption. An emulator-backed recovery drill verifies this path. Hosted snapshots, scheduled runs, retained generations and the durable external destination still need qualification.

For an offline drill, a source directory contains `records.json` and `media/<canonical-image-id>` (including `<id>-preview` where applicable). A restored v2 directory can itself be backed up again:

```sh
node memory/backup-cli.mjs key /outside-repository/fictional-recovery.key
node memory/backup-cli.mjs backup /outside-repository/fictional-recovery.key /outside-repository/fictional-source /outside-repository/fictional.jmb
node memory/backup-cli.mjs restore /outside-repository/fictional-recovery.key /outside-repository/fictional.jmb /outside-repository/new-recovery
```

Keep recovery keys separate from backup storage. Losing the key loses access; saving the key next to the backup defeats that separation. No real key, private archive or restored content belongs in this public repository. Selecting key custody, backup destination and retention is required before real-content use. No external storage or paid service has been activated.
