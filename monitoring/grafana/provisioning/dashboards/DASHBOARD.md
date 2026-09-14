# `grafana/provisioning/dashboards/dashboards.yaml` — Explained Line by Line

This file is **Grafana's dashboard auto-loader**. While `datasources.yaml` told Grafana *where to fetch data from*, this file tells Grafana *where to find dashboard JSON files* and *how to keep them in sync*.

Think of it as a **subscription card at a library**: "Every 30 seconds, walk over to `/var/lib/grafana/dashboards`, and load every dashboard JSON you find there into the `bongoDev` folder."

Grafana's provisioning system reads YAML files under `/etc/grafana/provisioning/dashboards/` when the container starts. Both folders are mounted in `compose.monitoring.yaml`:

```yaml
- ./grafana/provisioning:/etc/grafana/provisioning:ro
- ./grafana/dashboards:/var/lib/grafana/dashboards:ro
```

🔑 Notice there are **two paths involved**, and they serve different purposes:

| Host path | Container path | Role |
|---|---|---|
| `./grafana/provisioning/` | `/etc/grafana/provisioning/` | **Instructions** — this file lives here |
| `./grafana/dashboards/` | `/var/lib/grafana/dashboards/` | **Content** — the actual dashboard JSON files |

`dashboards.yaml` is the instruction that points at the content.

Let me walk through it.

---

## 1. `apiVersion: 1` — the schema version

```yaml
apiVersion: 1
```

- Same idea as in `datasources.yaml`: tells Grafana which version of the **provisioning schema** this file uses.
- `1` is the only supported value.
- It's *independent* of `datasources.yaml`'s `apiVersion` — each provisioning file declares its own.

---

## 2. `providers:` — the list of dashboard sources

```yaml
providers:
  - name: bongoDev Incident Lab
    ...
```

- A YAML **list** — each entry is a *provider* (a source of dashboards).
- A provider doesn't hold dashboards itself. It describes **where** dashboards come from (a directory, a URL, etc.) and **how** Grafana should load them.
- You can have multiple providers — e.g., one folder of "official" dashboards, one folder of "custom" dashboards. Here, there's just one.

Let's break down the single provider's fields.

---

## 3. `name: bongoDev Incident Lab` — the provider's name

```yaml
name: bongoDev Incident Lab
```

- A **friendly label** for this provider, used internally by Grafana.
- It appears in Grafana's logs when this provider runs (`provisioning.dashboard ... name=bongoDev Incident Lab`).
- It is **not** the folder name shown in the UI — that's the next field.

**What's "bongoDev"?** It's likely the name of the training program, bootcamp, or company this lab was built for. Including it in the provider name makes it easy to identify the source if Grafana has multiple dashboard providers.

---

## 4. `orgId: 1` — which organization owns these dashboards

```yaml
orgId: 1
```

- Grafana supports **multiple organizations** (orgs) — isolated tenants inside one Grafana instance.
- `orgId: 1` is the **default org**, created automatically on first boot.
- In almost every single-team setup, everything lives in org `1`. That's the case here — this lab has one org.
- If you had multiple teams sharing Grafana, you'd set up additional orgs and use a different `orgId` per provider.

**Why specify it at all?** Because Grafana's provisioning API requires it. Even in a single-org setup, you must be explicit.

---

## 5. `folder: bongoDev` — where dashboards appear in the UI

```yaml
folder: bongoDev
```

- 🔑 The **UI folder name** where all dashboards from this provider will be grouped.
- When you open Grafana's dashboard list, you'll see a folder named **"bongoDev"**, and inside it, every dashboard JSON from the mounted directory.
- This is what keeps things organized: instead of a flat list of 20 dashboards, you get a tidy `bongoDev/` folder.

**If omitted:** dashboards would land in the **General** folder (the default root). Providing a folder name is a best practice — it groups related dashboards and makes them easier to find.

**Folder lifecycle:**
- If `folder: bongoDev` doesn't exist, Grafana **creates it** on first provision.
- If it already exists, Grafana reuses it.
- Deleting the folder in the UI would cause it to be recreated on the next provisioning cycle (because the provider still declares it).

