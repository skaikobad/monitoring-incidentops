import cors from 'cors';
import express from 'express';
import client from 'prom-client';
import { initializeDatabase, pool, waitForDatabase } from './db.js';

const app = express();
const port = Number(process.env.PORT || 5000);
const validSeverities = new Set(['low', 'medium', 'high', 'critical']);
const validStatuses = new Set(['open', 'investigating', 'resolved']);

const { Counter, Histogram, Registry, collectDefaultMetrics } = client;
const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'incident_backend_',
});

const httpRequestsTotal = new Counter({
  name: 'incident_http_requests_total',
  help: 'Total HTTP requests handled by the incident backend',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'incident_http_request_duration_seconds',
  help: 'HTTP request duration in seconds for the incident backend',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.use((request, response, next) => {
  if (request.path === '/metrics' || request.path === '/health') {
    return next();
  }

  const startedAt = process.hrtime.bigint();

  response.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = request.route?.path || 'unmatched';
    const statusCode = String(response.statusCode);
    const labels = {
      method: request.method,
      route,
      status_code: statusCode,
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: response.statusCode >= 500 ? 'error' : 'info',
        service: 'incident-backend',
        method: request.method,
        route,
        status_code: response.statusCode,
        duration_ms: Number((durationSeconds * 1000).toFixed(2)),
      }),
    );
  });

  next();
});

app.get('/metrics', async (_request, response) => {
  response.set('Content-Type', metricsRegistry.contentType);
  response.end(await metricsRegistry.metrics());
});

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.status(200).json({
      service: 'incident-backend',
      status: 'healthy',
      database: 'connected',
    });
  } catch (error) {
    response.status(503).json({
      service: 'incident-backend',
      status: 'unhealthy',
      database: 'disconnected',
      message: error.message,
    });
  }
});

app.get('/api/incidents', async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, severity, status, created_at, updated_at
       FROM incidents
       ORDER BY created_at DESC`,
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/incidents', async (request, response, next) => {
  try {
    const {
      title,
      description = '',
      severity = 'medium',
      status = 'open',
    } = request.body;

    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      return response.status(400).json({
        message: 'title is required and must contain at least 3 characters',
      });
    }

    if (!validSeverities.has(severity)) {
      return response.status(400).json({ message: 'invalid severity' });
    }

    if (!validStatuses.has(status)) {
      return response.status(400).json({ message: 'invalid status' });
    }

    const result = await pool.query(
      `INSERT INTO incidents (title, description, severity, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, description, severity, status, created_at, updated_at`,
      [title.trim(), String(description).trim(), severity, status],
    );

    return response.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/incidents/:id/status', async (request, response, next) => {
  try {
    const incidentId = Number(request.params.id);
    const { status } = request.body;

    if (!Number.isInteger(incidentId) || incidentId <= 0) {
      return response.status(400).json({ message: 'invalid incident id' });
    }

    if (!validStatuses.has(status)) {
      return response.status(400).json({ message: 'invalid status' });
    }

    const result = await pool.query(
      `UPDATE incidents
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, description, severity, status, created_at, updated_at`,
      [status, incidentId],
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ message: 'incident not found' });
    }

    return response.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/incidents/:id', async (request, response, next) => {
  try {
    const incidentId = Number(request.params.id);

    if (!Number.isInteger(incidentId) || incidentId <= 0) {
      return response.status(400).json({ message: 'invalid incident id' });
    }

    const result = await pool.query('DELETE FROM incidents WHERE id = $1', [
      incidentId,
    ]);

    if (result.rowCount === 0) {
      return response.status(404).json({ message: 'incident not found' });
    }

    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: 'internal server error' });
});

async function start() {
  try {
    await waitForDatabase();
    await initializeDatabase();

    app.listen(port, '0.0.0.0', () => {
      console.log(`Incident backend listening on port ${port}`);
    });
  } catch (error) {
    console.error('Backend startup failed:', error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} received. Closing database connections.`);
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
