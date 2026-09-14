# `grafana/dashboards/incident-observability.json` — Explained Line by Line

This is the **actual dashboard** that Grafana loads and displays. Everything we've looked at so far has been plumbing — this is the payoff: a single JSON file that defines 12 panels (stat boxes, time-series charts, and a log viewer) which together give you a full picture of your app's health.

Think of it as a **blueprint for one Grafana screen**: which panels exist, where they sit, what query each runs, and which data source each one talks to.

It's referenced by `dashboards.yaml` (the provider scans `/var/lib/grafana/dashboards/` and loads every JSON). It uses the `uid`s (`prometheus`, `loki`) declared in `datasources.yaml`. So this file only works because the earlier two files set up the right context.

Let me walk through it.

---

## 1. Top-level metadata

```json
"annotations": { "list": [] },
"editable": true,
"fiscalYearStartMonth": 0,
"graphTooltip": 1,
"id": null,
"links": [],
```

- `annotations.list: []` — no annotations (those little event markers you can pin onto graphs, like "deployed v2 at 3pm"). Empty here.
- `editable: true` — users **can edit** this dashboard in the UI. (Note: the *data source* was locked, but the *dashboard* is editable. Edits made in the UI would be overwritten on the next 30-second sync because `disableDeletion: false` makes the file authoritative.)
- `fiscalYearStartMonth: 0` — irrelevant for this use case; default.
- `graphTooltip: 1` — hovering over a graph shows a **shared crosshair** across all panels (not just per-panel). Nice for correlating spikes.
- `id: null` — no fixed numeric ID. Grafana assigns one on import. Keeping it `null` avoids collisions.
- `links: []` — no dashboard-level external links (like "go to runbook").

---

## 2. Layout: the `panels` array

The dashboard has **12 panels**, laid out on a **24-column grid**. Each panel declares:

- `id` — a unique number within this dashboard.
- `title` — displayed above the panel.
- `type` — what kind of panel it is (`stat`, `timeseries`, `logs`).
- `gridPos` — its position and size: `{x, y, w, h}`.
- `datasource` — which backend to query (`prometheus` or `loki`).
- `targets` — the queries to run.
- `fieldConfig` — how to format the result (units, mappings, thresholds).

The `y` coordinate is *in grid units*, and each panel's `h` determines how much vertical space it takes. Let me walk through the panels.

---

## 3. The four "stat" panels (top row)

These are the **big-number tiles** across the top, showing the current state at a glance. All four are `y: 0`, `h: 4`, and split the 24-column row into four 6-column cells.

### Panel 1 — `Backend Status`

```json
{
  "id": 1,
  "title": "Backend Status",
  "type": "stat",
  "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
  "datasource": { "type": "prometheus", "uid": "prometheus" },
  "targets": [
    {
      "refId": "A",
      "expr": "up{job=\"incident-backend\"}",
      "instant": true
    }
  ],
  "fieldConfig": {
    "defaults": {
      "mappings": [
        {
          "type": "value",
          "options": {
            "0": { "text": "DOWN" },
            "1": { "text": "UP" }
          }
        }
      ]
    }
  }
}
```

- **Type:** `stat` — a single big number.
- **Query:** `up{job="incident-backend"}` — Prometheus's built-in metric that is **1** if the last scrape succeeded and **0** if it failed.
- `instant: true` — get the *latest* value, not a range.
- **Mappings:** turn `1` → "UP" and `0` → "DOWN" so the tile reads clearly.

**What it tells you:** *Is the backend reachable by Prometheus right now?* This is a live up/down light.

### Panel 2 — `API Requests / sec`

```json
{
  "title": "API Requests / sec",
  "type": "stat",
  "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
  "targets": [
    {
      "expr": "sum(rate(incident_http_requests_total{job=\"incident-backend\",route=~\"/api/.*\"}[1m]))",
      "instant": true
    }
  ],
  "fieldConfig": { "defaults": { "unit": "reqps" } }
}
```

