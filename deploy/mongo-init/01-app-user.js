// Выполняется один раз — при самом первом запуске пустой базы.
// Приложение работает под отдельным пользователем с правами только на свою базу.
db.getSiblingDB('saq-bol').createUser({
  user: 'saqbol',
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'saq-bol' }],
});
