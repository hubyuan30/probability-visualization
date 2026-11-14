import fs from 'node:fs/promises';

await fs.mkdir('dist', { recursive: true });

const [js, template] = await Promise.all([
  fs.readFile('dist/app.js', 'utf8'),
  fs.readFile('src/index.html', 'utf8'),
]);

const safeJs = js.replace(/<\/script/gi, '<\\/script');
const html = template.replace('<!-- __APP_BUNDLE__ -->', () => `<script>\n${safeJs}\n</script>`);
await fs.writeFile('index.html', html);
await fs.writeFile('dist/index.html', html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`Built index.html (${kb} KB, self-contained)`);
