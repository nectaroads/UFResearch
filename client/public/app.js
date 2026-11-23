const main = document.querySelector('main');
const editor = document.querySelector('#editor');
const access = document.querySelector('#access');
const titles = {
  inicio: 'Início', equipe: 'Equipe', publicacoes: 'Publicações',
  login: 'Entrar', conta: 'Minha conta', busca: 'Busca',
};
let portal;
let account;
let apiOrigin;
let remoteToken;
let currentRender = 0;
let success = '';

const escaped = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = value => String(value ?? '').replace(/[&<>"']/g, character => escaped[character]);

function href(page, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return '#' + page + (params.size ? '?' + params : '');
}

function route() {
  const [page, query] = location.hash.slice(1).split('?');
  return [Object.hasOwn(titles, page) ? page : 'inicio', Object.fromEntries(new URLSearchParams(query))];
}

function navigate(page, values) {
  const next = href(page, values);
  if (location.hash === next) void render();
  else location.hash = next;
}

function apiPath(path) {
  return (apiOrigin || '.') + '/api/' + path;
}

async function api(path, method = 'GET', data) {
  const options = { method, headers: {}, credentials: apiOrigin ? 'omit' : 'same-origin' };
  if (apiOrigin && remoteToken) options.headers.Authorization = 'Bearer ' + remoteToken;
  if (method !== 'GET') options.headers['X-UFResearch-Request'] = 'web';
  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await fetch(apiPath(path), options).catch(() => {
    throw new Error('O serviço do portal está indisponível no momento.');
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Não foi possível concluir a solicitação.');
  return payload;
}

function setNavigation(page) {
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  access.href = account ? '#conta' : '#login';
  access.lastChild.textContent = account ? ' Minha conta' : ' Entrar';
  document.title = titles[page] + ' · ' + portal.name;
}

function empty(message) {
  return `<p class="empty">${html(message)}</p>`;
}

function banner(title, description = '') {
  return `<div class="section-title"><div class="wrap">
    <h1>${html(title)}</h1>${description ? `<p>${html(description)}</p>` : ''}
  </div></div>`;
}

function searchForm(page, query, placeholder, label = 'Buscar', topic = '') {
  return `<form class="search-form" data-search="${page}" role="search">
    <label class="sr-only" for="search-${page}">${html(placeholder)}</label>
    <input id="search-${page}" name="q" type="search" maxlength="160" value="${html(query)}" placeholder="${html(placeholder)}">
    <input type="hidden" name="topic" value="${html(topic)}">
    <button class="button" type="submit"><span class="icon search-icon" aria-hidden="true"></span> ${html(label)}</button>
  </form>`;
}

function home() {
  const preview = portal.pages && !apiOrigin;
  return `<section class="hero">
    <div class="hero-content">
      <p class="kicker">Portal de pesquisa</p>
      <h1>${html(portal.headline)}</h1>
      <p class="hero-description">${html(portal.description)}</p>
      <a class="button gold" href="#publicacoes">Explorar publicações</a>
    </div>
    <figure class="hero-photo">
      <img src="./assets/reitoria.jpg" alt="Fachada do Palácio da Reitoria da UFBA">
      <figcaption><a href="https://commons.wikimedia.org/wiki/File:Fachada_do_Pal%C3%A1cio_da_Reitoria_da_Universidade_Federal_da_Bahia_%28UFBA%29.jpg">Guimarães Mota</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></figcaption>
    </figure>
  </section>
  ${preview ? `<div class="wrap page-body"><p class="notice">A apresentação do portal já está disponível. A busca, a equipe e o acesso às contas serão ativados quando o serviço de dados estiver conectado.</p></div>` : `
    <section class="search-band">
      <div class="wrap home-search"><h2>Busca no portal</h2>
        ${searchForm('busca', '', 'Publicações, temas ou integrantes da equipe')}
      </div>
    </section>`}
  <section class="wrap home-body">
    <div><h2>Sobre o portal</h2><p>${html(portal.about)}</p></div>
    <div class="home-links">
      <a class="home-card" href="#equipe"><span class="mark" aria-hidden="true"></span><h3>Equipe</h3><p>Conheça os integrantes e acesse seus currículos Lattes.</p></a>
      <a class="home-card" href="#publicacoes"><span class="mark" aria-hidden="true"></span><h3>Publicações</h3><p>Consulte a produção científica por tema e baixe os trabalhos disponíveis.</p></a>
    </div>
  </section>`;
}

function teamCards(members) {
  return `<div class="card-grid">${members.map(member => `<article class="card">
    <h3>${html(member.name)}</h3>
    ${member.lattes ? `<div class="actions"><a href="${html(member.lattes)}" target="_blank" rel="noopener noreferrer">Currículo Lattes</a></div>` : ''}
  </article>`).join('')}</div>`;
}

async function team(query) {
  const members = await api('team?' + new URLSearchParams({ q: query }));
  const groups = Map.groupBy(members, member => member.level);
  return `${banner('Equipe', 'Conheça as pessoas que fazem parte do portal.')}
    <div class="wrap page-body">
      ${searchForm('equipe', query, 'Nome ou nível de estudo')}
      ${groups.size ? [...groups].map(([level, people]) => `<section class="group"><h2>${html(level)}</h2>${teamCards(people)}</section>`).join('')
        : empty(query ? 'Nenhum integrante encontrado para esta busca.' : 'A equipe será exibida após a aprovação dos integrantes.')}
    </div>`;
}

function publicationCard(item, editable) {
  const link = html(item.has_pdf ? apiPath(`publications/${item.id}/download`) : item.download_url);
  const attributes = item.has_pdf ? 'download' : 'target="_blank" rel="noopener noreferrer"';
  return `<article class="card">
    <p class="record-topic">${html(item.topic)}</p>
    <h3>${html(item.title)}</h3>
    <p>${html(item.authors)} · ${html(item.year)}</p>
    <p>${html(item.journal)}</p>
    <div class="actions">
      <a class="button secondary" href="${link}" ${attributes}>${item.has_pdf ? 'Baixar PDF' : 'Acessar download'}</a>
      ${editable && item.owner_id === account?.id ? `
        <button class="button secondary" type="button" data-edit-publication="${item.id}">Editar</button>
        <button class="button danger" type="button" data-remove-publication="${item.id}">Remover</button>` : ''}
    </div>
  </article>`;
}

async function publications(params) {
  const query = params.q ?? '';
  const topic = params.topic ?? '';
  const search = new URLSearchParams({ q: query, topic, page: params.page ?? 1 });
  const [topics, listing] = await Promise.all([api('topics'), api('publications?' + search)]);
  const selected = topics.find(item => String(item.id) === topic);
  const page = listing.page;
  const topicLinks = [{ name: 'Todos os temas', id: '' }, ...topics].map(item => `
    <a class="topic-link" href="${href('publicacoes', { q: query, topic: item.id })}" ${String(item.id) === topic ? 'aria-current="true"' : ''}>
      ${html(item.name)} ${item.publication_count === undefined ? '' : `<span>${item.publication_count}</span>`}
    </a>`).join('');
  const previous = page > 1 ? `<a class="button secondary" href="${href('publicacoes', { q: query, topic, page: page - 1 })}">Anterior</a>` : '';
  const next = listing.hasNext ? `<a class="button secondary" href="${href('publicacoes', { q: query, topic, page: page + 1 })}">Próxima</a>` : '';
  return {
    topics, items: listing.items, selected,
    markup: `${banner('Publicações', 'Consulte artigos e trabalhos acadêmicos por tema.')}
    <div class="wrap page-body">
      ${notice()}
      <div class="toolbar">
        ${searchForm('publicacoes', query, 'Título, revista, autor, ano ou tema', 'Buscar', topic)}
        ${account ? `<div class="actions">
          ${account.role === 'coordinator' ? '<button class="button secondary" type="button" data-new-topic>Novo tema</button>' : ''}
          ${topics.length ? '<button class="button" type="button" data-new-publication>Nova publicação</button>' : ''}
        </div>` : ''}
      </div>
      <div class="columns">
        <aside class="topics" aria-label="Filtrar publicações por tema"><h2>Temas de pesquisa</h2>${topicLinks}</aside>
        <section aria-labelledby="listing-title">
          <h2 id="listing-title">${html(selected?.name ?? 'Todas as publicações')}</h2>
          ${selected?.description ? `<p>${html(selected.description)}</p>` : ''}
          <div class="publication-list">
            ${listing.items.map(item => publicationCard(item, true)).join('')
              || empty(query ? 'Nenhuma publicação encontrada para esta busca.' : 'Ainda não há publicações nesta seleção.')}
          </div>
          ${previous || next ? `<div class="pager">${previous}<span>Página ${page}</span>${next}</div>` : ''}
        </section>
      </div>
    </div>`,
  };
}

async function globalSearch(query) {
  const term = new URLSearchParams({ q: query });
  const [members, listing, topics] = query
    ? await Promise.all([api('team?' + term), api('publications?' + term), api('topics?' + term)])
    : [[], { items: [] }, []];
  return `${banner('Busca no portal')}
    <div class="wrap page-body">
      ${searchForm('busca', query, 'Publicações, temas ou integrantes da equipe')}
      ${query ? `${topics.length ? `<section class="group"><h2>Temas de pesquisa</h2>
        <div class="topics">${topics.map(topic => `<a class="topic-link" href="${href('publicacoes', { topic: topic.id })}">
          ${html(topic.name)} <span>${topic.publication_count}</span></a>`).join('')}</div>
      </section>` : ''}
      <section class="group"><h2>Publicações</h2>
        ${listing.items.slice(0, 4).map(item => publicationCard(item, false)).join('') || empty('Nenhuma publicação encontrada.')}
        ${listing.items.length > 4 ? `<div class="actions"><a href="${href('publicacoes', { q: query })}">Ver resultados em Publicações</a></div>` : ''}
      </section>
      <section class="group"><h2>Equipe</h2>
        ${members.length ? teamCards(members.slice(0, 4)) : empty('Nenhum integrante encontrado.')}
        ${members.length > 4 ? `<div class="actions"><a href="${href('equipe', { q: query })}">Ver resultados em Equipe</a></div>` : ''}
      </section>` : empty('Digite um termo para buscar no portal.')}
    </div>`;
}

function notice() {
  return success ? `<p class="notice" role="status">${html(success)}</p>` : '';
}

function signIn() {
  return `${banner('Entrar', 'Use o login fornecido pela coordenação.')}
  <div class="wrap page-body"><div class="card auth-card">
    <form id="login-form" class="form-stack">
      <label>Login<input name="login" autocomplete="username" required minlength="3" maxlength="40"></label>
      <label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
      <p class="form-error" role="alert"></p>
      <div class="actions"><button class="button" type="submit">Entrar</button></div>
    </form>
  </div></div>`;
}

function profileFields(levels, target = {}, self = false) {
  return `<label>Nome completo<input name="name" value="${html(target.name)}" required minlength="2" maxlength="160"></label>
    <label>Login<input name="login" value="${html(target.login)}" autocomplete="${self ? 'username' : 'off'}" required minlength="3" maxlength="40"></label>
    <label>Currículo Lattes${target.role === 'coordinator' ? ' (opcional)' : ''}<input name="lattes" type="url" value="${html(target.lattes)}" placeholder="https://lattes.cnpq.br/..." maxlength="2048" ${target.role === 'coordinator' ? '' : 'required'}></label>
    ${target.role === 'coordinator' ? '' : `<label>Nível de estudo<select name="level" required>
      <option value="">Selecione</option>${levels.map(level => `<option ${target.level === level ? 'selected' : ''}>${html(level)}</option>`).join('')}
    </select></label>`}
    <label>Matrícula (opcional)<input name="matricula" value="${html(target.matricula)}" maxlength="40"></label>
    <label>${target.id ? 'Nova senha (opcional)' : 'Senha inicial'}<input type="password" name="password" minlength="10" maxlength="128" autocomplete="new-password" ${target.id ? '' : 'required'}>
      <small>${target.id ? 'Deixe em branco para manter a senha atual.' : 'Use pelo menos 10 caracteres.'}</small>
    </label>`;
}

async function profilePage() {
  const isCoordinator = account.role === 'coordinator';
  const [options, members] = await Promise.all([api('options'), isCoordinator ? api('accounts') : []]);
  return {
    levels: options.levels, members,
    markup: `${banner('Minha conta', isCoordinator ? 'Gerencie seu perfil e os acessos ao portal.' : 'Atualize seus dados de acesso e seu perfil público.')}
      <div class="wrap page-body">
        ${notice()}
        <div class="profile-layout">
          <section><h2>Meu perfil</h2><div class="card">
            <form id="profile-form" class="form-stack">
              ${profileFields(options.levels, account, true)}
              <p class="form-error" role="alert"></p>
              <div class="actions"><button class="button" type="submit">Salvar perfil</button><button class="button secondary" id="logout" type="button">Sair</button></div>
            </form>
          </div></section>
          ${isCoordinator ? `<section aria-labelledby="accounts-title">
            <div class="toolbar"><h2 id="accounts-title">Contas da equipe</h2><button class="button" type="button" data-new-account>Criar conta</button></div>
            ${members.filter(member => member.id !== account.id).map(member => `<article class="card">
              <h3>${html(member.name)}</h3><p>${html(member.login)} · ${html(member.level)} · ${member.approved ? 'Aprovada' : 'Pendente'}</p>
              <div class="actions">
                <button class="button secondary" type="button" data-edit-account="${member.id}">Editar conta</button>
                ${member.approved ? '' : `<button class="button" type="button" data-approve="${member.id}">Aprovar conta</button>`}
              </div>
            </article>`).join('') || empty('As contas criadas pela coordenação aparecem aqui para aprovação.')}
          </section>` : ''}
        </div>
      </div>`,
  };
}

function handleForm(form, action) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const error = form.querySelector('.form-error');
    button.disabled = true;
    error.textContent = '';
    try {
      await action(Object.fromEntries(new FormData(form)));
    } catch (problem) {
      error.textContent = problem.message;
    } finally {
      button.disabled = false;
    }
  });
}

function openEditor(title, fields, action, label = 'Salvar', danger = false) {
  editor.innerHTML = `<h2 id="dialog-title">${html(title)}</h2><form class="form-stack">
    ${fields}
    <p class="form-error" role="alert"></p>
    <div class="actions"><button class="button ${danger ? 'danger' : ''}" type="submit">${html(label)}</button>
      <button class="button secondary" type="button" data-cancel>Cancelar</button></div>
  </form>`;
  editor.querySelector('[data-cancel]').onclick = () => editor.close();
  handleForm(editor.querySelector('form'), async data => {
    await action(data);
    editor.close();
    await render();
  });
  editor.showModal();
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o PDF.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

function publicationEditor(topics, item, selected) {
  const target = item ?? {};
  const topicId = target.topic_id ?? selected?.id;
  openEditor(item ? 'Editar publicação' : 'Nova publicação', `
    <label>Tema<select name="topicId" required><option value="">Selecione</option>
      ${topics.map(topic => `<option value="${topic.id}" ${topic.id === topicId ? 'selected' : ''}>${html(topic.name)}</option>`).join('')}
    </select></label>
    <label>Título<input name="title" maxlength="300" required value="${html(target.title)}"></label>
    <label>Revista<input name="journal" maxlength="240" required value="${html(target.journal)}"></label>
    <label>Autores<input name="authors" maxlength="300" required value="${html(target.authors)}"></label>
    <label>Ano<input name="year" type="number" min="1000" max="9999" required value="${html(target.year ?? new Date().getFullYear())}"></label>
    <label>Link para download<input name="downloadUrl" type="url" maxlength="2048" value="${html(target.download_url)}" placeholder="https://..."></label>
    <label>Arquivo PDF<input name="file" type="file" accept="application/pdf,.pdf">
      <small>${target.has_pdf ? 'Há um PDF anexado. Envie outro arquivo ou informe um link para substituí-lo.' : 'Informe um link ou selecione um PDF de até 10 MB.'}</small>
    </label>`, async ({ file, ...data }) => {
    if (file?.size) {
      if (file.size > 10 * 1024 * 1024) throw new Error('Selecione um PDF de até 10 MB.');
      data.pdf = await fileBase64(file);
    }
    await api(item ? 'publications/' + item.id : 'publications', item ? 'PATCH' : 'POST', data);
    success = item ? 'Publicação atualizada.' : 'Publicação adicionada.';
  });
  const fileInput = editor.querySelector('[name="file"]');
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) editor.querySelector('[name="downloadUrl"]').value = '';
  });
}

