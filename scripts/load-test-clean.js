// Счёт и удаление участников нагрузочного теста (scripts/load-test.mjs регистрирует их
// с фамилией «Нагрузочный»). Настоящие ученики, заведения и настройки не трогаются.
// На сервере, в папке deploy:
//   посчитать:  sudo docker compose exec -T backup sh -c 'mongosh "$MONGO_URI" --quiet' < ../scripts/load-test-clean.js
//   удалить:    sudo docker compose exec -T backup sh -c 'mongosh "$MONGO_URI" --quiet --eval "var CLEAN=1" --shell' < ../scripts/load-test-clean.js
const d = db.getSiblingDB('saq-bol');
const TEST = { lastName: 'Нагрузочный' };
const total = d.participants.countDocuments();
const test = d.participants.countDocuments(TEST);
print(`участников всего: ${total}, тестовых: ${test}, настоящих: ${total - test}`);
print(`сертификатов у настоящих: ${d.participants.countDocuments({ lastName: { $ne: 'Нагрузочный' }, certNumber: { $type: 'string' } })}`);
if (typeof CLEAN !== 'undefined' && CLEAN) {
  const ids = d.participants.find(TEST, { _id: 1 }).toArray().map((p) => p._id);
  const a = d.attempts.deleteMany({ participantId: { $in: ids } }).deletedCount;
  const p = d.participants.deleteMany(TEST).deletedCount;
  d.ratelimits.deleteMany({});
  // Счётчик сертификатов — по самому большому номеру у настоящих участников (или с нуля)
  const real = d.participants.find({ certNumber: { $type: 'string' } }, { certNumber: 1 }).toArray()
    .map((x) => Number((x.certNumber.match(/-(\d{5})-\d{4}$/) || [])[1]) || 0);
  const max = real.length ? Math.max(...real) : 0;
  if (max) d.counters.updateOne({ _id: 'cert' }, { $set: { seq: max } }, { upsert: true });
  else d.counters.deleteOne({ _id: 'cert' });
  print(`удалено: тестовых участников ${p}, их попыток теста ${a}; счётчик сертификатов = ${max}`);
  print(`осталось участников: ${d.participants.countDocuments()}`);
}
