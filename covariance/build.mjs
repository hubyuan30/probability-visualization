import fs from 'node:fs';

const shell = fs.readFileSync('src/shell.html', 'utf8');
const css = fs.readFileSync('src/style.css', 'utf8');
const js = fs.readFileSync('src/app.js', 'utf8');

const html = shell
  .replace('/*__STYLE__*/', () => css)
  .replace('/*__SCRIPT__*/', () => js);

fs.writeFileSync('index.html', html);
console.log(`Built index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, self-contained)`);