function attachPublicationActions({ topics, items, selected }) {
  const newTopic = main.querySelector('[data-new-topic]');
  if (newTopic) newTopic.onclick = () => openEditor('Novo tema', `
    <label>Nome do tema<input name="name" minlength="2" maxlength="120" required></label>
    <label>Descrição (opcional)<textarea name="description" maxlength="600" rows="3"></textarea></label>`, async data => {
    await api('topics', 'POST', data);
    success = 'Tema criado.';
  });
  const newPublication = main.querySelector('[data-new-publication]');
  if (newPublication) newPublication.onclick = () => publicationEditor(topics, null, selected);
  for (const button of main.querySelectorAll('[data-edit-publication]')) {
    button.onclick = () => publicationEditor(topics, items.find(item => item.id === Number(button.dataset.editPublication)), selected);
  }
  for (const button of main.querySelectorAll('[data-remove-publication]')) {
    const item = items.find(entry => entry.id === Number(button.dataset.removePublication));
    button.onclick = () => openEditor('Remover publicação', `<p>Remover “${html(item.title)}” do portal?</p>`, async () => {
      await api('publications/' + item.id, 'DELETE');
      success = 'Publicação removida.';
    }, 'Remover', true);
  }
}

function attachAccountActions({ members, levels }) {
  const form = main.querySelector('#profile-form');
  handleForm(form, async data => {
    ({ account } = await api('profile', 'PATCH', data));
    success = 'Perfil atualizado.';
    await render();
  });
  main.querySelector('#logout').onclick = async () => {
    try {
      await api('logout', 'POST');
      remoteToken = null;
      account = null;
      navigate('inicio');
    } catch (error) {
      form.querySelector('.form-error').textContent = error.message;
    }
  };
  const create = main.querySelector('[data-new-account]');
  if (create) create.onclick = () => openEditor('Criar conta', profileFields(levels), async data => {
    await api('accounts', 'POST', data);
    success = 'Conta criada. Aprove o acesso quando ela estiver pronta para uso.';
  }, 'Criar conta');
  for (const button of main.querySelectorAll('[data-edit-account]')) {
    const member = members.find(entry => entry.id === Number(button.dataset.editAccount));
    button.onclick = () => openEditor('Editar conta', profileFields(levels, member), async data => {
      await api('accounts/' + member.id, 'PATCH', data);
      success = 'Conta atualizada.';
    });
  }
  for (const button of main.querySelectorAll('[data-approve]')) {
    const member = members.find(entry => entry.id === Number(button.dataset.approve));
    button.onclick = () => openEditor('Aprovar conta', `<p>Liberar o acesso de ${html(member.name)}?</p>`, async () => {
      await api('accounts/' + member.id + '/approve', 'POST');
      success = 'Conta aprovada.';
    }, 'Aprovar conta');
  }
}

