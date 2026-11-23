import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword, verifyPassword, sessionHash, startSession, endSession } from './auth.mjs';
import { HttpError, field, levels, login, maxPdf, password, profile, publication } from './validation.mjs';

const production = process.env.NODE_ENV === 'production';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  if (production) return '{}';
  throw new Error('Crie server/config.json a partir de config.example.json. Consulte o README.');
}));
const configuredOrigin = process.env.UFRESEARCH_WEB_ORIGIN ?? '';
let hostedOrigin = '';
if (configuredOrigin) {
  const parsed = new URL(configuredOrigin);
  const protocols = production ? ['https:'] : ['https:', 'http:'];
  if (!protocols.includes(parsed.protocol) || parsed.origin !== configuredOrigin) {
    throw new Error('UFRESEARCH_WEB_ORIGIN deve conter apenas a origem do site, sem caminho nem barra final.');
  }
  hostedOrigin = parsed.origin;
}
const secureCookies = production || config.secureCookies === true;
const database = process.env.UFRESEARCH_DATABASE_CONFIG
  ? JSON.parse(await readFile(process.env.UFRESEARCH_DATABASE_CONFIG, 'utf8'))
  : config.database;

if (production && !process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no ambiente da API.');
const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { ...database, host: process.env.PGHOST ?? database.host };
const db = new pg.Pool({ ...connection, connectionTimeoutMillis: 5000 });
db.on('error', error => console.error('Conexão do PostgreSQL:', error.message));
const accountFields = 'id, name, login, lattes, level, matricula, role, approved';
const publicationFields = `p.id, p.owner_id, p.topic_id, p.title, p.journal, p.authors, p.year,
  p.download_url, p.pdf IS NOT NULL AS has_pdf, t.name AS topic`;

await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
const coordinator = await db.query("SELECT 1 FROM accounts WHERE role = 'coordinator' LIMIT 1");
if (!coordinator.rowCount) {
  const account = production ? {
    login: process.env.UFRESEARCH_COORDINATOR_LOGIN,
    password: process.env.UFRESEARCH_COORDINATOR_PASSWORD,
    name: process.env.UFRESEARCH_COORDINATOR_NAME || 'Coordenação',
  } : config.coordinator;
  if (!account?.login || !account.password) {
    throw new Error('Configure o login e a senha iniciais da coordenação para este banco vazio.');
  }
  const firstPassword = password(account);
  await db.query(
    "INSERT INTO accounts (name, login, password_hash, level, role, approved) VALUES ($1,$2,$3,'Coordenação','coordinator',true) ON CONFLICT (login) DO NOTHING",
    [field(account, 'name', 'Nome da coordenação', 160, 2), login(account), await hashPassword(firstPassword)],
  );
}
const unknownPasswordHash = await hashPassword('conta-inexistente');
const loginAttempts = new Map();
setInterval(() => loginAttempts.clear(), 15 * 60 * 1000).unref();

function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request, max = 16 * 1024) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Envie os dados em JSON.');
  }
  if (Number(request.headers['content-length']) > max) throw new HttpError(413, 'Arquivo ou formulário muito grande.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'Arquivo ou formulário muito grande.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'Formulário inválido.');
  }
}

async function currentAccount(request) {
  const tokenHash = sessionHash(request);
  if (!tokenHash) return null;
  const { rows } = await db.query(
    `SELECT ${accountFields} FROM accounts WHERE approved AND id =
      (SELECT account_id FROM sessions WHERE token_hash = $1 AND expires_at > now())`, [tokenHash],
  );
  return rows[0] ?? null;
}

function requireAccount(account, coordinatorOnly = false) {
  if (!account) throw new HttpError(401, 'Entre com sua conta para continuar.');
  if (coordinatorOnly && account.role !== 'coordinator') throw new HttpError(403, 'Apenas a coordenação pode realizar esta ação.');
}

function row(result, message = 'Registro não encontrado.') {
  if (!result.rowCount) throw new HttpError(404, message);
  return result.rows[0];
}

function recordId(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647) {
    throw new HttpError(404, 'Registro não encontrado.');
  }
  return Number(value);
}

function searchTerm(params) {
  return (params.get('q') ?? '').trim().slice(0, 160);
}

