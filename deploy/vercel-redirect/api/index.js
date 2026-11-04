// Если у ученика ещё открыта старая вкладка, её запросы к API получат понятный ответ
// «обновите страницу». После обновления страница-переадресация отправит его на новый сайт.
// Тело запроса не читается и нигде не сохраняется.
export default function handler(req, res) {
  const kk = String(req.headers['x-lang'] || '').toLowerCase() === 'kk';
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    error: kk
      ? 'Сайт жаңа мекенжайға көшті. Бетті жаңартыңыз.'
      : 'Сайт переехал на новый адрес. Обновите страницу.',
  }));
}
