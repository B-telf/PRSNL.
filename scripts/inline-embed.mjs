// Folds the built embed page into one HTML file with no external requests,
// so a native app can ship it as a single bundled resource.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

const dist = new URL('../embed-dist/', import.meta.url);
const out = new URL('../ios/LoopKit/loop.html', import.meta.url);

let html = readFileSync(new URL('index.html', dist), 'utf8');
const assets = readdirSync(new URL('assets/', dist));
const scripts = assets.filter((f) => f.endsWith('.js'));
if (scripts.length !== 1) throw new Error(`Expected one script, found ${scripts.length}`);
const js = readFileSync(new URL(`assets/${scripts[0]}`, dist), 'utf8').replaceAll('</script', '<\\/script');

html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '');
html = html.replace('</body>', () => `<script type="module">${js}</script>\n  </body>`);
if (/(src|href)="\.\/assets/.test(html)) throw new Error('The page still references external files');

mkdirSync(new URL('./', out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ios/LoopKit/loop.html (${(html.length / 1024).toFixed(0)} kB)`);
