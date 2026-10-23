// Сақ бол! — API квеста. Один обработчик для Vercel (api/index.js)
// и для локального запуска (dev-server.js).
//
// Переменные окружения:
//   MONGODB_URI       строка подключения к MongoDB (обязательно)
//   MONGODB_DB        имя базы (по умолчанию saq-bol)
//   ADMIN_PASSWORD    пароль админ-панели (обязательно для входа в админку)
//   TZ_OFFSET_HOURS   часовой пояс для статистики по дням (по умолчанию 5 — Казахстан)
//   TRUST_PROXY       =1 — брать IP клиента из X-Forwarded-For (на Vercel включено всегда)

import crypto from 'node:crypto';
import { getDb, getSettings, setSetting, nextSeq, rateLimited, toObjectId, DEFAULT_SETTINGS, ConfigError } from './db.js';
import { QUESTIONS, QUESTIONS_BY_ID, TOPIC_PLAN, TOPIC_LABELS } from './quiz-bank.js';
import { QUESTIONS_KK, TOPIC_LABELS_KK } from './quiz-bank.kk.js';

const ON_VERCEL = !!process.env.VERCEL;
const TRUST_PROXY = ON_VERCEL || process.env.TRUST_PROXY === '1';
const TZ_OFFSET = Number(process.env.TZ_OFFSET_HOURS ?? 5);
const TZ = `${TZ_OFFSET >= 0 ? '+' : '-'}${String(Math.abs(TZ_OFFSET)).padStart(2, '0')}:00`;

const MISSION_IDS = ['m1', 'm2', 'm3', 'm4', 'm5'];
const QUIZ_SIZE = Object.values(TOPIC_PLAN).reduce((a, b) => a + b, 0);
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ─── Языки и сообщения ─────────────────────────────────────────────────────
// Язык интерфейса ученика приходит в заголовке X-Lang (kk или ru).

const langOf = (req) => (String(req.headers['x-lang'] || '').toLowerCase() === 'kk' ? 'kk' : 'ru');

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
    tooManyRequests: 'Слишком много запросов',
    notFound: 'Не найдено',
    tooLarge: 'Слишком большой запрос',
    badJson: 'Некорректный JSON',
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
    tooManyRequests: 'Сұраулар тым көп',
    notFound: 'Табылмады',
    tooLarge: 'Сұрау тым үлкен',
    badJson: 'JSON қате',
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

function json(res, status, data) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

async function readJson(req, limit = 32 * 1024) {
  // На Vercel тело запроса уже разобрано платформой и доступно как req.body
  if (ON_VERCEL && 'body' in req) {
    let b;
    try { b = req.body; } catch { throw new HttpError(400, 'badJson'); }
    if (b === undefined || b === null || b === '') return {};
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
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
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
  if (p.missionsDone >= MISSION_IDS.length) return 'missions_done';
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
    missions: p.missions || {},
    missionsDone: p.missionsDone,
    xp: p.xp,
    attemptsCount: p.attemptsCount,
    bestScore: p.bestScore,
    passed: !!p.certNumber,
    certNumber: p.certNumber,
    passedAt: p.passedAt,
  };
}

async function participantByToken(db, req) {
  const token = String(req.headers['x-participant-token'] || '');
  if (!/^[a-f0-9]{48}$/.test(token)) throw new HttpError(401, 'needRegistration');
  const p = await db.collection('participants').findOne({ token });
  if (!p) throw new HttpError(401, 'participantNotFound');
  return p;
}

function passScoreOf(settings) {
  const n = Number(settings.pass_score);
  return Number.isInteger(n) && n >= 1 && n <= QUIZ_SIZE ? n : 7;
}

// Настройка на языке lang: для казахского берём поле *_kk, если оно заполнено
const setting = (s, key, lang) => (lang === 'kk' && s[`${key}_kk`]) || s[key];

