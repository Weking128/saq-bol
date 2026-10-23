// Подключение к MongoDB и служебные операции.
// Подключение кэшируется между вызовами serverless-функции Vercel.

import { MongoClient, ObjectId } from 'mongodb';
import { SEED_INSTITUTIONS } from './institutions.js';

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
  contacts: 'Полиция — 102\nЕдиная служба экстренного вызова — 112',
  contacts_kk: 'Полиция — 102\nШұғыл қызметтердің бірыңғай нөмірі — 112',
};

const g = globalThis;

export class ConfigError extends Error {}

export function getDb() {
  if (!g.__sbDb) {
    const uri = process.env.MONGODB_URI;
    if (!uri) return Promise.reject(new ConfigError('База данных не настроена: задайте переменную MONGODB_URI'));
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
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

async function init(db) {
  await Promise.all([
    db.collection('participants').createIndexes([
      { key: { token: 1 }, unique: true },
      { key: { certNumber: 1 }, unique: true, partialFilterExpression: { certNumber: { $type: 'string' } } },
      { key: { institutionId: 1 } },
      { key: { createdAt: -1 } },
    ]),
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
}

export async function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of await db.collection('settings').find().toArray()) out[row._id] = row.value;
  return out;
}

export async function setSetting(db, key, value) {
  await db.collection('settings').updateOne({ _id: key }, { $set: { value: String(value) } }, { upsert: true });
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
