// Запуск на своём сервере (не Vercel): несколько процессов Node — по числу ядер, но не больше 4.
// Если один процесс упадёт, остальные продолжают отвечать, а упавший перезапускается через секунду.
// Количество процессов можно задать переменной WEB_CONCURRENCY.

import cluster from 'node:cluster';
import os from 'node:os';

const workers = Number(process.env.WEB_CONCURRENCY) || Math.min(os.availableParallelism(), 4);

if (cluster.isPrimary && workers > 1) {
  let stopping = false;
  for (let i = 0; i < workers; i++) cluster.fork();

  // Защита от наплыва (lib/app.js, FLOOD): процесс, проверивший токен ученика, сообщает
  // о нём остальным — так ученик сразу «свой» для всех процессов
  cluster.on('message', (from, msg) => {
    if (!msg || typeof msg.sbToken !== 'string') return;
    for (const w of Object.values(cluster.workers)) if (w !== from && w.isConnected()) w.send(msg);
  });

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      if (!Object.keys(cluster.workers).length) process.exit(0);
      return;
    }
    console.error(`Процесс ${worker.process.pid} завершился (${signal || code}), запускаем новый`);
    setTimeout(() => cluster.fork(), 1000);
  });

  const stop = () => {
    stopping = true;
    for (const w of Object.values(cluster.workers)) w.process.kill('SIGTERM');
    setTimeout(() => process.exit(0), 12_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log(`Сақ бол!: запущено процессов — ${workers}`);
} else {
  await import('./dev-server.js');
}
