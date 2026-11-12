// Сақ бол! — API квеста. Один обработчик для Vercel (api/index.js)
// и для локального запуска (dev-server.js).
//
// Переменные окружения:
//   MONGODB_URI       строка подключения к MongoDB (обязательно)
//   MONGODB_DB        имя базы (по умолчанию saq-bol)
//   ADMIN_PASSWORD    пароль админ-панели (обязательно для входа в админку)
//   DER_PASSWORD      пароль панели ДЭР /der — админка без теста и сертификатов, только просмотр (необязательно)
//   TZ_OFFSET_HOURS   часовой пояс для статистики по дням (по умолчанию 5 — Казахстан)
//   TRUST_PROXY       =1 — брать IP клиента из X-Forwarded-For (на Vercel включено всегда)

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { getDb, getSettings, setSetting, nextSeq, rateLimited, toObjectId, cached, invalidate, DEFAULT_SETTINGS, ConfigError } from './db.js';
import { QUESTIONS, QUESTIONS_BY_ID, TOPIC_PLAN, JUNIOR_TOPIC_PLAN, TOPIC_LABELS } from './quiz-bank.js';
import { QUESTIONS_KK, TOPIC_LABELS_KK } from './quiz-bank.kk.js';
import { DISTRICTS, DISTRICTS_BY_ID } from './districts.js';

const ON_VERCEL = !!process.env.VERCEL;
const TRUST_PROXY = ON_VERCEL || process.env.TRUST_PROXY === '1';
const TZ_OFFSET = Number(process.env.TZ_OFFSET_HOURS ?? 5);
const TZ = `${TZ_OFFSET >= 0 ? '+' : '-'}${String(Math.abs(TZ_OFFSET)).padStart(2, '0')}:00`;

// Полная версия квеста и облегчённая для 1–6 классов (без миссии про дропперство)
const MISSION_SETS = { senior: ['m1', 'm2', 'm3', 'm4', 'm5'], junior: ['m1', 'm2', 'm3', 'm5'] };
const MISSION_IDS = MISSION_SETS.senior;
const QUIZ_SIZE = Object.values(TOPIC_PLAN).reduce((a, b) => a + b, 0);
const levelOf = (p) => p.level || (p.gradeKind === 'class' && Number(p.grade) <= 6 ? 'junior' : 'senior');
const missionsOf = (p) => MISSION_SETS[levelOf(p)];
const missionsComplete = (p) => p.missionsComplete ?? (p.missionsDone >= missionsOf(p).length);
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // Чужая вкладка, открытая со ссылки, не получит доступа к окну квеста; ответы API
  // и файлы сайта нельзя встроить в чужую страницу
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// ─── Языки и сообщения ─────────────────────────────────────────────────────
// Язык интерфейса ученика приходит в параметре ?lang= (для ответов, которые кэширует CDN)
// или в заголовке X-Lang (kk или ru).

const langOf = (req, url) => (String(url.searchParams.get('lang') || req.headers['x-lang'] || '').toLowerCase() === 'kk' ? 'kk' : 'ru');

const MESSAGES = {
  ru: {
    needRegistration: 'Требуется регистрация',
    participantNotFound: 'Участник не найден. Зарегистрируйтесь заново',
    tooManyRegistrations: 'Слишком много регистраций с этого адреса. Попробуйте через несколько минут',
    consentRequired: 'Нужно согласие на обработку персональных данных',
    institutionNameRequired: 'Укажите название учебного заведения',
    chooseInstitution: 'Выберите учебное заведение из списка',
    chooseClass: 'Выберите класс',
    chooseCourse: 'Выберите курс',
    chooseDistrict: 'Выберите город или район',
    badLetter: 'Литера класса / группа указаны неверно',
    fillField: 'Заполните поле «{field}»',
    lettersOnly: 'Поле «{field}» может содержать только буквы, пробел и дефис',
    lastName: 'Фамилия',
    firstName: 'Имя',
    middleName: 'Отчество',
    unknownMission: 'Неизвестная миссия',
    missionsFirst: 'Сначала пройдите все миссии',
    tooManyAttempts: 'Слишком много попыток. Сделайте перерыв',
    attemptNotFound: 'Попытка не найдена',
    attemptFinished: 'Эта попытка уже завершена',
    certAfterTest: 'Сертификат выдаётся после успешного прохождения итогового теста',
    gameLocked: 'Мини-игра откроется после первой миссии',
    gameOff: 'Мини-игра сейчас выключена',
    badScore: 'Некорректный результат игры',
    tooManyRequests: 'Слишком много запросов',
    slowDown: 'Слишком много запросов. Повторите через {s} с',
    notFound: 'Не найдено',
    tooLarge: 'Слишком большой запрос',
    badJson: 'Некорректный JSON',
    unsupportedType: 'Неверный формат запроса',
    dbUnavailable: 'База данных временно недоступна. Попробуйте через минуту',
    serverError: 'Внутренняя ошибка сервера. Попробуйте ещё раз',
  },
  kk: {
    needRegistration: 'Тіркелу қажет',
    participantNotFound: 'Қатысушы табылмады. Қайта тіркеліңіз',
    tooManyRegistrations: 'Бұл мекенжайдан тіркелу тым көп. Бірнеше минуттан кейін қайталаңыз',
    consentRequired: 'Дербес деректерді өңдеуге келісім қажет',
    institutionNameRequired: 'Оқу орнының атауын көрсетіңіз',
    chooseInstitution: 'Тізімнен оқу орнын таңдаңыз',
    chooseClass: 'Сыныпты таңдаңыз',
    chooseCourse: 'Курсты таңдаңыз',
    chooseDistrict: 'Қаланы немесе ауданды таңдаңыз',
    badLetter: 'Сынып литерасы / тобы қате көрсетілген',
    fillField: '«{field}» өрісін толтырыңыз',
    lettersOnly: '«{field}» өрісінде тек әріптер, бос орын және дефис болуы мүмкін',
    lastName: 'Тегі',
    firstName: 'Аты',
    middleName: 'Әкесінің аты',
    unknownMission: 'Белгісіз миссия',
    missionsFirst: 'Алдымен барлық миссиядан өтіңіз',
    tooManyAttempts: 'Әрекеттер тым көп. Үзіліс жасаңыз',
    attemptNotFound: 'Әрекет табылмады',
    attemptFinished: 'Бұл әрекет аяқталған',
    certAfterTest: 'Сертификат қорытынды тесттен сәтті өткеннен кейін беріледі',
    gameLocked: 'Шағын ойын бірінші миссиядан кейін ашылады',
    gameOff: 'Шағын ойын қазір өшірулі',
    badScore: 'Ойын нәтижесі қате',
    tooManyRequests: 'Сұраулар тым көп',
    slowDown: 'Сұраулар тым көп. {s} секундтан кейін қайталаңыз',
    notFound: 'Табылмады',
    tooLarge: 'Сұрау тым үлкен',
    badJson: 'JSON қате',
    unsupportedType: 'Сұрау пішімі қате',
    dbUnavailable: 'Деректер қоры уақытша қолжетімсіз. Бір минуттан кейін қайталаңыз',
    serverError: 'Сервердің ішкі қатесі. Қайта байқап көріңіз',
  },
};

function tr(lang, key, vars = {}) {
  const text = MESSAGES[lang][key] ?? MESSAGES.ru[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// ─── Утилиты ───────────────────────────────────────────────────────────────

// message — ключ из MESSAGES (переводится под язык запроса) или готовый текст
class HttpError extends Error {
  constructor(status, message, vars) {
    super(message);
    this.status = status;
    this.vars = vars;
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function clientIp(req) {
  if (TRUST_PROXY) {
    const real = req.headers['x-real-ip'];
    if (real) return String(real);
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, data, cacheControl = 'no-store', body = JSON.stringify(data)) {
  send(res, status, body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
  });
}

// Общие ответы (список заведений ~100 КБ) приходят из кэша одним и тем же объектом —
// превращаем такой объект в JSON один раз, а не на каждый запрос. Без CDN (свой сервер)
// это заметно снижает нагрузку на процессор.
const serialized = new WeakMap();
function stringifyShared(data) {
  if (data === null || typeof data !== 'object') return JSON.stringify(data);
  let s = serialized.get(data);
  if (s === undefined) {
    s = JSON.stringify(data);
    serialized.set(data, s);
  }
  return s;
}

// Те же общие ответы, сжатые один раз (список заведений ~100 КБ → ~15 КБ). Раньше Caddy
// сжимал его заново для каждого ученика — это заметная доля процессора в начале урока
// и при наплыве запросов. Caddy уже сжатый ответ не трогает.
const gzipped = new WeakMap();
function gzipShared(data, body) {
  let z = gzipped.get(data);
  if (!z) {
    z = zlib.gzipSync(body, { level: 6 });
    gzipped.set(data, z);
  }
  return z;
}

// Общие для всех данные (настройки, список заведений) раздаёт CDN Vercel: тысячи учеников
// получают их из кэша, не запуская функцию. Изменения из админки доходят до учеников
// в течение пары минут.
const PUBLIC_CACHE = 'public, max-age=60, s-maxage=120, stale-while-revalidate=600';

// Тело запроса — только JSON. Форма с чужого сайта не может отправить такой запрос
// без разрешения браузера (CORS), поэтому подделать регистрацию или отправку результата
// со стороннего сайта нельзя.
const isJsonType = (req) => /^application\/json\b/i.test(String(req.headers['content-type'] || '').trim());

async function readJson(req, limit = 32 * 1024) {
  // На Vercel тело запроса уже разобрано платформой и доступно как req.body
  if (ON_VERCEL && 'body' in req) {
    let b;
    try { b = req.body; } catch { throw new HttpError(400, 'badJson'); }
    if (b === undefined || b === null || b === '') return {};
    if (!isJsonType(req)) throw new HttpError(415, 'unsupportedType');
    if (typeof b === 'object' && !Buffer.isBuffer(b)) {
      if (JSON.stringify(b).length > limit) throw new HttpError(413, 'tooLarge');
      return b;
    }
    const s = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
    if (s.length > limit) throw new HttpError(413, 'tooLarge');
    try { return JSON.parse(s); } catch { throw new HttpError(400, 'badJson'); }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'tooLarge');
    chunks.push(chunk);
  }
  if (!size) return {};
  if (!isJsonType(req)) throw new HttpError(415, 'unsupportedType');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'badJson');
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // Испорченная чужая cookie (например, «%» без кода) не должна ломать вход в админку
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* пропускаем */ }
  }
  return out;
}

// ─── Данные участника ──────────────────────────────────────────────────────

