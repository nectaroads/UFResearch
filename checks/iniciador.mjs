import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('..', import.meta.url));
const project = await mkdtemp(join(tmpdir(), 'UFResearch teste '));
const coordinator = 'coordenacao-teste';
const password = 'senha-exclusiva-para-teste';
const origin = 'http://localhost:3000';
const excluded = new Set(['config.json', 'node_modules']);

function start() {
  const child = spawn(process.execPath, ['iniciar.mjs', '--no-browser'], {
    cwd: project,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let loginSent = false;
  let passwordSent = false;
  const waitForExit = new Promise(resolve => child.once('close', resolve));
  const ready = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!loginSent && output.includes('Login inicial')) {
        loginSent = true;
        child.stdin.write(coordinator + '\n');
      }
      if (!passwordSent && output.includes('Senha inicial')) {
        passwordSent = true;
        child.stdin.write(password + '\n');
      }
      if (output.includes('Pressione Enter para encerrar')) resolve();
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => reject(new Error(`O iniciador encerrou com código ${code}.\n${output}`)));
  });
  return {
    ready,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('\n');
      assert.equal(await waitForExit, 0, output);
    },
  };
}

async function request(path, options) {
  return fetch(origin + '/api/' + path, options);
}

try {
  await Promise.all(['client', 'server', 'package.json', 'package-lock.json', 'iniciar.mjs', 'setup.mjs'].map(name =>
    cp(join(source, name), join(project, name), {
      recursive: true,
      filter: path => !excluded.has(basename(path)),
    }),
  ));
  const first = start();
  try {
    await first.ready;
    const health = await request('health');
    assert.equal(health.status, 200);
    const headers = { 'X-UFResearch-Request': 'web', 'Content-Type': 'application/json' };
    const login = await request('login', { method: 'POST', headers, body: JSON.stringify({ login: coordinator, password }) });
    assert.equal(login.status, 200);
    const topic = await request('topics', {
      method: 'POST',
      headers: { ...headers, cookie: login.headers.get('set-cookie').split(';')[0] },
      body: JSON.stringify({ name: 'Áreas de teste' }),
    });
    assert.equal(topic.status, 201);
  } finally {
    await first.stop();
  }

  const second = start();
  try {
    await second.ready;
    const response = await request('topics?q=areas');
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].name, 'Áreas de teste');
  } finally {
    await second.stop();
  }
  console.log('Primeira abertura, encerramento e reabertura com dados preservados.');
} finally {
  await rm(project, { recursive: true, force: true });
}
