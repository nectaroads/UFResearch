import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const settings = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8')
  .catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(new URL('./config.example.json', import.meta.url), 'utf8');
  }));
const api = new URL(process.env.API_URL ?? settings.apiUrl);
const forward = api.protocol === 'https:' ? httpsRequest : httpRequest;
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function proxy(request, response, url) {
  const headers = { ...request.headers, host: api.host, 'x-ufresearch-client-ip': request.socket.remoteAddress };
  const upstream = forward(api.origin + url.pathname + url.search, { method: request.method, headers }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  upstream.on('error', () => {
    if (response.headersSent || response.destroyed) return response.destroy();
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'A API está indisponível. Verifique se o servidor e o PostgreSQL estão ligados.' }));
  });
  response.on('close', () => upstream.destroy());
  request.on('error', () => upstream.destroy());
  request.pipe(upstream);
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return proxy(request, response, url);
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!/^\/(?:assets\/)?[a-z0-9-]+\.[a-z]+$/.test(path)) return response.writeHead(404).end();
    const type = contentTypes[extname(path)];
    if (!type) return response.writeHead(404).end();
    const body = await readFile(new URL('./public' + path, import.meta.url));
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') return response.writeHead(404).end();
    console.error(error);
    response.writeHead(500).end();
  }
});
server.listen(settings.port, process.env.CLIENT_HOST ?? settings.host, function () {
  console.log(`Abra http://localhost:${this.address().port} no navegador.`);
  process.send?.({ ready: true, port: this.address().port });
});