async function updateAccount(target, data, request, account) {
  const fields = profile(data, target.role === 'coordinator');
  const newPassword = password(data, false);
  const newHash = newPassword ? await hashPassword(newPassword) : null;
  const keepSession = target.id === account.id ? sessionHash(request) : null;
  return row(await db.query(`
    WITH updated AS (
      UPDATE accounts SET name = $1, login = $2, lattes = $3, level = $4, matricula = $5,
        password_hash = COALESCE($6, password_hash)
      WHERE id = $7 RETURNING ${accountFields}
    ), revoked AS (
      DELETE FROM sessions USING updated
      WHERE account_id = updated.id AND $6 IS NOT NULL AND token_hash IS DISTINCT FROM $8
    )
    SELECT * FROM updated
  `, [...fields, newHash, target.id, keepSession]));
}

async function signIn(request, response) {
  const address = (production ? undefined : request.headers['x-ufresearch-client-ip']) ?? request.socket.remoteAddress;
  const attempts = loginAttempts.get(address) ?? 0;
  if (attempts >= 20) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  const data = await readJson(request);
  const name = login(data);
  const secret = password(data);
  loginAttempts.set(address, (loginAttempts.get(address) ?? 0) + 1);
  const { rows: [account] } = await db.query(
    `SELECT ${accountFields}, password_hash FROM accounts WHERE login = $1`, [name],
  );
  const valid = await verifyPassword(secret, account?.password_hash ?? unknownPasswordHash);
  if (!valid || !account) throw new HttpError(401, 'Login ou senha inválidos.');
  if (!account.approved) throw new HttpError(403, 'A conta aguarda aprovação da coordenação.');
  loginAttempts.delete(address);
  const remote = hostedOrigin !== '' && request.headers.origin === hostedOrigin;
  const token = await startSession(db, request, response, secureCookies, account.id, remote);
  delete account.password_hash;
  return json(response, { account, ...(remote ? { token } : {}) });
}