const NAME_RE = /^[\p{L}][\p{L}\p{M}'’ʼ\- ]{0,49}$/u;

// field — ключ названия поля в MESSAGES (lastName / firstName / middleName)
function cleanName(value, field, lang, required = true) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!v) {
    if (required) throw new HttpError(400, 'fillField', { field: tr(lang, field) });
    return '';
  }
  if (!NAME_RE.test(v)) throw new HttpError(400, 'lettersOnly', { field: tr(lang, field) });
  // Иванова-петрова → Иванова-Петрова
  return v.toLocaleLowerCase('ru').replace(/(^|[\s\-'’ʼ])(\p{L})/gu, (m, sep, ch) => sep + ch.toLocaleUpperCase('ru'));
}

function gradeLabel(p, lang = 'ru') {
  if (lang === 'kk') {
    if (p.gradeKind === 'course') return `${p.grade} курс` + (p.gradeLetter ? `, ${p.gradeLetter} тобы` : '');
    return p.gradeLetter ? `${p.grade} «${p.gradeLetter}» сынып` : `${p.grade} сынып`;
  }
  if (p.gradeKind === 'course') return `${p.grade} курс` + (p.gradeLetter ? `, группа ${p.gradeLetter}` : '');
  return p.gradeLetter ? `${p.grade} «${p.gradeLetter}» класс` : `${p.grade} класс`;
}

const institutionOf = (p, lang) => (lang === 'kk' && p.institutionNameKk) || p.institutionName;

// Вопрос теста на нужном языке
function localQuestion(q, lang) {
  const kk = lang === 'kk' && QUESTIONS_KK[q.id];
  return {
    q: kk ? kk.q : q.q,
    options: kk ? kk.options : q.options,
    explain: kk ? kk.explain : q.explain,
    topic: (lang === 'kk' ? TOPIC_LABELS_KK : TOPIC_LABELS)[q.topic],
  };
}

const fullName = (p) => [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ');

function statusOf(p) {
  if (p.certNumber) return 'passed';
  if (p.attemptsCount > 0) return 'failed';
  if (missionsComplete(p)) return 'missions_done';
  if (p.missionsDone > 0) return 'in_progress';
  return 'registered';
}

function publicParticipant(p, lang) {
  return {
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName,
    fullName: fullName(p),
    institution: institutionOf(p, lang),
    gradeLabel: gradeLabel(p, lang),
    level: levelOf(p),
    missionIds: missionsOf(p),
    missions: p.missions || {},
    missionsDone: p.missionsDone,
    missionsComplete: missionsComplete(p),
    xp: p.xp,
    attemptsCount: p.attemptsCount,
    bestScore: p.bestScore,
    passed: !!p.certNumber,
    certNumber: p.certNumber,
    passedAt: p.passedAt,
    gameBest: p.gameBest || 0,
  };
}

async function participantByToken(db, req) {
  const token = String(req.headers['x-participant-token'] || '');
  if (!/^[a-f0-9]{48}$/.test(token)) throw new HttpError(401, 'needRegistration');
  const p = await db.collection('participants').findOne({ token });
  if (!p) {
    noteBadToken(req);
    throw new HttpError(401, 'participantNotFound');
  }
  rememberToken(token);
  return p;
}

// ─── Защита от наплыва запросов с одного адреса ────────────────────────────
// Вся школа (Wi-Fi) или много абонентов мобильного оператора выходят в интернет через один
// IP-адрес, поэтому жёсткий лимит «на адрес» отрезал бы целые классы. Лимиты считаются так:
// • у каждого ученика свой лимит по его токену: 40 запросов подряд, дальше 4 в секунду.
//   Ученик в квесте делает запрос раз в несколько секунд, а программа, которая шлёт тысячи
//   запросов, упрётся в свой лимит и не помешает одноклассникам за тем же адресом;
// • выдуманные токены: адрес может прислать 60 неверных токенов подряд, дальше 1 в секунду
//   на процесс — потом токены, которых сервер ещё не видел, с этого адреса ждут. Токены
//   учеников, уже проверенные любым процессом сервера, проходят всегда;
// • без токена — два запаса адреса: «лёгкий» (настройки и список заведений — они в памяти
//   и уже сжаты) 600 подряд и 60 в секунду на процесс; «тяжёлый» (регистрация, проверка
//   сертификата, вход в админку, отчёт об ошибке, несуществующие адреса) — 300 подряд
//   и 30 в секунду. Процессов до 4, то есть до 240 и 120 в секунду с адреса: школа
//   из 2 000 учеников, начавшая за одну минуту, — около 35 в секунду;
// • /api/health (мониторинг) и вошедший в админку — без лимита.
// Превышение — ответ 429 с Retry-After: браузер ученика сам ждёт и повторяет запрос
// (public/js/ui.js), ошибки ученик не видит. Счётчики — в памяти процесса, без базы:
// проверка ничего не стоит даже при наплыве. Проверенные токены процессы сообщают друг
// другу (server.js), чтобы ученика не «проверял заново» каждый процесс.
const FLOOD = {
  student: { burst: 40, perSec: 4 },
  badToken: { burst: 60, perSec: 1 },
  light: { burst: 600, perSec: 60 },
  heavy: { burst: 300, perSec: 30 },
  knownMax: 100_000, // сколько проверенных токенов помнит процесс
};
const LIGHT_PATHS = new Set(['/api/config', '/api/institutions']);
const knownTokens = new Set();
const studentBuckets = new Map();
const badTokenBuckets = new Map();
const lightBuckets = new Map();
const heavyBuckets = new Map();

function addKnownToken(token) {
  if (knownTokens.has(token)) return false;
  if (knownTokens.size >= FLOOD.knownMax) knownTokens.delete(knownTokens.values().next().value);
  knownTokens.add(token);
  return true;
}

function rememberToken(token) {
  if (addKnownToken(token) && typeof process.send === 'function') {
    try { process.send({ sbToken: token }); } catch { /* главный процесс недоступен — не страшно */ }
  }
}

// Токены, проверенные соседними процессами (рассылает главный процесс в server.js)
if (typeof process.send === 'function') {
  process.on('message', (msg) => {
    if (msg && typeof msg.sbToken === 'string' && /^[a-f0-9]{48}$/.test(msg.sbToken)) addKnownToken(msg.sbToken);
  });
}

// Неверный токен с адреса: расходует запас «выдуманных токенов» (см. FLOOD.badToken)
function noteBadToken(req) {
  takeToken(badTokenBuckets, clientIp(req), FLOOD.badToken);
}

// «Ведро с жетонами»: запрос берёт жетон, жетоны восстанавливаются со скоростью perSec.
// Возвращает 0 — можно, иначе через сколько секунд повторить.
function takeToken(buckets, key, { burst, perSec }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { left: burst, at: now };
    buckets.set(key, b);
  } else {
    b.left = Math.min(burst, b.left + ((now - b.at) / 1000) * perSec);
    b.at = now;
  }
  if (b.left >= 1) {
    b.left -= 1;
    return 0;
  }
  return Math.max(1, Math.ceil((1 - b.left) / perSec));
}

// Есть ли в ведре запас (не расходуя его)
function hasToken(buckets, key, { burst, perSec }) {
  const b = buckets.get(key);
  return !b || Math.min(burst, b.left + ((Date.now() - b.at) / 1000) * perSec) >= 1;
}

// Раз в минуту забываем полные вёдра — память не растёт
setInterval(() => {
  const now = Date.now();
  for (const [buckets, rule] of [[studentBuckets, FLOOD.student], [badTokenBuckets, FLOOD.badToken],
    [lightBuckets, FLOOD.light], [heavyBuckets, FLOOD.heavy]]) {
    for (const [key, b] of buckets) if (b.left + ((now - b.at) / 1000) * rule.perSec >= rule.burst) buckets.delete(key);
  }
}, 60_000).unref();

// Наплыв виден в журнале: одна строка в минуту на адрес (или ученика) и вид лимита,
// со счётом отклонённых за прошлую минуту — по адресу школьный IT найдёт источник.
// Не больше 30 строк в минуту на процесс, токен ученика в журнал не попадает.
const floodLog = { minute: 0, lines: 0, seen: new Map() };
function noteFlood(kind, who) {
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== floodLog.minute) Object.assign(floodLog, { minute, lines: 0 });
  const key = `${kind}|${who}`;
  const s = floodLog.seen.get(key) || { minute: 0, n: 0, prev: 0 };
  if (s.minute !== minute) {
    s.prev = s.minute === minute - 1 ? s.n : 0;
    s.minute = minute;
    s.n = 0;
    if (floodLog.lines < 30) {
      floodLog.lines += 1;
      console.warn(`[flood] ${who}: упёрся в лимит «${kind}», лишние запросы отклоняются`
        + (s.prev ? ` (за прошлую минуту отклонено ${s.prev})` : ''));
    }
  }
  s.n += 1;
  floodLog.seen.set(key, s);
  if (floodLog.seen.size > 5000) floodLog.seen.clear();
}

// 0 — запрос можно выполнять, иначе через сколько секунд повторить
function floodWait(req, pathname) {
  if (pathname === '/api/health') return 0;
  const token = String(req.headers['x-participant-token'] || '');
  if (/^[a-f0-9]{48}$/.test(token)) {
    // Токен, которого сервер ещё не видел, — только пока у адреса не кончились «неверные токены»
    if (!knownTokens.has(token) && !hasToken(badTokenBuckets, clientIp(req), FLOOD.badToken)) {
      noteFlood('выдуманные токены', `адрес ${clientIp(req)}`);
      return Math.max(1, Math.ceil(1 / FLOOD.badToken.perSec));
    }
    const wait = takeToken(studentBuckets, token, FLOOD.student);
    if (wait) noteFlood('запросы ученика', `ученик ${sha256(token).toString('hex').slice(0, 8)} с адреса ${clientIp(req)}`);
    return wait;
  }
  if (pathname.startsWith('/api/admin/') && hasAdminSession(req)) return 0;
  if (pathname.startsWith('/api/der/') && (hasDerSession(req) || hasAdminSession(req))) return 0;
  const light = req.method === 'GET' && LIGHT_PATHS.has(pathname);
  const wait = takeToken(light ? lightBuckets : heavyBuckets, clientIp(req), light ? FLOOD.light : FLOOD.heavy);
  if (wait) noteFlood(light ? 'лёгкие запросы без токена' : 'тяжёлые запросы без токена', `адрес ${clientIp(req)}`);
  return wait;
}

function passScoreOf(settings) {
  const n = Number(settings.pass_score);
  return Number.isInteger(n) && n >= 1 && n <= QUIZ_SIZE ? n : 7;
}

// Настройка на языке lang: для казахского берём поле *_kk, если оно заполнено
const setting = (s, key, lang) => (lang === 'kk' && s[`${key}_kk`]) || s[key];

// Настройки мини-игры (Админка → Настройки → «Мини-игра»)
function gameSettings(s) {
  const rounds = Number(s.game_rounds);
  const enabled = s.game_enabled !== 'off';
  return {
    enabled,
    rating: enabled && s.game_rating !== 'off',
    names: s.game_rating_names === 'initials' ? 'initials' : 'name',
    rounds: Number.isInteger(rounds) && rounds >= 1 && rounds <= 5 ? rounds : 1,
    unlimited: s.game_unlimited !== 'off',
  };
}

function publicConfig(s, lang) {
  const game = gameSettings(s);
  return {
    lang,
    eventTitle: setting(s, 'event_title', lang),
    orgName: setting(s, 'org_name', lang),
    city: setting(s, 'city', lang),
    signerName: s.signer_name,
    signerPosition: setting(s, 'signer_position', lang),
    passScore: passScoreOf(s),
    quizSize: QUIZ_SIZE,
    missions: MISSION_IDS,
    gameRating: game.rating, // для старых вкладок, открытых до обновления
    game: { enabled: game.enabled, rating: game.rating, names: game.names, rounds: game.rounds, unlimited: game.unlimited },
    districts: DISTRICTS.map((d) => ({ id: d.id, name: lang === 'kk' ? d.kk : d.ru, center: lang === 'kk' ? d.centerKk : d.centerRu })),
  };
}

const districtName = (id, lang = 'ru') => {
  const d = DISTRICTS_BY_ID.get(id || 'taraz');
  return d ? (lang === 'kk' ? d.kk : d.ru) : '';
};

function certificateData(p, s, lang) {
  return {
    ...publicConfig(s, lang),
    fullName: fullName(p),
    institution: institutionOf(p, lang),
    gradeLabel: gradeLabel(p, lang),
    score: p.bestScore,
    total: QUIZ_SIZE,
    number: p.certNumber,
    passedAt: p.passedAt,
  };
}

// ─── Маршруты ──────────────────────────────────────────────────────────────

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });
const admin = (method, pattern, handler) => route(method, pattern, handler, { admin: true });
const derRoute = (method, pattern, handler) => route(method, pattern, handler, { der: true });

