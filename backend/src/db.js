import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'incidentdb',
  user: process.env.DB_USER || 'incident_user',
  password: process.env.DB_PASSWORD || 'incident_password',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForDatabase(maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const client = await pool.connect();
      client.release();
      console.log('Database connection established.');
      return;
    } catch (error) {
      console.error(
        `Database connection attempt ${attempt}/${maxAttempts} failed: ${error.message}`,
      );

      if (attempt === maxAttempts) {
        throw error;
      }

      await sleep(3_000);
    }
  }
}

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      severity VARCHAR(20) NOT NULL
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'investigating', 'resolved')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM incidents');

  if (countResult.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO incidents (title, description, severity, status)
       VALUES
         ($1, $2, $3, $4),
         ($5, $6, $7, $8)`,
      [
        'API response time increased',
        'The checkout API is responding more slowly than normal.',
        'high',
        'investigating',
        'Nightly backup completed late',
        'The database backup completed successfully after a delay.',
        'medium',
        'resolved',
      ],
    );
  }
}
