import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

await pool.query(schema);
console.log('Schema applied');
await pool.end();
