# bongoDev Incident Observability Lab

A hands-on Docker and observability lab for running a three-tier application with Docker Compose and monitoring it with Prometheus, Grafana, Loki, Grafana Alloy, Node Exporter, and cAdvisor.

The application and monitoring stacks are intentionally deployed with **separate Docker Compose files**.

---

## Architecture

```text
                    APPLICATION STACK

Browser
   |
   | :80
   v
Frontend / Nginx
   |
   | /api
   v
Node.js / Express Backend
   |
   | :5432
   v
PostgreSQL


                    MONITORING STACK

Backend /metrics ------------\
                              \
Node Exporter -----------------> Prometheus
                               /
cAdvisor ---------------------/
                                 |
                                 v
                              Grafana

Docker Container Logs
        |
        v
   Grafana Alloy
        |
        v
       Loki
        |
        v
      Grafana
```

---

## Project Structure

```text
bongodev-incident-observability-lab/
│
├── backend/
├── frontend/
├── monitoring/
│   ├── compose.monitoring.yaml
│   ├── compose.monitoring.mac.yaml
│   ├── prometheus/
│   ├── grafana/
│   ├── loki/
│   └── alloy/
│
├── compose.yaml
├── .env.example
└── README.md
```

---

## Why Two Docker Compose Files?

The application and monitoring services have different responsibilities and lifecycles.

### Application stack

```text
Frontend
Backend
PostgreSQL
```

### Monitoring stack

```text
Prometheus
Grafana
Loki
Alloy
Node Exporter
cAdvisor
```

Keeping them separate allows you to deploy, restart, upgrade, or troubleshoot monitoring without unnecessarily rebuilding the application.

Both Compose projects communicate through a shared external Docker network:

```text
incident-observability
```

---

# Prerequisites

You need:

- Docker Engine or Docker Desktop
- Docker Compose v2
- Git
- curl

Verify:

```bash
docker --version
docker compose version
```

---

# Ubuntu Installation

For a simple Ubuntu installation:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
```

Enable Docker:

```bash
sudo systemctl enable --now docker
```

Add your user to the Docker group:

```bash
sudo usermod -aG docker $USER
```

Log out and log back in, then verify:

```bash
docker --version
docker compose version
```

---
Configure EC2 Security Group

For a classroom lab:

| Port | Purpose | Recommended source |
|---|---|---|
| 22 | SSH | Your IP only |
| 80 | Incident application | Your IP or required audience |
| 3000 | Grafana | Your IP only |

Do **not** expose PostgreSQL `5432`, backend `5000`, Prometheus `9090`, Loki `3100`, cAdvisor `8080`, or Node Exporter `9100` publicly.

Prometheus and Loki are bound to `127.0.0.1` on the EC2 host when a host port is provided.
---

# macOS Installation

Install Docker Desktop for Mac and make sure it is running.

Verify:

```bash
docker --version
docker compose version
```

> macOS uses Docker Desktop, which runs containers inside a Linux virtual machine. Some Linux host-monitoring settings therefore differ from native Ubuntu.

For monitoring on Mac, use:

```text
compose.monitoring.mac.yaml
```

For Linux / Ubuntu / EC2, use:

```text
compose.monitoring.yaml
```

---

# PART 1 — Run the Application First

Always deploy and verify the application before starting monitoring.

## Step 1 — Enter the project

```bash
cd bongodev-incident-observability-lab
```

## Step 2 — Create the shared observability network

```bash
docker network create incident-observability
```

Verify:

```bash
docker network ls
```

If the network already exists, no action is required.

## Step 3 — Create the application environment file

```bash
cp .env.example .env
```

Edit it:

```bash
nano .env
```

Example:

```env
POSTGRES_DB=incidentdb
POSTGRES_USER=incident_user
POSTGRES_PASSWORD=StrongPassword123!
```

Do not commit real secrets to Git.

## Step 4 — Validate application Compose

```bash
docker compose config
```

## Step 5 — Build and start the application

```bash
docker compose up -d --build
```

This starts:

```text
frontend
backend
db
```

## Step 6 — Check application status

```bash
docker compose ps
```

Also useful:

```bash
docker ps
```

## Step 7 — Check logs

All logs:

```bash
docker compose logs
```

Backend:

```bash
docker compose logs backend
```

Database:

```bash
docker compose logs db
```

Frontend:

```bash
docker compose logs frontend
```

Follow backend logs live:

```bash
docker compose logs -f backend
```

Press `CTRL + C` to stop following logs. This does not stop the container.

## Step 8 — Test the application

```bash
curl http://localhost/health
```

```bash
curl http://localhost/api/incidents
```

Open in a browser:

```text
http://EC2_PUBLIC_IP
```

Do not continue to monitoring until the application works correctly.

## Step 9 — Verify Prometheus metrics endpoint

The backend exposes metrics at `/metrics`.

Because backend port `5000` is intentionally not publicly exposed, test it from inside the backend container:

```bash
docker compose exec backend node -e \
"fetch('http://localhost:5000/metrics').then(r=>r.text()).then(console.log)"
```

You should see metrics such as:

```text
incident_http_requests_total
incident_http_request_duration_seconds
```

If `/metrics` works, the backend is ready for Prometheus.

---

# PART 2 — Configure Monitoring

Enter the monitoring directory:

```bash
cd monitoring
```

Create the monitoring environment file:

```bash
cp .env.monitoring.example .env.monitoring
```

Edit it:

```bash
nano .env.monitoring
```

Example:

```env
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=StrongGrafanaPassword123!
```

---

# IMPORTANT — Choose the Correct Monitoring YAML

## macOS / Docker Desktop

Use:

```text
compose.monitoring.mac.yaml
```

## Linux / Ubuntu / EC2

Use:

```text
compose.monitoring.yaml
```

---

# PART 3 — Start Monitoring on macOS

Validate first:

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  config
```

