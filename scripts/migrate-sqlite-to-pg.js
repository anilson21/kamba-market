// Migra os dados existentes (data/kamba.db + public/uploads) para o Postgres (DATABASE_URL).
// Idempotente: usa os mesmos IDs e não apaga nada. Só insere o que falta.
// Uso: DATABASE_URL=... node scripts/migrate-sqlite-to-pg.js
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const DB_FILE = process.env.KAMBA_DB || path.join(__dirname, '..', 'data', 'kamba.db');
const UPLOADS = path.join(__dirname, '..', 'public', 'uploads');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Defina DATABASE_URL.'); process.exit(1); }

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

(async () => {
  const sdb = new Database(DB_FILE, { readonly: true });
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
  const require_ = require('../src/db');
  await require_.init(); // cria o schema no Postgres (idempotente)
  await require_.close?.();
  const p = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });

  const copy = async (table, cols, conflict = 'id') => {
    const rows = sdb.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all();
    let n = 0;
    for (const r of rows) {
      const vals = cols.map((c) => r[c]);
      const ph = cols.map((_, i) => `$${i + 1}`).join(',');
      const res = await p.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) ON CONFLICT (${conflict}) DO NOTHING`, vals);
      n += res.rowCount;
    }
    // avança as sequências SERIAL para não colidir com IDs novos
    if (cols.includes('id')) {
      await p.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${table}), 1))`);
    }
    console.log(`${table}: ${rows.length} na origem, ${n} inseridos`);
  };

  await copy('users', ['id', 'nome', 'email', 'password_hash', 'telefone', 'role', 'created_at']);
  await copy('categories', ['id', 'nome', 'slug', 'icone', 'ordem', 'destaque', 'ativo']);
  await copy('listings', ['id', 'seller_id', 'category_id', 'titulo', 'descricao', 'preco_kz', 'provincia', 'cidade', 'estado', 'marca', 'quantidade', 'status', 'motivo_rejeicao', 'views', 'is_demo', 'created_at', 'updated_at']);
  await copy('listing_photos', ['id', 'listing_id', 'url', 'ordem']);
  await copy('favorites', ['user_id', 'listing_id', 'created_at'], 'user_id,listing_id');
  await copy('sessions', ['token_hash', 'user_id', 'expires_at'], 'token_hash');
  await copy('reports', ['id', 'listing_id', 'reporter_id', 'motivo', 'detalhes', 'estado', 'created_at']);

  // fotos legadas: ficheiros de public/uploads -> tabela uploads (mesmo nome, mesmo URL /uploads/<nome>)
  let up = 0;
  if (fs.existsSync(UPLOADS)) {
    const used = new Set(sdb.prepare("SELECT url FROM listing_photos WHERE url LIKE '/uploads/%'").all().map((r) => path.basename(r.url)));
    for (const f of fs.readdirSync(UPLOADS)) {
      const ext = path.extname(f).toLowerCase();
      if (!MIME[ext]) continue;
      const data = fs.readFileSync(path.join(UPLOADS, f));
      const res = await p.query('INSERT INTO uploads (name, mime, data) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING', [f, MIME[ext], data]);
      up += res.rowCount;
      if (!used.has(f)) console.log(`aviso: ${f} não está ligado a nenhum anúncio`);
    }
  }
  console.log(`uploads (fotos legadas): ${up} inseridas`);

  const count = async (t) => (await p.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
  for (const t of ['users', 'categories', 'listings', 'listing_photos', 'reports', 'uploads']) console.log(`${t} no Postgres: ${await count(t)}`);

  sdb.close();
  await p.end();
  await pool.end();
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
