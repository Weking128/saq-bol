// Подключение к MongoDB и служебные операции.
// Подключение кэшируется между вызовами serverless-функции Vercel.
//
// Под нагрузкой (1–2 тыс. учеников одновременно) важно не делать лишних запросов
// к базе: настройки и список заведений кэшируются в памяти экземпляра функции.

import { MongoClient, ObjectId } from 'mongodb';
import { SEED_INSTITUTIONS, SEED_INSTITUTIONS_V2 } from './institutions.js';

export { ObjectId };

// Поля с суффиксом _kk — казахская версия (если пусто, показывается русская)
export const DEFAULT_SETTINGS = {
  event_title: 'Сақ бол! Квест по финансовой безопасности',
  event_title_kk: 'Сақ бол! Қаржылық қауіпсіздік бойынша квест',
  org_name: 'Департамент экономических расследований по Жамбылской области Агентства Республики Казахстан по финансовому мониторингу',
  org_name_kk: 'Қазақстан Республикасы Қаржылық мониторинг агенттігінің Жамбыл облысы бойынша Экономикалық тергеп-тексеру департаменті',
  city: 'г. Тараз',
  city_kk: 'Тараз қ.',
  signer_name: '',
  signer_position: 'Руководитель',
  signer_position_kk: 'Басшы',
  pass_score: '7',
  cert_prefix: 'SB',
  contacts: 'Колл-центр АФМ — 1458 (с городского)\nКолл-центр АФМ с мобильного — +7 7172 70-09-51\nЕдиная служба экстренного вызова — 112',
  contacts_kk: 'ҚМА байланыс орталығы — 1458 (қалалық телефоннан)\nҚМА байланыс орталығы ұялы телефоннан — +7 7172 70-09-51\nШұғыл қызметтердің бірыңғай нөмірі — 112',
};

const g = globalThis;

// На Vercel пул подключений «прикрепляется» к функции: перед заморозкой экземпляра
// простаивающие соединения закрываются и не копятся в Atlas (лимит — 500 соединений).
// Локально функция ничего не делает.
let attachDatabasePool = null;
try {
  ({ attachDatabasePool } = await import('@vercel/functions'));
} catch { /* пакет не установлен — работаем без него */ }

export class ConfigError extends Error {}

export function getDb() {
  if (!g.__sbDb) {
    const uri = process.env.MONGODB_URI;
    if (!uri) return Promise.reject(new ConfigError('База данных не настроена: задайте переменную MONGODB_URI'));
    const client = new MongoClient(uri, {
      appName: 'saq-bol',
      maxPoolSize: Number(process.env.MONGODB_POOL_SIZE) || 10,
      maxIdleTimeMS: 5000,
      serverSelectionTimeoutMS: 8000,
    });
    attachDatabasePool?.(client);
    g.__sbDb = client.connect()
      .then(async (c) => {
        const db = c.db(process.env.MONGODB_DB || 'saq-bol');
        await init(db);
        return db;
      })
      .catch((err) => {
        g.__sbDb = null; // при следующем запросе попробуем снова
        throw err;
      });
  }
  return g.__sbDb;
}

const isDuplicate = (err) => err && err.code === 11000;

// Версия схемы: если база уже обновлена, холодный старт функции стоит один запрос
const SCHEMA_VERSION = 4;