---

## 6. `type: file` — where the dashboards come from

```yaml
type: file
```

- 🔑 The **source type** for this provider. `file` means: *"read dashboard JSON files from a local directory."*
- It's the only type Grafana supports for dashboard provisioning. (Other provisioning mechanisms like HTTP-based ones aren't officially supported.)
- Consequence: the dashboards must be **present as JSON files on disk** inside the Grafana container. That's why the compose file mounts `./grafana/dashboards:/var/lib/grafana/dashboards:ro`.

**In plain terms:** Grafana walks the directory, reads every `.json` it finds, and registers each one as a dashboard in the `bongoDev` folder.

---

## 7. `disableDeletion: false` — allow Grafana to remove stale dashboards

```yaml
disableDeletion: false
```

This is one of the most misunderstood flags. Let's be precise:

- **What it controls:** what happens if a dashboard JSON file is **deleted from disk** after Grafana has already loaded it.
- **`false`** → Grafana **will remove** the dashboard from its database when the file disappears. ✅ Used here.
- **`true`** → Grafana **keeps** the dashboard in the UI even after the file is gone (it just becomes an orphan).

**Why `false` here?** Because the file system is the source of truth. If you delete `backend-overview.json` from `./grafana/dashboards/`, you want that dashboard to disappear from Grafana on the next sync. Otherwise, stale dashboards would pile up.

**Common confusion:** Some people think `disableDeletion: false` means "users can delete dashboards in the UI." It does *not*. UI deletion is controlled by Grafana's **role permissions** (`editors` can delete, `viewers` cannot). This flag only governs file → Grafana synchronization.

**Rule of thumb:**
- Use `false` if the JSON files are your **single source of truth** (this lab).
- Use `true` if you want to edit dashboards in the UI and keep those edits, treating the files as a one-time seed.

⚠️ With `false`, any UI edits to provisioned dashboards are **overwritten on the next sync**. That's by design — the file wins.

---

## 8. `updateIntervalSeconds: 30` — how often to check for changes

```yaml
updateIntervalSeconds: 30
```

- Grafana **polls the directory every 30 seconds**.
- On each poll, it:
  1. Scans `/var/lib/grafana/dashboards/` for `*.json` files.
  2. Compares each file to what it already has.
  3. Adds new dashboards, updates changed ones, removes deleted ones (because `disableDeletion: false`).
- 🔑 **Why polling instead of a one-shot load?** Because you might edit a dashboard JSON while Grafana is running (e.g., tweaking a panel in the lab). With polling, the change appears in Grafana **within 30 seconds** — no container restart needed.
- **Trade-off:** a lower value (e.g., 5s) means faster sync but more disk I/O. 30s is a comfortable default for a lab; production setups often use 60–300s.

**Note:** This only applies to **new/changed files**. If nothing changed on disk, the poll is a no-op.

---

## 9. `options.path: /var/lib/grafana/dashboards`

```yaml
options:
  path: /var/lib/grafana/dashboards
```

- 🔑 The **container path** Grafana scans for dashboard JSON files.
- This must match the mount in `compose.monitoring.yaml`:

```yaml
- ./grafana/dashboards:/var/lib/grafana/dashboards:ro
```

- Inside the container, `/var/lib/grafana/dashboards/` contains whatever is in `./grafana/dashboards/` on your host — and that's where the dashboard JSON files live in your repo.

**Note:** This is *not* Grafana's internal database folder. Grafana's own database is at `/var/lib/grafana/grafana.db` (backed by the `grafana_data` volume). The `dashboards/` subfolder here is a **separate, read-only** mount reserved for provisioning.

**Possible gotcha:** If this path doesn't exist inside the container, Grafana logs a warning and provisions zero dashboards. The compose file's volume mount guarantees it exists.

---

## 10. How it all fits together

Here's what happens on container startup:

