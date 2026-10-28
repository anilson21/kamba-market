const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { PROVINCIAS, ESTADOS, REPORT_MOTIVOS, LISTING_STATUS } = require('./constants');

const app = express();
const PORT = process.env.PORT || 3000;
// Fotos novas ficam na base de dados (tabela uploads), por isso sobrevivem a reinícios do Render.
// Os ficheiros antigos em public/uploads continuam a ser servidos pelo express.static.
const LEGACY_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const SESSION_DAYS = 14;
const MAX_PHOTOS = 6;

// Garante que o schema existe antes de qualquer pedido (Postgres ou SQLite).
const ready = db.init();
app.use((req, res, next) => { ready.then(() => next(), next); });

// Express 4 não apanha erros de funções async: encapsula os handlers.
const A = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- helpers ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', [sha256(token), userId, expires]);
  return token;
}

// Attach req.user (or null = visitor) on every request
app.use(A(async (req, res, next) => {
  req.user = null;
  const token = parseCookies(req).kamba_session;
  if (token) {
    const row = await db.get(`
      SELECT u.id, u.nome, u.email, u.telefone, u.role, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`, [sha256(token)]);
    if (row && Number(row.expires_at) > Date.now()) {
      req.user = { id: row.id, nome: row.nome, email: row.email, telefone: row.telefone, role: row.role };
    } else if (row) {
      await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
    }
  }
  next();
}));

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Precisa de iniciar sessão.' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Precisa de iniciar sessão.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão para esta ação.' });
    next();
  };
}

const publicUser = (u) => ({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, role: u.role });

const sanitizeText = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function parseListingBody(body) {
  const errors = [];
  const titulo = sanitizeText(body.titulo, 120);
  const descricao = sanitizeText(body.descricao, 4000);
  const preco = Number(String(body.preco_kz ?? '').replace(/\s/g, ''));
  const quantidade = Number(body.quantidade ?? 1);
  const categoryId = Number(body.category_id);
  const provincia = sanitizeText(body.provincia, 60);
  const cidade = sanitizeText(body.cidade, 80);
  const estado = sanitizeText(body.estado, 10);
  const marca = sanitizeText(body.marca, 60);

  if (titulo.length < 3) errors.push('O título precisa de pelo menos 3 caracteres.');
  if (descricao.length < 10) errors.push('A descrição precisa de pelo menos 10 caracteres.');
  if (!Number.isFinite(preco) || !Number.isInteger(preco) || preco < 0) errors.push('Preço inválido. Use um valor inteiro em Kz.');
  if (!Number.isInteger(quantidade) || quantidade < 0) errors.push('Quantidade inválida.');
  if (!Number.isInteger(categoryId) || categoryId <= 0) errors.push('Escolha uma categoria.');
  if (!PROVINCIAS.includes(provincia)) errors.push('Escolha uma província de Angola válida.');
  if (!ESTADOS.includes(estado)) errors.push('Estado deve ser novo ou usado.');
  if (categoryId > 0) {
    const cat = await db.get('SELECT id FROM categories WHERE id = ? AND ativo = 1', [categoryId]);
    if (!cat) errors.push('Categoria não existe ou está inativa.');
  }
  return {
    errors,
    data: { titulo, descricao, preco_kz: preco, quantidade, category_id: categoryId, provincia, cidade, estado, marca },
  };
}

const LISTING_SELECT = `
  SELECT l.*, c.nome AS categoria_nome, c.slug AS categoria_slug,
         u.nome AS vendedor_nome, u.telefone AS vendedor_telefone,
         (SELECT COUNT(*) FROM favorites f WHERE f.listing_id = l.id) AS favoritos
  FROM listings l
  JOIN categories c ON c.id = l.category_id
  JOIN users u ON u.id = l.seller_id`;

async function withPhotos(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const photos = await db.all(`SELECT listing_id, url FROM listing_photos WHERE listing_id IN (${ids.map(() => '?').join(',')}) ORDER BY ordem, id`, ids);
  const map = {};
  photos.forEach((p) => { (map[p.listing_id] = map[p.listing_id] || []).push(p.url); });
  return rows.map((r) => ({ ...r, fotos: map[r.id] || [] }));
}