Start monitoring:

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  up -d
```

Check status:

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  ps
```

---

# PART 4 — Start Monitoring on Ubuntu / EC2

Validate first:

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.yaml \
  config
```

Start monitoring:

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.yaml \
  up -d
```

Check status:

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.yaml \
  ps
```

---

# Monitoring Services

| Service | Purpose |
|---|---|
| Prometheus | Collects and stores metrics |
| Grafana | Dashboards and visualization |
| Loki | Stores and queries logs |
| Grafana Alloy | Collects Docker logs and sends them to Loki |
| Node Exporter | Host/server metrics |
| cAdvisor | Docker container metrics |

---

# Verify All Containers

```bash
docker ps
```

You should see both groups:

```text
APPLICATION
-----------
frontend
backend
db

MONITORING
----------
prometheus
grafana
loki
alloy
node-exporter
cadvisor
```

---

# Open Grafana

```text
http://localhost:3000
```

Use the username and password from `.env.monitoring`.

---

# Open Prometheus

```text
http://localhost:9090
```

Go to:

```text
Status
→ Target health
```

You should see targets such as:

```text
incident-backend
node-exporter
cadvisor
```

with status `UP`.

Test all targets:

```promql
up
```

Test backend only:

```promql
up{job="incident-backend"}
```

Expected value:

```text
1
```

---

# Generate Application Traffic

From the project root:

```bash
for i in {1..100}; do
  curl -s http://localhost/api/incidents > /dev/null
done
```

Then query Prometheus:

```promql
incident_http_requests_total
```

Or request rate:

```promql
sum(rate(incident_http_requests_total[1m]))
```

Flow:

```text
Application Request
       |
       v
Backend
       |
       v
/metrics
       |
       v
Prometheus
       |
       v
