// Нагрузочный тест: N «учеников» одновременно проходят квест целиком —
// регистрация → 5 миссий → тест → сертификат. Показывает время ответа и ошибки.
//
// ВНИМАНИЕ: тест создаёт в базе настоящие записи участников (фамилия «Нагрузочный»).
// Запускайте его только на свежем сервере ДО переноса боевых данных, а после теста
// очистите базу (см. README, раздел «Размещение на сервере в Казахстане»).
//
// Пример:
//   node scripts/load-test.mjs --url https://quest.example.kz --students 1500 --ramp 120 --think 3000 --confirm
//
// Параметры:
//   --url        адрес сайта (обязательно)
//   --students   сколько учеников (по умолчанию 500; с одного IP — не больше ~1900 за 10 минут,
//                иначе сработает защита от спама)
//   --ramp       за сколько секунд все ученики начинают (по умолчанию 60)
//   --think      пауза между действиями ученика, мс (по умолчанию 3000, ±50%)
//   --admin      пароль админки: тогда каждые 30 с открывается «Аналитика», как в день мероприятия
//   --confirm    подтверждение, что база тестовая

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const BASE = String(args.url || '').replace(/\/+$/, '');
const STUDENTS = Number(args.students) || 500;
const RAMP_MS = (Number(args.ramp) || 60) * 1000;
const THINK_MS = Number(args.think) || 3000;
if (!BASE) {
  console.error('Укажите адрес: --url https://...');
  process.exit(1);
}
if (!args.confirm) {
  console.error('Тест записывает в базу тестовых участников. Если база тестовая — добавьте --confirm');
  process.exit(1);
}

const stats = new Map(); // endpoint → { times: [], errors: Map(status → n) }
const stat = (name) => {
  if (!stats.has(name)) stats.set(name, { times: [], errors: new Map() });
  return stats.get(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(THINK_MS * (0.5 + Math.random()));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function call(name, path, { method = 'GET', body, token, cookie, headers = {} } = {}) {
  const s = stat(name);
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Participant-Token': token } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        'X-Lang': 'ru',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    s.times.push(performance.now() - t0);
    if (!res.ok) {
      s.errors.set(res.status, (s.errors.get(res.status) || 0) + 1);
      return null;
    }
    return { res, data: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  } catch (err) {
    s.times.push(performance.now() - t0);
    const key = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code || err.name);
    s.errors.set(key, (s.errors.get(key) || 0) + 1);
    return null;
  }
}

let institutions = [];
let finished = 0;
let certified = 0;
let failedStudents = 0;

async function student(i) {
  await call('GET  /', '/');
  await call('GET  /js/app.js', '/js/app.js');
  const cfg = await call('GET  /api/config', '/api/config?lang=ru');
  const list = await call('GET  /api/institutions', '/api/institutions?lang=ru');
  if (!cfg || !list) { failedStudents += 1; return; }
  await think();

  const inst = pick(institutions);
  const grade = inst.type === 'school' ? 5 + (i % 7) : 1 + (i % 4);
  const reg = await call('POST /api/register', '/api/register', {
    method: 'POST',
    body: {
      institutionId: inst.id, district: inst.district,
      lastName: 'Нагрузочный', firstName: pick(['Арман', 'Айгерим', 'Данияр', 'Алия', 'Тимур', 'Мадина']),
      middleName: '', grade, gradeLetter: pick(['А', 'Б', 'В', '']), consent: true,
    },
  });
  if (!reg) { failedStudents += 1; return; }
  const { token, participant } = reg.data;

  for (const missionId of participant.missionIds) {
    await think();
    const max = 10;
    const ok = await call('POST /api/progress', '/api/progress', {
      method: 'POST', token, body: { missionId, score: 5 + Math.floor(Math.random() * 6), max },
    });
    if (!ok) { failedStudents += 1; return; }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await think();
    const quiz = await call('POST /api/quiz/start', '/api/quiz/start', { method: 'POST', token });
    if (!quiz) { failedStudents += 1; return; }
    await think();
    const answers = quiz.data.questions.map((q) => Math.floor(Math.random() * q.options.length));
    const result = await call('POST /api/quiz/submit', '/api/quiz/submit', {
      method: 'POST', token, body: { attemptId: quiz.data.attemptId, answers },
    });
    if (!result) { failedStudents += 1; return; }
    if (result.data.passed) {
      await call('GET  /api/certificate', '/api/certificate', { token });
      certified += 1;
      break;
    }
  }
  finished += 1;
}

async function adminWatcher(signal) {
  const login = await call('POST /api/admin/login', '/api/admin/login', { method: 'POST', body: { password: String(args.admin) } });
  if (!login) { console.error('Не удалось войти в админку — аналитика в тесте не участвует'); return; }
  const cookie = login.res.headers.get('set-cookie').split(';')[0];
  while (!signal.aborted) {
    await Promise.all([
      call('GET  /api/admin/analytics', '/api/admin/analytics', { cookie }),
      call('GET  /api/admin/stats', '/api/admin/stats', { cookie }),
    ]);
    await Promise.race([sleep(30_000), new Promise((r) => signal.addEventListener('abort', r, { once: true }))]);
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

function report(elapsedS) {
  const rows = [];
  let total = 0;
  let totalErr = 0;
  for (const [name, s] of [...stats.entries()].sort()) {
    const t = s.times.slice().sort((a, b) => a - b);
    const errs = [...s.errors.values()].reduce((a, b) => a + b, 0);
    total += t.length;
    totalErr += errs;
    rows.push({
      'Запрос': name,
      'Всего': t.length,
      'Ошибок': errs ? `${errs} (${[...s.errors.entries()].map(([k, v]) => `${k}: ${v}`).join(', ')})` : 0,
      'p50, мс': Math.round(pct(t, 50)),
      'p95, мс': Math.round(pct(t, 95)),
      'p99, мс': Math.round(pct(t, 99)),
      'Макс, мс': Math.round(t[t.length - 1] || 0),
    });
  }
  console.table(rows);
  console.log(`Учеников: ${STUDENTS}, прошли до конца: ${finished}, получили сертификат: ${certified}, прервались из-за ошибок: ${failedStudents}`);
  console.log(`Запросов: ${total} за ${elapsedS.toFixed(0)} с (в среднем ${(total / elapsedS).toFixed(0)} в секунду), ошибок: ${totalErr}`);
}

const list = await call('GET  /api/institutions', '/api/institutions?lang=ru');
if (!list || !list.data.length) {
  console.error('Не удалось получить список учебных заведений — сайт не отвечает или база пуста');
  process.exit(1);
}
institutions = list.data;
console.log(`Старт: ${STUDENTS} учеников за ${RAMP_MS / 1000} с, пауза между действиями ~${THINK_MS} мс → ${BASE}`);

const t0 = performance.now();
const stopAdmin = new AbortController();
const admin = args.admin ? adminWatcher(stopAdmin.signal) : Promise.resolve();
const progress = setInterval(() => {
  const n = [...stats.values()].reduce((a, s) => a + s.times.length, 0);
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(0)} с: запросов ${n}, закончили ${finished}/${STUDENTS}`);
}, 10_000);

await Promise.all(Array.from({ length: STUDENTS }, (_, i) => sleep((RAMP_MS * i) / STUDENTS).then(() => student(i))));
clearInterval(progress);
stopAdmin.abort();
await admin.catch(() => {});
report((performance.now() - t0) / 1000);