async function listingPublicShape(r, req) {
  const favorito = !!(req.user && await db.get('SELECT 1 AS x FROM favorites WHERE user_id=? AND listing_id=?', [req.user.id, r.id]));
  const { vendedor_telefone, ...rest } = r;
  return { ...rest, favorito, vendedor_telefone: vendedor_telefone || null };
}

// ---------- uploads ----------
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_PHOTOS },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Só são aceites fotos JPG, PNG ou WEBP.'));
    }
    cb(null, true);
  },
});

// Guarda cada foto na base de dados e devolve o URL público /uploads/<nome>
async function saveUploadedFiles(files, t = db) {
  const urls = [];
  for (const f of files || []) {
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${MIME_EXT[f.mimetype] || '.bin'}`;
    await t.run('INSERT INTO uploads (name, mime, data) VALUES (?,?,?)', [name, f.mimetype, f.buffer]);
    urls.push(`/uploads/${name}`);
  }
  return urls;
}

// Mensagens de erro do multer em português (o multer devolve texto em inglês por defeito)
function uploadErrorMessage(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'Cada foto pode ter no máximo 5 MB.';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return `Pode enviar no máximo ${MAX_PHOTOS} fotos.`;
  if (err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FIELD_COUNT' || err.code === 'LIMIT_FIELD_VALUE' || err.code === 'LIMIT_FIELD_KEY') return 'Pedido inválido. Tente novamente.';
  if (err.message && /Só são aceites/.test(err.message)) return err.message;
  return 'Erro no upload das fotos.';
}

async function removeFiles(urls) {
  for (const u of urls || []) {
    const name = path.basename(u);
    if (!u.startsWith('/uploads/')) continue;
    await db.run('DELETE FROM uploads WHERE name = ?', [name]).catch(() => {});
    // ficheiros antigos ainda em disco (legado)
    fs.unlink(path.join(LEGACY_UPLOAD_DIR, name), () => {});
  }
}

// ---------- middleware ----------
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fotos guardadas na base de dados (novas). Ficheiros legados são servidos pelo static acima.
app.get('/uploads/:name', A(async (req, res, next) => {
  const row = await db.get('SELECT mime, data FROM uploads WHERE name = ?', [req.params.name]);
  if (!row) return res.status(404).type('text').send('Foto não encontrada.');
  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
}));

// ---------- meta ----------
app.get('/api/meta', (req, res) => {
  res.json({ provincias: PROVINCIAS, estados: ESTADOS, reportMotivos: REPORT_MOTIVOS, moeda: 'Kz (AOA)', fuso: 'Africa/Luanda', modoPagamento: 'modo de teste' });
});

// ---------- categories (DB-driven) ----------
app.get('/api/categories', A(async (req, res) => {
  const rows = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id AND l.status='aprovado') AS total
    FROM categories c WHERE c.ativo = 1 ORDER BY c.ordem, c.nome`);
  res.json(rows);
}));

// ---------- auth ----------
app.post('/api/auth/register', A(async (req, res) => {
  const nome = sanitizeText(req.body.nome, 80);
  const email = sanitizeText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  const telefone = sanitizeText(req.body.telefone, 20);
  const role = req.body.role === 'seller' ? 'seller' : 'buyer'; // admin nunca por registo público
  if (nome.length < 2) return res.status(400).json({ error: 'Indique o seu nome.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email inválido.' });
  if (password.length < 8) return res.status(400).json({ error: 'A palavra-passe deve ter pelo menos 8 caracteres.' });
  if (await db.get('SELECT 1 AS x FROM users WHERE email = ?', [email])) return res.status(409).json({ error: 'Já existe uma conta com este email.' });
  const info = await db.run('INSERT INTO users (nome, email, password_hash, telefone, role) VALUES (?,?,?,?,?)',
    [nome, email, hashPassword(password), telefone || null, role]);
  const token = await createSession(info.lastInsertRowid);
  const u = await db.get('SELECT * FROM users WHERE id=?', [info.lastInsertRowid]);
  res.cookie('kamba_session', token, cookieOpts()).status(201).json({ user: publicUser(u) });
}));

app.post('/api/auth/login', A(async (req, res) => {
  const email = sanitizeText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  const u = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  // resposta igual para email/palavra-passe errados
  if (!u || !verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Email ou palavra-passe incorretos.' });
  const token = await createSession(u.id);
  res.cookie('kamba_session', token, cookieOpts()).json({ user: publicUser(u) });
}));

app.post('/api/auth/logout', A(async (req, res) => {
  const token = parseCookies(req).kamba_session;
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie('kamba_session').json({ ok: true });
}));

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user });
});