// Один обработчик для админки (/api/admin/…) и панели ДЭР (/api/der/…): обработчик получает
// der = true и отдаёт данные без итогового теста и сертификатов
function panel(method, sub, handler) {
  const path = (prefix) => (typeof sub === 'string' ? `${prefix}${sub}` : new RegExp(`^${prefix}${sub.source}`));
  admin(method, path('/api/admin/'), (c) => handler({ ...c, der: false }));
  derRoute(method, path('/api/der/'), (c) => handler({ ...c, der: true }));
}

// Активные заведения — в памяти экземпляра на минуту (сбрасывается при правке в админке)
const INSTITUTIONS_TTL = 60_000;
const activeInstitutions = (db) => cached('institutions:active', INSTITUTIONS_TTL, async () => {
  const list = await db.collection('institutions').find({ active: true }).project({ name: 1, nameKk: 1, type: 1, district: 1 }).toArray();
  return { list, byId: new Map(list.map((i) => [String(i._id), i])) };
});

// Проверка «жив ли сайт и доступна ли база» — для мониторинга и Docker
route('GET', '/api/health', async ({ db }) => {
  await db.command({ ping: 1 });
  return { ok: true };
});

route('GET', '/api/config', async ({ db, lang }) => publicConfig(await getSettings(db), lang), { public: true });

// name — на языке интерфейса, alt — на втором языке (для поиска)
route('GET', '/api/institutions', async ({ db, lang }) => cached(`institutions:list:${lang}`, INSTITUTIONS_TTL, async () =>
  (await activeInstitutions(db)).list
    .map((i) => {
      const kk = i.nameKk || i.name;
      return { id: String(i._id), name: lang === 'kk' ? kk : i.name, alt: lang === 'kk' ? i.name : kk, type: i.type, district: i.district || 'taraz' };
    })
    .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true }))), { public: true });

route('POST', '/api/register', async ({ db, req, lang }) => {
  // Весь класс или школа часто выходят в интернет с одного адреса (школьный Wi-Fi,
  // мобильный оператор), поэтому лимит щедрый — он только отсекает автоматический спам:
  // 10 000 регистраций в час — больше, чем учеников в самой большой школе и во всём
  // мероприятии. Поток запросов сдерживает FLOOD.heavy (не больше ~120 в секунду с адреса).
  if (await rateLimited(db, `reg:${clientIp(req)}`, 10_000, 60 * 60 * 1000)) {
    throw new HttpError(429, 'tooManyRegistrations');
  }
  const body = await readJson(req);
  if (body.consent !== true) throw new HttpError(400, 'consentRequired');

  let institutionId = null;
  let institutionName;
  let institutionNameKk;
  let institutionType;
  let district;
  if (body.institutionId === 'other') {
    institutionName = String(body.institutionOther ?? '').replace(/\s+/g, ' ').trim();
    if (institutionName.length < 3 || institutionName.length > 150) throw new HttpError(400, 'institutionNameRequired');
    institutionNameKk = institutionName;
    institutionType = 'other';
    district = String(body.district || '');
    if (!DISTRICTS_BY_ID.has(district)) throw new HttpError(400, 'chooseDistrict');
  } else {
    const id = toObjectId(body.institutionId);
    const inst = id && ((await activeInstitutions(db)).byId.get(String(id))
      || await db.collection('institutions').findOne({ _id: id, active: true }));
    if (!inst) throw new HttpError(400, 'chooseInstitution');
    institutionId = inst._id;
    institutionName = inst.name;
    institutionNameKk = inst.nameKk || inst.name;
    institutionType = inst.type;
    district = inst.district || 'taraz';
  }

  const gradeKind = institutionType === 'school' ? 'class'
    : institutionType === 'other' ? (body.gradeKind === 'course' ? 'course' : 'class')
    : 'course';
  const grade = Number(body.grade);
  const maxGrade = gradeKind === 'class' ? 12 : 6; // в НИШ и некоторых школах есть 12-й класс
  if (!Number.isInteger(grade) || grade < 1 || grade > maxGrade) {
    throw new HttpError(400, gradeKind === 'class' ? 'chooseClass' : 'chooseCourse');
  }
  const gradeLetter = String(body.gradeLetter ?? '').replace(/\s+/g, '').toLocaleUpperCase('ru').slice(0, 12);
  if (gradeLetter && !/^[\p{L}\d\-]+$/u.test(gradeLetter)) throw new HttpError(400, 'badLetter');

  const lastName = cleanName(body.lastName, 'lastName', lang);
  const firstName = cleanName(body.firstName, 'firstName', lang);
  const middleName = cleanName(body.middleName, 'middleName', lang, false);

  const now = new Date();
  const level = gradeKind === 'class' && grade <= 6 ? 'junior' : 'senior';
  const p = {
    token: crypto.randomBytes(24).toString('hex'),
    lang,
    institutionId, institutionName, institutionNameKk, institutionType, district,
    lastName, firstName, middleName,
    search: `${lastName} ${firstName} ${middleName}`.toLowerCase(),
    gradeKind, grade: String(grade), gradeLetter,
    level,
    missions: {}, missionsDone: 0, missionsComplete: false, xp: 0,
    attemptsCount: 0, bestScore: null, passedAt: null, certNumber: null,
    createdAt: now, updatedAt: now,
  };
  await db.collection('participants').insertOne(p);
  rememberToken(p.token); // новый ученик сразу «свой» для всех процессов сервера
  return { token: p.token, participant: publicParticipant(p, lang) };
});

route('GET', '/api/me', async ({ db, req, lang }) => ({ participant: publicParticipant(await participantByToken(db, req), lang) }));

route('POST', '/api/progress', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  const body = await readJson(req);
  const missionId = String(body.missionId || '');
  const ids = missionsOf(p);
  if (!ids.includes(missionId)) throw new HttpError(400, 'unknownMission');
  const max = Math.max(1, Math.min(100, Math.round(Number(body.max) || 1)));
  const score = Math.max(0, Math.min(max, Math.round(Number(body.score) || 0)));

  const missions = { ...(p.missions || {}) };
  const prev = missions[missionId];
  if (!prev || score / max > prev.score / prev.max) missions[missionId] = { score, max, at: new Date() };
  const counted = ids.filter((id) => missions[id]);
  const xp = counted.reduce((sum, id) => sum + Math.round((missions[id].score / missions[id].max) * 100), 0);
  const missionsDone = counted.length;
  const updated = await db.collection('participants').findOneAndUpdate(
    { _id: p._id },
    { $set: { missions, missionsDone, missionsComplete: missionsDone >= ids.length, level: levelOf(p), xp, updatedAt: new Date() } },
    { returnDocument: 'after' });
  return { participant: publicParticipant(updated, lang) };
});

// ─── Мини-игра «Сейф-пазл»: рейтинг своей школы и Жамбылской области ───────
// Рекорд — participants.gameBest. Рейтинги 1–6 и 7+ классов раздельные (разная сложность).
// Нагрузка: результат приходит в конце раунда (или при выходе с новым рекордом),
// рейтинг запрашивается при входе в игру и в начале раунда, «обгоны» считает браузер.
// Всё общее кэшируется в памяти на GAME_BOARD_TTL: список школы, топ области и отсортированный
// массив всех рекордов уровня (только числа, покрывающий запрос по индексу level + gameBest) —
// по нему место ученика в области находится двоичным поиском, без запроса к базе.
// Приватность (ФИО несовершеннолетних): в своей школе — имя, первая буква фамилии и класс,
// в рейтинге области — имя, первая буква фамилии и школа (или только инициалы и школа —
// настройка game_rating_names). Полностью фамилия не показывается нигде.
// Игра и рейтинг выключаются в настройках (game_enabled, game_rating).
const GAME_MAX_SCORE = 1_000_000; // потолок за раунд: столько честно не набрать, а опечатку и подделку отсечёт
const GAME_BOARD_TTL = 45_000;
const GAME_LIST_LIMIT = 50; // строк во вкладке рейтинга
const GAME_SCHOOL_LIMIT = 1000; // учеников школы в кэше — для места ученика внутри школы

const firstLetter = (s) => [...String(s || '')][0] || '';
const shortName = (p) => `${p.firstName} ${firstLetter(p.lastName)}.`;
const initialsOf = (p) => `${firstLetter(p.firstName)}. ${firstLetter(p.lastName)}.`;
function shortGrade(p, lang) {
  if (p.gradeKind === 'course') return lang === 'kk' ? `${p.grade}-курс` : `${p.grade} курс`;
  if (p.gradeLetter) return `${p.grade} «${p.gradeLetter}»`;
  return lang === 'kk' ? `${p.grade}-сынып` : `${p.grade} кл.`;
}
const sameClass = (a, b) => a.gradeKind === b.gradeKind && String(a.grade) === String(b.grade) && (a.gradeLetter || '') === (b.gradeLetter || '');
// Заведение «нет в списке» хранится без id — сравниваем по району и введённому названию
const schoolQuery = (p) => (p.institutionId
  ? { institutionId: p.institutionId }
  : { institutionId: null, district: p.district || 'taraz', institutionName: p.institutionName });
const schoolKey = (p) => (p.institutionId ? String(p.institutionId) : `o:${p.district || 'taraz'}:${p.institutionName}`);