async function render() {
  const renderId = ++currentRender;
  const [page, params] = route();
  if (page === 'conta' && !account) return navigate('login');
  if (page === 'login' && account) return navigate('conta');
  setNavigation(page);
  if (portal.pages && !apiOrigin && page !== 'inicio') {
    main.innerHTML = `${banner(titles[page])}<div class="wrap page-body">
      <p class="notice" role="status">Esta seção ficará disponível quando o serviço de dados do portal estiver conectado.</p>
    </div>`;
    return;
  }
  try {
    let view;
    switch (page) {
      case 'equipe': view = await team(params.q ?? ''); break;
      case 'publicacoes': view = await publications(params); break;
      case 'busca': view = await globalSearch(params.q ?? ''); break;
      case 'conta': view = await profilePage(); break;
      case 'login': view = signIn(); break;
      default: view = home();
    }
    if (renderId !== currentRender) return;
    main.innerHTML = typeof view === 'string' ? view : view.markup;
    success = '';
    if (page === 'publicacoes') attachPublicationActions(view);
    if (page === 'conta') attachAccountActions(view);
    if (page === 'login') handleForm(main.querySelector('#login-form'), async data => {
      const session = await api('login', 'POST', data);
      account = session.account;
      remoteToken = session.token;
      navigate('conta');
    });
  } catch (error) {
    if (renderId !== currentRender) return;
    main.innerHTML = `${banner(titles[page])}<div class="wrap page-body"><p class="notice error" role="alert">${html(error.message)}</p>
      <button class="button secondary" type="button" data-retry>Tentar novamente</button></div>`;
    main.querySelector('[data-retry]').onclick = render;
  }
}

main.addEventListener('submit', event => {
  const form = event.target;
  if (!form.matches('[data-search]')) return;
  event.preventDefault();
  const { q, topic } = Object.fromEntries(new FormData(form));
  navigate(form.dataset.search, { q: q.trim(), topic });
});

document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView();
});

try {
  const response = await fetch('./portal.json');
  if (!response.ok) throw new Error('O conteúdo do portal está indisponível.');
  portal = await response.json();
  apiOrigin = portal.apiUrl || '';
  if (!apiOrigin && !portal.pages) {
    ({ account } = await api('session').catch(() => ({ account: null })));
  }
  for (const label of document.querySelectorAll('[data-brand]')) label.textContent = portal.name;
  for (const label of document.querySelectorAll('[data-institution]')) {
    label.textContent = portal.institution;
    label.href = portal.website;
  }
  window.addEventListener('hashchange', () => {
    if (editor.open) editor.close();
    window.scrollTo(0, 0);
    void render();
  });
  await render();
} catch (error) {
  main.textContent = error.message;
}