function cookieOpts() {
  return { httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 86400000, path: '/' };
}

// ---------- public listings ----------
app.get('/api/listings', A(async (req, res) => {
  const where = [`l.status = 'aprovado'`];
  const args = [];
  const q = sanitizeText(req.query.q, 100);
  if (q) {
    where.push('(l.titulo LIKE ? OR l.descricao LIKE ? OR l.marca LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (req.query.categoria) {
    const cat = await db.get('SELECT id FROM categories WHERE slug = ?', [String(req.query.categoria)]);
    if (cat) { where.push('l.category_id = ?'); args.push(cat.id); } else { where.push('0 = 1'); }
  }
  const min = Number(req.query.min);
  const max = Number(req.query.max);
  if (Number.isFinite(min) && req.query.min !== undefined && req.query.min !== '') { where.push('l.preco_kz >= ?'); args.push(min); }
  if (Number.isFinite(max) && req.query.max !== undefined && req.query.max !== '') { where.push('l.preco_kz <= ?'); args.push(max); }
  if (req.query.provincia && PROVINCIAS.includes(String(req.query.provincia))) { where.push('l.provincia = ?'); args.push(String(req.query.provincia)); }
  if (ESTADOS.includes(String(req.query.estado))) { where.push('l.estado = ?'); args.push(String(req.query.estado)); }
  const orders = {
    recentes: 'l.created_at DESC, l.id DESC',
    preco_asc: 'l.preco_kz ASC, l.id DESC',
    preco_desc: 'l.preco_kz DESC, l.id DESC',
    mais_vistos: 'l.views DESC, l.id DESC',
  };
  const order = orders[req.query.sort] || orders.recentes;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const whereSql = where.join(' AND ');
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM listings l WHERE ${whereSql}`, args)).n);
  const rows = await db.all(`${LISTING_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...args, perPage, (page - 1) * perPage]);
  const items = (await withPhotos(rows)).map((r) => {
    const { vendedor_telefone, ...rest } = r;
    return { ...rest, fotos: r.fotos.slice(0, 1) };
  });
  res.json({ items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) });
}));

app.get('/api/listings/featured', A(async (req, res) => {
  const rows = await withPhotos(await db.all(`${LISTING_SELECT} WHERE l.status='aprovado' ORDER BY l.views DESC, l.created_at DESC LIMIT 8`));
  res.json(rows.map((r) => { const { vendedor_telefone, ...x } = r; return x; }));
}));

app.get('/api/listings/:id', A(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.get(`${LISTING_SELECT} WHERE l.id = ?`, [id]);
  if (!row) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const isOwnerOrAdmin = req.user && (req.user.id === row.seller_id || req.user.role === 'admin');
  if (row.status !== 'aprovado' && !isOwnerOrAdmin) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const isOwner = req.user && req.user.id === row.seller_id;
  const counts = row.status === 'aprovado' && !isOwner && !(req.user && req.user.role === 'admin');
  if (counts) await db.run('UPDATE listings SET views = views + 1 WHERE id = ?', [id]);
  const [full] = await withPhotos([{ ...row, views: counts ? row.views + 1 : row.views }]);
  const out = await listingPublicShape(full, req);
  if (!req.user) out.vendedor_telefone = null; // contacto só para utilizadores com sessão
  res.json(out);
}));

// ---------- favorites ----------
app.get('/api/me/favorites', requireAuth, A(async (req, res) => {
  const rows = await withPhotos(await db.all(`${LISTING_SELECT} JOIN favorites f ON f.listing_id = l.id AND f.user_id = ? WHERE l.status='aprovado' ORDER BY f.created_at DESC`, [req.user.id]));
  res.json(rows.map((r) => { const { vendedor_telefone, ...x } = r; return { ...x, favorito: true, fotos: r.fotos.slice(0, 1) }; }));
}));

app.post('/api/listings/:id/favorite', requireAuth, A(async (req, res) => {
  const id = Number(req.params.id);
  const exists = await db.get(`SELECT 1 AS x FROM listings WHERE id = ? AND status='aprovado'`, [id]);
  if (!exists) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const has = await db.get('SELECT 1 AS x FROM favorites WHERE user_id=? AND listing_id=?', [req.user.id, id]);
  if (has) await db.run('DELETE FROM favorites WHERE user_id=? AND listing_id=?', [req.user.id, id]);
  else await db.run('INSERT INTO favorites (user_id, listing_id) VALUES (?,?)', [req.user.id, id]);
  res.json({ favorito: !has });
}));