const gameSchool = (db, p) => cached(`game:school:${levelOf(p)}:${schoolKey(p)}`, GAME_BOARD_TTL, () =>
  db.collection('participants')
    .find({ ...schoolQuery(p), level: levelOf(p), gameBest: { $gt: 0 } },
      { projection: { firstName: 1, lastName: 1, gradeKind: 1, grade: 1, gradeLetter: 1, gameBest: 1 } })
    .sort({ gameBest: -1 }).limit(GAME_SCHOOL_LIMIT).toArray());

const gameTop = (db, level) => cached(`game:top:${level}`, GAME_BOARD_TTL, () =>
  db.collection('participants')
    .find({ level, gameBest: { $gt: 0 } },
      { projection: { firstName: 1, lastName: 1, institutionId: 1, institutionName: 1, institutionNameKk: 1, district: 1, gameBest: 1 } })
    .sort({ gameBest: -1 }).limit(GAME_LIST_LIMIT + 1).toArray());

// Все рекорды уровня по убыванию — только числа (индекс level + gameBest покрывает запрос)
const gameScores = (db, level) => cached(`game:scores:${level}`, GAME_BOARD_TTL, async () =>
  (await db.collection('participants')
    .find({ level, gameBest: { $gt: 0 } }, { projection: { _id: 0, gameBest: 1 } })
    .sort({ gameBest: -1 }).toArray()).map((d) => d.gameBest));

// Сколько чисел в массиве (по убыванию) строго больше x — двоичный поиск
function countAbove(desc, x) {
  let lo = 0;
  let hi = desc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (desc[mid] > x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Вкладка «Моя школа / колледж / вуз» — по типу заведения
const schoolKind = (p) => (['college', 'university', 'other'].includes(p.institutionType) ? p.institutionType : 'school');

route('GET', '/api/game/board', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  const best = p.gameBest || 0;
  const level = levelOf(p);
  const gs = gameSettings(await getSettings(db));
  if (!gs.enabled) throw new HttpError(403, 'gameOff');
  if (!gs.rating) return { rating: false, best, level };
  const regionName = gs.names === 'initials' ? initialsOf : shortName;
  const [school, top, scores] = await Promise.all([gameSchool(db, p), gameTop(db, level), gameScores(db, level)]);
  const me = String(p._id);
  // Себя из списков убираем: браузер вставит строку ученика со свежим рекордом на его место
  const schoolOthers = school.filter((r) => String(r._id) !== me);
  const regionOthers = top.filter((r) => String(r._id) !== me).slice(0, GAME_LIST_LIMIT);
  const regionPlace = best ? countAbove(scores, best) + 1 : null;
  // Кэш мог ещё не увидеть свежий рекорд ученика — тогда считаем его в «из M» сами
  const regionTotal = scores.length + (best && scores[regionPlace - 1] !== best ? 1 : 0);
  return {
    rating: true,
    best,
    level,
    school: {
      kind: schoolKind(p),
      name: institutionOf(p, lang),
      rows: schoolOthers.slice(0, GAME_LIST_LIMIT)
        .map((r) => ({ name: shortName(r), grade: shortGrade(r, lang), score: r.gameBest, classmate: sameClass(r, p) })),
      place: best ? schoolOthers.filter((r) => r.gameBest > best).length + 1 : null,
      total: schoolOthers.length + (best ? 1 : 0),
    },
    region: {
      // Заведение «нет в списке» ученик вписал сам — всей области вместо этого текста
      // показываем только район (текст никто не проверял)
      rows: regionOthers.map((r) => ({
        score: r.gameBest,
        name: regionName(r),
        school: r.institutionId ? (lang === 'kk' && r.institutionNameKk) || r.institutionName : districtName(r.district, lang),
      })),
      place: regionPlace,
      total: regionTotal,
    },
  };
});

// Защита рейтинга от подделанных результатов. Браузер отмечает начало раунда
// (/api/game/start), и сервер не принимает больше очков, чем можно набрать за прошедшее
// время: чтобы «нарисовать» себе 1 000 000, пришлось бы ждать больше 40 минут.
// Бот с пятью «Новыми фигурами» набирает в среднем до ~215 очков за ход, человек ходит
// не чаще раза в секунду, поэтому 400 очков в секунду — с большим запасом.
// Раунд, начатый без связи (сервер не знает начала), — не больше GAME_NO_START_CAP:
// это выше лучшего результата бота в 1 500 длинных раундах (~120 тыс.).
const GAME_POINTS_PER_SEC = 400;
const GAME_GRACE = 10_000;
const GAME_NO_START_CAP = 150_000;
// Отметка начала незаконченного раунда (итог с final ещё не пришёл — например, играли без
// связи) новым раундом не перезаписывается: иначе рекорд того раунда, присланный позже
// (при входе в игру браузер досылает рекорд, набранный без связи), урезался как невозможный.
// Отметка старше GAME_ROUND_KEEP — ставится заново.
const GAME_ROUND_KEEP = 6 * 60 * 60 * 1000;

route('POST', '/api/game/start', async ({ db, req }) => {
  const p = await participantByToken(db, req);
  if (!(p.missionsDone > 0) && !p.certNumber) throw new HttpError(403, 'gameLocked');
  if (!gameSettings(await getSettings(db)).enabled) throw new HttpError(403, 'gameOff');
  if (await rateLimited(db, `gstart:${p._id}`, 60, 10 * 60 * 1000)) throw new HttpError(429, 'tooManyRequests');
  const now = new Date();
  await db.collection('participants').updateOne(
    { _id: p._id, $or: [{ gameRoundAt: { $exists: false } }, { gameRoundAt: { $lt: new Date(now.getTime() - GAME_ROUND_KEEP) } }] },
    { $set: { gameRoundAt: now } });
  return { ok: true };
});

route('POST', '/api/game/score', async ({ db, req }) => {
  const p = await participantByToken(db, req);
  if (!(p.missionsDone > 0) && !p.certNumber) throw new HttpError(403, 'gameLocked');
  if (!gameSettings(await getSettings(db)).enabled) throw new HttpError(403, 'gameOff');
  if (await rateLimited(db, `game:${p._id}`, 30, 10 * 60 * 1000)) throw new HttpError(429, 'tooManyRequests');
  const body = await readJson(req);
  const sent = Number(body.score);
  if (!Number.isInteger(sent) || sent < 0 || sent > GAME_MAX_SCORE) throw new HttpError(400, 'badScore');
  const final = body.final === true; // раунд закончен (иначе — выход посреди раунда с новым рекордом)
  const startedAt = p.gameRoundAt instanceof Date ? p.gameRoundAt.getTime() : 0;
  const allowed = startedAt
    ? Math.min(GAME_MAX_SCORE, GAME_GRACE + Math.floor(((Date.now() - startedAt) / 1000) * GAME_POINTS_PER_SEC))
    : GAME_NO_START_CAP;
  if (sent > allowed) console.warn(`[game] результат ${sent} больше возможного ${allowed}, участник ${p._id} — принято ${allowed}`);
  const score = Math.min(sent, allowed);
  const old = p.gameBest || 0;
  if (score > old || final) {
    const cur = { $ifNull: ['$gameBest', 0] };
    await db.collection('participants').updateOne({ _id: p._id }, [{
      $set: {
        gameBestAt: { $cond: [{ $gt: [score, cur] }, '$$NOW', '$gameBestAt'] },
        gameBest: { $max: [cur, score] },
        gameRounds: { $add: [{ $ifNull: ['$gameRounds', 0] }, final ? 1 : 0] },
        // Раунд закончен — следующий результат без новой отметки начала получит мягкий лимит
        gameRoundAt: final ? '$$REMOVE' : '$gameRoundAt',
      },
    }]);
  }
  return { best: Math.max(old, score) };
});

route('POST', '/api/quiz/start', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  if (!missionsComplete(p)) throw new HttpError(403, 'missionsFirst');
  if (await rateLimited(db, `quiz:${p._id}`, 30, 60 * 60 * 1000)) throw new HttpError(429, 'tooManyAttempts');

  // Для 1–6 классов — вопросы без дропперства и без сложных технических тем
  const junior = levelOf(p) === 'junior';
  const picked = [];
  for (const [topic, n] of Object.entries(junior ? JUNIOR_TOPIC_PLAN : TOPIC_PLAN)) {
    picked.push(...shuffle(QUESTIONS.filter((q) => q.topic === topic && (!junior || q.junior !== false))).slice(0, n));
  }
  const plan = shuffle(picked).map((q) => ({ id: q.id, order: shuffle(q.options.map((_, i) => i)) }));
  const { insertedId } = await db.collection('attempts').insertOne({
    participantId: p._id,
    institutionType: p.institutionType,
    district: p.district || 'taraz',
    participantCreatedAt: p.createdAt,
    questions: plan,
    answers: null,
    results: null,
    score: null,
    startedAt: new Date(),
    finishedAt: null,
  });

  return {
    attemptId: String(insertedId),
    passScore: passScoreOf(await getSettings(db)),
    questions: plan.map(({ id, order }) => {
      const q = localQuestion(QUESTIONS_BY_ID.get(id), lang);
      return { topic: q.topic, q: q.q, options: order.map((i) => q.options[i]) };
    }),
  };
});

route('POST', '/api/quiz/submit', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  const body = await readJson(req);
  const attemptId = toObjectId(body.attemptId);
  const attempts = db.collection('attempts');
  const attempt = attemptId && await attempts.findOne({ _id: attemptId, participantId: p._id });
  if (!attempt) throw new HttpError(404, 'attemptNotFound');
  if (attempt.finishedAt) throw new HttpError(409, 'attemptFinished');

  const answers = Array.isArray(body.answers) ? body.answers : [];
  let score = 0;
  const review = attempt.questions.map(({ id, order }, i) => {
    const base = QUESTIONS_BY_ID.get(id);
    const q = localQuestion(base, lang);
    const chosen = Number.isInteger(answers[i]) && answers[i] >= 0 && answers[i] < order.length ? answers[i] : null;
    const correctShown = order.indexOf(base.correct);
    const ok = chosen === correctShown;
    if (ok) score += 1;
    return { id, q: q.q, topic: q.topic, options: order.map((k) => q.options[k]), chosen, correct: correctShown, ok, explain: q.explain };
  });

  // Завершаем попытку атомарно: повторная отправка той же попытки не засчитается
  const now = new Date();
  const closed = await attempts.updateOne(
    { _id: attempt._id, finishedAt: null },
    { $set: { answers: review.map((r) => r.chosen), results: review.map((r) => ({ id: r.id, ok: r.ok })), score, finishedAt: now } });
  if (!closed.modifiedCount) throw new HttpError(409, 'attemptFinished');

  const settings = await getSettings(db);
  const need = passScoreOf(settings);
  const passed = score >= need;
  const participants = db.collection('participants');
  await participants.updateOne({ _id: p._id }, { $inc: { attemptsCount: 1 }, $max: { bestScore: score }, $set: { updatedAt: now, lang } });
  if (passed && !p.certNumber) {
    const prefix = (settings.cert_prefix || 'SB').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SB';
    const seq = await nextSeq(db, 'cert');
    const cert = `${prefix}-${now.getFullYear()}-${String(seq).padStart(5, '0')}-${crypto.randomInt(1000, 10000)}`;
    await participants.updateOne({ _id: p._id, certNumber: null }, { $set: { certNumber: cert, passedAt: now } });
  }
  const updated = await participants.findOne({ _id: p._id });
  return {
    score, total: review.length, passScore: need, passed,
    review: review.map(({ id, ...r }) => r),
    participant: publicParticipant(updated, lang),
  };
});

