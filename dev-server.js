const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

const EXACT_ROUTES = new Map([
  ['/', 'index.html'],
  ['/profile', 'profile.html'],
  ['/write-review', 'write-review.html'],
  ['/privacy-policy', 'privacy-policy.html'],
  ['/terms', 'terms-of-service.html'],
  ['/cookies', 'cookie-policy.html'],
  ['/my-profile', 'my-profile.html'],
  ['/how-it-works', 'how-it-works.html'],
  ['/careers', 'careers.html'],
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function safeLocalPath(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^([.][.][/\\])+/, '');
  return path.join(ROOT, normalized);
}

function resolvePath(urlPath) {
  if (EXACT_ROUTES.has(urlPath)) {
    return path.join(ROOT, EXACT_ROUTES.get(urlPath));
  }

  const assetPath = safeLocalPath(urlPath);
  if (assetPath.startsWith(ROOT) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return assetPath;
  }

  if (!path.extname(urlPath)) {
    const cleanHtmlPath = path.join(ROOT, `${urlPath.replace(/^\//, '')}.html`);
    if (cleanHtmlPath.startsWith(ROOT) && fs.existsSync(cleanHtmlPath) && fs.statSync(cleanHtmlPath).isFile()) {
      return cleanHtmlPath;
    }

    const segments = urlPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (segments.length === 1) {
      return path.join(ROOT, 'profile.html');
    }
  }

  return null;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  const resolvedPath = resolvePath(requestUrl.pathname);

  if (!resolvedPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  sendFile(res, resolvedPath);
});

server.listen(PORT, () => {
  console.log(`Peepd dev server running at http://localhost:${PORT}`);
});