// ---------- reports (denúncias) ----------
app.post('/api/listings/:id/report', requireAuth, A(async (req, res) => {
  const id = Number(req.params.id);
  const listing = await db.get(`SELECT id, seller_id FROM listings WHERE id = ? AND status='aprovado'`, [id]);
  if (!listing) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'Não pode denunciar o seu próprio anúncio.' });
  const motivo = sanitizeText(req.body.motivo, 60);
  if (!REPORT_MOTIVOS.includes(motivo)) return res.status(400).json({ error: 'Motivo inválido.' });
  const detalhes = sanitizeText(req.body.detalhes, 500);
  try {
    await db.run('INSERT INTO reports (listing_id, reporter_id, motivo, detalhes) VALUES (?,?,?,?)', [id, req.user.id, motivo, detalhes || null]);
  } catch (e) {
    return res.status(409).json({ error: 'Já denunciou este anúncio.' });
  }
  res.status(201).json({ ok: true, message: 'Denúncia enviada. A equipa vai analisar.' });
}));

// ---------- seller ----------
app.get('/api/seller/listings', requireRole('seller', 'admin'), A(async (req, res) => {
  const rows = await withPhotos(await db.all(`${LISTING_SELECT} WHERE l.seller_id = ? ORDER BY l.created_at DESC`, [req.user.id]));
  res.json(rows.map((r) => { const { vendedor_telefone, ...x } = r; return x; }));
}));

app.get('/api/seller/listings/:id', requireRole('seller', 'admin'), A(async (req, res) => {
  const row = await db.get(`${LISTING_SELECT} WHERE l.id = ?`, [Number(req.params.id)]);
  if (!row || (row.seller_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const [full] = await withPhotos([row]);
  const { vendedor_telefone, ...x } = full;
  res.json(x);
}));

app.post('/api/seller/listings', requireRole('seller', 'admin'), (req, res) => {
  upload.array('fotos', MAX_PHOTOS)(req, res, A(async (err) => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err) });
    const { errors, data } = await parseListingBody(req.body);
    const files = req.files || [];
    if (!files.length) errors.push('Adicione pelo menos uma foto.');
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const id = await db.tx(async (t) => {
      const info = await t.run(`INSERT INTO listings (seller_id, category_id, titulo, descricao, preco_kz, provincia, cidade, estado, marca, quantidade, status)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'pendente')`, [
        req.user.id, data.category_id, data.titulo, data.descricao, data.preco_kz, data.provincia,
        data.cidade || null, data.estado, data.marca || null, data.quantidade]);
      const urls = await saveUploadedFiles(files, t);
      for (let i = 0; i < urls.length; i++) {
        await t.run('INSERT INTO listing_photos (listing_id, url, ordem) VALUES (?,?,?)', [info.lastInsertRowid, urls[i], i]);
      }
      return info.lastInsertRowid;
    });
    res.status(201).json({ id, status: 'pendente', message: 'Anúncio criado. Fica visível depois de aprovado pela equipa.' });
  }));
});