route('GET', '/api/certificate', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  if (!p.certNumber) throw new HttpError(403, 'certAfterTest');
  return certificateData(p, await getSettings(db), lang);
});

route('GET', '/api/verify', async ({ db, req, url, lang }) => {
  // 300 в минуту: проверять сертификаты может целый класс с одного школьного адреса,
  // а от потока запросов защищает общий запас адреса (FLOOD.address)
  if (await rateLimited(db, `verify:${clientIp(req)}`, 300, 60 * 1000)) throw new HttpError(429, 'tooManyRequests');
  const n = String(url.searchParams.get('n') || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{6,40}$/.test(n)) return { found: false };
  const p = await db.collection('participants').findOne({ certNumber: n });
  if (!p) return { found: false };
  // Для защиты данных несовершеннолетних показываем фамилию частично и инициалы
  const ln = p.lastName;
  const masked = (ln.length <= 2 ? ln[0] + '*' : ln.slice(0, 2) + '*'.repeat(Math.min(ln.length - 2, 6)))
    + ` ${p.firstName[0]}.` + (p.middleName ? ` ${p.middleName[0]}.` : '');
  return {
    found: true,
    name: masked,
    institution: institutionOf(p, lang),
    gradeLabel: gradeLabel(p, lang),
    score: p.bestScore,
    total: QUIZ_SIZE,
    passedAt: p.passedAt,
    number: p.certNumber,
    eventTitle: setting(await getSettings(db), 'event_title', lang),
  };
});

// ─── Ошибки в браузерах учеников ───────────────────────────────────────────
// public/js/ui.js сообщает об ошибках кода (не о плохой связи) — одной строкой в журнал
// сервера: docker compose logs app | grep '\[client\]'. Без личных данных: текст ошибки,
// файл и строка, экран (#/map) и браузер. База не используется; одинаковые ошибки
// склеиваются, и в журнал попадает не больше CLIENT_ERR_PER_MIN строк в минуту на процесс —
// даже если ошибка у всех учеников сразу, журнал не переполнится.
const CLIENT_ERR_PER_MIN = 60;
const clientErrors = { minute: 0, lines: 0, dropped: 0, seen: new Map() };

route('POST', '/api/client-error', async ({ req }) => {
  const b = await readJson(req, 4 * 1024);
  const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, n);
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== clientErrors.minute) {
    const repeats = [...clientErrors.seen.values()].reduce((sum, n) => sum + n - 1, 0);
    if (repeats || clientErrors.dropped) {
      console.warn(`[client] за прошлую минуту: повторов уже записанных ошибок — ${repeats}, не записано из-за лимита — ${clientErrors.dropped}`);
    }
    Object.assign(clientErrors, { minute, lines: 0, dropped: 0, seen: new Map() });
  }
  const msg = clip(b.msg, 300);
  const src = clip(b.src, 200);
  const key = `${msg}@${src}`;
  const n = (clientErrors.seen.get(key) || 0) + 1;
  if (clientErrors.seen.size < 500 || n > 1) clientErrors.seen.set(key, n);
  if (n === 1 && clientErrors.lines < CLIENT_ERR_PER_MIN) {
    clientErrors.lines += 1;
    console.warn(`[client] ${clip(b.kind, 12)}: ${msg} @ ${src} | ${clip(b.page, 40)} | ${clip(req.headers['user-agent'], 160)}`);
  } else if (n === 1) {
    clientErrors.dropped += 1;
  }
  return { ok: true };
});

// ─── Админ-панель ──────────────────────────────────────────────────────────
// Пароль задаётся переменной окружения ADMIN_PASSWORD. Сессия — подписанная cookie
// (без хранения на сервере); смена пароля автоматически завершает все сессии.

// В админке — персональные данные детей всей области, поэтому на боевом сервере
// (NODE_ENV=production, так в Docker-образе) короткий пароль не принимается
const ADMIN_MIN_PASSWORD = 12;

function adminKey() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new HttpError(503, 'Админ-панель не настроена: задайте переменную окружения ADMIN_PASSWORD');
  if (process.env.NODE_ENV === 'production' && pw.length < ADMIN_MIN_PASSWORD) {
    throw new HttpError(503, `Пароль админки слишком короткий: нужно не меньше ${ADMIN_MIN_PASSWORD} символов (сгенерировать: openssl rand -hex 24)`);
  }
  return sha256(`saq-bol-session:${pw}`);
}

const sign = (exp) => crypto.createHmac('sha256', adminKey()).update(`admin:${exp}`).digest('base64url');

function isHttps(req) {
  return ON_VERCEL || req.socket?.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));
}

// Cookie вида «срок.подпись»; signer бросает исключение, если пароль не задан
function validSession(cookie, signer) {
  try {
    const [exp, sig] = String(cookie || '').split('.');
    const expected = exp ? Buffer.from(signer(exp)) : null;
    return !!(expected && sig && Buffer.from(sig).length === expected.length
      && crypto.timingSafeEqual(Buffer.from(sig), expected) && Number(exp) > Date.now());
  } catch {
    return false; // пароль не задан
  }
}

function hasAdminSession(req) {
  return validSession(parseCookies(req).sb_admin, sign);
}

function requireAdmin(req) {
  if (!hasAdminSession(req)) {
    adminKey(); // 503 с понятной причиной, если пароль не задан или слишком короткий
    throw new HttpError(401, 'Требуется вход в админ-панель');
  }
  // Защита от CSRF: изменяющие запросы должны идти через fetch с этим заголовком
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Запрос отклонён');
}

