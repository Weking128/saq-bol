# Caddy с файлами сайта внутри образа. Файлы заранее сжаты (brotli и gzip): Caddy отдаёт
# готовые и не тратит процессор на сжатие при каждой загрузке страницы — ни в начале урока,
# когда сайт открывает вся школа, ни при наплыве запросов с одного адреса.
# Образ пересобирается командой обновления сайта: docker compose up -d --build
FROM node:22-alpine AS pack
WORKDIR /srv
COPY public ./public
RUN node -e "\
const fs = require('fs'), path = require('path'), zlib = require('zlib'); \
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); \
let n = 0; \
for (const f of walk('public')) { \
  if (!/\.(js|css|html|svg|json|webmanifest)$/.test(f)) continue; \
  const b = fs.readFileSync(f); \
  fs.writeFileSync(f + '.gz', zlib.gzipSync(b, { level: 9 })); \
  fs.writeFileSync(f + '.br', zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } })); \
  n += 1; \
} \
console.log('сжато файлов: ' + n);"

FROM caddy:2-alpine
COPY --from=pack /srv/public /srv/public
