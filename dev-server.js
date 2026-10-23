// Локальный запуск без Vercel: раздаёт public/ и передаёт /api/* в тот же обработчик,
// что работает на Vercel. Настройки берутся из файла .env (см. .env.example).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Простая загрузка .env (переменные окружения системы имеют приоритет)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

// Если локальный DNS не отвечает на SRV-запросы MongoDB Atlas (ошибка querySrv EBADRESP),
// укажите в .env: DNS_SERVERS=8.8.8.8,1.1.1.1
if (process.env.DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
}

const { SECURITY_HEADERS } = await import('./lib/app.js');
const { default: apiHandler } = await import('./api/index.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  // Как cleanUrls на Vercel: /admin → admin.html
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!path.extname(rel)) rel += '.html';
  let file;
  try {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Страница не найдена');
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  if (pathname.startsWith('/api/')) {
    // Повторяем rewrite из vercel.json: /api/<путь> → /api?__path=<путь>
    url.searchParams.set('__path', pathname.slice('/api/'.length));
    req.url = `/api?${url.searchParams}`;
    return apiHandler(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  serveStatic(req, res, pathname);
}).listen(PORT, () => {
  console.log(`Сақ бол! запущен: http://localhost:${PORT}  (админка: http://localhost:${PORT}/admin)`);
  if (!process.env.MONGODB_URI) console.warn('Внимание: не задана MONGODB_URI — создайте файл .env по образцу .env.example');
  if (!process.env.ADMIN_PASSWORD) console.warn('Внимание: не задан ADMIN_PASSWORD — вход в админку будет недоступен');
});