async function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(request.url, 'http://localhost');
  const method = request.method;
  const path = url.pathname;
  const params = url.searchParams;
  const origin = request.headers.origin;
  if (hostedOrigin && origin === hostedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', hostedOrigin);
    response.setHeader('Vary', 'Origin');
    if (method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-UFResearch-Request');
      response.setHeader('Access-Control-Max-Age', '600');
      return response.writeHead(204).end();
    }
  }
  if (method !== 'GET' && request.headers['x-ufresearch-request'] !== 'web') {
    throw new HttpError(403, 'Origem da solicitação inválida.');
  }

  if (method === 'GET' && path === '/api/health') {
    await db.query('SELECT 1');
    return json(response, { status: 'ok' });
  }
  if (method === 'GET' && path === '/api/options') return json(response, { levels });
  if (method === 'GET' && path === '/api/team') {
    const { rows } = await db.query(`
      SELECT id, name, lattes, level, role FROM accounts WHERE approved
      AND strpos(search_text(concat_ws(' ', name, level)), search_text($1)) > 0
      ORDER BY role, name, id
    `, [searchTerm(params)]);
    return json(response, rows);
  }
  if (method === 'GET' && path === '/api/topics') {
    const { rows } = await db.query(`
      SELECT t.id, t.name, t.description, count(p.id)::integer AS publication_count
      FROM topics t LEFT JOIN publications p ON p.topic_id = t.id
      WHERE strpos(search_text(concat_ws(' ', t.name, t.description)), search_text($1)) > 0
      GROUP BY t.id ORDER BY t.name, t.id
    `, [searchTerm(params)]);
    return json(response, rows);
  }
  if (method === 'GET' && path === '/api/publications') {
    const topicId = params.has('topic') && params.get('topic') ? recordId(params.get('topic')) : null;
    const page = params.has('page') ? recordId(params.get('page')) : 1;
    const pageSize = 12;
    const { rows } = await db.query(`
      SELECT ${publicationFields}
      FROM publications p JOIN topics t ON t.id = p.topic_id
      WHERE ($2::integer IS NULL OR t.id = $2)
      AND strpos(search_text(concat_ws(' ', p.title, p.journal, p.authors, p.year, t.name)), search_text($1)) > 0
      ORDER BY p.year DESC, p.id DESC LIMIT $3 OFFSET $4
    `, [searchTerm(params), topicId, pageSize + 1, (page - 1) * pageSize]);
    return json(response, { items: rows.slice(0, pageSize), page, hasNext: rows.length > pageSize });
  }

  const download = path.match(/^\/api\/publications\/(\d+)\/download$/);
  if (method === 'GET' && download) {
    const id = recordId(download[1]);
    const { pdf } = row(await db.query('SELECT pdf FROM publications WHERE id = $1 AND pdf IS NOT NULL', [id]), 'PDF não encontrado.');
    response.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `attachment; filename="publicacao-${id}.pdf"`,
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    return response.end(pdf);
  }
  if (method === 'POST' && path === '/api/login') return signIn(request, response);
  if (method === 'POST' && path === '/api/logout') {
    await endSession(db, request, response, secureCookies);
    return json(response, {});
  }

  const account = await currentAccount(request);
  if (method === 'GET' && path === '/api/session') return json(response, { account });
  if (method === 'PATCH' && path === '/api/profile') {
    requireAccount(account);
    return json(response, { account: await updateAccount(account, await readJson(request), request, account) });
  }
  if (path === '/api/accounts') {
    requireAccount(account, true);
    if (method === 'GET') {
      const { rows } = await db.query(`SELECT ${accountFields} FROM accounts ORDER BY approved, role, name, id`);
      return json(response, rows);
    }
    if (method === 'POST') {
      const data = await readJson(request);
      const fields = profile(data);
      const secret = password(data);
      const result = await db.query(`
        INSERT INTO accounts (name, login, lattes, level, matricula, password_hash)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${accountFields}
      `, [...fields, await hashPassword(secret)]);
      return json(response, row(result), 201);
    }
  }
  const approval = path.match(/^\/api\/accounts\/(\d+)\/approve$/);
  if (method === 'POST' && approval) {
    requireAccount(account, true);
    return json(response, row(await db.query(
      "UPDATE accounts SET approved = true WHERE id = $1 AND role = 'member' RETURNING " + accountFields,
      [recordId(approval[1])],
    )));
  }
  const member = path.match(/^\/api\/accounts\/(\d+)$/);
  if (method === 'PATCH' && member) {
    requireAccount(account, true);
    const target = row(await db.query(`SELECT ${accountFields} FROM accounts WHERE id = $1`, [recordId(member[1])]));
    return json(response, await updateAccount(target, await readJson(request), request, account));
  }
  if (method === 'POST' && path === '/api/topics') {
    requireAccount(account, true);
    const data = await readJson(request);
    const result = await db.query('INSERT INTO topics (name, description) VALUES ($1,$2) RETURNING *', [
      field(data, 'name', 'Nome do tema', 120, 2), field(data, 'description', 'Descrição', 600, 0),
    ]);
    return json(response, row(result), 201);
  }
  if (method === 'POST' && path === '/api/publications') {
    requireAccount(account);
    const values = publication(await readJson(request, Math.ceil(maxPdf / 3) * 4 + 32 * 1024));
    if (!values[5] && !values[6]) throw new HttpError(400, 'Informe um link para download ou envie um PDF.');
    const result = await db.query(`
      INSERT INTO publications (topic_id, title, journal, authors, year, download_url, pdf, owner_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [...values, account.id]);
    return json(response, row(result), 201);
  }

  const item = path.match(/^\/api\/publications\/(\d+)$/);
  if (item && ['PATCH', 'DELETE'].includes(method)) {
    requireAccount(account);
    const id = recordId(item[1]);
    if (method === 'DELETE') {
      row(await db.query('DELETE FROM publications WHERE id = $1 AND owner_id = $2 RETURNING id', [id, account.id]));
      return json(response, {});
    }
    const values = publication(await readJson(request, Math.ceil(maxPdf / 3) * 4 + 32 * 1024));
    return json(response, row(await db.query(`
      UPDATE publications SET topic_id = $1, title = $2, journal = $3, authors = $4, year = $5,
        download_url = CASE WHEN $6::text IS NULL AND $7::bytea IS NULL THEN download_url ELSE $6 END,
        pdf = CASE WHEN $6::text IS NULL AND $7::bytea IS NULL THEN pdf ELSE $7 END
      WHERE id = $8 AND owner_id = $9 RETURNING id
    `, [...values, id, account.id])));
  }
  throw new HttpError(404, 'Página não encontrada.');
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    if (response.headersSent || response.destroyed) return response.destroy();
    if (error instanceof HttpError) return json(response, { error: error.message }, error.status);
    if (error.code === '23505') {
      const message = error.constraint === 'accounts_login_key' ? 'Esse login já está em uso.' : 'Já existe um tema com esse nome.';
      return json(response, { error: message }, 409);
    }
    if (error.code === '23503') return json(response, { error: 'O tema selecionado não existe mais.' }, 400);
    console.error(error);
    return json(response, { error: 'Ocorreu um erro no servidor. Tente novamente.' }, 500);
  });
});
const port = Number(process.env.PORT ?? config.port ?? 3001);
const host = process.env.SERVER_HOST ?? config.host ?? (production ? '0.0.0.0' : '127.0.0.1');
server.listen(port, host, function () {
  console.log(`API disponível na porta ${this.address().port}.`);
  process.send?.({ ready: true, port: this.address().port });
});
