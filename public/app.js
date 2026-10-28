/* Kamba Market: SPA leve em JavaScript puro (sem build). */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const state = { user: null, categories: [], meta: null };
  const KZ = (n) => new Intl.NumberFormat('pt-AO').format(Number(n || 0)) + ' Kz';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtData = (iso) => { try { return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('pt-AO', { timeZone: 'Africa/Luanda', day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return iso; } };
  const STATUS_LABEL = { pendente: ['Pendente', 'warn'], aprovado: ['Aprovado', 'ok'], rejeitado: ['Rejeitado', 'bad'], removido: ['Removido', 'bad'] };

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { const err = new Error(data.error || 'Erro inesperado.'); err.status = res.status; throw err; }
    return data;
  }

  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 2800);
  }

  function confirmBox(title, body, okLabel = 'Confirmar') {
    return new Promise((resolve) => {
      const m = document.getElementById('modal');
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').textContent = body;
      const ok = document.getElementById('modal-ok');
      const cancel = document.getElementById('modal-cancel');
      ok.textContent = okLabel;
      m.hidden = false;
      const done = (v) => { m.hidden = true; ok.onclick = cancel.onclick = null; resolve(v); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
    });
  }

  function setLoading() { app.innerHTML = '<div class="loading" role="status">A carregar…</div>'; }

  // ---------- header / nav ----------
  function renderAccountNav() {
    const el = document.getElementById('account-nav');
    if (!state.user) {
      el.innerHTML = `<a href="#/entrar">Entrar</a><a href="#/registar">Criar conta</a><a class="btn gold small" href="#/vender">Vender</a>`;
      return;
    }
    const u = state.user;
    const links = [`<a href="#/favoritos">Favoritos</a>`];
    if (u.role === 'seller' || u.role === 'admin') links.push(`<a href="#/vender">Painel</a>`);
    if (u.role === 'admin') links.push(`<a href="#/admin">Admin</a>`);
    el.innerHTML = links.join('') + `<a class="btn gold small" href="#/vender/novo">Vender</a><button class="link" id="logout">Sair</button>`;
    document.getElementById('logout').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null; renderAccountNav(); toast('Sessão terminada.'); location.hash = '#/';
    };
  }

  function renderCatNav() {
    const el = document.getElementById('catnav');
    const current = (location.hash.match(/categoria=([^&]+)/) || [])[1] || '';
    el.innerHTML = `<a href="#/anuncios" class="${!current ? 'active' : ''}">Todas</a>` +
      state.categories.map((c) => `<a href="#/anuncios?categoria=${esc(c.slug)}" class="${current === c.slug ? 'active' : ''}">${esc(c.nome)}</a>`).join('');
  }

  async function loadBase() {
    try {
      const [me, cats, meta] = await Promise.all([api('/api/auth/me'), api('/api/categories'), api('/api/meta')]);
      state.user = me.user; state.categories = cats; state.meta = meta;
    } catch (e) {
      toast('Não foi possível ligar ao servidor. Verifique se está a correr.', true);
    }
    renderAccountNav(); renderCatNav();
  }

  // ---------- components ----------
  function card(l) {
    const foto = (l.fotos && l.fotos[0]) || '/placeholder.svg';
    return `<a class="card" href="#/anuncio/${l.id}">
      <div class="thumb"><img loading="lazy" src="${esc(foto)}" alt="${esc(l.titulo)}"/></div>
      <div class="body">
        <div class="title">${esc(l.titulo)}</div>
        <div class="price">${KZ(l.preco_kz)}</div>
        <div class="meta">${esc(l.provincia)} · ${esc(l.estado)}</div>
        ${l.is_demo ? '<span class="badge demo">DEMO</span>' : ''}
      </div></a>`;
  }
  const skeletons = (n = 4) => `<div class="grid">${Array.from({ length: n }).map(() => '<div class="skeleton"></div>').join('')}</div>`;
  const empty = (ico, title, text, action = '') => `<div class="empty"><div class="ico">${ico}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;

  // ---------- pages ----------
  async function pageHome() {
    app.innerHTML = `
      <section class="hero">
        <span class="gold-line"></span>
        <h1>Compre e venda em Angola, com preço em Kz</h1>
        <p>Telemóveis, informática, moda, veículos e imóveis numa só plataforma. Contacte o vendedor pelo WhatsApp.</p>
        <div class="btn-row" style="margin-top:14px">
          <a class="btn gold" href="#/anuncios">Ver anúncios</a>
          <a class="btn ghost" style="background:transparent;color:#fff;border-color:#fff" href="#/vender/novo">Vender um produto</a>
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Categorias em destaque</h2><a href="#/anuncios">Ver todas</a></div>
        <div class="cat-grid" id="feat-cats"></div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Anúncios recentes</h2><a href="#/anuncios?sort=recentes">Ver mais</a></div>
        <div id="recent">${skeletons(4)}</div>
      </section>
      <section class="section">
        <h2>Como comprar e vender</h2>
        <div class="steps">
          <div class="step"><div class="n">1</div><h3>Crie a sua conta</h3><p class="muted small">Grátis. Só precisa de email e palavra-passe.</p></div>
          <div class="step"><div class="n">2</div><h3>Publique o anúncio</h3><p class="muted small">Título, preço em Kz, província, fotos e estado (novo ou usado).</p></div>
          <div class="step"><div class="n">3</div><h3>A equipa aprova</h3><p class="muted small">Cada anúncio é revisto antes de aparecer no site.</p></div>
          <div class="step"><div class="n">4</div><h3>Combine pelo WhatsApp</h3><p class="muted small">Negoceie e combine a entrega diretamente com o vendedor ou comprador.</p></div>
        </div>
        <p class="small muted" style="margin-top:10px">Dica de segurança: encontre-se em local público, veja o produto antes de pagar e desconfie de preços muito abaixo do mercado.</p>
      </section>`;

    const cats = state.categories.filter((c) => c.destaque).slice(0, 5);
    const list = cats.length ? cats : state.categories.slice(0, 5);
    document.getElementById('feat-cats').innerHTML = list.map((c) =>
      `<a class="cat-card" href="#/anuncios?categoria=${esc(c.slug)}"><div class="ico">${esc(c.icone || '📦')}</div><div><b>${esc(c.nome)}</b></div><div class="n">${c.total} anúncio(s)</div></a>`).join('') || empty('📂', 'Sem categorias', 'As categorias são geridas pela administração.');

    try {
      const data = await api('/api/listings?sort=recentes&limit=8');
      document.getElementById('recent').innerHTML = data.items.length
        ? `<div class="grid">${data.items.map(card).join('')}</div>`
        : empty('🛍️', 'Ainda não há anúncios', 'Seja o primeiro a publicar um produto.', '<p><a class="btn gold" href="#/vender/novo">Vender agora</a></p>');
    } catch (e) {
      document.getElementById('recent').innerHTML = empty('⚠️', 'Não foi possível carregar', e.message);
    }
  }

  async function pageListings() {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const f = {
      q: qs.get('q') || '', categoria: qs.get('categoria') || '', min: qs.get('min') || '', max: qs.get('max') || '',
      provincia: qs.get('provincia') || '', estado: qs.get('estado') || '', sort: qs.get('sort') || 'recentes', page: Number(qs.get('page') || 1),
    };
    const provs = (state.meta && state.meta.provincias) || [];
    const catName = (state.categories.find((c) => c.slug === f.categoria) || {}).nome;
    app.innerHTML = `
      <div class="layout-filters">
        <aside class="panel" aria-label="Filtros">
          <h3>Filtros</h3>
          <form id="filters">
            <div class="field"><label for="f-q">Pesquisa</label><input id="f-q" name="q" value="${esc(f.q)}" placeholder="Ex.: iPhone, Hilux"/></div>
            <div class="field"><label for="f-cat">Categoria</label>
              <select id="f-cat" name="categoria"><option value="">Todas</option>${state.categories.map((c) => `<option value="${esc(c.slug)}" ${c.slug === f.categoria ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
            <div class="field"><label for="f-prov">Província</label>
              <select id="f-prov" name="provincia"><option value="">Todas</option>${provs.map((p) => `<option ${p === f.provincia ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
            <div class="field"><label>Preço (Kz)</label>
              <div class="row2"><input name="min" type="number" min="0" inputmode="numeric" placeholder="Mín." value="${esc(f.min)}"/><input name="max" type="number" min="0" inputmode="numeric" placeholder="Máx." value="${esc(f.max)}"/></div></div>
            <div class="field"><label for="f-est">Estado</label>
              <select id="f-est" name="estado"><option value="">Qualquer</option><option value="novo" ${f.estado === 'novo' ? 'selected' : ''}>Novo</option><option value="usado" ${f.estado === 'usado' ? 'selected' : ''}>Usado</option></select></div>
            <button class="btn block" type="submit">Aplicar filtros</button>
            <button class="btn ghost block" type="button" id="clear-filters" style="margin-top:8px">Limpar</button>
          </form>
        </aside>
        <section>
          <div class="toolbar">
            <div><h2 style="margin:0">${esc(catName || 'Todos os anúncios')}</h2><div class="meta" id="count"></div></div>
            <div class="sort"><label class="visually-hidden" for="sort">Ordenar</label>
              <select id="sort">
                <option value="recentes">Mais recentes</option>
                <option value="preco_asc">Preço: menor primeiro</option>
                <option value="preco_desc">Preço: maior primeiro</option>
                <option value="mais_vistos">Mais vistos</option>
              </select></div>
          </div>
          <div id="results">${skeletons(6)}</div>
          <div class="pager" id="pager"></div>
        </section>
      </div>`;
    document.getElementById('sort').value = f.sort;

    const buildHash = (over) => {
      const p = new URLSearchParams();
      const merged = { ...f, ...over };
      Object.entries(merged).forEach(([k, v]) => { if (v && !(k === 'page' && v === 1)) p.set(k, v); });
      return '#/anuncios' + (p.toString() ? '?' + p.toString() : '');
    };

    document.getElementById('filters').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const over = { q: fd.get('q').trim(), categoria: fd.get('categoria'), provincia: fd.get('provincia'), min: fd.get('min'), max: fd.get('max'), estado: fd.get('estado'), page: 1 };
      location.hash = buildHash(over);
    };
    document.getElementById('clear-filters').onclick = () => { location.hash = '#/anuncios'; };
    document.getElementById('sort').onchange = (e) => { location.hash = buildHash({ sort: e.target.value, page: 1 }); };

    const params = new URLSearchParams();
    ['q', 'categoria', 'provincia', 'min', 'max', 'estado'].forEach((k) => { if (f[k]) params.set(k, f[k]); });
    params.set('sort', f.sort); params.set('page', f.page); params.set('limit', 12);
    try {
      const data = await api('/api/listings?' + params.toString());
      document.getElementById('count').textContent = `${data.total} anúncio(s) encontrado(s)`;
      document.getElementById('results').innerHTML = data.items.length
        ? `<div class="grid">${data.items.map(card).join('')}</div>`
        : empty('🔎', 'Nenhum anúncio encontrado', 'Tente outra pesquisa ou remova alguns filtros.', '<p><a class="btn ghost" href="#/anuncios">Limpar filtros</a></p>');
      document.getElementById('pager').innerHTML = data.pages > 1
        ? `<button class="btn ghost small" ${f.page <= 1 ? 'disabled' : ''} data-go="${f.page - 1}">Anterior</button>
           <span class="meta">Página ${data.page} de ${data.pages}</span>
           <button class="btn ghost small" ${f.page >= data.pages ? 'disabled' : ''} data-go="${f.page + 1}">Seguinte</button>` : '';
      document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { location.hash = buildHash({ page: Number(b.dataset.go) }); }));
    } catch (e) {
      document.getElementById('results').innerHTML = empty('⚠️', 'Erro ao carregar', e.message);
    }
  }

  // Galeria, WhatsApp e restantes ações do produto
  async function pageProduct(id) {
    setLoading();
    let l;
    try { l = await api('/api/listings/' + id); } catch (e) {
      app.innerHTML = empty('🚫', 'Anúncio não encontrado', 'Pode ter sido removido ou ainda não foi aprovado.', '<p><a class="btn" href="#/anuncios">Ver anúncios</a></p>');
      return;
    }
    const fotos = (l.fotos && l.fotos.length) ? l.fotos : ['/placeholder.svg'];
    const url = location.origin + '/#/anuncio/' + l.id;
    const waPhone = (l.vendedor_telefone || '').replace(/\D/g, '');
    const waMsg = `Olá, vi o anúncio "${l.titulo}" no Kamba Market por ${KZ(l.preco_kz)}. Ainda está disponível? ${url}`;
    const waHref = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}` : '';
    const isOwner = state.user && state.user.id === l.seller_id;
    const wa = !state.user
      ? `<a class="btn wa block" href="#/entrar">Entrar para ver o contacto</a>`
      : (waHref ? `<a class="btn wa block" target="_blank" rel="noopener" href="${esc(waHref)}">Contactar no WhatsApp</a>`
        : `<button class="btn wa block" disabled>Vendedor sem WhatsApp</button>`);

    app.innerHTML = `
      <p class="meta"><a href="#/anuncios?categoria=${esc(l.categoria_slug)}">${esc(l.categoria_nome)}</a> · <a href="#/anuncios">Todos</a></p>
      ${l.status !== 'aprovado' ? `<div class="panel" style="margin-bottom:12px;border-color:var(--gold)"><b>Estado: ${STATUS_LABEL[l.status][0]}.</b> Só é visível para o dono e administração. ${l.motivo_rejeicao ? 'Motivo: ' + esc(l.motivo_rejeicao) : ''}</div>` : ''}
      <div class="product">
        <div class="gallery">
          <div class="main-img"><img id="main-photo" src="${esc(fotos[0])}" alt="${esc(l.titulo)}"/></div>
          ${fotos.length > 1 ? `<div class="thumbs">${fotos.map((f, i) => `<button class="${i === 0 ? 'on' : ''}" data-i="${i}" aria-label="Foto ${i + 1}"><img src="${esc(f)}" alt=""/></button>`).join('')}</div>` : ''}
        </div>
        <div class="buybox">
          <div>${l.is_demo ? '<span class="badge demo">Anúncio DEMO</span> ' : ''}<span class="badge">${esc(l.estado)}</span> ${l.quantidade > 0 ? `<span class="badge gold">${l.quantidade} disponível(eis)</span>` : '<span class="badge bad">Esgotado</span>'}</div>
          <h1>${esc(l.titulo)}</h1>
          <div class="big-price">${KZ(l.preco_kz)}</div>
          <dl class="facts">
            <div><dt>Localização</dt><dd>${esc(l.provincia)}${l.cidade ? ', ' + esc(l.cidade) : ''}</dd></div>
            <div><dt>Marca</dt><dd>${esc(l.marca || '-')}</dd></div>
            <div><dt>Estado</dt><dd>${esc(l.estado)}</dd></div>
            <div><dt>Publicado em</dt><dd>${fmtData(l.created_at)}</dd></div>
            <div><dt>Visualizações</dt><dd>${l.views}</dd></div>
            <div><dt>Favoritos</dt><dd id="fav-count">${l.favoritos}</dd></div>
          </dl>
          <div class="seller-box panel">
            <div class="avatar">${esc((l.vendedor_nome || '?')[0].toUpperCase())}</div>
            <div><b>${esc(l.vendedor_nome)}</b><div class="meta">Vendedor · ${esc(l.provincia)}</div></div>
          </div>
          ${isOwner ? '<p class="meta">Este é o seu anúncio. <a href="#/vender">Gerir no painel</a></p>' : wa}
          <div class="btn-row">
            ${state.user && !isOwner ? `<button class="btn ghost" id="fav-btn" aria-pressed="${l.favorito}">${l.favorito ? '♥ Nos favoritos' : '♡ Favorito'}</button>` : ''}
            <button class="btn ghost" id="share-btn">Partilhar</button>
            ${state.user && !isOwner ? `<button class="btn ghost" id="report-btn">Denunciar</button>` : ''}
          </div>
          <div class="panel">
            <h3>Descrição</h3>
            <p class="desc">${esc(l.descricao)}</p>
          </div>
          <p class="small muted">Pagamentos em modo de teste. Combine o pagamento e a entrega diretamente com o vendedor, de preferência em local público.</p>
        </div>
      </div>`;

    document.querySelectorAll('.gallery .thumbs button').forEach((b) => (b.onclick = () => {
      document.getElementById('main-photo').src = fotos[Number(b.dataset.i)];
      document.querySelectorAll('.gallery .thumbs button').forEach((x) => x.classList.toggle('on', x === b));
    }));

    const favBtn = document.getElementById('fav-btn');
    if (favBtn) favBtn.onclick = async () => {
      if (!state.user) return (location.hash = '#/entrar');
      try {
        const r = await api(`/api/listings/${l.id}/favorite`, { method: 'POST' });
        favBtn.textContent = r.favorito ? '♥ Nos favoritos' : '♡ Favorito';
        favBtn.setAttribute('aria-pressed', String(r.favorito));
        toast(r.favorito ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
      } catch (e) { toast(e.message, true); }
    };

    document.getElementById('share-btn').onclick = async () => {
      const data = { title: l.titulo, text: `${l.titulo} por ${KZ(l.preco_kz)} no Kamba Market`, url };
      if (navigator.share) { try { await navigator.share(data); } catch (e) {} return; }
      try { await navigator.clipboard.writeText(url); toast('Link copiado para a área de transferência.'); }
      catch (e) { toast('Não foi possível copiar. Link: ' + url, true); }
    };

    const rep = document.getElementById('report-btn');
    if (rep) rep.onclick = () => openReport(l.id);
  }

  function openReport(listingId) {
    const motivos = (state.meta && state.meta.reportMotivos) || [];
    const modalBody = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    title.textContent = 'Denunciar anúncio';
    modalBody.innerHTML = `<div class="field"><label for="rep-motivo">Motivo</label>
      <select id="rep-motivo">${motivos.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="field"><label for="rep-det">Detalhes (opcional)</label><textarea id="rep-det" maxlength="500"></textarea></div>`;
    const m = document.getElementById('modal'); m.hidden = false;
    const ok = document.getElementById('modal-ok'); const cancel = document.getElementById('modal-cancel');
    ok.textContent = 'Enviar denúncia'; ok.className = 'btn danger';
    const close = () => { m.hidden = true; modalBody.textContent = ''; ok.onclick = cancel.onclick = null; };
    cancel.onclick = close;
    ok.onclick = async () => {
      try {
        const r = await api(`/api/listings/${listingId}/report`, { method: 'POST', body: { motivo: document.getElementById('rep-motivo').value, detalhes: document.getElementById('rep-det').value } });
        close(); toast(r.message);
      } catch (e) { toast(e.message, true); close(); }
    };
  }

  // ---------- auth ----------
  function pageAuth(mode) {
    const isReg = mode === 'registar';
    app.innerHTML = `
      <div class="auth panel">
        <div class="tabs">
          <button class="${!isReg ? 'on' : ''}" data-m="entrar">Entrar</button>
          <button class="${isReg ? 'on' : ''}" data-m="registar">Criar conta</button>
        </div>
        <form id="auth-form" novalidate>
          ${isReg ? `
            <div class="field"><label for="a-nome">Nome completo</label><input id="a-nome" name="nome" required maxlength="80" autocomplete="name"/></div>
            <div class="field"><label for="a-tel">Telefone / WhatsApp (opcional)</label><input id="a-tel" name="telefone" type="tel" placeholder="+244 9XX XXX XXX" maxlength="20"/></div>
            <div class="field"><label for="a-role">Quero</label>
              <select id="a-role" name="role"><option value="buyer">Comprar</option><option value="seller">Comprar e vender</option></select></div>` : ''}
          <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" required autocomplete="email"/></div>
          <div class="field"><label for="a-pass">Palavra-passe</label><input id="a-pass" name="password" type="password" required minlength="8" autocomplete="${isReg ? 'new-password' : 'current-password'}"/>
            ${isReg ? '<span class="hint">Mínimo de 8 caracteres. Guardada de forma cifrada.</span>' : ''}</div>
          <p class="error" id="auth-err" role="alert"></p>
          <button class="btn block" type="submit" id="auth-submit">${isReg ? 'Criar conta' : 'Entrar'}</button>
        </form>
        <p class="small muted" style="margin-top:12px">Conta de demonstração: comprador@demo.kamba / demo1234 (vendedor@demo.kamba, admin@demo.kamba)</p>
      </div>`;
    document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => (location.hash = '#/' + b.dataset.m)));
    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      const btn = document.getElementById('auth-submit');
      btn.disabled = true; btn.textContent = 'A processar…';
      try {
        const r = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
        state.user = r.user; renderAccountNav();
        toast(isReg ? 'Conta criada. Bem-vindo!' : 'Sessão iniciada.');
        location.hash = r.user.role === 'admin' ? '#/admin' : (r.user.role === 'seller' ? '#/vender' : '#/');
      } catch (err) {
        document.getElementById('auth-err').textContent = err.message;
        btn.disabled = false; btn.textContent = isReg ? 'Criar conta' : 'Entrar';
      }
    };
  }

  function requireUser(roles) {
    if (!state.user) { location.hash = '#/entrar'; return false; }
    if (roles && !roles.includes(state.user.role)) {
      app.innerHTML = empty('🔒', 'Sem permissão', 'Esta área não está disponível para a sua conta.', '<p><a class="btn" href="#/">Voltar ao início</a></p>');
      return false;
    }
    return true;
  }

  // ---------- seller ----------
  async function pageSellerList() {
    if (!requireUser(['seller', 'admin'])) return;
    setLoading();
    let items = [];
    try { items = await api('/api/seller/listings'); } catch (e) { app.innerHTML = empty('⚠️', 'Erro', e.message); return; }
    app.innerHTML = `
      <div class="dash-head"><div><h1>Os meus anúncios</h1><p class="muted small">Só vê e edita os seus próprios anúncios.</p></div>
        <a class="btn gold" href="#/vender/novo">+ Novo anúncio</a></div>
      ${items.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Anúncio</th><th>Preço</th><th>Estado</th><th>Qtd.</th><th>Vistas</th><th></th></tr></thead>
        <tbody>${items.map((l) => `<tr>
          <td><a href="#/anuncio/${l.id}"><b>${esc(l.titulo)}</b></a><div class="meta">${esc(l.categoria_nome)} · ${esc(l.provincia)}</div></td>
          <td>${KZ(l.preco_kz)}</td>
          <td><span class="badge ${STATUS_LABEL[l.status][1]}">${STATUS_LABEL[l.status][0]}</span>${l.motivo_rejeicao ? `<div class="meta">${esc(l.motivo_rejeicao)}</div>` : ''}</td>
          <td>${l.quantidade}</td><td>${l.views}</td>
          <td style="white-space:nowrap"><a class="btn ghost small" href="#/vender/editar/${l.id}">Editar</a>
            <button class="btn danger small" data-del="${l.id}" data-t="${esc(l.titulo)}">Apagar</button></td>
        </tr>`).join('')}</tbody></table></div>`
        : empty('📦', 'Ainda não tem anúncios', 'Publique o seu primeiro produto. Fica visível depois de aprovado.', '<p><a class="btn gold" href="#/vender/novo">Criar anúncio</a></p>')}`;
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const ok = await confirmBox('Apagar anúncio?', `"${b.dataset.t}" será apagado permanentemente, incluindo as fotos. Esta ação não pode ser desfeita.`, 'Apagar');
      if (!ok) return;
      try { await api('/api/seller/listings/' + b.dataset.del, { method: 'DELETE' }); toast('Anúncio apagado.'); pageSellerList(); }
      catch (e) { toast(e.message, true); }
    }));
  }

  async function pageListingForm(id) {
    if (!requireUser(['seller', 'admin'])) return;
    const editing = !!id;
    let l = null;
    if (editing) {
      setLoading();
      try { l = await api('/api/seller/listings/' + id); } catch (e) { app.innerHTML = empty('🚫', 'Anúncio não encontrado', e.message); return; }
    }
    const provs = state.meta.provincias;
    const keptPhotos = editing ? [...(l.fotos || [])] : [];
    let newFiles = [];
    const cats = state.categories;

    app.innerHTML = `
      <div class="dash-head"><div><h1>${editing ? 'Editar anúncio' : 'Novo anúncio'}</h1>
        <p class="muted small">${editing ? 'Ao guardar, o anúncio volta a ficar pendente de aprovação.' : 'O anúncio fica pendente até a equipa aprovar.'}</p></div>
        <a class="btn ghost small" href="#/vender">← Voltar</a></div>
      <form id="lf" class="panel" novalidate style="max-width:820px">
        <div class="row2">
          <div class="field" style="grid-column:1/-1"><label for="lf-titulo">Título</label><input id="lf-titulo" name="titulo" maxlength="120" required value="${esc(l?.titulo || '')}"/></div>
          <div class="field"><label for="lf-cat">Categoria</label>
            <select id="lf-cat" name="category_id" required><option value="">Escolha…</option>${cats.map((c) => `<option value="${c.id}" ${l && l.category_id === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
          <div class="field"><label for="lf-preco">Preço (Kz)</label><input id="lf-preco" name="preco_kz" type="number" min="0" step="1" inputmode="numeric" required value="${esc(l?.preco_kz ?? '')}"/></div>
          <div class="field"><label for="lf-prov">Província</label>
            <select id="lf-prov" name="provincia" required><option value="">Escolha…</option>${provs.map((p) => `<option ${l && l.provincia === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
          <div class="field"><label for="lf-cid">Cidade / município</label><input id="lf-cid" name="cidade" maxlength="80" value="${esc(l?.cidade || '')}"/></div>
          <div class="field"><label for="lf-est">Estado</label>
            <select id="lf-est" name="estado" required><option value="novo" ${l?.estado === 'novo' ? 'selected' : ''}>Novo</option><option value="usado" ${l?.estado === 'usado' ? 'selected' : ''}>Usado</option></select></div>
          <div class="field"><label for="lf-marca">Marca</label><input id="lf-marca" name="marca" maxlength="60" value="${esc(l?.marca || '')}"/></div>
          <div class="field"><label for="lf-qtd">Quantidade</label><input id="lf-qtd" name="quantidade" type="number" min="0" step="1" value="${esc(l?.quantidade ?? 1)}"/></div>
        </div>
        <div class="field"><label for="lf-desc">Descrição</label><textarea id="lf-desc" name="descricao" maxlength="4000" required>${esc(l?.descricao || '')}</textarea></div>
        <div class="field"><label>Fotos (até 6, JPG/PNG/WEBP, máx. 5 MB cada)</label>
          <div class="photos-pick" id="photos"></div>
          <input id="lf-fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple />
        </div>
        <p class="error" id="lf-err" role="alert"></p>
        <div class="btn-row"><button class="btn" type="submit" id="lf-submit">${editing ? 'Guardar alterações' : 'Publicar para revisão'}</button>
          <a class="btn ghost" href="#/vender">Cancelar</a></div>
      </form>`;

    const drawPhotos = () => {
      const el = document.getElementById('photos');
      const existing = keptPhotos.map((u, i) => `<div class="ph"><img src="${esc(u)}" alt=""/><button type="button" data-rm-old="${i}" aria-label="Remover foto">×</button></div>`);
      const fresh = newFiles.map((f, i) => `<div class="ph"><img src="${URL.createObjectURL(f)}" alt=""/><button type="button" data-rm-new="${i}" aria-label="Remover foto">×</button></div>`);
      el.innerHTML = existing.concat(fresh).join('') || '<span class="meta">Nenhuma foto ainda.</span>';
      el.querySelectorAll('[data-rm-old]').forEach((b) => (b.onclick = () => { keptPhotos.splice(Number(b.dataset.rmOld), 1); drawPhotos(); }));
      el.querySelectorAll('[data-rm-new]').forEach((b) => (b.onclick = () => { newFiles.splice(Number(b.dataset.rmNew), 1); drawPhotos(); }));
    };
    drawPhotos();

    document.getElementById('lf-fotos').onchange = (e) => {
      const files = Array.from(e.target.files);
      const total = keptPhotos.length + newFiles.length + files.length;
      if (total > 6) { toast('Máximo de 6 fotos por anúncio.', true); return; }
      const bad = files.find((f) => f.size > 5 * 1024 * 1024);
      if (bad) { toast('Cada foto pode ter no máximo 5 MB.', true); return; }
      newFiles = newFiles.concat(files);
      e.target.value = '';
      drawPhotos();
    };

    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('lf-err');
      err.textContent = '';
      const f = e.target;
      const fd = new FormData();
      ['titulo', 'category_id', 'preco_kz', 'provincia', 'cidade', 'estado', 'marca', 'quantidade', 'descricao'].forEach((k) => fd.append(k, f.elements[k].value.trim()));
      fd.append('keep_fotos_set', '1');
      keptPhotos.forEach((u) => fd.append('keep_fotos', u));
      newFiles.forEach((file) => fd.append('fotos', file));
      if (!editing && keptPhotos.length + newFiles.length === 0) { err.textContent = 'Adicione pelo menos uma foto.'; return; }
      const btn = document.getElementById('lf-submit');
      btn.disabled = true; btn.textContent = 'A guardar…';
      try {
        if (editing) await api('/api/seller/listings/' + id, { method: 'PUT', body: fd });
        else await api('/api/seller/listings', { method: 'POST', body: fd });
        toast(editing ? 'Anúncio atualizado. Fica pendente de aprovação.' : 'Anúncio publicado. Aguarda aprovação.');
        location.hash = '#/vender';
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false; btn.textContent = editing ? 'Guardar alterações' : 'Publicar para revisão';
      }
    };
  }

  // ---------- favorites ----------
  async function pageFavorites() {
    if (!requireUser()) return;
    setLoading();
    try {
      const items = await api('/api/me/favorites');
      app.innerHTML = `<h1>Os meus favoritos</h1>` + (items.length
        ? `<div class="grid">${items.map(card).join('')}</div>`
        : empty('♡', 'Ainda sem favoritos', 'Toque em ♡ num anúncio para o guardar aqui.', '<p><a class="btn" href="#/anuncios">Explorar anúncios</a></p>'));
    } catch (e) { app.innerHTML = empty('⚠️', 'Erro', e.message); }
  }

  // ---------- admin ----------
  async function pageAdmin(tab = 'pendentes') {
    if (!requireUser(['admin'])) return;
    setLoading();
    const tabs = [['pendentes', 'Pendentes'], ['aprovados', 'Aprovados'], ['rejeitados', 'Rejeitados'], ['categorias', 'Categorias'], ['utilizadores', 'Utilizadores'], ['denuncias', 'Denúncias']];
    let body = '';
    try {
      if (tab === 'categorias') body = await adminCategories();
      else if (tab === 'utilizadores') body = await adminUsers();
      else if (tab === 'denuncias') body = await adminReports();
      else body = await adminListings(tab);
    } catch (e) { body = empty('⚠️', 'Erro', e.message); }
    const stats = await api('/api/admin/stats').catch(() => ({}));
    app.innerHTML = `
      <h1>Painel de administração</h1>
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><div class="v">${stats.utilizadores ?? '-'}</div><div class="l">Utilizadores</div></div>
        <div class="stat"><div class="v">${stats.pendentes ?? '-'}</div><div class="l">Por aprovar</div></div>
        <div class="stat"><div class="v">${stats.aprovados ?? '-'}</div><div class="l">Anúncios ativos</div></div>
        <div class="stat"><div class="v">${stats.denunciasAbertas ?? '-'}</div><div class="l">Denúncias abertas</div></div>
      </div>
      <div class="tabs" style="flex-wrap:wrap">${tabs.map(([k, n]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
      <div id="admin-body">${body}</div>`;
    document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => (location.hash = '#/admin/' + b.dataset.tab)));
    bindAdmin(tab);
  }

  async function adminListings(tab) {
    const map = { pendentes: 'pendente', aprovados: 'aprovado', rejeitados: 'rejeitado' };
    const items = await api('/api/admin/listings?status=' + (map[tab] || 'pendente'));
    if (!items.length) return empty('✅', 'Nada aqui', 'Não há anúncios nesta lista.');
    return `<div class="table-wrap"><table><thead><tr><th>Anúncio</th><th>Vendedor</th><th>Preço</th><th>Ações</th></tr></thead><tbody>
      ${items.map((l) => `<tr><td><a href="#/anuncio/${l.id}"><b>${esc(l.titulo)}</b></a><div class="meta">${esc(l.categoria_nome)} · ${esc(l.provincia)} · ${esc(l.estado)}</div></td>
        <td>${esc(l.vendedor_nome)}</td><td>${KZ(l.preco_kz)}</td>
        <td style="white-space:nowrap">
          ${l.status !== 'aprovado' ? `<button class="btn ok small" data-approve="${l.id}" style="background:var(--ok)">Aprovar</button>` : ''}
          ${l.status !== 'rejeitado' ? `<button class="btn ghost small" data-reject="${l.id}" data-t="${esc(l.titulo)}">Rejeitar</button>` : ''}
          ${l.status === 'aprovado' ? `<button class="btn danger small" data-remove="${l.id}" data-t="${esc(l.titulo)}">Remover</button>` : ''}
        </td></tr>`).join('')}</tbody></table></div>`;
  }

  async function adminCategories() {
    const cats = await api('/api/admin/categories');
    return `
      <div class="panel" style="margin-bottom:12px"><h3>Nova categoria</h3>
        <form id="cat-new" class="row2" style="align-items:end">
          <div class="field" style="margin:0"><label for="cn">Nome</label><input id="cn" required maxlength="60"/></div>
          <div class="field" style="margin:0"><label for="ci">Ícone (emoji)</label><input id="ci" maxlength="30"/></div>
          <button class="btn gold" type="submit">Criar</button>
        </form></div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Slug</th><th>Ícone</th><th>Destaque</th><th>Ativa</th><th></th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td><input value="${esc(c.nome)}" data-f="nome" data-id="${c.id}" style="font:inherit;border:1px solid var(--line);border-radius:8px;padding:4px 8px;width:160px"/></td>
        <td class="meta">${esc(c.slug)}</td>
        <td><input value="${esc(c.icone || '')}" data-f="icone" data-id="${c.id}" style="width:60px;font:inherit;border:1px solid var(--line);border-radius:8px;padding:4px"/></td>
        <td><input type="checkbox" data-f="destaque" data-id="${c.id}" ${c.destaque ? 'checked' : ''}/></td>
        <td><input type="checkbox" data-f="ativo" data-id="${c.id}" ${c.ativo ? 'checked' : ''}/></td>
        <td style="white-space:nowrap"><button class="btn ghost small" data-cat-save="${c.id}">Guardar</button>
          <button class="btn danger small" data-cat-del="${c.id}" data-t="${esc(c.nome)}">Apagar</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:8px">As categorias são lidas da base de dados. Uma categoria com anúncios não pode ser apagada: desative-a.</p>`;
  }

  async function adminUsers() {
    const users = await api('/api/admin/users');
    return `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Email</th><th>Telefone</th><th>Papel</th><th>Desde</th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(u.nome)}</td><td>${esc(u.email)}</td><td>${esc(u.telefone || '-')}</td>
        <td><select data-role="${u.id}" style="font:inherit;padding:4px 8px;border-radius:8px">
          ${['buyer', 'seller', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${({ buyer: 'Comprador', seller: 'Vendedor', admin: 'Admin' })[r]}</option>`).join('')}
        </select></td><td>${fmtData(u.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function adminReports() {
    const reps = await api('/api/admin/reports?estado=aberta');
    if (!reps.length) return empty('✅', 'Sem denúncias abertas', 'Tudo em ordem por agora.');
    return `<div class="table-wrap"><table><thead><tr><th>Anúncio</th><th>Motivo</th><th>Detalhes</th><th>Quem denunciou</th><th>Ações</th></tr></thead><tbody>
      ${reps.map((r) => `<tr><td><a href="#/anuncio/${r.listing_id}"><b>${esc(r.listing_titulo)}</b></a><div class="meta">${esc(r.listing_status)}</div></td>
        <td>${esc(r.motivo)}</td><td>${esc(r.detalhes || '-')}</td><td>${esc(r.reporter_nome)}<div class="meta">${esc(r.reporter_email)}</div></td>
        <td style="white-space:nowrap">
          <button class="btn ghost small" data-rep="${r.id}" data-state="ignorada">Ignorar</button>
          <button class="btn ghost small" data-rep="${r.id}" data-state="resolvida">Resolvida</button>
          <button class="btn danger small" data-rep-remove="${r.listing_id}" data-rep-id="${r.id}" data-t="${esc(r.listing_titulo)}">Remover anúncio</button>
        </td></tr>`).join('')}</tbody></table></div>`;
  }

  function bindAdmin(tab) {
    const body = document.getElementById('admin-body');
    const reload = () => pageAdmin(tab);

    body.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/admin/listings/${b.dataset.approve}/approve`, { method: 'POST' }); toast('Anúncio aprovado.'); reload(); } catch (e) { toast(e.message, true); }
    }));
    body.querySelectorAll('[data-reject]').forEach((b) => (b.onclick = async () => {
      const motivo = prompt('Motivo da rejeição (visível para o vendedor):');
      if (!motivo || motivo.trim().length < 3) return toast('Indique um motivo com pelo menos 3 caracteres.', true);
      try { await api(`/api/admin/listings/${b.dataset.reject}/reject`, { method: 'POST', body: { motivo } }); toast('Anúncio rejeitado.'); reload(); } catch (e) { toast(e.message, true); }
    }));
    body.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
      const ok = await confirmBox('Remover anúncio?', `"${b.dataset.t}" deixa de estar visível no site. Pode ser reativado mais tarde pela equipa.`, 'Remover');
      if (!ok) return;
      try { await api(`/api/admin/listings/${b.dataset.remove}/remove`, { method: 'POST' }); toast('Anúncio removido.'); reload(); } catch (e) { toast(e.message, true); }
    }));

    body.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => {
      const ok = await confirmBox('Alterar papel?', 'Esta alteração muda as permissões do utilizador.', 'Alterar');
      if (!ok) return reload();
      try { await api(`/api/admin/users/${s.dataset.role}/role`, { method: 'PUT', body: { role: s.value } }); toast('Papel atualizado.'); }
      catch (e) { toast(e.message, true); reload(); }
    }));

    const newCat = document.getElementById('cat-new');
    if (newCat) newCat.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/admin/categories', { method: 'POST', body: { nome: document.getElementById('cn').value, icone: document.getElementById('ci').value } }); toast('Categoria criada.'); await refreshCats(); reload(); }
      catch (ex) { toast(ex.message, true); }
    };
    body.querySelectorAll('[data-cat-save]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.catSave;
      const val = (f) => body.querySelector(`[data-f="${f}"][data-id="${id}"]`);
      try {
        await api('/api/admin/categories/' + id, { method: 'PUT', body: { nome: val('nome').value, icone: val('icone').value, destaque: val('destaque').checked, ativo: val('ativo').checked } });
        toast('Categoria guardada.'); await refreshCats(); reload();
      } catch (ex) { toast(ex.message, true); }
    }));
    body.querySelectorAll('[data-cat-del]').forEach((b) => (b.onclick = async () => {
      const ok = await confirmBox('Apagar categoria?', `"${b.dataset.t}" será apagada. Só é possível se não tiver anúncios.`, 'Apagar');
      if (!ok) return;
      try { await api('/api/admin/categories/' + b.dataset.catDel, { method: 'DELETE' }); toast('Categoria apagada.'); await refreshCats(); reload(); }
      catch (ex) { toast(ex.message, true); }
    }));

    body.querySelectorAll('[data-rep]').forEach((b) => (b.onclick = async () => {
      try { await api('/api/admin/reports/' + b.dataset.rep, { method: 'PUT', body: { estado: b.dataset.state } }); toast('Denúncia atualizada.'); reload(); } catch (e) { toast(e.message, true); }
    }));
    body.querySelectorAll('[data-rep-remove]').forEach((b) => (b.onclick = async () => {
      const ok = await confirmBox('Remover anúncio denunciado?', `"${b.dataset.t}" será removido do site e a denúncia fica resolvida.`, 'Remover');
      if (!ok) return;
      try {
        await api(`/api/admin/listings/${b.dataset.repRemove}/remove`, { method: 'POST' });
        await api('/api/admin/reports/' + b.dataset.repId, { method: 'PUT', body: { estado: 'resolvida' } });
        toast('Anúncio removido e denúncia resolvida.'); reload();
      } catch (e) { toast(e.message, true); }
    }));
  }

  async function refreshCats() { state.categories = await api('/api/categories'); renderCatNav(); }

  function pageDoc(title, html) {
    app.innerHTML = `<article class="doc panel" style="max-width:820px"><h1>${title}</h1>${html}</article>`;
  }

  // ---------- router ----------
  function route() {
    const hash = location.hash || '#/';
    const path = hash.split('?')[0];
    document.querySelectorAll('.catnav a').forEach(() => {});
    renderCatNav();
    window.scrollTo(0, 0);
    const parts = path.replace(/^#\/?/, '').split('/');
    const [a, b, c] = parts;
    if (!a) return pageHome();
    if (a === 'anuncios') return pageListings();
    if (a === 'anuncio' && b) return pageProduct(b);
    if (a === 'entrar') return pageAuth('entrar');
    if (a === 'registar') return pageAuth('registar');
    if (a === 'favoritos') return pageFavorites();
    if (a === 'vender') {
      if (b === 'novo') return pageListingForm(null);
      if (b === 'editar' && c) return pageListingForm(c);
      return pageSellerList();
    }
    if (a === 'admin') return pageAdmin(b || 'pendentes');
    if (a === 'ajuda') return pageDoc('Como funciona', `
      <h2>Comprar</h2><ol><li>Pesquise ou escolha uma categoria.</li><li>Filtre por preço, província e estado.</li><li>Abra o anúncio e contacte o vendedor pelo WhatsApp.</li><li>Combine o pagamento e a entrega. Prefira locais públicos.</li></ol>
      <h2>Vender</h2><ol><li>Crie uma conta de vendedor.</li><li>Publique o anúncio com fotos reais, preço em Kz e localização.</li><li>A equipa revê e aprova. Depois fica visível.</li></ol>`);
    if (a === 'termos') return pageDoc('Termos de utilização', `
      <p>Esta é uma versão de demonstração (MVP). Os termos finais devem ser redigidos por um advogado antes do lançamento.</p>
      <h2>Regras básicas</h2><ul><li>Só publique produtos que tenha o direito de vender.</li><li>Não são permitidos produtos ilegais, fraudes ou conteúdos ofensivos.</li><li>A Kamba Market é o intermediário de contacto e não processa pagamentos reais nesta versão (modo de teste).</li><li>A equipa pode remover anúncios que violem estas regras.</li></ul>`);
    if (a === 'privacidade') return pageDoc('Política de privacidade', `
      <p>Guardamos apenas o necessário: nome, email, telefone (opcional) e a palavra-passe em forma cifrada. Esta versão é um MVP de demonstração; a política final deve ser revista antes de publicar.</p>`);
    app.innerHTML = empty('🔍', 'Página não encontrada', 'O endereço não existe.', '<p><a class="btn" href="#/">Ir para o início</a></p>');
  }

  // Pesquisa do cabeçalho
  document.getElementById('header-search').onsubmit = (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    location.hash = '#/anuncios' + (q ? '?q=' + encodeURIComponent(q) : '');
  };
  document.getElementById('year').textContent = new Date().getFullYear();

  window.addEventListener('hashchange', route);
  loadBase().then(route);
})();