- **Query:** `sum(rate(..._total[1m]))` — sum the per-second rate of all API requests over the last 1 minute.
- `route=~"/api/.*"` — filter to only routes starting with `/api/`.
- **Unit:** `reqps` — Grafana formats the number as "requests per second".

**What it tells you:** *How busy is the API right now?* A sudden drop to 0 likely means clients can't reach it; a spike means traffic surge.

### Panel 3 — `5xx Error Rate`

```json
{
  "title": "5xx Error Rate",
  "type": "stat",
  "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
  "targets": [
    {
      "expr": "100 * sum(rate(incident_http_requests_total{job=\"incident-backend\",route=~\"/api/.*\",status_code=~\"5..\"}[5m])) / clamp_min(sum(rate(incident_http_requests_total{job=\"incident-backend\",route=~\"/api/.*\"}[5m])), 0.001)",
      "instant": true
    }
  ],
  "fieldConfig": { "defaults": { "unit": "percent" } }
}
```

- **Numerator:** rate of requests with `status_code=~"5.."` (500–599 — server errors).
- **Denominator:** rate of *all* API requests.
- **Multiply by 100** to get a percentage.
- **`clamp_min(..., 0.001)`** — avoids a divide-by-zero when there's no traffic (0.001 becomes a tiny denominator so the result is 0%, not NaN).

**What it tells you:** *What fraction of API responses are server errors?* Anything above ~1% usually warrants investigation.

### Panel 4 — `P95 API Latency`

```json
{
  "title": "P95 API Latency",
  "type": "stat",
  "gridPos": { "x": 18, "y": 0, "w": 6, "h": 4 },
  "targets": [
    {
      "expr": "histogram_quantile(0.95, sum by (le) (rate(incident_http_request_duration_seconds_bucket{job=\"incident-backend\",route=~\"/api/.*\"}[5m])))",
      "instant": true
    }
  ],
  "fieldConfig": { "defaults": { "unit": "s" } }
}
```

- Uses a **histogram** metric (`..._bucket`) and `histogram_quantile()` to compute the 95th percentile latency — i.e., "95% of requests completed within X seconds."
- `sum by (le)` aggregates across routes into one number.
- **Unit:** `s` — seconds.

**What it tells you:** *How slow are the slowest 5% of requests?* Rising P95 is the classic early warning of backend slowness.

---

## 4. The two large time-series panels (second row)

These occupy `y: 4`, `h: 8` — each takes half the row. They show **history**, not just the current number.

### Panel 5 — `API Request Rate by Route`

```json
{
  "title": "API Request Rate by Route",
  "type": "timeseries",
  "gridPos": { "x": 0, "y": 4, "w": 12, "h": 8 },
  "targets": [
    {
      "expr": "sum by (method, route, status_code) (rate(incident_http_requests_total{job=\"incident-backend\",route=~\"/api/.*\"}[1m]))",
      "legendFormat": "{{method}} {{route}} {{status_code}}"
    }
  ],
  "fieldConfig": { "defaults": { "unit": "reqps" } }
}
```

- **`sum by (method, route, status_code)`** — one line per *combination* of method+route+status, not one aggregate.
- `legendFormat` — the label under each line is rendered as e.g. `GET /api/incidents 200`.
- **Time-series** — plotted over the dashboard's time range (default `now-1h` to `now`).

**What it tells you:** *Which endpoints are getting hit, and with what responses?* Useful for spotting a specific route suddenly returning 500s.

### Panel 6 — `API Latency P95 by Route`

```json
{
  "title": "API Latency P95 by Route",
  "type": "timeseries",
  "gridPos": { "x": 12, "y": 4, "w": 12, "h": 8 },
  "targets": [
    {
      "expr": "histogram_quantile(0.95, sum by (le, route) (rate(incident_http_request_duration_seconds_bucket{job=\"incident-backend\",route=~\"/api/.*\"}[5m])))",
      "legendFormat": "{{route}}"
    }
  ]
}
```

