import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const source = new URL('./public/', import.meta.url);
const destination = new URL('./dist/', import.meta.url);
const apiUrl = process.env.UFRESEARCH_API_URL ?? '';
if (apiUrl) {
  const url = new URL(apiUrl);
  if (url.protocol !== 'https:' || url.origin !== apiUrl) {
    throw new Error('UFRESEARCH_API_URL deve ser uma origem HTTPS, sem caminho ou barra final.');
  }
}
await mkdir(destination, { recursive: true });
for (const entry of ['index.html', 'styles.css', 'app.js', 'assets']) {
  await cp(new URL(entry, source), new URL(entry, destination), { recursive: true });
}
const portal = JSON.parse(await readFile(new URL('portal.json', source), 'utf8'));
await writeFile(new URL('portal.json', destination), JSON.stringify({ ...portal, pages: true, apiUrl }, null, 2) + '\n');
await writeFile(new URL('.nojekyll', destination), '');