function publicConfig(s, lang) {
  return {
    lang,
    eventTitle: setting(s, 'event_title', lang),
    orgName: setting(s, 'org_name', lang),
    city: setting(s, 'city', lang),
    signerName: s.signer_name,
    signerPosition: setting(s, 'signer_position', lang),
    contacts: setting(s, 'contacts', lang),
    passScore: passScoreOf(s),
    quizSize: QUIZ_SIZE,
    missions: MISSION_IDS,
  };
}

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

route('GET', '/api/config', async ({ db, lang }) => publicConfig(await getSettings(db), lang));

// name — на языке интерфейса, alt — на втором языке (для поиска)
route('GET', '/api/institutions', async ({ db, lang }) =>
  (await db.collection('institutions').find({ active: true }).project({ name: 1, nameKk: 1, type: 1 }).toArray())
    .map((i) => {
      const kk = i.nameKk || i.name;
      return { id: String(i._id), name: lang === 'kk' ? kk : i.name, alt: lang === 'kk' ? i.name : kk, type: i.type };
    })
    .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true })));

route('POST', '/api/register', async ({ db, req, lang }) => {
  if (await rateLimited(db, `reg:${clientIp(req)}`, 300, 10 * 60 * 1000)) {
    throw new HttpError(429, 'tooManyRegistrations');
  }
  const body = await readJson(req);
  if (body.consent !== true) throw new HttpError(400, 'consentRequired');

  let institutionId = null;
  let institutionName;
  let institutionNameKk;
  let institutionType;
  if (body.institutionId === 'other') {
    institutionName = String(body.institutionOther ?? '').replace(/\s+/g, ' ').trim();
    if (institutionName.length < 3 || institutionName.length > 150) throw new HttpError(400, 'institutionNameRequired');
    institutionNameKk = institutionName;
    institutionType = 'other';
  } else {
    const id = toObjectId(body.institutionId);
    const inst = id && await db.collection('institutions').findOne({ _id: id, active: true });
    if (!inst) throw new HttpError(400, 'chooseInstitution');
    institutionId = inst._id;
    institutionName = inst.name;
    institutionNameKk = inst.nameKk || inst.name;
    institutionType = inst.type;
  }

  const gradeKind = institutionType === 'school' ? 'class'
    : institutionType === 'other' ? (body.gradeKind === 'course' ? 'course' : 'class')
    : 'course';
  const grade = Number(body.grade);
  const maxGrade = gradeKind === 'class' ? 11 : 6;
  if (!Number.isInteger(grade) || grade < 1 || grade > maxGrade) {
    throw new HttpError(400, gradeKind === 'class' ? 'chooseClass' : 'chooseCourse');
  }
  const gradeLetter = String(body.gradeLetter ?? '').replace(/\s+/g, '').toLocaleUpperCase('ru').slice(0, 12);
  if (gradeLetter && !/^[\p{L}\d\-]+$/u.test(gradeLetter)) throw new HttpError(400, 'badLetter');

  const lastName = cleanName(body.lastName, 'lastName', lang);
  const firstName = cleanName(body.firstName, 'firstName', lang);
  const middleName = cleanName(body.middleName, 'middleName', lang, false);

  const now = new Date();
  const p = {
    token: crypto.randomBytes(24).toString('hex'),
    lang,
    institutionId, institutionName, institutionNameKk, institutionType,
    lastName, firstName, middleName,
    search: `${lastName} ${firstName} ${middleName}`.toLowerCase(),
    gradeKind, grade: String(grade), gradeLetter,
    missions: {}, missionsDone: 0, xp: 0,
    attemptsCount: 0, bestScore: null, passedAt: null, certNumber: null,
    createdAt: now, updatedAt: now,
  };
  await db.collection('participants').insertOne(p);
  return { token: p.token, participant: publicParticipant(p, lang) };
});

route('GET', '/api/me', async ({ db, req, lang }) => ({ participant: publicParticipant(await participantByToken(db, req), lang) }));