- Same as Panel 4 but **broken down per route** (`by (le, route)`), so each route gets its own line.
- **What it tells you:** *Which endpoint is slow?* If `/api/search` is at 2s while everything else is at 100ms, you've found the bottleneck.

---

## 5. The three host + backend panels (third row)

`y: 12`, `h: 7`, three panels splitting the row 8/8/8.

### Panel 7 — `EC2 CPU Usage`

```json
{
  "title": "EC2 CPU Usage",
  "type": "timeseries",
  "targets": [
    {
      "expr": "100 - (avg(rate(node_cpu_seconds_total{job=\"node-exporter\",mode=\"idle\"}[5m])) * 100)"
    }
  ],
  "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 } }
}
```

- Standard CPU-usage formula: `100 - (idle%)`.
- `job="node-exporter"` — comes from the host metrics we looked at earlier.
- Fixed `min: 0, max: 100` so the axis is stable.

**What it tells you:** *How loaded is the server itself?* Persistent >80% means you may need to scale up.

### Panel 8 — `EC2 Memory Usage`

```json
{
  "title": "EC2 Memory Usage",
  "targets": [
    {
      "expr": "100 * (1 - node_memory_MemAvailable_bytes{job=\"node-exporter\"} / node_memory_MemTotal_bytes{job=\"node-exporter\"})"
    }
  ]
}
```

- `MemAvailable` / `MemTotal` gives the free fraction; subtract from 1 and multiply by 100 for percent used.

**What it tells you:** *Is the host running out of RAM?* If it approaches 100%, the OOM killer may start terminating containers.

### Panel 9 — `Backend Process Memory`

```json
{
  "title": "Backend Process Memory",
  "targets": [
    {
      "expr": "incident_backend_process_resident_memory_bytes{job=\"incident-backend\"}",
      "legendFormat": "Backend RSS"
    }
  ],
  "fieldConfig": { "defaults": { "unit": "bytes" } }
}
```

- This metric is exposed by your Node.js backend at `/metrics` — it's the **process's resident set size** (RSS).
- Prometheus scrapes it because of the `incident-backend` job in `prometheus.yml`.

**What it tells you:** *Is the backend leaking memory?* A line that only ever goes up, never comes down, is a leak.

---

## 6. The two container panels (fourth row)

`y: 19`, `h: 8`, two 12-column panels.

### Panel 10 — `Application Container CPU`

```json
{
  "title": "Application Container CPU",
  "targets": [
    {
      "expr": "sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{job=\"cadvisor\",container_label_com_docker_compose_project=\"incident-app\",image!=\"\"}[5m])) * 100",
      "legendFormat": "{{container_label_com_docker_compose_service}}"
    }
  ],
  "fieldConfig": { "defaults": { "unit": "percent" } }
}
```

- **Source:** cAdvisor metrics (`job="cadvisor"`).
- **Filter:** `container_label_com_docker_compose_project="incident-app"` — only the app's containers, not the monitoring stack.
- **Group by:** `container_label_com_docker_compose_service` — one line per service (`backend`, `frontend`, `db`).
- `image!=""` excludes pseudo-containers (like the infra container) that cAdvisor reports but which have no image.
- Multiply by 100 for percent.

**What it tells you:** *Which container is the CPU hog?* If `backend` spikes to 300% while others sit at 1%, you've localized the problem.

### Panel 11 — `Application Container Memory`

```json
{
  "title": "Application Container Memory",
  "targets": [
    {
      "expr": "sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{job=\"cadvisor\",container_label_com_docker_compose_project=\"incident-app\",image!=\"\"})",
      "legendFormat": "{{container_label_com_docker_compose_service}}"
    }
  ],
  "fieldConfig": { "defaults": { "unit": "bytes" } }
}
```

