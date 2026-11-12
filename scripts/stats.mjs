// Итоговые цифры для отчётов (паспорт проекта и т. п.): только чтение, без имён учеников.
//
// На сервере, в папке deploy:
//   sudo docker compose exec -T app node --input-type=module - < ../scripts/stats.mjs
// Локально (строка подключения из .env):
//   node scripts/stats.mjs

import fs from 'node:fs';
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (process.env.DNS_SERVERS) (await import('node:dns')).setServers(process.env.DNS_SERVERS.split(','));

const client = await new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).connect();
const db = client.db(process.env.MONGODB_DB || 'saq-bol');

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const day = (d) => (d ? new Date(d.getTime() + 5 * 3600e3).toISOString().slice(0, 10) : '—');

const p = await db.collection('participants').find({}, {
  projection: { _id: 0, level: 1, gradeKind: 1, grade: 1, institutionType: 1, institutionId: 1, institutionName: 1, district: 1, lang: 1,
    missionsDone: 1, missionsComplete: 1, attemptsCount: 1, bestScore: 1, certNumber: 1, createdAt: 1, updatedAt: 1, passedAt: 1,
    gameBest: 1, gameRounds: 1 },
}).toArray();
const attempts = await db.collection('attempts').find({ finishedAt: { $ne: null } },
  { projection: { _id: 0, participantId: 1, score: 1, startedAt: 1, finishedAt: 1 } }).toArray();
const passScore = Number((await db.collection('settings').findOne({ _id: 'pass_score' }))?.value) || 7;

const levelOf = (x) => x.level || (x.gradeKind === 'class' && Number(x.grade) <= 6 ? 'junior' : 'senior');
const count = (f) => p.filter(f).length;
const total = p.length;
const started = count((x) => x.missionsDone > 0);
const allMissions = count((x) => x.missionsComplete);
const tested = count((x) => x.attemptsCount > 0);
const certified = count((x) => x.certNumber);
const institutions = new Set(p.map((x) => (x.institutionId ? String(x.institutionId) : `o:${x.institutionName}`))).size;
const districts = new Set(p.map((x) => x.district || 'taraz')).size;
const inList = await db.collection('institutions').countDocuments({ active: true });

// Первая попытка теста каждого участника
const firstTry = new Map();
for (const a of attempts.sort((x, y) => x.finishedAt - y.finishedAt)) {
  const k = String(a.participantId);
  if (!firstTry.has(k)) firstTry.set(k, a.score);
}
const firstPass = [...firstTry.values()].filter((s) => s >= passScore).length;

// Время: от регистрации до сертификата и «активное» время (регистрация → последнее действие, в пределах 4 часов)
const toCert = p.filter((x) => x.passedAt).map((x) => (x.passedAt - x.createdAt) / 60000);
const active = p.filter((x) => x.missionsDone > 0 && x.updatedAt).map((x) => (x.updatedAt - x.createdAt) / 60000).filter((m) => m <= 240);
const testMin = attempts.map((a) => (a.finishedAt - a.startedAt) / 60000).filter((m) => m <= 60);

const players = p.filter((x) => (x.gameBest || 0) > 0 || (x.gameRounds || 0) > 0);
const byLevel = (l) => p.filter((x) => levelOf(x) === l).length;
const byType = (t) => p.filter((x) => x.institutionType === t).length;

const rows = [
  ['Период', `${day(p.reduce((m, x) => (!m || x.createdAt < m ? x.createdAt : m), null))} — ${day(p.reduce((m, x) => (!m || x.createdAt > m ? x.createdAt : m), null))}`],
  ['Зарегистрировано учащихся', total],
  ['  из них 1–6 классы / 7+ классы', `${byLevel('junior')} / ${byLevel('senior')}`],
  ['  школы / колледжи / вузы / другое', `${byType('school')} / ${byType('college')} / ${byType('university')} / ${byType('other')}`],
  ['  на казахском / русском', `${count((x) => x.lang === 'kk')} / ${count((x) => x.lang !== 'kk')}`],
  ['Учебных заведений с участниками', `${institutions} из ${inList} в справочнике (${pct(institutions, inList)})`],
  ['Город и районы с участниками', `${districts} из 11`],
  ['Начали миссии', `${started} (${pct(started, total)})`],
  ['Прошли все миссии', `${allMissions} (${pct(allMissions, total)})`],
  ['Проходили итоговый тест', `${tested} (${pct(tested, total)})`],
  ['Получили сертификат', `${certified} (${pct(certified, total)})`],
  ['Средний лучший балл теста', `${r1(mean(p.filter((x) => x.attemptsCount > 0 && x.bestScore != null).map((x) => x.bestScore)))} из 10`],
  ['Сдали тест с первой попытки', `${firstPass} из ${firstTry.size} (${pct(firstPass, firstTry.size)})`],
  ['Время до сертификата, медиана', `${r1(median(toCert))} мин`],
  ['Время на сайте за визит, медиана / среднее', `${r1(median(active))} / ${r1(mean(active))} мин`],
  ['Длительность теста, медиана', `${r1(median(testMin))} мин`],
  ['Играли в «Сейф-пазл»', `${players.length} (${pct(players.length, started)} от начавших миссии)`],
  ['Сыграно раундов', players.reduce((s, x) => s + (x.gameRounds || 0), 0)],
  ['Раундов на игрока, в среднем', r1(mean(players.map((x) => x.gameRounds || 0)))],
  ['Рекорд игры, медиана / лучший', `${r1(median(players.map((x) => x.gameBest || 0)))} / ${Math.max(0, ...players.map((x) => x.gameBest || 0))}`],
  ['Заведений, где играют', new Set(players.map((x) => String(x.institutionId || x.institutionName))).size],
];
const w = Math.max(...rows.map((r) => r[0].length));
for (const [k, v] of rows) console.log(`${k.padEnd(w)}  ${v}`);
await client.close();
