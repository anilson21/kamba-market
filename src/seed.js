// Dados de demonstração (rotulados como DEMO). Não são anúncios reais.
// Só cria dados se a base estiver vazia. Nunca apaga nada.
const db = require('../src/db');
const { hashPassword } = require('./auth');

const CATEGORIAS = [
  ['Telemóveis', 'telemoveis', '📱', 1, 1],
  ['Informática', 'informatica', '💻', 2, 1],
  ['Moda', 'moda', '👕', 3, 1],
  ['Veículos', 'veiculos', '🚗', 4, 1],
  ['Imóveis', 'imoveis', '🏠', 5, 1],
  ['Casa e Jardim', 'casa-e-jardim', '🛋️', 6, 0],
  ['Eletrónica', 'eletronica', '🔌', 7, 0],
  ['Desporto', 'desporto', '⚽', 8, 0],
  ['Serviços', 'servicos', '🛠️', 9, 0],
  ['Outros', 'outros', '📦', 99, 0],
];

async function seed() {
  await db.init();
  const n = await db.get('SELECT COUNT(*) AS n FROM users');
  if (Number(n.n)) { console.log('Base de dados já tem dados. Nada a fazer.'); return; }

  for (const c of CATEGORIAS) {
    await db.run('INSERT INTO categories (nome, slug, icone, ordem, destaque, ativo) VALUES (?,?,?,?,?,1)', c);
  }
  const catRows = await db.all('SELECT slug, id FROM categories');
  const catId = Object.fromEntries(catRows.map((r) => [r.slug, r.id]));

  const pw = hashPassword('demo1234');
  await db.run('INSERT INTO users (nome, email, password_hash, telefone, role) VALUES (?,?,?,?,?)', ['Admin Demo', 'admin@demo.kamba', pw, null, 'admin']);
  const v = await db.run('INSERT INTO users (nome, email, password_hash, telefone, role) VALUES (?,?,?,?,?)', ['Vendedor Demo', 'vendedor@demo.kamba', pw, '+244****0000', 'seller']);
  const vendedor = v.lastInsertRowid;
  await db.run('INSERT INTO users (nome, email, password_hash, telefone, role) VALUES (?,?,?,?,?)', ['Comprador Demo', 'comprador@demo.kamba', pw, null, 'buyer']);

  const itens = [
    ['iPhone 13 128GB (DEMO)', 'telemoveis', 'Demonstração. Bateria a 89%, sem riscos no ecrã.', 450000, 'Luanda', 'Talatona', 'usado', 'Apple', 1, 120],
    ['Portátil Lenovo i5 8GB (DEMO)', 'informatica', 'Demonstração. SSD 256GB, carregador incluído.', 380000, 'Luanda', 'Viana', 'usado', 'Lenovo', 1, 64],
    ['Ténis Nike Air (DEMO)', 'moda', 'Demonstração. Tamanho 42, nunca usados.', 45000, 'Benguela', 'Benguela', 'novo', 'Nike', 3, 30],
    ['Toyota Hilux 2015 (DEMO)', 'veiculos', 'Demonstração. Diesel, 120 mil km.', 28500000, 'Huíla', 'Lubango', 'usado', 'Toyota', 1, 210],
    ['T1 para arrendar (DEMO)', 'imoveis', 'Demonstração. Água e luz incluídas.', 150000, 'Luanda', 'Cacuaco', 'novo', null, 1, 88],
    ['Samsung Galaxy A54 (DEMO)', 'telemoveis', 'Demonstração. Caixa original e película.', 260000, 'Huambo', 'Huambo', 'novo', 'Samsung', 2, 42],
  ];
  for (const [titulo, cat, desc, preco, prov, cidade, estado, marca, qtd, views] of itens) {
    const r = await db.run(`INSERT INTO listings (seller_id, category_id, titulo, descricao, preco_kz, provincia, cidade, estado, marca, quantidade, status, is_demo, views)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'aprovado', 1, ?)`, [vendedor, catId[cat], titulo, desc, preco, prov, cidade, estado, marca, qtd, views]);
    await db.run('INSERT INTO listing_photos (listing_id, url, ordem) VALUES (?,?,0)', [r.lastInsertRowid, '/placeholder.svg']);
  }
  console.log('Seed concluído: 10 categorias, 3 contas demo (senha demo1234), 6 anúncios DEMO.');
}

seed().then(() => db.close && db.close()).catch((e) => { console.error(e); process.exit(1); });
