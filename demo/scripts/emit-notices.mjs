import { readFile, writeFile } from 'node:fs/promises';

const demo = new URL('../', import.meta.url);
const packages = ['react', 'react-dom', 'scheduler', '@fontsource-variable/manrope', '@fontsource/ibm-plex-mono'];
const sections = ['Custodia demo — third-party notices\n\nThese notices cover bundled dependencies and fonts.\nThey do not set a license for Custodia itself.'];
for (const name of packages) {
  const directory = new URL(`node_modules/${name}/`, demo);
  const metadata = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  const license = await readFile(new URL('LICENSE', directory), 'utf8');
  if (!license.trim()) throw new Error(`Missing license text: ${name}`);
  sections.push(`${name} ${metadata.version}\n${'='.repeat(60)}\n${license.trim()}`);
}
// Static hosts may omit charset on text/plain; a UTF-8 BOM preserves names
// and punctuation when the visitor opens the notices directly.
await writeFile(new URL('dist/THIRD-PARTY-NOTICES.txt', demo), `\uFEFF${sections.join('\n\n')}\n`);
process.stdout.write('Third-party notices included in dist/THIRD-PARTY-NOTICES.txt\n');
