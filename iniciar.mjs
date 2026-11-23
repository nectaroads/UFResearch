import { spawn, fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { prepareConfigs } from './setup.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const data = join(root, 'data');
const cluster = join(data, 'postgres');
const databaseConfig = join(data, 'database.json');
const windows = process.platform === 'win32';
const supported = { win32: ['x64'], linux: ['x64', 'arm64'] };
const packageName = '@embedded-postgres/' + (windows ? 'windows' : 'linux') + '-' + process.arch;
const binaryModule = join(root, 'node_modules', packageName, 'dist', 'index.js');
const browserEnabled = !process.argv.includes('--no-browser');

const services = [];
let database;
let pgControl;
let shuttingDown;
let closing = false;

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} terminou com código ${code}.`));
    });
  });
}

async function installDependencies(directory, requiredFile, label) {
  const lock = await readFile(join(directory, 'package-lock.json'));
  const fingerprint = createHash('sha256').update(lock).digest('hex');
  const stamp = join(directory, 'node_modules', '.ufresearch-lock');
  const installed = await readFile(stamp, 'utf8').catch(() => '');
  if (installed === fingerprint && existsSync(requiredFile)) return;

  console.log(`Preparando ${label}. A primeira abertura precisa de internet.`);
  const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  try {
    if (windows) {
      const npm = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      await run(process.execPath, [npm, ...args], directory);
    } else {
      await run('npm', args, directory);
    }
  } catch {
    throw new Error(`Não foi possível preparar ${label}. Confira a conexão com a internet e tente novamente.`);
  }
  if (!existsSync(requiredFile)) throw new Error(`A instalação de ${label} está incompleta.`);
  await writeFile(stamp, fingerprint);
}

async function prepareDatabase() {
  await mkdir(data, { recursive: true, mode: 0o700 });
  if (!existsSync(databaseConfig)) {
    if (existsSync(join(cluster, 'PG_VERSION'))) throw new Error('A configuração do banco local está faltando. Restaure o arquivo data/database.json do backup.');
    const settings = {
      host: '127.0.0.1', port: 55432, database: 'postgres', user: 'ufresearch',
      password: randomBytes(24).toString('hex'),
    };
    await writeFile(databaseConfig, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  database = JSON.parse(await readFile(databaseConfig, 'utf8'));
  if (!Number.isInteger(database.port) || database.port < 1 || database.port > 65535) {
    throw new Error('A porta em data/database.json precisa ser um número entre 1 e 65535.');
  }
  const { initdb, pg_ctl } = await import(packageName);
  pgControl = pg_ctl;

  await run(process.execPath, [join(root, 'node_modules', packageName, 'scripts', 'hydrate-symlinks.js')]);
  if (!existsSync(join(cluster, 'PG_VERSION'))) {
    console.log('Criando o banco de dados local.');
    const temporary = await mkdtemp(join(tmpdir(), 'ufresearch-'));
    try {
      const passwordFile = join(temporary, 'password');
      await writeFile(passwordFile, database.password + '\n', { mode: 0o600 });
      await run(initdb, [
        '-D', cluster, '-U', database.user, '--auth=scram-sha-256', '--encoding=UTF8',
        '--locale-provider=builtin', '--builtin-locale=C.UTF-8', '--pwfile=' + passwordFile,
      ]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  console.log('Abrindo o banco de dados local.');
  const options = `-h 127.0.0.1 -p ${database.port}` + (windows ? '' : ' -c unix_socket_directories=');
  try {
    await run(pgControl, ['start', '-D', cluster, '-l', join(data, 'postgres.log'), '-o', options, '-w', '-t', '30']);
  } catch {
    throw new Error('O banco local não abriu. Feche outra janela do UFResearch, se estiver aberta, e tente novamente. Detalhes em data/postgres.log.');
  }
}

function startService(folder, entry, env) {
  return new Promise((resolve, reject) => {
    const child = fork(join(root, folder, entry), {
      cwd: join(root, folder),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    services.push(child);
    let started = false;
    child.once('error', reject);
    child.on('message', message => {
      if (message.ready !== true) return;
      started = true;
      resolve(message.port);
    });
    child.once('exit', () => {
      if (closing) return;
      const error = new Error(`O ${folder === 'client' ? 'portal' : 'servidor'} encerrou. Confira se outra cópia está aberta.`);
      if (!started) reject(error);
      else {
        console.error(error.message);
        process.exitCode = 1;
        closing = true;
        input.abort();
      }
    });
  });
}

function openBrowser(url) {
  const [command, args] = windows
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  browser.on('error', () => {});
  browser.unref();
}

let databaseStarted = false;
const input = new AbortController();

function stop() {
  closing = true;
  input.abort();
  if (shuttingDown) return shuttingDown;
  shuttingDown = (async () => {
    await Promise.all(services.map(async child => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, delay(2000, undefined, { ref: false })]);
    }));
    if (databaseStarted) {
      await run(pgControl, ['stop', '-D', cluster, '-m', 'fast', '-w', '-t', '20']);
    }
  })();
  return shuttingDown;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(windows ? ['SIGBREAK'] : [])]) {
  process.on(signal, () => {
    closing = true;
    input.abort();
  });
}

try {
  console.log('UFResearch');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Instale o Node.js LTS atual em https://nodejs.org/.');
  if (!supported[process.platform]?.includes(process.arch)) throw new Error('O iniciador atende Windows 64 bits (x64) e Linux x64 ou ARM64.');
  if (process.getuid?.() === 0) throw new Error('Abra o UFResearch com sua conta de usuário do Linux.');
  await prepareConfigs();
  if (!closing) await installDependencies(root, binaryModule, 'o PostgreSQL local');
  const serverDir = join(root, 'server');
  if (!closing) await installDependencies(serverDir, join(serverDir, 'node_modules', 'pg', 'package.json'), 'o servidor');
  if (!closing) {
    await prepareDatabase();
    databaseStarted = true;
  }
  if (!closing) {
    const apiPort = await startService('server', 'index.mjs', {
      UFRESEARCH_DATABASE_CONFIG: databaseConfig, PGHOST: '127.0.0.1', SERVER_HOST: '127.0.0.1',
    });
    if (!closing) {
      const port = await startService('client', 'serve.mjs', { API_URL: `http://127.0.0.1:${apiPort}`, CLIENT_HOST: '127.0.0.1' });
      const url = `http://localhost:${port}`;
      console.log(`\nPortal pronto em ${url}`);
      if (browserEnabled) openBrowser(url);
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await prompt.question('Mantenha esta janela aberta. Pressione Enter para encerrar.\n', { signal: input.signal });
      } finally {
        prompt.close();
      }
    }
  }
} catch (error) {
  if (error.name !== 'AbortError') {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  await stop().catch(error => {
    console.error('Não foi possível encerrar o banco local.', error.message);
    process.exitCode = 1;
  });
}
