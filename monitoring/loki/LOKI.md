# `loki/loki-config.yml` — Explained Line by Line

This is **Loki's configuration** — it tells Loki *how to run*, *where to store logs*, and *how to organize its index*. If Alloy is the clerk who delivers letters, Loki is the **filing room**: this file describes the room's layout, the filing system, and how long papers live on the shelves.

Loki is designed to be **cheap and simple** — unlike Elasticsearch, it doesn't index log *content*, only **labels**. This file reflects that philosophy: most sections are minimal, and the storage is just plain files on disk.

Let me walk through each block.

---

## 1. `auth_enabled: false` — no authentication

```yaml
auth_enabled: false
```

- If `true`, Loki would require HTTP basic auth (multi-tenant mode with `X-Scope-OrgID` headers).
- `false` → **single-tenant mode**, no auth needed. Anyone who can reach `loki:3100` can push and query.

**Why it's safe here:** Loki isn't exposed to the internet. In `compose.monitoring.yaml`, its port is bound as `127.0.0.1:3100:3100` — **loopback only**. Only Alloy (pushing) and Grafana (querying) hit it, both over the internal `monitoring` Docker network. No external user can reach it, so auth isn't necessary.

⚠️ **In production**, if you exposed Loki publicly, you'd want `auth_enabled: true`.

---

## 2. `server:` — the HTTP listener

```yaml
server:
  http_listen_port: 3100
```

- Loki listens for HTTP on port **3100**.
- That's where Alloy pushes logs (`/loki/api/v1/push`) and where Grafana queries them (`/loki/api/v1/query_range`).
- This is why `compose.monitoring.yaml` maps `127.0.0.1:3100:3100` and why `alloy/config.alloy` posts to `http://loki:3100/loki/api/v1/push`.

**Note:** There's also a `grpc_listen_port` (default 9095) that Loki uses internally for some operations, but it's not configured here — the default is fine for a single-node setup.

---

## 3. `common:` — settings shared across Loki's internal parts

```yaml
common:
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory
  replication_factor: 1
  path_prefix: /loki
```