Grafana
```

---

# Check Logs with Loki

Open Grafana:

```text
http://localhost:3000
```

Go to:

```text
Explore
→ Loki
```

All application logs:

```logql
{compose_project="incident-app"}
```

Backend logs only:

```logql
{compose_project="incident-app", compose_service="backend"}
```

Errors only:

```logql
{compose_project="incident-app", compose_service="backend"} |= "error"
```

Log flow:

```text
Docker Containers
       |
       v
   Grafana Alloy
       |
       v
      Loki
       |
       v
    Grafana
```

---

# Important macOS Note

When running Docker Desktop on macOS, the architecture is approximately:

```text
macOS
 |
 v
Docker Desktop
 |
 v
Linux Virtual Machine
 |
 ├── frontend
 ├── backend
 ├── PostgreSQL
 ├── Prometheus
 ├── Grafana
 ├── Loki
 ├── Alloy
 ├── Node Exporter
 └── cAdvisor
```

Node Exporter and cAdvisor therefore primarily observe the Docker Desktop Linux environment rather than macOS itself.

For proper native Linux host-level monitoring, use Ubuntu / EC2 with:

```text
compose.monitoring.yaml
```

---

# Stop the Application

From the project root:

```bash
docker compose down
```

---

# Stop Monitoring on macOS

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  down
```

---

# Stop Monitoring on Ubuntu / EC2

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.yaml \
  down
```

---

# Restart the Application

```bash
docker compose up -d
```

If source code or Dockerfiles changed:

```bash
docker compose up -d --build
```

---

# Restart Monitoring on macOS

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  up -d
```

---

# Restart Monitoring on Ubuntu / EC2

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.yaml \
  up -d
```

---

# Useful Troubleshooting Commands

## Application

```bash
docker compose ps
docker compose logs
docker compose logs -f backend
docker compose restart backend
```

## Monitoring on macOS

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  ps
```

```bash
docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  logs
```

## General Docker

```bash
docker ps
docker ps -a
docker image ls
docker network ls
docker volume ls
docker stats
```

Inspect the shared network:

```bash
docker network inspect incident-observability
```

---

# Important Warning About Volumes

Normally stop the application with:

```bash
docker compose down
```

Be careful with:

```bash
docker compose down -v
```

`-v` removes Compose-managed volumes and may delete PostgreSQL data.

---

# Recommended Deployment Order

```text
1. Start Docker
        |
        v
2. Create incident-observability network
        |
        v
3. Configure application .env
        |
        v
4. Start application Compose
        |
        v
5. Verify application
        |
        v
6. Verify /metrics
        |
        v
7. Configure monitoring .env
        |
        v
8. Start monitoring Compose
        |
        v
9. Verify Prometheus targets
        |
        v
10. Open Grafana
        |
        v
11. Verify Loki logs
```

---

# Quick Start — macOS

From the project root:

```bash
docker network create incident-observability
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Verify:

```bash
curl http://localhost/health
curl http://localhost/api/incidents
```

Then:

```bash
cd monitoring
cp .env.monitoring.example .env.monitoring

docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.mac.yaml \
  up -d
```

Open:

```text
Application: http://localhost
Grafana:     http://localhost:3000
Prometheus:  http://localhost:9090
```

---

# Quick Start — Ubuntu / EC2

From the project root:

```bash
docker network create incident-observability
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Then:

```bash
cd monitoring
cp .env.monitoring.example .env.monitoring

docker compose \
  --env-file .env.monitoring \
  -f compose.monitoring.yaml \
  up -d
```

---

# Core Learning Outcomes

```text
Dockerfile
    ↓
Docker Image
    ↓
Container
    ↓
Docker Compose
    ↓
Application
    ↓
Observability
```

```text
Prometheus = Metrics
Grafana = Visualization
Loki = Logs
Alloy = Log Collection
Node Exporter = Host Metrics
cAdvisor = Container Metrics
```

Most importantly:

```text
Container Running
      ≠
Application Healthy
```

Good observability combines:

```text
Application Metrics
        +
Container Metrics
        +
Host Metrics
        +
Logs
        ↓
Faster Troubleshooting
        ↓
Lower MTTR
```