route('POST', '/api/admin/login', async ({ db, req, res }) => {
  adminKey(); // 503, если пароль не задан
  if (await rateLimited(db, `login:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
    throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут');
  }
  const body = await readJson(req);
  if (!crypto.timingSafeEqual(sha256(body.password ?? ''), sha256(process.env.ADMIN_PASSWORD))) {
    // В журнале сервера видно, если пароль подбирают
    console.warn(`[admin] неверный пароль, ip ${clientIp(req)}`);
    throw new HttpError(401, 'Неверный пароль');
  }
  const exp = Date.now() + ADMIN_SESSION_TTL;
  res.setHeader('Set-Cookie',
    `sb_admin=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL / 1000}${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});

route('POST', '/api/admin/logout', async ({ req, res }) => {
  res.setHeader('Set-Cookie', `sb_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});

admin('GET', '/api/admin/me', async () => ({ ok: true }));

const STATUS_LABELS = {
  passed: 'Сертификат получен',
  failed: 'Тест не сдан',
  missions_done: 'Миссии пройдены',
  in_progress: 'Проходит миссии',
  registered: 'Только регистрация',
};

const STATUS_QUERY = {
  passed: { certNumber: { $type: 'string' } },
  failed: { certNumber: null, attemptsCount: { $gt: 0 } },
  missions_done: { certNumber: null, attemptsCount: 0, missionsComplete: true },
  in_progress: { certNumber: null, attemptsCount: 0, missionsDone: { $gt: 0 }, missionsComplete: { $ne: true } },
  registered: { certNumber: null, attemptsCount: 0, missionsDone: 0 },
};

const TYPE_LABELS = { school: 'Школа', college: 'Колледж', university: 'Вуз', other: 'Другое' };

// Дата YYYY-MM-DD в местном времени → момент начала этого дня в UTC
function localDay(day, addDays = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  d.setUTCHours(d.getUTCHours() - TZ_OFFSET);
  return d;
}

function dateRange(params) {
  const range = {};
  const from = localDay(params.get('from'));
  const to = localDay(params.get('to'), 1);
  if (from) range.$gte = from;
  if (to) range.$lt = to;
  return Object.keys(range).length ? range : null;
}

// Панель ДЭР: статусы только по миссиям — ни поиском, ни фильтром нельзя узнать, у кого есть сертификат
const DER_STATUS_LABELS = {
  missions_done: 'Миссии пройдены',
  in_progress: 'Проходит миссии',
  registered: 'Только регистрация',
};
const DER_STATUS_QUERY = {
  missions_done: { missionsComplete: true },
  in_progress: { missionsDone: { $gt: 0 }, missionsComplete: { $ne: true } },
  registered: { missionsDone: 0 },
};
const derStatusOf = (p) => (missionsComplete(p) ? 'missions_done' : p.missionsDone > 0 ? 'in_progress' : 'registered');

// der — для панели ДЭР: без поиска по № сертификата и со статусами только по миссиям
function buildFilter(params, { der = false } = {}) {
  const and = [];
  const q = String(params.get('q') || '').trim().slice(0, 100);
  if (q) {
    const byName = { search: { $regex: escapeRegex(q.toLowerCase()) } };
    and.push(der ? byName : { $or: [byName, { certNumber: { $regex: escapeRegex(q.toUpperCase()) } }] });
  }
  const inst = params.get('institution');
  if (inst === 'other') and.push({ institutionId: null });
  else if (inst) and.push({ institutionId: toObjectId(inst) || 'none' });
  const type = params.get('type');
  if (type && TYPE_LABELS[type]) and.push({ institutionType: type });
  const district = params.get('district');
  if (district && DISTRICTS_BY_ID.has(district)) and.push({ district });
  const status = params.get('status');
  const statuses = der ? DER_STATUS_QUERY : STATUS_QUERY;
  if (status && Object.hasOwn(statuses, status)) and.push(statuses[status]);
  const grade = params.get('grade');
  if (grade && /^\d{1,2}$/.test(grade)) and.push({ grade });
  const range = dateRange(params);
  if (range) and.push({ createdAt: range });
  return and.length ? { $and: and } : {};
}

function adminRow(p) {
  return {
    id: String(p._id),
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName,
    institution: p.institutionName,
    institutionId: p.institutionId ? String(p.institutionId) : null,
    institutionType: p.institutionType,
    district: p.district || 'taraz',
    districtName: districtName(p.district),
    gradeLabel: gradeLabel(p),
    grade: p.grade,
    level: levelOf(p),
    missionIds: missionsOf(p),
    missionsDone: p.missionsDone,
    missionsTotal: missionsOf(p).length,
    xp: p.xp,
    attemptsCount: p.attemptsCount,
    bestScore: p.bestScore,
    status: statusOf(p),
    certNumber: p.certNumber,
    passedAt: p.passedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// Строка участника для панели ДЭР — только эти поля (без теста и сертификата)
function derRow(p) {
  return {
    id: String(p._id),
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName,
    institution: p.institutionName,
    institutionId: p.institutionId ? String(p.institutionId) : null,
    institutionType: p.institutionType,
    district: p.district || 'taraz',
    districtName: districtName(p.district),
    gradeLabel: gradeLabel(p),
    grade: p.grade,
    level: levelOf(p),
    missionIds: missionsOf(p),
    missionsDone: p.missionsDone,
    missionsTotal: missionsOf(p).length,
    xp: p.xp,
    status: derStatusOf(p),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const round1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

// Завершённые попытки теста с теми же фильтрами (период — по дате регистрации участника)
function attemptsFilter(params) {
  const am = { finishedAt: { $ne: null } };
  const type = params.get('type');
  if (type && TYPE_LABELS[type]) am.institutionType = type;
  const district = params.get('district');
  if (district && DISTRICTS_BY_ID.has(district)) am.district = district;
  const range = dateRange(params);
  if (range) am.participantCreatedAt = range;
  return am;
}
const isPassed = { $cond: [{ $eq: [{ $type: '$certNumber' }, 'string'] }, 1, 0] };
const isDone = { $cond: [{ $eq: ['$missionsComplete', true] }, 1, 0] };
const testedScore = { $cond: [{ $gt: ['$attemptsCount', 0] }, '$bestScore', null] };
const instKey = { $ifNull: [{ $toString: '$institutionId' }, { $concat: ['o:', '$institutionName'] }] };

// Панель ДЭР могут держать открытой сразу несколько сотрудников, а аналитика обновляется
// каждые 30 секунд. На базе в 100+ тыс. участников обзор и аналитика — секунды работы базы,
// поэтому одинаковые запросы панели ДЭР считаются не чаще раза в 30 секунд (админка — как раньше)
const DER_CACHE_MS = 30_000;
const derCache = new Map();
function derCached(name, handler) {
  return (c) => {
    if (!c.der) return handler(c);
    const key = `${name}:${c.url.search}`;
    const now = Date.now();
    const hit = derCache.get(key);
    if (hit && now - hit.at < DER_CACHE_MS) return hit.promise;
    for (const [k, v] of derCache) if (now - v.at >= DER_CACHE_MS) derCache.delete(k); // устаревшее не копим
    const promise = Promise.resolve().then(() => handler(c));
    derCache.set(key, { at: now, promise });
    promise.catch(() => { if (derCache.get(key)?.promise === promise) derCache.delete(key); });
    return promise;
  };
}

panel('GET', 'stats', derCached('stats', async ({ db, url, der }) => {
  const match = buildFilter(url.searchParams, { der });
  const P = db.collection('participants');

  const [totalsRow] = await P.aggregate([
    { $match: match },
    { $group: {
      _id: null,
      participants: { $sum: 1 },
      missionsDone: { $sum: isDone },
      tested: { $sum: { $cond: [{ $gt: ['$attemptsCount', 0] }, 1, 0] } },
      passed: { $sum: isPassed },
      avgScore: { $avg: testedScore },
      insts: { $addToSet: instKey },
    } },
  ]).toArray();
  const totals = totalsRow
    ? { participants: totalsRow.participants, missionsDone: totalsRow.missionsDone, tested: totalsRow.tested, passed: totalsRow.passed, avgScore: round1(totalsRow.avgScore), institutions: totalsRow.insts.length }
    : { participants: 0, missionsDone: 0, tested: 0, passed: 0, avgScore: null, institutions: 0 };

  const byInstitution = (await P.aggregate([
    { $match: match },
    { $group: {
      _id: instKey,
      id: { $first: '$institutionId' },
      name: { $last: '$institutionName' },
      type: { $first: '$institutionType' },
      district: { $first: '$district' },
      participants: { $sum: 1 },
      missionsDone: { $sum: isDone },
      passed: { $sum: isPassed },
      avgScore: { $avg: testedScore },
      lastActivity: { $max: '$updatedAt' },
    } },
    { $sort: { participants: -1, name: 1 } },
  ]).toArray()).map((r) => ({ ...r, _id: undefined, id: r.id ? String(r.id) : null, districtName: districtName(r.district), avgScore: round1(r.avgScore) }));

  // По районам: все районы в порядке справочника, даже если участников пока нет
  const districtRows = await P.aggregate([
    { $match: match },
    { $group: {
      _id: { $ifNull: ['$district', 'taraz'] },
      participants: { $sum: 1 },
      missionsDone: { $sum: isDone },
      passed: { $sum: isPassed },
      avgScore: { $avg: testedScore },
      insts: { $addToSet: instKey },
    } },
  ]).toArray();
  const byDistrict = DISTRICTS.map((d) => {
    const r = districtRows.find((x) => x._id === d.id);
    return {
      id: d.id, name: d.ru,
      participants: r ? r.participants : 0, missionsDone: r ? r.missionsDone : 0, passed: r ? r.passed : 0,
      avgScore: r ? round1(r.avgScore) : null, institutions: r ? r.insts.length : 0,
    };
  });

  const byDay = (await P.aggregate([
    { $match: match },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
      participants: { $sum: 1 },
      passed: { $sum: isPassed },
    } },
    { $sort: { _id: -1 } },
    { $limit: 31 },
  ]).toArray()).map((r) => ({ day: r._id, participants: r.participants, passed: r.passed })).reverse();

  const byGrade = (await P.aggregate([
    { $match: match },
    { $group: { _id: { kind: '$gradeKind', grade: '$grade' }, participants: { $sum: 1 }, passed: { $sum: isPassed } } },
  ]).toArray())
    .map((r) => ({ kind: r._id.kind, grade: r._id.grade, participants: r.participants, passed: r.passed }))
    .sort((a, b) => (a.kind === b.kind ? Number(a.grade) - Number(b.grade) : a.kind === 'course' ? -1 : 1));

  // Панель ДЭР: только перечисленные поля — без теста и сертификатов
  if (der) {
    return {
      totals: { participants: totals.participants, institutions: totals.institutions },
      byDistrict: byDistrict.map((r) => ({ id: r.id, name: r.name, participants: r.participants, institutions: r.institutions })),
      byInstitution: byInstitution.map((r) => ({
        id: r.id, name: r.name, type: r.type, district: r.district, districtName: r.districtName,
        participants: r.participants, lastActivity: r.lastActivity,
      })),
      byDay: byDay.map((r) => ({ day: r.day, participants: r.participants })),
      byGrade: byGrade.map((r) => ({ kind: r.kind, grade: r.grade, participants: r.participants })),
      typeLabels: TYPE_LABELS,
    };
  }

  // Аналитика ответов: какие вопросы и темы даются хуже всего
  const qRows = await db.collection('attempts').aggregate([
    { $match: attemptsFilter(url.searchParams) },
    { $unwind: '$results' },
    { $group: { _id: '$results.id', shown: { $sum: 1 }, correct: { $sum: { $cond: ['$results.ok', 1, 0] } } } },
  ]).toArray();
  const questions = qRows.filter((r) => QUESTIONS_BY_ID.has(r._id)).map((r) => {
    const q = QUESTIONS_BY_ID.get(r._id);
    return { id: r._id, q: q.q, topic: TOPIC_LABELS[q.topic], shown: r.shown, correctPct: Math.round((r.correct / r.shown) * 100) };
  }).sort((a, b) => a.correctPct - b.correctPct);
  const topics = Object.entries(TOPIC_LABELS).map(([key, label]) => {
    let shown = 0;
    let correct = 0;
    for (const r of qRows) {
      if (QUESTIONS_BY_ID.get(r._id)?.topic === key) { shown += r.shown; correct += r.correct; }
    }
    return { topic: label, shown, correctPct: shown ? Math.round((correct / shown) * 100) : null };
  });

  return { totals, byDistrict, byInstitution, byDay, byGrade, questions, topics, statusLabels: STATUS_LABELS, typeLabels: TYPE_LABELS };
}));

// ─── Аналитика ─────────────────────────────────────────────────────────────
// Воронка прохождения, миссии, результаты теста, время, языки и «живые» показатели
// для дня мероприятия. Фильтры — как у обзора.

function median(values) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

const localToday = () => new Date(Date.now() + TZ_OFFSET * 3600 * 1000).toISOString().slice(0, 10);
const FUNNEL_KEYS = ['registered', 'started', 'allMissions', 'tested', 'certified'];
const DER_FUNNEL_KEYS = ['registered', 'started'];
const RECENT_BUCKET_MS = 10 * 60 * 1000;
const RECENT_BUCKETS = 18; // последние 3 часа по 10 минут

panel('GET', 'analytics', derCached('analytics', async ({ db, url, der }) => {
  const params = url.searchParams;
  const match = buildFilter(params, { der });
  const P = db.collection('participants');
  const passScore = passScoreOf(await getSettings(db));
  const hasMission = (id) => ({ $eq: [{ $type: `$missions.${id}` }, 'object'] });
  const level = { $ifNull: ['$level', 'senior'] };

  // «Живые» показатели — без учёта периода: сегодня и последние минуты
  const liveParams = new URLSearchParams(params);
  liveParams.delete('from');
  liveParams.delete('to');
  const live = buildFilter(liveParams, { der });
  const liveAnd = (extra) => ({ $and: [live, extra] });
  const now = Date.now();
  const lastBucket = Math.floor(now / RECENT_BUCKET_MS);
  const firstBucket = lastBucket - RECENT_BUCKETS + 1;
  const since = new Date(firstBucket * RECENT_BUCKET_MS);
  const bucketOf = (field) => ({ $floor: { $divide: [{ $toLong: field }, RECENT_BUCKET_MS] } });

  const levelGroup = {
    _id: level,
    registered: { $sum: 1 },
    started: { $sum: { $cond: [{ $gt: ['$missionsDone', 0] }, 1, 0] } },
    allMissions: { $sum: isDone },
    tested: { $sum: { $cond: [{ $gt: ['$attemptsCount', 0] }, 1, 0] } },
    certified: { $sum: isPassed },
  };
  for (const id of MISSION_IDS) {
    levelGroup[`${id}_n`] = { $sum: { $cond: [hasMission(id), 1, 0] } };
    levelGroup[`${id}_pct`] = { $sum: { $cond: [hasMission(id), { $divide: [`$missions.${id}.score`, `$missions.${id}.max`] }, 0] } };
  }

  const [[f], activeNow, regToday, certToday, recentReg, recentCert, tested] = await Promise.all([
    P.aggregate([
      { $match: match },
      { $facet: {
        byLevel: [{ $group: levelGroup }],
        byLang: [{ $group: { _id: { $ifNull: ['$lang', 'ru'] }, n: { $sum: 1 }, certified: { $sum: isPassed } } }],
        stuck: [{ $match: { missionsComplete: { $ne: true } } }, { $group: { _id: '$missionsDone', n: { $sum: 1 } } }],
        scores: [{ $match: { attemptsCount: { $gt: 0 } } }, { $group: { _id: '$bestScore', n: { $sum: 1 } } }],
        hours: [{ $group: { _id: { $hour: { date: '$createdAt', timezone: TZ } }, n: { $sum: 1 } } }],
        certHours: [{ $match: { passedAt: { $type: 'date' } } }, { $group: { _id: { $hour: { date: '$passedAt', timezone: TZ } }, n: { $sum: 1 } } }],
        toCert: [{ $match: { passedAt: { $type: 'date' } } }, { $project: { _id: 0, m: { $divide: [{ $subtract: ['$passedAt', '$createdAt'] }, 60000] } } }],
      } },
    ]).toArray(),
    P.countDocuments(liveAnd({ updatedAt: { $gte: new Date(now - 10 * 60 * 1000) } })),
    P.countDocuments(liveAnd({ createdAt: { $gte: localDay(localToday()) } })),
    der ? 0 : P.countDocuments(liveAnd({ passedAt: { $gte: localDay(localToday()) } })),
    P.aggregate([{ $match: liveAnd({ createdAt: { $gte: since } }) }, { $group: { _id: bucketOf('$createdAt'), n: { $sum: 1 } } }]).toArray(),
    der ? [] : P.aggregate([{ $match: liveAnd({ passedAt: { $gte: since } }) }, { $group: { _id: bucketOf('$passedAt'), n: { $sum: 1 } } }]).toArray(),
    // Попытки теста каждого участника по порядку — для «сдал с первого раза» и времени теста
    der ? [] : P.aggregate([
      { $match: { $and: [match, { attemptsCount: { $gt: 0 } }] } },
      { $project: { _id: 1 } },
      { $lookup: {
        from: 'attempts', localField: '_id', foreignField: 'participantId', as: 'a',
        pipeline: [{ $match: { finishedAt: { $ne: null } } }, { $sort: { finishedAt: 1 } }, { $project: { _id: 0, score: 1, startedAt: 1, finishedAt: 1 } }],
      } },
    ]).toArray(),
  ]);

  // Итоги по версиям квеста (облегчённая 1–6 кл. и полная)
  const zero = () => Object.fromEntries([...FUNNEL_KEYS, ...MISSION_IDS.flatMap((id) => [`${id}_n`, `${id}_pct`])].map((k) => [k, 0]));
  const lv = { junior: zero(), senior: zero() };
  for (const r of f.byLevel) {
    const target = lv[r._id === 'junior' ? 'junior' : 'senior'];
    for (const k of Object.keys(target)) target[k] += r[k] || 0;
  }
  const both = (k) => lv.junior[k] + lv.senior[k];
  const countOf = (rows, key) => rows.find((r) => r._id === key)?.n || 0;

  const missions = MISSION_IDS.map((id) => {
    const inLevels = Object.keys(MISSION_SETS).filter((l) => MISSION_SETS[l].includes(id));
    const done = both(`${id}_n`);
    return {
      id,
      seniorOnly: !inLevels.includes('junior'),
      eligible: inLevels.reduce((sum, l) => sum + lv[l].registered, 0),
      done,
      avgPct: done ? Math.round((both(`${id}_pct`) / done) * 100) : null,
    };
  });

  let firstTry = 0;
  let attemptsTotal = 0;
  let testedN = 0;
  const toPass = [0, 0, 0]; // с 1-й, 2-й, 3-й и более попытки
  const testMinutes = [];
  for (const p of tested) {
    if (!p.a.length) continue;
    testedN += 1;
    attemptsTotal += p.a.length;
    if (p.a[0].score >= passScore) firstTry += 1;
    const k = p.a.findIndex((a) => a.score >= passScore);
    if (k >= 0) toPass[Math.min(2, k)] += 1;
    for (const a of p.a) testMinutes.push((a.finishedAt - a.startedAt) / 60000);
  }

  const out = {
    generatedAt: new Date(),
    passScore,
    quizSize: QUIZ_SIZE,
    live: {
      activeNow, regToday, certToday,
      recent: Array.from({ length: RECENT_BUCKETS }, (_, i) => {
        const b = firstBucket + i;
        return { at: new Date(b * RECENT_BUCKET_MS), reg: countOf(recentReg, b), cert: countOf(recentCert, b) };
      }),
    },
    funnel: FUNNEL_KEYS.map((key) => ({ key, n: both(key), junior: lv.junior[key], senior: lv.senior[key] })),
    missions,
    stuck: Array.from({ length: MISSION_IDS.length }, (_, done) => ({ done, n: countOf(f.stuck, done) })),
    scores: Array.from({ length: QUIZ_SIZE + 1 }, (_, score) => ({ score, n: countOf(f.scores, score) })),
    tests: {
      tested: testedN,
      firstTry,
      avgAttempts: testedN ? round1(attemptsTotal / testedN) : null,
      medianTestMin: round1(median(testMinutes)),
      toPass,
    },
    medianToCertMin: round1(median(f.toCert.map((x) => x.m))),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, reg: countOf(f.hours, hour), cert: countOf(f.certHours, hour) })),
    langs: ['kk', 'ru'].map((l) => ({ lang: l, n: countOf(f.byLang, l), certified: f.byLang.find((r) => r._id === l)?.certified || 0 })),
    levels: ['junior', 'senior'].map((l) => ({ level: l, n: lv[l].registered, certified: lv[l].certified })),
  };
  if (!der) return out;
  // Панель ДЭР: только перечисленные поля — без теста и сертификатов
  return {
    generatedAt: out.generatedAt,
    live: { activeNow, regToday, recent: out.live.recent.map((r) => ({ at: r.at, reg: r.reg })) },
    funnel: out.funnel.filter((r) => DER_FUNNEL_KEYS.includes(r.key)),
    missions,
    stuck: out.stuck,
    hours: out.hours.map((r) => ({ hour: r.hour, reg: r.reg })),
    langs: out.langs.map((r) => ({ lang: r.lang, n: r.n })),
    levels: out.levels.map((r) => ({ level: r.level, n: r.n })),
  };
}));

const SORTS = {
  created: { createdAt: -1 },
  name: { lastName: 1, firstName: 1 },
  institution: { institutionName: 1, lastName: 1 },
  score: { bestScore: -1, createdAt: -1 },
};
const RU = { locale: 'ru', numericOrdering: true };

panel('GET', 'participants', async ({ db, url, der }) => {
  const filter = buildFilter(url.searchParams, { der });
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const size = Math.min(200, Math.max(10, Number(url.searchParams.get('size')) || 50));
  const sortKey = url.searchParams.get('sort');
  // В панели ДЭР нет сортировки по результату теста
  const sort = (Object.hasOwn(SORTS, sortKey) && !(der && sortKey === 'score') && SORTS[sortKey]) || SORTS.created;
  const P = db.collection('participants');
  const [total, rows] = await Promise.all([
    P.countDocuments(filter),
    P.find(filter).sort(sort).collation(RU).skip((page - 1) * size).limit(size).toArray(),
  ]);
  return der
    ? { total, page, size, rows: rows.map(derRow), statusLabels: DER_STATUS_LABELS }
    : { total, page, size, rows: rows.map(adminRow), statusLabels: STATUS_LABELS };
});

panel('GET', /participants\/([a-f0-9]{24})$/, async ({ db, m, der }) => {
  const p = await db.collection('participants').findOne({ _id: toObjectId(m[1]) });
  if (!p) throw new HttpError(404, 'Участник не найден');
  if (der) return { participant: { ...derRow(p), missions: p.missions || {}, lang: p.lang || 'ru' } };
  const attempts = (await db.collection('attempts').find({ participantId: p._id }).sort({ _id: -1 }).toArray())
    .map((a) => ({ id: String(a._id), score: a.score, startedAt: a.startedAt, finishedAt: a.finishedAt }));
  return {
    participant: { ...adminRow(p), missions: p.missions || {}, lang: p.lang || 'ru' },
    attempts,
    certificates: p.certNumber ? await getSettings(db).then((s) => ({ ru: certificateData(p, s, 'ru'), kk: certificateData(p, s, 'kk') })) : null,
  };
});

admin('DELETE', /^\/api\/admin\/participants\/([a-f0-9]{24})$/, async ({ db, m }) => {
  const id = toObjectId(m[1]);
  const { deletedCount } = await db.collection('participants').deleteOne({ _id: id });
  if (!deletedCount) throw new HttpError(404, 'Участник не найден');
  await db.collection('attempts').deleteMany({ participantId: id });
  return { ok: true };
});

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // защита от формул в Excel
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localDateTime(d) {
  if (!d) return '';
  return new Date(new Date(d).getTime() + TZ_OFFSET * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

// Только поля, нужные для выгрузки (без токенов, ответов миссий и т. п.)
const EXPORT_FIELDS = {
  _id: 0, createdAt: 1, lastName: 1, firstName: 1, middleName: 1, district: 1, institutionName: 1, institutionType: 1,
  gradeKind: 1, grade: 1, gradeLetter: 1, level: 1, missionsDone: 1, missionsComplete: 1, xp: 1,
};
const EXPORT_TEST_FIELDS = { attemptsCount: 1, bestScore: 1, certNumber: 1, passedAt: 1 };

// Ждём, пока ответ уйдёт клиенту (или клиент закроет соединение)
const drained = (res) => new Promise((resolve) => {
  const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
  res.once('drain', done);
  res.once('close', done);
});

// Выгрузка для Excel. Участников десятки тысяч, поэтому строки читаются из базы порциями
// и сразу отправляются: память сервера не растёт, а остальные запросы учеников не ждут
panel('GET', 'export.csv', async ({ db, url, res, der }) => {
  const cursor = db.collection('participants').find(buildFilter(url.searchParams, { der }))
    .project(der ? EXPORT_FIELDS : { ...EXPORT_FIELDS, ...EXPORT_TEST_FIELDS })
    .sort({ district: 1, institutionName: 1, lastName: 1, firstName: 1 }).collation(RU).allowDiskUse(true).batchSize(2000);
  const header = ['№', 'Дата регистрации', 'Фамилия', 'Имя', 'Отчество', 'Город / район', 'Учебное заведение', 'Тип', 'Класс / курс',
    'Версия квеста', 'Миссий пройдено', 'Очки (XP)',
    ...(der ? ['Статус'] : ['Попыток теста', `Лучший результат (из ${QUIZ_SIZE})`, 'Статус', '№ сертификата', 'Дата сертификата'])];
  const row = (p, i) => [i + 1, localDateTime(p.createdAt), p.lastName, p.firstName, p.middleName, districtName(p.district), p.institutionName,
    TYPE_LABELS[p.institutionType] || p.institutionType, gradeLabel(p),
    levelOf(p) === 'junior' ? 'Облегчённая (1–6 кл.)' : 'Полная', `${p.missionsDone} из ${missionsOf(p).length}`, p.xp,
    ...(der
      ? [DER_STATUS_LABELS[derStatusOf(p)]]
      : [p.attemptsCount, p.bestScore ?? '', STATUS_LABELS[statusOf(p)], p.certNumber ?? '', localDateTime(p.passedAt)])]
    .map(csvCell).join(';');

  try {
    // Первая порция — до заголовков ответа: если база недоступна, админка получит понятную ошибку
    const first = await cursor.hasNext();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="uchastniki-${localDateTime(new Date()).slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    let chunk = '﻿' + header.map(csvCell).join(';');
    let i = 0;
    if (first) {
      for await (const p of cursor) {
        chunk += '\r\n' + row(p, i++);
        if (i % 1000 === 0) {
          if (!res.write(chunk)) await drained(res);
          chunk = '';
          if (res.destroyed) return undefined; // выгрузку отменили
        }
      }
    }
    res.end(chunk);
  } finally {
    await cursor.close().catch(() => {});
  }
  return undefined;
});

// ─── Панель ДЭР (/der) ─────────────────────────────────────────────────────
// Та же админка, но без итогового теста и сертификатов: обзор, аналитика, участники
// и учебные заведения — только просмотр. Свой пароль DER_PASSWORD. Баллы теста, попытки,
// статус «сертификат получен» и номера сертификатов сервер этой панели не отдаёт вовсе —
// их нет ни в ответах, ни в выгрузке, ни в поиске и фильтрах (см. derOnly ниже в обработчиках).
// Администратор, вошедший в /admin, открывает /der без второго пароля.

function derKey() {
  const pw = process.env.DER_PASSWORD;
  if (!pw) throw new HttpError(503, 'Панель ДЭР не настроена: задайте переменную окружения DER_PASSWORD');
  if (process.env.NODE_ENV === 'production' && pw.length < ADMIN_MIN_PASSWORD) {
    throw new HttpError(503, `Пароль DER_PASSWORD слишком короткий: нужно не меньше ${ADMIN_MIN_PASSWORD} символов (сгенерировать: openssl rand -hex 24)`);
  }
  return sha256(`saq-bol-der:${pw}`);
}

const signDer = (exp) => crypto.createHmac('sha256', derKey()).update(`der:${exp}`).digest('base64url');

function hasDerSession(req) {
  return validSession(parseCookies(req).sb_der, signDer);
}

function requireDer(req) {
  if (hasDerSession(req) || hasAdminSession(req)) return;
  derKey(); // 503 с понятной причиной, если пароль не задан или слишком короткий
  throw new HttpError(401, 'Требуется вход');
}

route('POST', '/api/der/login', async ({ db, req, res }) => {
  derKey();
  if (await rateLimited(db, `login:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
    throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут');
  }
  const body = await readJson(req);
  if (!crypto.timingSafeEqual(sha256(body.password ?? ''), sha256(process.env.DER_PASSWORD))) {
    console.warn(`[der] неверный пароль, ip ${clientIp(req)}`);
    throw new HttpError(401, 'Неверный пароль');
  }
  const exp = Date.now() + ADMIN_SESSION_TTL;
  res.setHeader('Set-Cookie',
    `sb_der=${exp}.${signDer(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL / 1000}${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});

route('POST', '/api/der/logout', async ({ req, res }) => {
  res.setHeader('Set-Cookie', `sb_der=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});

derRoute('GET', '/api/der/me', async ({ req }) => ({ ok: true, admin: hasAdminSession(req) }));

panel('GET', 'institutions', async ({ db, der }) => {
  const [list, counts] = await Promise.all([
    db.collection('institutions').find().toArray(),
    db.collection('participants').aggregate([
      { $match: { institutionId: { $ne: null } } },
      { $group: { _id: '$institutionId', participants: { $sum: 1 }, passed: { $sum: isPassed } } },
    ]).toArray(),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));
  return list.map((i) => ({
    id: String(i._id), name: i.name, nameKk: i.nameKk || '', type: i.type, district: i.district || 'taraz', active: i.active ? 1 : 0,
    participants: byId.get(String(i._id))?.participants || 0,
    ...(der ? {} : { passed: byId.get(String(i._id))?.passed || 0 }),
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
});

function cleanInstitution(body) {
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 150) throw new HttpError(400, 'Название: от 3 до 150 символов');
  const nameKk = String(body.nameKk ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const type = ['school', 'college', 'university'].includes(body.type) ? body.type : 'school';
  const district = DISTRICTS_BY_ID.has(body.district) ? body.district : 'taraz';
  return { name, nameKk, type, district };
}

admin('POST', '/api/admin/institutions', async ({ db, req }) => {
  const { name, nameKk, type, district } = cleanInstitution(await readJson(req));
  const { insertedId } = await db.collection('institutions').insertOne({ name, nameKk, type, district, active: true, createdAt: new Date() });
  invalidate('institutions');
  return { id: String(insertedId) };
});

// Массовое добавление: по строке на заведение, «Название на русском | Название на казахском»
admin('POST', '/api/admin/institutions/bulk', async ({ db, req }) => {
  const body = await readJson(req, 256 * 1024);
  const { type, district } = cleanInstitution({ ...body, name: 'xxx' });
  const existing = new Set((await db.collection('institutions').find({ district }).project({ name: 1 }).toArray())
    .map((i) => i.name.toLowerCase()));
  const now = new Date();
  const docs = [];
  let skipped = 0;
  for (const line of String(body.lines || '').split(/\r?\n/)) {
    const [ru, kk = ''] = line.split('|').map((s) => s.replace(/\s+/g, ' ').trim());
    if (!ru) continue;
    if (ru.length < 3 || ru.length > 150 || existing.has(ru.toLowerCase())) { skipped += 1; continue; }
    existing.add(ru.toLowerCase());
    docs.push({ name: ru, nameKk: kk.slice(0, 200), type, district, active: true, createdAt: now });
  }
  if (docs.length > 1000) throw new HttpError(400, 'Не больше 1000 строк за раз');
  if (docs.length) await db.collection('institutions').insertMany(docs);
  invalidate('institutions');
  return { added: docs.length, skipped };
});

admin('PUT', /^\/api\/admin\/institutions\/([a-f0-9]{24})$/, async ({ db, req, m }) => {
  const body = await readJson(req);
  const { name, nameKk, type, district } = cleanInstitution(body);
  const id = toObjectId(m[1]);
  const { matchedCount } = await db.collection('institutions').updateOne({ _id: id }, { $set: { name, nameKk, type, district, active: !!body.active } });
  if (!matchedCount) throw new HttpError(404, 'Не найдено');
  await db.collection('participants').updateMany({ institutionId: id }, { $set: { institutionName: name, institutionNameKk: nameKk || name, institutionType: type, district } });
  invalidate('institutions');
  return { ok: true };
});

admin('DELETE', /^\/api\/admin\/institutions\/([a-f0-9]{24})$/, async ({ db, m }) => {
  const id = toObjectId(m[1]);
  if (await db.collection('participants').countDocuments({ institutionId: id }, { limit: 1 })) {
    throw new HttpError(409, 'У этого заведения есть участники — его можно только скрыть');
  }
  await db.collection('institutions').deleteOne({ _id: id });
  invalidate('institutions');
  return { ok: true };
});

const EDITABLE_SETTINGS = Object.keys(DEFAULT_SETTINGS);

admin('GET', '/api/admin/settings', async ({ db }) => {
  const s = await getSettings(db);
  return Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, s[k] ?? '']));
});

admin('PUT', '/api/admin/settings', async ({ db, req }) => {
  const body = await readJson(req);
  const updates = {};
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in body)) continue;
    let v = String(body[key] ?? '').trim().slice(0, 600);
    if (key === 'pass_score') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > QUIZ_SIZE) throw new HttpError(400, `Проходной балл: от 1 до ${QUIZ_SIZE}`);
    }
    if (key === 'cert_prefix') {
      v = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (!v) throw new HttpError(400, 'Префикс сертификата: латинские буквы и цифры');
    }
    if ((key === 'event_title' || key === 'org_name') && !v) throw new HttpError(400, 'Поле не может быть пустым');
    if (['game_enabled', 'game_rating', 'game_unlimited'].includes(key) && v !== 'on' && v !== 'off') {
      throw new HttpError(400, 'Настройки мини-игры: on или off');
    }
    if (key === 'game_rating_names' && v !== 'name' && v !== 'initials') throw new HttpError(400, 'Имена в рейтинге области: name или initials');
    if (key === 'game_rounds' && !/^[1-5]$/.test(v)) throw new HttpError(400, 'Раундов за миссию: от 1 до 5');
    updates[key] = v;
  }
  for (const [k, v] of Object.entries(updates)) await setSetting(db, k, v);
  return { ok: true };
});

