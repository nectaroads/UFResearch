import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

const file = path => new URL(path, import.meta.url);
const serverConfig = file('./server/config.json');
const clientConfig = file('./client/config.json');

async function copyConfig(target, example, customize = async config => config) {
  try {
    await readFile(target);
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const config = JSON.parse(await readFile(file(example), 'utf8'));
  const updated = await customize(config);
  await writeFile(target, JSON.stringify(updated, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return true;
}

export async function prepareConfigs() {
  const created = await copyConfig(serverConfig, './server/config.example.json', async config => {
    const input = createInterface({ input: stdin, output: stdout });
    try {
      const login = (await input.question('Login inicial da coordenação: ')).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(login)) {
        throw new Error('O login precisa ter de 3 a 40 caracteres. Use letras sem acento, números, ponto, hífen ou sublinhado.');
      }
      const password = await input.question('Senha inicial da coordenação (10 a 128 caracteres): ');
      if (password.length < 10 || password.length > 128) {
        throw new Error('A senha precisa ter de 10 a 128 caracteres. Execute node setup.mjs novamente.');
      }
      config.database.password = randomBytes(24).toString('hex');
      config.coordinator.login = login;
      config.coordinator.password = password;
      return config;
    } finally {
      input.close();
    }
  });
  if (created) console.log('Configuração do servidor criada.');
  if (await copyConfig(clientConfig, './client/config.example.json')) console.log('Configuração do cliente criada.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareConfigs();
  const { database } = JSON.parse(await readFile(serverConfig, 'utf8'));
  if (!database.password || /[\r\n]/.test(database.password)) throw new Error('Verifique a senha local do PostgreSQL em server/config.json.');
  const escaped = database.password.replaceAll("'", "\\'");
  await writeFile(file('./.env'), "POSTGRES_PASSWORD='" + escaped + "'\n", { flag: 'wx', mode: 0o600 })
    .catch(error => { if (error.code !== 'EEXIST') throw error; });
}
