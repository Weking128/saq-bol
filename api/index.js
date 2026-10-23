// Serverless-функция Vercel: все запросы /api/* перенаправляются сюда (см. vercel.json).
// Rewrite передаёт исходный путь в параметре __path — восстанавливаем адрес запроса,
// чтобы обработчик видел, например, /api/quiz/start, а не /api.
import { handle } from '../lib/app.js';

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('__path')) {
    const original = url.searchParams.get('__path').replace(/^\/+/, '');
    url.searchParams.delete('__path');
    const query = url.searchParams.toString();
    req.url = `/api/${original}${query ? `?${query}` : ''}`;
  }
  return handle(req, res);
}