// ─── Обработчик ────────────────────────────────────────────────────────────

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const lang = langOf(req, url);
  const { pathname } = url;
  try {
    const wait = floodWait(req, pathname);
    if (wait) {
      send(res, 429, JSON.stringify({ error: tr(lang, 'slowDown', { s: wait }) }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(wait),
      });
      return;
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = typeof r.pattern === 'string' ? (r.pattern === pathname ? [] : null) : pathname.match(r.pattern);
      if (!m) continue;
      if (r.admin) requireAdmin(req);
      if (r.der) requireDer(req);
      const db = await getDb();
      const result = await r.handler({ db, req, res, url, m, lang });
      // В CDN кэшируются только ответы с явным ?lang=, иначе язык мог бы перепутаться
      if (result !== undefined) {
        const cache = r.public && url.searchParams.has('lang') ? PUBLIC_CACHE : 'no-store';
        if (!r.public) {
          json(res, 200, result, cache);
        } else {
          const body = stringifyShared(result);
          const gzip = body.length > 1024 && typeof result === 'object' && result !== null
            && /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
          send(res, 200, gzip ? gzipShared(result, body) : body, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': cache,
            Vary: 'Accept-Encoding',
            ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
          });
        }
      }
      return;
    }
    throw new HttpError(404, 'notFound');
  } catch (err) {
    let status = err instanceof HttpError ? err.status : 500;
    let message = tr(lang, err.message, err.vars);
    if (err instanceof ConfigError) {
      status = 503;
    } else if (err && (err.code === 'ECONNRESET' || err.message === 'aborted')) {
      // Ученик потерял связь посреди отправки запроса — это не ошибка сервера, в журнал не пишем
      status = 400;
      message = tr(lang, 'badJson');
    } else if (/^Mongo(Server)?(Selection|Network|Timeout)/.test(err.name || '')) {
      console.error(err);
      status = 503;
      message = tr(lang, 'dbUnavailable');
    } else if (status === 500) {
      console.error(err);
      message = tr(lang, 'serverError');
    }
    if (!res.headersSent) json(res, status, { error: message });
    else res.end();
  }
}