async function init(db) {
  if (await db.collection('meta').findOne({ _id: 'schema', v: { $gte: SCHEMA_VERSION } })) return;
  await Promise.all([
    db.collection('participants').createIndexes([
      { key: { token: 1 }, unique: true },
      { key: { certNumber: 1 }, unique: true, partialFilterExpression: { certNumber: { $type: 'string' } } },
      { key: { institutionId: 1 } },
      { key: { district: 1 } },
      { key: { createdAt: -1 } },
      { key: { updatedAt: -1 } },
      { key: { passedAt: -1 }, partialFilterExpression: { passedAt: { $type: 'date' } } },
    ]),
    db.collection('institutions').createIndex({ district: 1 }),
    db.collection('attempts').createIndexes([{ key: { participantId: 1 } }, { key: { finishedAt: 1 } }]),
    db.collection('ratelimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  // Стартовый список заведений — один раз. Отметка в meta защищает от двойной загрузки
  // при одновременном холодном старте нескольких функций.
  try {
    await db.collection('meta').insertOne({ _id: 'seeded', at: new Date() });
    const now = new Date();
    await db.collection('institutions').insertMany(SEED_INSTITUTIONS.map((it) => ({ ...it, active: true, createdAt: now })));
  } catch (err) {
    if (!isDuplicate(err)) throw err;
  }

  // Версия 2: районы Жамбылской области. Существующим записям проставляем г. Тараз
  // (раньше в списке был только Тараз), затем один раз добавляем школы и колледжи районов.
  try {
    await db.collection('meta').insertOne({ _id: 'seed-v2-districts', at: new Date() });
    await db.collection('institutions').updateMany({ district: { $exists: false } }, { $set: { district: 'taraz' } });
    await db.collection('participants').updateMany({ district: { $exists: false } }, { $set: { district: 'taraz' } });
    await db.collection('attempts').updateMany({ district: { $exists: false } }, { $set: { district: 'taraz' } });
    const now = new Date();
    await db.collection('institutions').insertMany(SEED_INSTITUTIONS_V2.map((it) => ({ ...it, active: true, createdAt: now })));
  } catch (err) {
    if (!isDuplicate(err)) throw err;
  }

  // Версия 3: облегчённая версия для 1–6 классов. Проставляем уровень и признак «все миссии пройдены».
  try {
    await db.collection('meta').insertOne({ _id: 'v3-levels', at: new Date() });
    await db.collection('participants').updateMany({ level: { $exists: false } }, [
      { $set: { level: { $cond: [{ $and: [{ $eq: ['$gradeKind', 'class'] }, { $lte: [{ $toInt: '$grade' }, 6] }] }, 'junior', 'senior'] } } },
      { $set: { missionsComplete: { $gte: ['$missionsDone', { $cond: [{ $eq: ['$level', 'junior'] }, 4, 5] }] } } },
    ]);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
  }

  await db.collection('meta').updateOne({ _id: 'schema' }, { $max: { v: SCHEMA_VERSION } }, { upsert: true });
}

// ─── Кэш в памяти экземпляра функции ───────────────────────────────────────
// Одновременные запросы ждут одну и ту же загрузку, а не идут в базу каждый сам.
// Изменения из админки видны сразу на том экземпляре, где их сохранили,
// и не позже чем через ttl — на остальных.

const memo = (g.__sbMemo ||= new Map());

export function cached(key, ttlMs, load) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = Promise.resolve().then(load);
  memo.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (memo.get(key)?.promise === promise) memo.delete(key); });
  return promise;
}

export function invalidate(prefix) {
  for (const key of memo.keys()) if (key.startsWith(prefix)) memo.delete(key);
}

export async function getSettings(db) {
  const saved = await cached('settings', 30_000, () => db.collection('settings').find().toArray());
  const out = { ...DEFAULT_SETTINGS };
  for (const row of saved) out[row._id] = row.value;
  return out;
}

export async function setSetting(db, key, value) {
  await db.collection('settings').updateOne({ _id: key }, { $set: { value: String(value) } }, { upsert: true });
  invalidate('settings');
}

export async function nextSeq(db, name) {
  const doc = await db.collection('counters').findOneAndUpdate(
    { _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return doc.seq;
}

// Ограничение частоты запросов, общее для всех экземпляров функции
export async function rateLimited(db, key, max, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  try {
    const doc = await db.collection('ratelimits').findOneAndUpdate(
      { _id: `${key}:${bucket}` },
      { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs + 60_000) } },
      { upsert: true, returnDocument: 'after' });
    return doc.n > max;
  } catch (err) {
    if (isDuplicate(err)) return rateLimited(db, key, max, windowMs); // гонка при первом upsert
    throw err;
  }
}

export function toObjectId(value) {
  const s = String(value ?? '');
  return /^[a-f0-9]{24}$/.test(s) ? new ObjectId(s) : null;
}
