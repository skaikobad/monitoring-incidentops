# Alloy → Loki Pipeline

## Full pipeline diagram

```
┌────────────────────────────────────────────────────────────────┐
│                          Alloy container                       │
│                                                                │
│  ┌──────────────────────┐                                      │
│  │ discovery.docker     │  "Which containers exist?"           │
│  │ .containers          │────────────┐                         │
│  └──────────────────────┘            │                         │
│                                      ▼                         │
│                        ┌──────────────────────────────┐        │
│                        │ discovery.relabel            │        │
│                        │ .docker_logs                 │        │
│                        │  - container = <name>        │        │
│                        │  - compose_project = <proj>  │        │
│                        │  - compose_service = <svc>   │        │
│                        │  - stream = stdout|stderr    │        │
│                        └──────────────┬───────────────┘        │
│                                       │ cleaned targets        │
│                                       ▼                        │
│  ┌──────────────────────────────────────────────────┐          │
│  │ loki.source.docker.docker                        │          │
│  │  - reads each container's stdout/stderr          │          │
│  │  - adds label: platform=docker                   │          │
│  └──────────────────────────┬───────────────────────┘          │
│                             │ raw log lines                    │
│                             ▼                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │ loki.process.docker                              │          │
│  │  - stage.docker: unwraps Docker JSON log format  │          │
│  └──────────────────────────┬───────────────────────┘          │
│                             │ parsed entries                   │
│                             ▼                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │ loki.write.local                                 │          │
│  │  - POST → http://loki:3100/loki/api/v1/push      │          │
│  └──────────────────────────┬───────────────────────┘          │
└─────────────────────────────┼──────────────────────────────────┘
                              │
                              ▼
                      ┌───────────────┐
                      │     Loki      │
                      │    :3100      │
                      └───────┬───────┘
                              │
                              ▼
                      [loki_data volume]

                              ▲
                              │ queries
                              │
                      ┌───────┴───────┐
                      │   Grafana     │
                      └───────────────┘
```

---

## What a log line looks like at each stage

Take a real backend log: `Server listening on port 5000`

**Stage 1 — Docker writes it (raw JSON on disk):**
```json
{"log":"Server listening on port 5000\n","stream":"stdout","time":"2025-01-01T00:00:00Z"}
```

**Stage 2 — `loki.source.docker` reads it and attaches labels:**
```
labels: {platform="docker", container="incident-app-backend-1",
         compose_project="incident-app", compose_service="backend",
         stream="stdout"}
line:   {"log":"Server listening on port 5000\n","stream":"stdout","time":"..."}
```

**Stage 3 — `loki.process` unwraps the JSON:**
```
labels: {platform="docker", container="incident-app-backend-1",
         compose_project="incident-app", compose_service="backend",
         stream="stdout"}
line:   Server listening on port 5000
```

**Stage 4 — `loki.write` POSTs to Loki. Loki stores it. Grafana can now query:**
```logql
{compose_service="backend"} |= "listening"
```

---

## TL;DR table

| Block | What it does | Simple analogy |
|---|---|---|
| `logging` | Set Alloy's own log verbosity/format | Clerk's diary settings |
| `discovery.docker "containers"` | Ask Docker "which containers exist?" | Take attendance |
| `discovery.relabel "docker_logs"` | Rename ugly metadata labels to clean ones | Peel off sticky notes, re-label |
| `loki.source.docker "docker"` | Tail each container's stdout/stderr | Read the mail as it arrives |
| `loki.process "docker"` | Unwrap Docker's JSON log format | Open the envelope, discard packaging |
| `loki.write "local"` | POST logs to `loki:3100/loki/api/v1/push` | Hand letters to Loki |

**In one sentence:** Alloy asks Docker which containers are running, attaches clean labels (container, compose project, compose service, stream), tails each container's logs, unwraps Docker's JSON wrapper, and pushes everything to Loki over HTTP.