app.put('/api/seller/listings/:id', requireRole('seller', 'admin'), (req, res) => {
  upload.array('fotos', MAX_PHOTOS)(req, res, A(async (err) => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err) });
    const id = Number(req.params.id);
    const existing = await db.get('SELECT * FROM listings WHERE id = ?', [id]);
    if (!existing || (existing.seller_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Anúncio não encontrado.' });
    const { errors, data } = await parseListingBody({ ...existing, ...req.body, category_id: req.body.category_id ?? existing.category_id });
    const newFiles = req.files || [];
    // keep_fotos_set="1" indica que o cliente enviou a lista (pode ser vazia = removeu todas as fotos antigas)
    const keepSet = req.body.keep_fotos_set !== undefined;
    const keepRaw = req.body.keep_fotos;
    const keep = keepSet ? (Array.isArray(keepRaw) ? keepRaw : (keepRaw ? [keepRaw] : [])) : null;
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const current = (await db.all('SELECT url FROM listing_photos WHERE listing_id=? ORDER BY ordem, id', [id])).map((p) => p.url);
    const finalKeep = keep ? current.filter((u) => keep.includes(u)) : current;
    const removed = current.filter((u) => !finalKeep.includes(u));
    if (finalKeep.length + newFiles.length === 0) return res.status(400).json({ error: 'Precisa de pelo menos uma foto.' });
    const newStatus = req.user.role === 'admin' ? existing.status : 'pendente';
    await db.tx(async (t) => {
      // editar volta a submeter para aprovação (exceto admin)
      await t.run(`UPDATE listings SET category_id=?, titulo=?, descricao=?, preco_kz=?, provincia=?, cidade=?, estado=?, marca=?, quantidade=?,
        status=?, motivo_rejeicao=NULL, updated_at=datetime('now') WHERE id=?`, [
        data.category_id, data.titulo, data.descricao, data.preco_kz, data.provincia, data.cidade || null,
        data.estado, data.marca || null, data.quantidade, newStatus, id]);
      await t.run('DELETE FROM listing_photos WHERE listing_id = ?', [id]);
      const newUrls = await saveUploadedFiles(newFiles, t);
      const all = [...finalKeep, ...newUrls];
      for (let i = 0; i < all.length; i++) {
        await t.run('INSERT INTO listing_photos (listing_id, url, ordem) VALUES (?,?,?)', [id, all[i], i]);
      }
    });
    await removeFiles(removed);
    res.json({ ok: true, id, status: newStatus });
  }));
});