Loki is normally a **distributed system** — it has separate components (distributor, ingester, querier, compactor) that coordinate via a "ring" (a shared membership list). But it can also run as a **single binary** (which is what's happening here).

### `ring.instance_addr: 127.0.0.1`
> "In the hash ring, this instance is known as `127.0.0.1`."

The "ring" is how Loki's components find each other. With one instance, it just points to itself.

### `ring.kvstore.store: inmemory`
> "Keep the ring's membership **in memory**, not in Consul/Etcd."

- Loki supports Consul, Etcd, or in-memory for ring state.
- `inmemory` means: don't persist the ring — just keep it in RAM.
- **Fine for a single-instance setup.** If Loki restarts, the ring is rebuilt from scratch. If you had multiple Loki instances, you'd need a shared store like Consul.

### `replication_factor: 1`
> "Each log line is stored on **one** instance, not replicated."

- In a multi-instance cluster, you'd set this to 3 so that losing one instance doesn't lose data.
- Here there's only one Loki instance, so replication is meaningless — `1` is correct.

### `path_prefix: /loki`
> "All Loki's data lives under `/loki` inside the container."

- This is the **root** for Loki's files. Other paths (`/loki/chunks`, `/loki/compactor`, `/loki/index_*`) are relative to this.
- It maps to the `loki_data` named volume (`loki_data:/loki` in `compose.monitoring.yaml`), so all this data survives container restarts.

---

## 4. `schema_config:` — the index layout

```yaml
schema_config:
  configs:
    - from: 2024-04-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
```

This is the most important block. It defines **how Loki organizes its index over time.**

### Why "from: 2024-04-01"?
Loki stores logs using a **schema version**. When a new schema is released, you add a new entry to `configs` with a later `from:` date. Loki reads all entries and knows: "before this date, use schema X; after, use schema Y."

Here there's only **one entry**, starting from 2024-04-01, so all logs written now use this single schema. The date just needs to be in the past.

### `store: tsdb`
> "Use the TSDB index format."

- TSDB (Time Series Database index) is Loki's **modern, recommended** index format — compressed, fast, and efficient.
- The older options were `boltdb-shipper` and `boltdb`. `tsdb` is the current best practice.
- The index tracks *which labels exist* and *where their chunks live* — **not** the log contents.

### `object_store: filesystem`
> "Store the actual log chunks (the data) on the local filesystem."

- Loki separates **index** (the label lookup table) from **object store** (the raw log data, called "chunks").
- Options for object store: `s3`, `gcs`, `azure`, `filesystem`. Here it's `filesystem` — local disk.
- Perfect for a single-host lab; a production setup would use S3/GCS.

### `schema: v13`
> "Use schema version 13."

- The current stable schema at the time of writing. Different versions change how index keys are hashed and stored.
- You don't need to understand v13's internals — just know it's the recommended version and works with `tsdb`.

### `index.prefix: index_`
> "Name index files with the prefix `index_`."

- Files on disk will look like `/loki/index_12345` (roughly). It's just a naming convention to keep things organized.

### `index.period: 24h`
> "Roll over the index into a new file **every 24 hours**."

- Each day, Loki starts a fresh index file. Yesterday's index becomes read-only.
- This makes **compaction** and **retention** much easier: to delete old data, you just delete old index+chunk files.
- 24h is a common default — smaller periods create more files, larger periods create larger files that are slower to compact.

**After this block, Loki writes:**
```
/loki/
├── index_<date1>          ← index files, one per 24h period
├── index_<date2>
├── chunks/                ← actual log data (from storage_config below)
└── compactor/             ← compactor's working directory
```

---

## 5. `storage_config:` — where chunks live

```yaml
storage_config:
  filesystem:
    directory: /loki/chunks
```

- The **object store** (defined above as `filesystem`) needs a directory to write to.
- This says: put log chunks under `/loki/chunks`.
- Since `path_prefix: /loki` and this is `/loki/chunks`, chunks live in the `loki_data` volume like everything else.

**What's a "chunk"?** Loki groups many log lines together (usually those sharing the same label set within a time window) and compresses them into a **chunk** — a gzipped blob. Chunks are what actually contain your log text. The index just points to them.

---

## 6. `compactor:` — the garbage collector

```yaml
compactor:
  working_directory: /loki/compactor
```

- The **compactor** is a background process that:
  - **Merges** small index files into bigger ones (fewer, cleaner files).
  - **Applies retention** — deletes data older than `retention_period` (not set here, so default behavior applies).
  - **Cleans up** chunks whose index entries have been removed.
- `working_directory: /loki/compactor` → scratch space for its operations.

**Important:** `retention_period` is **not set** in this config. In Loki 3.x, retention defaults to **disabled** (unlimited). So unless it's enabled elsewhere, **Loki will keep logs forever** — or until the disk fills. This is a common gotcha.

To enable retention, you'd add:
```yaml
limits_config:
  retention_period: 168h   # 7 days
compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: filesystem
```

Your current config doesn't have this, so logs are kept indefinitely by default.

---

## 7. Full picture: what this config produces on disk

```
loki_data volume  (mounted at /loki inside the container)
│
├── index_<day1>              ← TSDB index files (rolled every 24h)
├── index_<day2>
├── index_<day3>
│
├── chunks/                   ← compressed log data ("chunks")
│   └── <fake-org-id>/        ← even with auth off, Loki uses a default tenant
│       └── <fingerprint>/
│           └── <timestamp>.gz
│
├── compactor/                ← scratch space for compaction
│
└── wal/                      ← write-ahead log (default, not shown in config)
```

On restart, Loki reads `index_*` files, cross-references them with `chunks/`, and can serve queries immediately. Nothing is lost because everything lives in the `loki_data` named volume.

---

## 8. How this config connects to the rest of the stack

```
┌──────────────────┐                            ┌──────────────────────┐
│   Alloy          │  POST /loki/api/v1/push    │   Loki :3100         │
│                  │──────────────────────────▶ │                      │
│                  │                            │  auth_enabled: false │
└──────────────────┘                            │  schema: v13 / tsdb  │
                                                │  filesystem storage  │
┌──────────────────┐                            │                      │
│   Grafana        │  GET  /loki/api/v1/query   │  writes → /loki      │
│                  │◀─────────────────────────  │  (loki_data volume)  │
└──────────────────┘                            └──────────────────────┘
```

- **Alloy → Loki:** pushes over HTTP on port 3100. No auth needed (matches `auth_enabled: false`).
- **Grafana → Loki:** queries over HTTP on port 3100. Same.
- **Loki → disk:** writes everything under `/loki`, which is the `loki_data` volume.
- **Compactor:** runs in the background inside Loki, merging indexes and (if configured) deleting old data.

---

## 9. TL;DR table

| Block | Meaning | Simple analogy |
|---|---|---|
| `auth_enabled: false` | No login required; single-tenant | Open filing room, no keycard |
| `server.http_listen_port: 3100` | Listen for pushes/queries on 3100 | The filing room's front desk |
| `common.ring.instance_addr: 127.0.0.1` | This instance's ID in the ring | "It's just me here" |
| `common.ring.kvstore.store: inmemory` | Ring state kept in RAM | Remember coworkers' names, no phonebook |
| `common.replication_factor: 1` | No copies, one instance | Only one copy of each letter |
| `common.path_prefix: /loki` | All data under `/loki` | Filing room's floor number |
| `schema_config.configs[0].from` | Date this schema starts applying | "From this day forward..." |
| `store: tsdb` | Index format | Card catalog system |
| `object_store: filesystem` | Store chunks on local disk | The actual filing cabinets |
| `schema: v13` | Schema version | Catalog format version |
| `index.prefix: index_` | Index filename prefix | Files named "index_..." |
| `index.period: 24h` | New index every day | New catalog every morning |
| `storage_config.filesystem.directory` | Where chunks go | "Put papers in /loki/chunks" |
| `compactor.working_directory` | Compactor scratch space | Janitor's closet |

**In one sentence:** This config tells Loki to run as a **single, auth-free instance on port 3100**, using the **modern TSDB index (v13)**, storing index files **rolled every 24 hours** and log chunks **on the local filesystem** under `/loki`, with a **background compactor** keeping things tidy — and no retention limit, so logs are kept indefinitely unless you add one.