route('POST', '/api/progress', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  const body = await readJson(req);
  const missionId = String(body.missionId || '');
  if (!MISSION_IDS.includes(missionId)) throw new HttpError(400, 'unknownMission');
  const max = Math.max(1, Math.min(100, Math.round(Number(body.max) || 1)));
  const score = Math.max(0, Math.min(max, Math.round(Number(body.score) || 0)));

  const missions = { ...(p.missions || {}) };
  const prev = missions[missionId];
  if (!prev || score / max > prev.score / prev.max) missions[missionId] = { score, max, at: new Date() };
  const xp = Object.values(missions).reduce((sum, m) => sum + Math.round((m.score / m.max) * 100), 0);
  const missionsDone = MISSION_IDS.filter((id) => missions[id]).length;
  const updated = await db.collection('participants').findOneAndUpdate(
    { _id: p._id },
    { $set: { missions, missionsDone, xp, updatedAt: new Date() } },
    { returnDocument: 'after' });
  return { participant: publicParticipant(updated, lang) };
});

route('POST', '/api/quiz/start', async ({ db, req, lang }) => {
  const p = await participantByToken(db, req);
  if (p.missionsDone < MISSION_IDS.length) throw new HttpError(403, 'missionsFirst');
  if (await rateLimited(db, `quiz:${p._id}`, 30, 60 * 60 * 1000)) throw new HttpError(429, 'tooManyAttempts');

  const picked = [];
  for (const [topic, n] of Object.entries(TOPIC_PLAN)) {
    picked.push(...shuffle(QUESTIONS.filter((q) => q.topic === topic)).slice(0, n));
  }
  const plan = shuffle(picked).map((q) => ({ id: q.id, order: shuffle(q.options.map((_, i) => i)) }));
  const { insertedId } = await db.collection('attempts').insertOne({
    participantId: p._id,
    institutionType: p.institutionType,
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
  if (await rateLimited(db, `verify:${clientIp(req)}`, 60, 60 * 1000)) throw new HttpError(429, 'tooManyRequests');
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

// ─── Админ-панель ──────────────────────────────────────────────────────────
// Пароль задаётся переменной окружения ADMIN_PASSWORD. Сессия — подписанная cookie
// (без хранения на сервере); смена пароля автоматически завершает все сессии.

function adminKey() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new HttpError(503, 'Админ-панель не настроена: задайте переменную окружения ADMIN_PASSWORD');
  return sha256(`saq-bol-session:${pw}`);
}

const sign = (exp) => crypto.createHmac('sha256', adminKey()).update(`admin:${exp}`).digest('base64url');

function isHttps(req) {
  return ON_VERCEL || req.socket?.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));
}

function requireAdmin(req) {
  const [exp, sig] = String(parseCookies(req).sb_admin || '').split('.');
  const expected = exp ? Buffer.from(sign(exp)) : null;
  const ok = expected && sig && Buffer.from(sig).length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sig), expected) && Number(exp) > Date.now();
  if (!ok) throw new HttpError(401, 'Требуется вход в админ-панель');
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
  missions_done: { certNumber: null, attemptsCount: 0, missionsDone: { $gte: MISSION_IDS.length } },
  in_progress: { certNumber: null, attemptsCount: 0, missionsDone: { $gt: 0, $lt: MISSION_IDS.length } },
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

