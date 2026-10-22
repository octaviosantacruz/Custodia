import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only built public files are packaged. Git, source, fixtures and local
// configuration never enter the deliverable. No publication or upload.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'demo', 'dist');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function filesIn(directory, manifestDirectory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'manifest.json' && directory === manifestDirectory && entry.isFile()) continue;
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error(`Unexpected build entry: ${entry.name}`);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path, manifestDirectory));
    else if (entry.isFile() && /\.(?:html|css|js|woff2?|txt|svg|png|webp)$/.test(entry.name)) files.push(path);
    else throw new Error(`Unexpected build file: ${entry.name}`);
  }
  return files.sort();
}

const entries = await Promise.all((await filesIn(build)).map(async path => {
  const bytes = await readFile(path);
  return { path: relative(build, path).split('\\').join('/'), bytes, sha256: hash(bytes) };
}));
for (const required of ['index.html', 'THIRD-PARTY-NOTICES.txt']) {
  if (!entries.some(entry => entry.path === required)) throw new Error(`Missing build file: ${required}`);
}
const manifest = `${JSON.stringify({
  format: 1,
  entrypoint: 'index.html',
  syntheticData: true,
  files: entries.map(entry => ({ path: entry.path, bytes: entry.bytes.length, sha256: entry.sha256 })),
}, null, 2)}\n`;
const destination = join(root, 'artifacts', `custodia-demo-${hash(manifest).slice(0, 12)}`);
await mkdir(dirname(destination), { recursive: true });
let existing = false;
try {
  await mkdir(destination);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  existing = true;
}
if (existing) {
  if (await readFile(join(destination, 'manifest.json'), 'utf8') !== manifest) throw new Error('Existing artifact has a different manifest');
  const actualPaths = (await filesIn(destination, destination)).map(path => relative(destination, path).split('\\').join('/'));
  if (actualPaths.length !== entries.length) throw new Error('Existing artifact has extra or missing files');
  for (const entry of entries) {
    if (hash(await readFile(join(destination, entry.path))) !== entry.sha256) throw new Error(`Artifact changed: ${entry.path}`);
  }
} else {
  for (const entry of entries) {
    await mkdir(dirname(join(destination, entry.path)), { recursive: true });
    await writeFile(join(destination, entry.path), entry.bytes, { flag: 'wx' });
  }
  await writeFile(join(destination, 'manifest.json'), manifest, { flag: 'wx' });
}
process.stdout.write(`Static demo artifact: ${destination}\nSHA-256 manifest: ${hash(manifest)}\nNo upload or publication performed.\n`);