```
1. Grafana container starts
2. Grafana reads /etc/grafana/provisioning/dashboards/*.yaml
   (this file)
3. It finds one provider: "bongoDev Incident Lab"
4. Provider says: "Scan /var/lib/grafana/dashboards every 30s"
5. Grafana ensures folder "bongoDev" exists in org 1
6. Grafana loads every .json file from that directory
   → each becomes a dashboard inside the "bongoDev" folder
7. Every 30 seconds thereafter, Grafana re-scans:
   - New file?      → add dashboard
   - Changed file?  → update dashboard
   - Deleted file?  → remove dashboard (disableDeletion: false)
```

**Idempotent:** Restart Grafana a hundred times — you always end up with the same set of dashboards in the same folder. No duplicates, no manual imports.

---

## 11. Full picture: how dashboards + data sources connect

```
┌───────────────────────────────────────────────────────────────────────┐
│                       Grafana container                               │
│                                                                       │
│  /etc/grafana/provisioning/                                           │
│    ├── datasources/                                                   │
│    │   └── datasources.yaml    ──▶ "Prometheus + Loki live here"      │
│    └── dashboards/                                                    │
│        └── dashboards.yaml     ──▶ "Load JSONs from ..."  ──┐         │
│                                                             │         │
│  /var/lib/grafana/dashboards/                               │         │
│    ├── backend-overview.json   ◀─────────────────────────────┘        │
│    ├── api-latency.json                                               │
│    ├── container-resources.json                                       │
│    └── ...                                                            │
│                                                                       │
│  Inside each dashboard JSON:                                          │
│    "datasource": { "uid": "prometheus" }   ← from datasources.yaml    │
│    "datasource": { "uid": "loki" }         ← from datasources.yaml    │
└───────────────────────────────────────────────────────────────────────┘
         │                                                       ▲
         │ queries Prometheus / Loki                             │
         ▼                                                       │
  ┌──────────────┐  ┌──────────────┐                    ┌─────────────┐
  │  Prometheus  │  │     Loki     │                    │  Your       │
  │   :9090      │  │    :3100     │                    │  browser    │
  └──────────────┘  └──────────────┘                    └─────────────┘
```

- `datasources.yaml` says **where the data comes from**.
- `dashboards.yaml` says **where the dashboards come from**.
- Dashboard JSON files reference data sources by `uid` (`prometheus`, `loki`) — which is why the `uid`s in `datasources.yaml` matter.

---

## 12. TL;DR table

| Field | Value | Meaning |
|---|---|---|
| `apiVersion` | `1` | Provisioning schema version |
| `providers[0].name` | `bongoDev Incident Lab` | Internal label for the provider (shows in logs) |
| `orgId` | `1` | Grafana org where dashboards are registered (default org) |
| `folder` | `bongoDev` | UI folder name where dashboards appear |
| `type` | `file` | Load dashboards from local JSON files |
| `disableDeletion` | `false` | Remove dashboards from Grafana when their JSON file is deleted |
| `updateIntervalSeconds` | `30` | Poll the directory every 30 seconds for changes |
| `options.path` | `/var/lib/grafana/dashboards` | Container path Grafana scans for JSON files |

**In one sentence:** This file tells Grafana, *"Every 30 seconds, scan `/var/lib/grafana/dashboards` for dashboard JSON files, and keep them in sync with the `bongoDev` folder in org 1 — adding new ones, updating changed ones, and removing deleted ones."*

---

## 🔗 Why this file matters to the whole stack

So far, each piece has done one job:

| File | Job |
|---|---|
| `compose.monitoring.yaml` | Start the containers |
| `prometheus.yml` | Tell Prometheus what to scrape |
| `config.alloy` | Ship container logs to Loki |
| `loki-config.yml` | Store logs on disk |
| `datasources.yaml` | Tell Grafana where the data is |
| **`dashboards.yaml`** | **Tell Grafana where the dashboards are** |

Without `dashboards.yaml`, Grafana would start with **zero dashboards** — you'd have to import each JSON by hand and organize them into folders yourself. With it, the moment Grafana boots, the `bongoDev` folder appears, populated with every dashboard in your repo.

Combined with `datasources.yaml`, this gives you a **fully self-configuring Grafana**: data sources wired up, dashboards loaded, everything in the right folder — all from files checked into Git.