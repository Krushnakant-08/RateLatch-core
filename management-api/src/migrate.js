require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('./db');

/**
 * Run all migration files in order.
 * Reads .sql files from the /app/migrations directory (mounted via Docker volume).
 * Skips already-applied migrations tracked in a migrations table.
 */
async function migrate() {
  const client = await db.connect();

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Find migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    let files;

    try {
      files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch {
      console.error(`[Migrate] Migrations directory not found at: ${migrationsDir}`);
      process.exit(1);
    }

    if (files.length === 0) {
      console.log('[Migrate] No migration files found.');
      return;
    }

    // Get already-applied migrations
    const applied = await client.query('SELECT filename FROM _migrations');
    const appliedSet = new Set(applied.rows.map(r => r.filename));

    // Run pending migrations in a transaction
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[Migrate] Skipping (already applied): ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[Migrate] Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Migrate] Failed on ${file}:`, err.message);
        process.exit(1);
      }
    }

    console.log('[Migrate] All migrations applied successfully.');
  } finally {
    client.release();
    await db.end();
  }
}

migrate();
