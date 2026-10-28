// Camada de base de dados com a mesma API para Postgres (DATABASE_URL, produção)
// e SQLite (fallback local, sem DATABASE_URL). Todas as funções são async.
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL || '';
const usePg = !!DATABASE_URL;

// SQL escrito em estilo SQLite (?, datetime('now'), LIKE). Para Postgres traduz-se aqui.
function toPg(sql) {
  let i = 0;
  let out = sql.replace(/\?/g, () => `$${++i}`);
  out = out.replace(/datetime\('now'\)/g, `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`);
  out = out.replace(/\bLIKE\b/g, 'ILIKE');
  return out;
}

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  telefone TEXT,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer','seller','admin')),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icone TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  destaque INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  preco_kz INTEGER NOT NULL CHECK (preco_kz >= 0),
  provincia TEXT NOT NULL,
  cidade TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('novo','usado')),
  marca TEXT,
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade >= 0),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado','removido')),
  motivo_rejeicao TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category_id);
CREATE TABLE IF NOT EXISTS listing_photos (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (user_id, listing_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  detalhes TEXT,
  estado TEXT NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','resolvida','ignorada')),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (listing_id, reporter_id)
);
`;

let impl;

if (usePg) {
  const { Pool, types } = require('pg');
  // COUNT(*) e BIGINT chegam como inteiro (e não string) para o JSON ficar igual ao SQLite
  types.setTypeParser(20, (v) => parseInt(v, 10));
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  const wrap = (c) => ({
    all: async (sql, params = []) => (await c.query(toPg(sql), params)).rows,
    get: async (sql, params = []) => (await c.query(toPg(sql), params)).rows[0],
    // INSERT: devolve lastInsertRowid (id) quando a tabela tem coluna id
    run: async (sql, params = []) => {
      let text = toPg(sql);
      const isInsert = /^\s*INSERT/i.test(text) && !/RETURNING/i.test(text);
      if (isInsert) text += ' RETURNING id';
      let r;
      try {
        r = await c.query(text, params);
      } catch (e) {
        if (isInsert && /column "id" does not exist/.test(e.message)) {
          r = await c.query(toPg(sql), params);
          return { changes: r.rowCount, lastInsertRowid: null };
        }
        throw e;
      }
      return { changes: r.rowCount, lastInsertRowid: isInsert && r.rows[0] ? r.rows[0].id : null };
    },
  });
  const base = wrap(pool);
  impl = {
    kind: 'postgres',
    ...base,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn(wrap(client));
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    init: async () => {
      await pool.query(SCHEMA_PG);
    },
    close: () => pool.end(),
  };
} else {
  const Database = require('better-sqlite3');
  const DATA_DIR = path.join(__dirname, '..', 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const DB_PATH = process.env.KAMBA_DB || path.join(DATA_DIR, 'kamba.db');
  const sdb = new Database(DB_PATH);
  sdb.pragma('journal_mode = WAL');
  sdb.pragma('foreign_keys = ON');
  const wrapS = (d) => ({
    all: async (sql, params = []) => d.prepare(sql).all(...params),
    get: async (sql, params = []) => d.prepare(sql).get(...params),
    run: async (sql, params = []) => {
      const r = d.prepare(sql).run(...params);
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
  });
  const base = wrapS(sdb);
  impl = {
    kind: 'sqlite',
    ...base,
    tx: async (fn) => {
      sdb.exec('BEGIN');
      try {
        const res = await fn(base);
        sdb.exec('COMMIT');
        return res;
      } catch (e) {
        sdb.exec('ROLLBACK');
        throw e;
      }
    },
    init: async () => {
      // mesmo schema do Postgres, adaptado ao SQLite
      sdb.exec(require('./schema_sqlite'));
    },
    close: () => sdb.close(),
  };
}

module.exports = impl;
