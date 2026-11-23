import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const [operation, file, configPath] = process.argv.slice(2);
const backup = operation === 'backup';

function postgres(command, args, config) {
  const { host, port, database, user, password, sslmode, sslrootcert } = config;
  if (!host || !database || !user || typeof password !== 'string') {
    throw new Error('Confirme host, database, user e password na configuração do banco.');
  }
  const env = {
    ...process.env,
    PGHOST: host, PGPORT: String(port ?? 5432), PGDATABASE: database,
    PGUSER: user, PGPASSWORD: password, PGSSLMODE: sslmode ?? 'prefer',
    PGCONNECT_TIMEOUT: '10',
  };
  if (sslrootcert) env.PGSSLROOTCERT = sslrootcert;
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, ['--no-password', ...args], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', error => {
      reject(error.code === 'ENOENT'
        ? new Error(`Instale as ferramentas do PostgreSQL e coloque ${command} no PATH.`)
        : error);
    });
    child.once('close', code => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} terminou com código ${code}.`));
    });
  });
}

try {
  if (!['backup', 'restore'].includes(operation) || (!backup && (!file || !configPath))) {
    throw new Error('Uso: node banco.mjs backup [config.json] ou node banco.mjs restore arquivo.dump config.json');
  }
  const settings = JSON.parse(await readFile(
    backup ? file ?? join(root, 'data', 'database.json') : configPath, 'utf8',
  ));
  const config = settings.database && typeof settings.database === 'object' ? settings.database : settings;
  if (backup) {
    const backups = join(root, 'backups');
    await mkdir(backups, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(backups, 'ufresearch-'));
    const partial = join(directory, 'banco.part');
    const archive = join(directory, 'banco.dump');
    try {
      await postgres('pg_dump', [
        '--format=custom', '--schema=public', '--exclude-table-data=public.sessions', '--file=' + partial,
      ], config);
      await rename(partial, archive);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    console.log('Backup salvo em ' + archive);
  } else {
    await postgres('pg_restore', [
      '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', '--dbname=' + config.database,
      resolve(file),
    ], config);
    console.log('Banco restaurado com sucesso.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