function buildFilter(params) {
  const and = [];
  const q = String(params.get('q') || '').trim();
  if (q) {
    and.push({ $or: [
      { search: { $regex: escapeRegex(q.toLowerCase()) } },
      { certNumber: { $regex: escapeRegex(q.toUpperCase()) } },
    ] });
  }
  const inst = params.get('institution');
  if (inst === 'other') and.push({ institutionId: null });
  else if (inst) and.push({ institutionId: toObjectId(inst) || 'none' });
  const type = params.get('type');
  if (type && TYPE_LABELS[type]) and.push({ institutionType: type });
  const status = params.get('status');
  if (status && STATUS_QUERY[status]) and.push(STATUS_QUERY[status]);
  const grade = params.get('grade');
  if (grade) and.push({ grade: String(grade) });
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
    gradeLabel: gradeLabel(p),
    grade: p.grade,
    missionsDone: p.missionsDone,
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

const round1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const isPassed = { $cond: [{ $eq: [{ $type: '$certNumber' }, 'string'] }, 1, 0] };
const isDone = { $cond: [{ $gte: ['$missionsDone', MISSION_IDS.length] }, 1, 0] };
const testedScore = { $cond: [{ $gt: ['$attemptsCount', 0] }, '$bestScore', null] };
const instKey = { $ifNull: [{ $toString: '$institutionId' }, { $concat: ['o:', '$institutionName'] }] };

admin('GET', '/api/admin/stats', async ({ db, url }) => {
  const match = buildFilter(url.searchParams);
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
      participants: { $sum: 1 },
      missionsDone: { $sum: isDone },
      passed: { $sum: isPassed },
      avgScore: { $avg: testedScore },
      lastActivity: { $max: '$updatedAt' },
    } },
    { $sort: { participants: -1, name: 1 } },
  ]).toArray()).map((r) => ({ ...r, _id: undefined, id: r.id ? String(r.id) : null, avgScore: round1(r.avgScore) }));

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

  // Аналитика ответов: какие вопросы и темы даются хуже всего
  const am = { finishedAt: { $ne: null } };
  const type = url.searchParams.get('type');
  if (type && TYPE_LABELS[type]) am.institutionType = type;
  const range = dateRange(url.searchParams);
  if (range) am.participantCreatedAt = range;
  const qRows = await db.collection('attempts').aggregate([
    { $match: am },
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

  return { totals, byInstitution, byDay, byGrade, questions, topics, statusLabels: STATUS_LABELS, typeLabels: TYPE_LABELS };
});

const SORTS = {
  created: { createdAt: -1 },
  name: { lastName: 1, firstName: 1 },
  institution: { institutionName: 1, lastName: 1 },
  score: { bestScore: -1, createdAt: -1 },
};
const RU = { locale: 'ru', numericOrdering: true };

admin('GET', '/api/admin/participants', async ({ db, url }) => {
  const filter = buildFilter(url.searchParams);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const size = Math.min(200, Math.max(10, Number(url.searchParams.get('size')) || 50));
  const sort = SORTS[url.searchParams.get('sort')] || SORTS.created;
  const P = db.collection('participants');
  const [total, rows] = await Promise.all([
    P.countDocuments(filter),
    P.find(filter).sort(sort).collation(RU).skip((page - 1) * size).limit(size).toArray(),
  ]);
  return { total, page, size, rows: rows.map(adminRow), statusLabels: STATUS_LABELS };
});