- Same idea, but reads `container_memory_working_set_bytes` (the "working set" — what's actively in memory).
- Grouped by compose service.

**What it tells you:** *Which container is using the most RAM?* Together with Panel 10, this gives you per-container resource accounting.

---

## 7. The logs panel (bottom row)

### Panel 12 — `Incident Application Logs`

```json
{
  "title": "Incident Application Logs",
  "type": "logs",
  "gridPos": { "x": 0, "y": 27, "w": 24, "h": 10 },
  "datasource": { "type": "loki", "uid": "loki" },
  "targets": [
    {
      "refId": "A",
      "expr": "{compose_project=\"incident-app\"}",
      "queryType": "range"
    }
  ],
  "options": {
    "showTime": true,
    "showLabels": false,
    "wrapLogMessage": true,
    "prettifyLogMessage": false,
    "enableLogDetails": true,
    "sortOrder": "Descending"
  }
}
```

- **Type:** `logs` — Grafana's Logs panel.
- **Datasource:** `loki` (uses the `uid` from `datasources.yaml`).
- **Query (LogQL):** `{compose_project="incident-app"}` — every log line from any container in the app's compose project. 🔑 This works because Alloy **attached that exact label** when shipping logs.
- `queryType: "range"` — show logs over the dashboard's time range, not just the latest N.
- **Options:**
  - `showTime: true` — timestamp per line.
  - `showLabels: false` — hide the label chips for a cleaner view.
  - `wrapLogMessage: true` — long lines wrap instead of truncating.
  - `enableLogDetails: true` — click a line to see its full label set.
  - `sortOrder: Descending` — newest at the top.

**Full width (24 columns) and bottom of the dashboard** — it's the last thing you look at after noticing a problem in the metric panels above.

**What it tells you:** *The literal text of what the app is doing.* This is where you go after seeing a red number in a panel above, to find the actual error message.

---

## 8. Dashboard-level settings

```json
"refresh": "10s",
"schemaVersion": 41,
"tags": ["bongoDev", "Docker", "Prometheus", "Loki"],
"templating": { "list": [] },
"time": { "from": "now-1h", "to": "now" },
"timezone": "browser",
"title": "bongoDev Incident App Observability",
"uid": "bongodev-incident-observability",
"version": 1,
"weekStart": ""
```

- **`refresh: "10s"`** — auto-refresh every 10 seconds. Faster than Prometheus's 15s scrape — harmless but slightly aggressive. In practice Prometheus just returns the same data twice in a row on some refreshes.
- **`schemaVersion: 41`** — Grafana's internal dashboard schema version. Written by whatever Grafana version last saved it. Grafana auto-upgrades on load if needed.
- **`tags`** — searchable labels: `bongoDev`, `Docker`, `Prometheus`, `Loki`. Useful in the dashboard list.
- **`templating.list: []`** — no template variables (no dropdown at the top like "select environment"). Fine for a single-environment lab.
- **`time.from / to`** — default time range: **last 1 hour**.
- **`timezone: "browser"`** — timestamps rendered in the viewer's local timezone.
- **`title`** — display name: "bongoDev Incident App Observability".
- **`uid: "bongodev-incident-observability"`** — the dashboard's permanent ID. If you ever import this again, the same `uid` means Grafana **updates** the existing dashboard instead of creating a duplicate.
- **`version: 1`** — revision number; Grafana tracks edit history via this field.

---

## 9. How the panels map to the pipeline

Each panel's query is made possible by one of the earlier components:

```
┌──────────────────────────────────────────────────────────────────┐
│                       Dashboard panels                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Backend Status (Panel 1)          ◀── Prometheus scrapes        │
│  API Requests / sec (2)                  backend:5000/metrics    │
│  5xx Error Rate (3)                       (from prometheus.yml)  │
│  P95 API Latency (4)                                             │
│  Request Rate by Route (5)                                       │
│  P95 Latency by Route (6)                                        │
│                                                                  │
│  EC2 CPU Usage (7)                 ◀── Prometheus scrapes        │
│  EC2 Memory Usage (8)                    node-exporter:9100      │
│                                                                  │
│  Backend Process Memory (9)        ◀── Backend's custom metric   │
│                                          (Node.js /metrics)      │
│                                                                  │
│  Container CPU (10)                ◀── Prometheus scrapes        │
│  Container Memory (11)                   cadvisor:8080           │
│                                                                  │
│  App Logs (12)                     ◀── Loki, fed by Alloy        │
│                                          (config.alloy)          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Every panel is downstream of a scrape config or a log-shipping rule we've already read.

---

## 10. Grid layout — what it looks like on screen

```
x:  0          6          12         18
y:0 ┌──────────┬──────────┬──────────┬──────────┐
    │ Backend  │ API Req  │ 5xx Err  │ P95 API  │   (4 stat tiles)
    │ Status   │ /sec     │ Rate     │ Latency  │
y:4 ├──────────┴──────────┼──────────┴──────────┤
    │ Request Rate         │ P95 Latency         │   (2 time-series)
    │ by Route             │ by Route            │
y:12├──────────┬──────────┼──────────┬──────────┤
    │ EC2 CPU  │ EC2 Mem  │ Backend  │          │   (3 time-series)
    │          │          │ Memory   │          │
y:19├──────────┴──────────┼──────────┴──────────┤
    │ Container CPU        │ Container Memory    │   (2 time-series)
y:27├──────────────────────┴─────────────────────┤
    │  Application Logs (full width)             │   (1 logs panel)
    └────────────────────────────────────────────┘
```

Reading top-to-bottom, the dashboard answers four questions in order:

1. **Is it up?** → stat tiles
2. **Is it slow or erroring?** → the two large time-series
3. **Where's the pressure?** → host + container resources
4. **What is it saying?** → the logs panel

---

## 11. TL;DR

| Section | What it does |
|---|---|
| Top-level metadata | Title, UID, time range, refresh interval, tags |
| `panels` array | 12 panels, each with datasource + query + layout |
| Panels 1–4 (`stat`) | At-a-glance numbers: up/down, req/s, error %, P95 latency |
| Panels 5–6 (`timeseries`) | Trend over time: request rate and P95 per route |
| Panels 7–9 (`timeseries`) | Resource usage: EC2 CPU/RAM, backend process memory |
| Panels 10–11 (`timeseries`) | Per-container CPU and memory (via cAdvisor) |
| Panel 12 (`logs`) | Live tail of all app logs from Loki |
| `refresh: 10s` | Auto-refresh the dashboard every 10 seconds |
| `time.from/to` | Default time window: last 1 hour |
| `uid` | Stable dashboard identifier (`bongodev-incident-observability`) |

**In one sentence:** This JSON defines a single 12-panel Grafana dashboard — four status tiles, seven time-series charts, and one log viewer — that together show, at a glance, whether the Incident App is up, how it's performing, where its resources are going, and what it's logging.

---

## 🔗 Where this fits in the whole stack

You've now walked through every config file in the monitoring stack. End-to-end:

| Layer | File | Role |
|---|---|---|
| Compose (app) | `compose.yaml` | Runs app containers on a shared external network |
| Compose (monitoring) | `compose.monitoring.yaml` | Runs Prometheus, Loki, Alloy, exporters, Grafana |
| Metrics scrape | `prometheus.yml` | Prometheus scrapes 4 targets every 15s |
| Log shipping | `config.alloy` | Alloy tails Docker logs and pushes to Loki |
| Log storage | `loki-config.yml` | Loki stores logs in TSDB + filesystem chunks |
| Grafana wiring | `datasources.yaml` | Grafana auto-connects to Prometheus + Loki |
| Grafana loading | `dashboards.yaml` | Grafana auto-loads dashboard JSONs every 30s |
| **The payoff** | **`incident-observability.json`** | **This file — the actual dashboard** |

Every file in the chain serves this JSON: metrics get scraped so Panels 1–11 have data; logs get shipped and stored so Panel 12 has content; datasources get provisioned so each panel's `datasource` reference resolves; dashboards get auto-loaded so this JSON appears in the UI without any manual import.

Put it all together and you have a **self-contained observability stack**: bring up two compose files, and within seconds you have a fully populated Grafana dashboard watching your app's uptime, traffic, errors, latency, resources, and logs — with zero manual configuration.