# `grafana/provisioning/datasources/datasources.yaml` — Explained Line by Line

This file is **Grafana's auto-configuration for data sources**. Without it, you'd have to log into Grafana, click "Add data source," pick Prometheus, paste a URL, do the same for Loki, and repeat every time you rebuild the container. With it, **Grafana comes up already wired** to Prometheus and Loki on first boot.

Think of it as a **pre-filled address book** handed to Grafana at startup: "Here are the two services you can talk to, here's where they live, and here's how to reach them."

Grafana's provisioning system reads all YAML files under `/etc/grafana/provisioning/datasources/` when the container starts. That path is mounted in `compose.monitoring.yaml`:

```yaml
- ./grafana/provisioning:/etc/grafana/provisioning:ro
```

Let me walk through it.

---

## 1. `apiVersion: 1` — the schema version

```yaml
apiVersion: 1
```

- Tells Grafana which version of the **provisioning API schema** this file uses.
- `1` is the only currently supported value — it's been stable for years.
- If Grafana ever changes the file format in a breaking way, it'd introduce `apiVersion: 2`. For now, always write `1`.

**Note:** This is *Grafana's* API version, not Grafana's own version (`13.2.0` in the compose file) and not Prometheus's or Loki's. It's just a schema tag.

---

## 2. `datasources:` — the list of data sources

```yaml
datasources:
  - name: Prometheus
    ...
  - name: Loki
    ...
```

- A YAML **list** (note the `-` markers) — each entry is one data source.
- Grafana will create or update each one at startup.
- There are two here: **Prometheus** for metrics, **Loki** for logs.

Let's go through them one at a time.

---

## 3. Data source #1 — Prometheus

```yaml
- name: Prometheus
  uid: prometheus
  type: prometheus
  access: proxy
  url: http://prometheus:9090
  isDefault: true
  editable: false
```

### `name: Prometheus`
- The **display name** shown in Grafana's UI (dropdowns, data source list, dashboard panels).
- Purely cosmetic — you could call it "Metrics" or "Prod-Prom" and it'd still work.
- However, dashboards sometimes reference data sources by name, so keeping it standard ("Prometheus") is a good habit.

### `uid: prometheus`
- The **unique identifier** for this data source, used internally and in dashboard JSON files.
- Dashboards reference data sources by `uid` (not by name), so this is the **stable link** between a dashboard panel and its backend.
- If you rename the data source later, the `uid` stays the same, and dashboards keep working.
- 🔑 **Convention:** keeping the `uid` short and predictable (`prometheus`, `loki`) means dashboards are portable across environments — the same dashboard JSON works on your laptop, in the lab, and in production, as long as the `uid` matches.

### `type: prometheus`
- Tells Grafana this data source speaks the **Prometheus HTTP API**.
- Grafana has built-in support for it — no plugin needed. It knows how to translate Grafana's query builder (and PromQL) into the right API calls.
- Other possible values: `loki`, `elasticsearch`, `influxdb`, `tempo`, `graphite`, etc.

### `access: proxy`
- **How Grafana talks to the data source:**
  - `proxy` → the **Grafana server** (the container) makes the HTTP request to Prometheus, then forwards the result to your browser. ✅ Used here.
  - `direct` → your **browser** makes the request directly to Prometheus. ❌ Not used here.
- 🔑 **Why `proxy` matters here:** Prometheus lives at `http://prometheus:9090` — an internal Docker hostname that only resolves *inside* the `monitoring` Docker network. Your browser (on your laptop) has no idea what `prometheus` means. So Grafana's server does the lookup instead, since it's on that same network.
- `direct` would only work if Prometheus had a publicly reachable URL. Not the case here.
- **Also a security benefit:** with `proxy`, Prometheus never has to be exposed to the browser at all. It can stay on `127.0.0.1:9090`.

### `url: http://prometheus:9090`
- The **actual endpoint** Grafana calls to fetch data.
- `prometheus` is the container name (from `compose.monitoring.yaml`), resolved by Docker's internal DNS on the `monitoring` network.
- `9090` is Prometheus's default HTTP port.

### `isDefault: true`
- Marks **Prometheus as the default data source**.
- When you open a new dashboard panel and don't pick a data source, Grafana uses this one automatically.
- 🔑 Only **one** data source can be the default. Prometheus gets the honor because most panels (CPU, memory, request rate) are metric queries, not log queries.
- Without this, Grafana would show a "no data source selected" prompt on every new panel.

### `editable: false`
- Prevents users from **editing this data source through the UI**.
- If someone logs into Grafana and tries to change the URL or delete the data source, they can't — the UI shows it as read-only.
- 🔑 **Why do this?** Because the file is the source of truth. If a user edited the data source in the UI, then Grafana restarted, the file would overwrite their change anyway. Locking it in the UI avoids confusion: "why did my edit disappear?"
- To actually change it, you edit **this file** and restart Grafana.

---

## 4. Data source #2 — Loki

```yaml
- name: Loki
  uid: loki
  type: loki
  access: proxy
  url: http://loki:3100
  editable: false
```

Nearly identical shape, but with Loki-specific values:

### `name: Loki` / `uid: loki`
- Display name and stable identifier. Dashboards reference it by `uid: loki`.

