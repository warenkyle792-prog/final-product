// Assembles client/dist (a build artifact, not persisted in snapshots) from the
// persisted sources: client/built (production bundle) + client/public (static assets).
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pub = path.join(root, 'client', 'public');
const built = path.join(root, 'client', 'built');
const dist = path.join(root, 'client', 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

if (!fs.existsSync(built)) throw new Error('client/built is missing the production bundle.');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
for (const file of fs.readdirSync(built)) fs.copyFileSync(path.join(built, file), path.join(dist, 'assets', file));
copyDir(path.join(pub, 'brand'), path.join(dist, 'brand'));
copyDir(path.join(pub, 'covers'), path.join(dist, 'covers'));
copyDir(path.join(pub, 'backgrounds'), path.join(dist, 'backgrounds'));
copyDir(path.join(pub, 'fonts'), path.join(dist, 'fonts'));
fs.copyFileSync(path.join(pub, 'auth-backdrop.jpg'), path.join(dist, 'auth-backdrop.jpg'));
fs.copyFileSync(path.join(pub, 'favicon.svg'), path.join(dist, 'favicon.svg'));
fs.copyFileSync(path.join(pub, 'theme-overrides.css'), path.join(dist, 'theme-overrides.css'));
fs.copyFileSync(path.join(pub, 'google-auth.js'), path.join(dist, 'google-auth.js'));
fs.copyFileSync(path.join(pub, 'chat-launcher.js'), path.join(dist, 'chat-launcher.js'));
fs.copyFileSync(path.join(pub, 'hide-payments.js'), path.join(dist, 'hide-payments.js'));

const js = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.js'));
const css = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.css'));
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0d0d0e" />
    <meta name="description" content="Find thoughtful local events, meet the people behind them, and keep your plans together." />
    <link rel="icon" type="image/jpeg" href="/brand/velcor-mark.jpeg" />
    <link rel="preload" href="/fonts/etracker-sans.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/etracker-sans-bold.woff2" as="font" type="font/woff2" crossorigin />
    <title>VELCOR — find your next thing</title>
    <script type="module" crossorigin src="/assets/${js}"></script>
    <script src="/google-auth.js" defer></script>
    <script src="/chat-launcher.js" defer></script>
    <script src="/hide-payments.js" defer></script>
    <link rel="stylesheet" crossorigin href="/assets/${css}" />
    <link rel="stylesheet" href="/theme-overrides.css" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log(`client/dist assembled (assets/${js}, assets/${css}).`);