admin('GET', /^\/api\/admin\/participants\/([a-f0-9]{24})$/, async ({ db, m }) => {
  const p = await db.collection('participants').findOne({ _id: toObjectId(m[1]) });
  if (!p) throw new HttpError(404, 'Участник не найден');
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

admin('GET', '/api/admin/export.csv', async ({ db, url, res }) => {
  const rows = await db.collection('participants').find(buildFilter(url.searchParams))
    .sort({ institutionName: 1, lastName: 1, firstName: 1 }).collation(RU).toArray();
  const header = ['№', 'Дата регистрации', 'Фамилия', 'Имя', 'Отчество', 'Учебное заведение', 'Тип', 'Класс / курс',
    'Миссий пройдено', 'Очки (XP)', 'Попыток теста', `Лучший результат (из ${QUIZ_SIZE})`, 'Статус', '№ сертификата', 'Дата сертификата'];
  const lines = [header.map(csvCell).join(';')];
  rows.forEach((p, i) => {
    lines.push([i + 1, localDateTime(p.createdAt), p.lastName, p.firstName, p.middleName, p.institutionName,
      TYPE_LABELS[p.institutionType] || p.institutionType, gradeLabel(p), `${p.missionsDone} из ${MISSION_IDS.length}`, p.xp,
      p.attemptsCount, p.bestScore ?? '', STATUS_LABELS[statusOf(p)], p.certNumber ?? '', localDateTime(p.passedAt)]
      .map(csvCell).join(';'));
  });
  send(res, 200, '﻿' + lines.join('\r\n'), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="uchastniki-${localDateTime(new Date()).slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store',
  });
  return undefined;
});

admin('GET', '/api/admin/institutions', async ({ db }) => {
  const [list, counts] = await Promise.all([
    db.collection('institutions').find().toArray(),
    db.collection('participants').aggregate([
      { $match: { institutionId: { $ne: null } } },
      { $group: { _id: '$institutionId', participants: { $sum: 1 }, passed: { $sum: isPassed } } },
    ]).toArray(),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));
  return list.map((i) => ({
    id: String(i._id), name: i.name, nameKk: i.nameKk || '', type: i.type, active: i.active ? 1 : 0,
    participants: byId.get(String(i._id))?.participants || 0,
    passed: byId.get(String(i._id))?.passed || 0,
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
});

function cleanInstitution(body) {
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 150) throw new HttpError(400, 'Название: от 3 до 150 символов');
  const nameKk = String(body.nameKk ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const type = ['school', 'college', 'university'].includes(body.type) ? body.type : 'school';
  return { name, nameKk, type };
}

admin('POST', '/api/admin/institutions', async ({ db, req }) => {
  const { name, nameKk, type } = cleanInstitution(await readJson(req));
  const { insertedId } = await db.collection('institutions').insertOne({ name, nameKk, type, active: true, createdAt: new Date() });
  return { id: String(insertedId) };
});

admin('PUT', /^\/api\/admin\/institutions\/([a-f0-9]{24})$/, async ({ db, req, m }) => {
  const body = await readJson(req);
  const { name, nameKk, type } = cleanInstitution(body);
  const id = toObjectId(m[1]);
  const { matchedCount } = await db.collection('institutions').updateOne({ _id: id }, { $set: { name, nameKk, type, active: !!body.active } });
  if (!matchedCount) throw new HttpError(404, 'Не найдено');
  await db.collection('participants').updateMany({ institutionId: id }, { $set: { institutionName: name, institutionNameKk: nameKk || name, institutionType: type } });
  return { ok: true };
});

admin('DELETE', /^\/api\/admin\/institutions\/([a-f0-9]{24})$/, async ({ db, m }) => {
  const id = toObjectId(m[1]);
  if (await db.collection('participants').countDocuments({ institutionId: id }, { limit: 1 })) {
    throw new HttpError(409, 'У этого заведения есть участники — его можно только скрыть');
  }
  await db.collection('institutions').deleteOne({ _id: id });
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
    updates[key] = v;
  }
  for (const [k, v] of Object.entries(updates)) await setSetting(db, k, v);
  return { ok: true };
});

// ─── Обработчик ────────────────────────────────────────────────────────────

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const lang = langOf(req);
  const { pathname } = url;
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = typeof r.pattern === 'string' ? (r.pattern === pathname ? [] : null) : pathname.match(r.pattern);
      if (!m) continue;
      if (r.admin) requireAdmin(req);
      const db = await getDb();
      const result = await r.handler({ db, req, res, url, m, lang });
      if (result !== undefined) json(res, 200, result);
      return;
    }
    throw new HttpError(404, 'notFound');
  } catch (err) {
    let status = err instanceof HttpError ? err.status : 500;
    let message = tr(lang, err.message, err.vars);
    if (err instanceof ConfigError) {
      status = 503;
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