### `type: loki`
- Tells Grafana this data source speaks the **Loki HTTP API** (LogQL).
- Grafana's built-in Loki support includes the **Logs panel**, **Log browser**, **Explore view**, and **derived fields** (clickable links extracted from log lines).

### `access: proxy`
- Same reasoning as Prometheus: Grafana's server resolves `loki` inside the `monitoring` Docker network and forwards results to the browser.
- Loki stays bound to `127.0.0.1:3100` — never exposed to your browser directly.

### `url: http://loki:3100`
- Container name `loki` + port `3100` (from `loki-config.yml` → `server.http_listen_port: 3100`).
- Grafana uses the same URL for both **querying logs** and **checking Loki's health**.

### `editable: false`
- Locked in the UI, same reasoning as Prometheus.

### 🚫 Note: no `isDefault: true` here
- Only one data source can be the default, and Prometheus has that flag. Loki is **not** the default.
- Consequence: when you create a new panel and want logs, you must **explicitly pick Loki** as the data source.
- For dashboards that mix metrics and logs (common in "IncidentOps" style setups), each panel explicitly declares its data source — so this is normal.

---

## 5. Why both point to internal container names

Both URLs use Docker's internal DNS:

| Data source | URL | Resolved by |
|---|---|---|
| Prometheus | `http://prometheus:9090` | Docker DNS on `monitoring` network |
| Loki | `http://loki:3100` | Docker DNS on `monitoring` network |

🔑 **This works because** Grafana, Prometheus, and Loki are all on the **same `monitoring` network** (from `compose.monitoring.yaml`). Docker's embedded DNS server resolves the container names to their internal IPs. No `/etc/hosts` hacks, no public DNS, no ports exposed to the outside world.

If Grafana tried to reach Prometheus at `http://localhost:9090`, it would fail — because inside the Grafana container, `localhost` means *the Grafana container itself*, not the host or the Prometheus container.

---

## 6. How provisioning works at startup

```
1. Grafana container starts
2. Grafana reads /etc/grafana/provisioning/datasources/*.yaml
   (this file)
3. For each data source:
   - Does a data source with this "uid" already exist?
     - Yes → update its settings
     - No  → create it
4. Marks it as provisioned (read-only in UI because editable: false)
5. Grafana UI now shows both data sources in dropdowns
6. Dashboards can immediately query Prometheus + Loki
```

**Idempotent:** you can restart Grafana as many times as you want. Provisioning always produces the same end state — one Prometheus, one Loki. No duplicates, no manual clicking.

---

## 7. Full picture: how everything connects

```
┌────────────────────────────────────────────────────────────────────┐
│                     monitoring Docker network                      │
│                                                                    │
│  ┌────────────────┐          ┌──────────────────────┐              │
│  │  Prometheus    │◀──query──│                      │              │
│  │  :9090         │          │      Grafana         │              │
│  └────────────────┘          │      :3000           │              │
│                              │                      │              │
│  ┌────────────────┐          │  data sources from   │              │
│  │     Loki       │◀──query──│  datasources.yaml    │              │
│  │     :3100      │          │                      │              │
│  └────────────────┘          └──────────┬───────────┘              │
│                                         │                          │
└─────────────────────────────────────────┼──────────────────────────┘
                                          │
                                          │ browser → localhost:3000
                                          ▼
                                   ┌─────────────┐
                                   │ Your laptop │
                                   └─────────────┘
```

- Grafana is the **single entry point** for humans.
- Prometheus and Loki are **backends** — Grafana queries both on your behalf.
- `access: proxy` means your browser only ever talks to Grafana; Grafana talks to Prometheus and Loki internally.

---

## 8. TL;DR table

| Field | Value | Meaning |
|---|---|---|
| `apiVersion` | `1` | Provisioning schema version |
| `name` | `Prometheus` / `Loki` | Display name in Grafana UI |
| `uid` | `prometheus` / `loki` | Stable ID referenced by dashboards |
| `type` | `prometheus` / `loki` | Which backend API Grafana speaks |
| `access` | `proxy` | Grafana server proxies requests (browser never hits backends directly) |
| `url` | `http://prometheus:9090` / `http://loki:3100` | Internal Docker DNS + port |
| `isDefault` | `true` (Prometheus only) | Default data source for new panels |
| `editable` | `false` | Locked in UI; file is source of truth |

**In one sentence:** This file tells Grafana, at startup, *"Prometheus is your default metrics source at `http://prometheus:9090`, Loki is your logs source at `http://loki:3100`, both are accessed through your server (proxy), and both are locked so users can't edit them in the UI."*

---

## 🔗 Why this file matters to the whole stack

This is the **final connector** in the observability pipeline:

```
[App /metrics] ──▶ [Prometheus] ──┐
                                   ├──▶ [Grafana datasources.yaml] ──▶ Dashboards & Explore
[Containers] ──▶ [Alloy] ──▶ [Loki]┘
```

- Prometheus **scrapes** metrics (from `prometheus.yml`).
- Alloy **ships** logs (from `config.alloy`).
- Loki **stores** logs (from `loki-config.yml`).
- Grafana **reads** both — and this file is what tells it where they are.

Without `datasources.yaml`, Grafana would start empty and you'd have to wire everything by hand. With it, the whole stack is **self-configuring** the moment the containers come up.