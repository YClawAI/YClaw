#!/usr/bin/env node
/**
 * Memory Architecture — Migration Runner
 * Run: node packages/memory/scripts/migrate.js
 * Requires: MEMORY_DATABASE_URL env var
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

async function run() {
  const url = process.env.MEMORY_DATABASE_URL;
  if (!url) {
    console.error('MEMORY_DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  console.log('Connected to database');

  // Run DDL migration
  const ddl = readFileSync(join(__dirname, '..', 'migrations', '001_create_memory_tables.sql'), 'utf-8');
  console.log('Running DDL migration...');
  await client.query(ddl);
  console.log('DDL migration complete');

  // Run seed
  const seed = readFileSync(join(__dirname, '..', 'migrations', '002_seed_categories.sql'), 'utf-8');
  console.log('Running seed migration...');
  await client.query(seed);
  console.log('Seed migration complete');

  // Verify
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('\nTables created:');
  tables.rows.forEach(r => console.log(' ', r.table_name));

  const catCount = await client.query('SELECT count(*) as cnt FROM categories');
  console.log('\nCategories seeded:', catCount.rows[0].cnt);

  const byScope = await client.query('SELECT scope, count(*) as cnt FROM categories GROUP BY scope ORDER BY scope');
  console.log('By scope:');
  byScope.rows.forEach(r => console.log(' ', r.scope + ':', r.cnt));

  await client.end();
  console.log('\nMigration complete!');
}

run().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
