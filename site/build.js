// Builds the one-file site: src/page.html with the Edge Eyes engine, the computer player and the
// lesson diagrams written into it. Usage: node build.js
// Writes hexgo.html (for the Artifact) and ../docs/index.html (the complete page that GitHub Pages serves).
const fs = require('fs');
const path = require('path');

const here = (...p) => path.join(__dirname, ...p);
const parts = {
  engine: here('..', 'HexGo-EdgeEyes', 'engine.js'),
  ai: here('..', 'HexGo-EdgeEyes', 'ai.js'),
  lessons: here('src', 'lessons.js'),
};
let html = fs.readFileSync(here('src', 'page.html'), 'utf8');
for (const [name, file] of Object.entries(parts)) {
  const code = fs.readFileSync(file, 'utf8');
  if (code.includes('</script')) throw new Error(`${file} contains </script and cannot be written into the page`);
  const mark = `/*@${name}*/`;
  if (!html.includes(mark)) throw new Error(`src/page.html has no ${mark}`);
  html = html.replace(mark, () => code);
}
// The Artifact viewer blocks outside connections, so online play can never work in that copy.
const onlineFile = here('online.json');
const tag = '<span class="tag" id="onlineTag">Not yet</span>';
if (!html.includes(tag)) throw new Error('src/page.html has no Online tag to label');
fs.writeFileSync(here('hexgo.html'), fs.existsSync(onlineFile) ? html.replace(tag, tag.replace('Not yet', 'On the public site only')) : html);
console.log(`hexgo.html: ${(html.length / 1024).toFixed(0)} KB`);

// The same page as a complete document for an ordinary web host. (hexgo.html has no <html> or
// <head> of its own because the Artifact viewer supplies them.)
const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -14 28 28">' +
  '<polygon points="12,0 6,10.4 -6,10.4 -12,0 -6,-10.4 6,-10.4" fill="#dbb878" stroke="#94713a" stroke-width="1.6"/><circle r="5.6" fill="#17191a"/></svg>');
const description = 'HexGo is Go played on a hexagonal board. Play the computer or a friend, and learn the rules with live diagrams.';
// Visitor counts for the public site (Cloudflare Web Analytics, no cookies). The token is public by
// nature. The Artifact copy leaves this out: its viewer blocks outside scripts.
const analytics = `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "b705c8626d3147f39a4af1bd2862c160"}'></script><!-- End Cloudflare Web Analytics -->`;
// The address of the online-play server (see ../online). Without online.json the Online option stays off.
const online = fs.existsSync(onlineFile)
  ? `<script>window.HEXGO_ONLINE = ${JSON.stringify(JSON.parse(fs.readFileSync(onlineFile, 'utf8')).url)};</script>` : '';
// The public page serves its own copies of the fonts (docs/fonts) instead of loading them from
// Google, so visitors' browsers contact no one but this site and Cloudflare.
const fontLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/);
if (!fontLink) throw new Error('src/page.html has no Google Fonts link to replace');
const selfHosted = html.replace(fontLink[0], () => `<style>\n${fs.readFileSync(here('src', 'fonts.css'), 'utf8')}</style>\n`);
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta property="og:title" content="HexGo">
<meta property="og:description" content="${description}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${icon}">
<style>
  :root { padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
  body { margin: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
${online}
${selfHosted}
${analytics}
</body>
</html>
`;
// GitHub Pages serves the repository's docs/ folder; .nojekyll tells it to serve the file as it is.
fs.mkdirSync(here('..', 'docs'), { recursive: true });
fs.writeFileSync(here('..', 'docs', 'index.html'), page);
fs.writeFileSync(here('..', 'docs', '.nojekyll'), '');
console.log(`../docs/index.html: ${(page.length / 1024).toFixed(0)} KB`);