app.delete('/api/seller/listings/:id', requireRole('seller', 'admin'), A(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get('SELECT * FROM listings WHERE id = ?', [id]);
  if (!existing || (existing.seller_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const photos = (await db.all('SELECT url FROM listing_photos WHERE listing_id = ?', [id])).map((p) => p.url);
  await db.run('DELETE FROM listings WHERE id = ?', [id]);
  await removeFiles(photos);
  res.json({ ok: true });
}));

// ---------- admin ----------
const admin = requireRole('admin');

app.get('/api/admin/stats', admin, A(async (req, res) => {
  const n = async (sql) => Number((await db.get(sql)).n);
  res.json({
    utilizadores: await n('SELECT COUNT(*) AS n FROM users'),
    pendentes: await n("SELECT COUNT(*) AS n FROM listings WHERE status='pendente'"),
    aprovados: await n("SELECT COUNT(*) AS n FROM listings WHERE status='aprovado'"),
    denunciasAbertas: await n("SELECT COUNT(*) AS n FROM reports WHERE estado='aberta'"),
  });
}));

app.get('/api/admin/categories', admin, A(async (req, res) => {
  res.json(await db.all('SELECT * FROM categories ORDER BY ordem, nome'));
}));

function slugify(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

app.post('/api/admin/categories', admin, A(async (req, res) => {
  const nome = sanitizeText(req.body.nome, 60);
  if (nome.length < 2) return res.status(400).json({ error: 'Nome da categoria inválido.' });
  const slug = slugify(nome);
  if (!slug) return res.status(400).json({ error: 'Nome da categoria inválido.' });
  if (await db.get('SELECT 1 AS x FROM categories WHERE slug=? OR nome=?', [slug, nome])) return res.status(409).json({ error: 'Categoria já existe.' });
  const info = await db.run('INSERT INTO categories (nome, slug, icone, ordem, destaque, ativo) VALUES (?,?,?,?,?,1)',
    [nome, slug, sanitizeText(req.body.icone, 30) || null, Number(req.body.ordem) || 0, req.body.destaque ? 1 : 0]);
  res.status(201).json({ id: info.lastInsertRowid });
}));

app.put('/api/admin/categories/:id', admin, A(async (req, res) => {
  const id = Number(req.params.id);
  const cat = await db.get('SELECT * FROM categories WHERE id=?', [id]);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });
  const nome = req.body.nome !== undefined ? sanitizeText(req.body.nome, 60) : cat.nome;
  if (nome.length < 2) return res.status(400).json({ error: 'Nome inválido.' });
  const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : cat.ativo;
  const destaque = req.body.destaque !== undefined ? (req.body.destaque ? 1 : 0) : cat.destaque;
  const ordem = req.body.ordem !== undefined ? Number(req.body.ordem) || 0 : cat.ordem;
  const icone = req.body.icone !== undefined ? sanitizeText(req.body.icone, 30) || null : cat.icone;
  await db.run('UPDATE categories SET nome=?, icone=?, ordem=?, destaque=?, ativo=? WHERE id=?', [nome, icone, ordem, destaque, ativo, id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/categories/:id', admin, A(async (req, res) => {
  const id = Number(req.params.id);
  const used = Number((await db.get('SELECT COUNT(*) AS n FROM listings WHERE category_id=?', [id])).n);
  if (used > 0) return res.status(409).json({ error: `Esta categoria tem ${used} anúncio(s). Desative-a em vez de a apagar.` });
  await db.run('DELETE FROM categories WHERE id=?', [id]);
  res.json({ ok: true });
}));

app.get('/api/admin/listings', admin, A(async (req, res) => {
  const status = LISTING_STATUS.includes(String(req.query.status)) ? String(req.query.status) : 'pendente';
  const rows = await withPhotos(await db.all(`${LISTING_SELECT} WHERE l.status = ? ORDER BY l.created_at ASC`, [status]));
  res.json(rows.map((r) => { const { vendedor_telefone, ...x } = r; return x; }));
}));

app.post('/api/admin/listings/:id/approve', admin, A(async (req, res) => {
  const r = await db.run(`UPDATE listings SET status='aprovado', motivo_rejeicao=NULL, updated_at=datetime('now') WHERE id=?`, [Number(req.params.id)]);
  if (!r.changes) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  res.json({ ok: true });
}));

app.post('/api/admin/listings/:id/reject', admin, A(async (req, res) => {
  const motivo = sanitizeText(req.body.motivo, 300);
  if (motivo.length < 3) return res.status(400).json({ error: 'Indique o motivo da rejeição.' });
  const r = await db.run(`UPDATE listings SET status='rejeitado', motivo_rejeicao=?, updated_at=datetime('now') WHERE id=?`, [motivo, Number(req.params.id)]);
  if (!r.changes) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  res.json({ ok: true });
}));

app.get('/api/admin/users', admin, A(async (req, res) => {
  res.json(await db.all('SELECT id, nome, email, telefone, role, created_at FROM users ORDER BY created_at DESC'));
}));

app.put('/api/admin/users/:id/role', admin, A(async (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body.role);
  if (!['buyer', 'seller', 'admin'].includes(role)) return res.status(400).json({ error: 'Papel inválido.' });
  if (id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Não pode retirar o seu próprio acesso de administrador.' });
  const r = await db.run('UPDATE users SET role=? WHERE id=?', [role, id]);
  if (!r.changes) return res.status(404).json({ error: 'Utilizador não encontrado.' });
  res.json({ ok: true });
}));

app.get('/api/admin/reports', admin, A(async (req, res) => {
  const estado = ['aberta', 'resolvida', 'ignorada'].includes(String(req.query.estado)) ? String(req.query.estado) : 'aberta';
  const rows = await db.all(`
    SELECT r.id, r.motivo, r.detalhes, r.estado, r.created_at, r.listing_id,
           l.titulo AS listing_titulo, l.status AS listing_status,
           u.nome AS reporter_nome, u.email AS reporter_email
    FROM reports r
    JOIN listings l ON l.id = r.listing_id
    JOIN users u ON u.id = r.reporter_id
    WHERE r.estado = ? ORDER BY r.created_at DESC`, [estado]);
  res.json(rows);
}));

app.put('/api/admin/reports/:id', admin, A(async (req, res) => {
  const estado = String(req.body.estado);
  if (!['resolvida', 'ignorada'].includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  const r = await db.run('UPDATE reports SET estado=? WHERE id=?', [estado, Number(req.params.id)]);
  if (!r.changes) return res.status(404).json({ error: 'Denúncia não encontrada.' });
  res.json({ ok: true });
}));

app.post('/api/admin/listings/:id/remove', admin, A(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.run(`UPDATE listings SET status='removido', updated_at=datetime('now') WHERE id=?`, [id]);
  if (!r.changes) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  res.json({ ok: true });
}));

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

// SPA fallback
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, () => console.log(`Kamba Market a correr em http://localhost:${PORT} (${db.kind})`));
  }).catch((e) => { console.error('Falha ao iniciar a base de dados:', e); process.exit(1); });
}

module.exports = app;
module.exports.ready = ready;
