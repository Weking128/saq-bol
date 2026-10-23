// Электронный сертификат: рисуется на canvas (A4, альбомная ориентация)
// и сохраняется как PDF или PNG прямо в браузере, без сторонних библиотек.
(function () {
  'use strict';

  const W = 2000;
  const H = 1414;
  const SANS = '"Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", "Noto Serif", serif';
  const NAVY = '#0d1b3d';
  const INK = '#33405f';
  const MUTED = '#7d88a6';
  // Тексты сертификата на двух языках (язык берётся из d.lang)
  const TEXT = {
    ru: {
      intro: 'Настоящим подтверждается, что',
      body: 'успешно прошёл(а) обучающий квест по противодействию интернет-мошенничеству, фишингу и дропперству',
      scorePre: 'и сдал(а) итоговый тест с результатом ',
      score: (s, n) => `${s} из ${n}`,
      scorePost: '',
      date: 'Дата выдачи',
      verify: 'проверка',
    },
    kk: {
      intro: 'Сертификат иегері',
      body: 'интернет-алаяқтыққа, фишингке және дропперлікке қарсы іс-қимыл бойынша оқу квестінен сәтті өтті',
      scorePre: 'және қорытынды тестті ',
      score: (s, n) => `${s}/${n}`,
      scorePost: ' нәтижемен тапсырды',
      date: 'Берілген күні',
      verify: 'тексеру',
    },
  };

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Текст по центру с переносом; если строк больше maxLines — уменьшаем шрифт
  function centered(ctx, text, y, { size, weight = 400, family = SANS, color = INK, maxWidth = 1500, lineHeight = 1.3, maxLines = 2, italic = false }) {
    let s = size;
    let lines;
    do {
      ctx.font = `${italic ? 'italic ' : ''}${weight} ${s}px ${family}`;
      lines = wrap(ctx, text, maxWidth);
      s -= 2;
    } while (lines.length > maxLines && s > 14);
    // Выравниваем длину строк, чтобы последнее слово не висело одно на строке
    if (lines.length > 1) {
      let lo = maxWidth / 2;
      let hi = maxWidth;
      while (hi - lo > 8) {
        const mid = (lo + hi) / 2;
        if (wrap(ctx, text, mid).length > lines.length) lo = mid;
        else hi = mid;
      }
      lines = wrap(ctx, text, hi);
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * (s + 2) * lineHeight));
    return y + lines.length * (s + 2) * lineHeight;
  }

  function fitFont(ctx, text, { size, weight, family, maxWidth }) {
    let s = size;
    do {
      ctx.font = `${weight} ${s}px ${family}`;
      s -= 2;
    } while (ctx.measureText(text).width > maxWidth && s > 20);
  }

  function cornerWave(ctx) {
    const g = ctx.createLinearGradient(0, 0, 560, 480);
    g.addColorStop(0, '#00a3c4');
    g.addColorStop(1, '#0a5f8a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(520, 0);
    ctx.bezierCurveTo(380, 90, 190, 220, 0, 400);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f5b800';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(590, 0);
    ctx.bezierCurveTo(440, 110, 220, 255, 0, 465);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,163,196,.25)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(650, 0);
    ctx.bezierCurveTo(490, 125, 250, 290, 0, 520);
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function medal(ctx, cx, cy, r) {
    // ленточки
    ctx.fillStyle = '#00a3c4';
    ctx.beginPath(); ctx.moveTo(cx - 55, cy + 40); ctx.lineTo(cx - 90, cy + 165); ctx.lineTo(cx - 55, cy + 145); ctx.lineTo(cx - 30, cy + 175); ctx.lineTo(cx - 10, cy + 60); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 55, cy + 40); ctx.lineTo(cx + 90, cy + 165); ctx.lineTo(cx + 55, cy + 145); ctx.lineTo(cx + 30, cy + 175); ctx.lineTo(cx + 10, cy + 60); ctx.closePath(); ctx.fill();
    // розетка
    ctx.fillStyle = '#f5b800';
    ctx.beginPath();
    const spikes = 24;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (Math.PI * i) / spikes;
      const rr = i % 2 ? r : r + 12;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.fill();
    const g = ctx.createRadialGradient(cx - 20, cy - 25, 10, cx, cy, r);
    g.addColorStop(0, '#ffe68a');
    g.addColorStop(1, '#d9a300');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r - 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r - 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = NAVY;
    ctx.textAlign = 'center';
    ctx.font = `900 30px ${SANS}`;
    ctx.fillText('САҚ БОЛ!', cx, cy + 2);
    ctx.font = `700 22px ${SANS}`;
    ctx.fillText('★ ★ ★', cx, cy + 36);
  }

  function loadMascot() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SB.MASCOT_SVG.replace('<svg ', '<svg width="240" height="240" '));
    });
  }

  async function draw(canvas, d) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, W, H);
    cornerWave(ctx);
    ctx.save();
    ctx.translate(W, H);
    ctx.rotate(Math.PI);
    cornerWave(ctx);
    ctx.restore();

    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 3;
    roundRect(ctx, 70, 70, W - 140, H - 140, 26);
    ctx.stroke();
    ctx.strokeStyle = '#e2c25a';
    ctx.lineWidth = 2;
    roundRect(ctx, 86, 86, W - 172, H - 172, 20);
    ctx.stroke();

    centered(ctx, d.orgName.toUpperCase(), 160, { size: 26, weight: 700, color: NAVY, maxWidth: 1250, maxLines: 3, lineHeight: 1.35 });

    const img = await loadMascot();
    if (img) ctx.drawImage(img, W / 2 - 62, 238, 124, 124);

    const tg = ctx.createLinearGradient(0, 380, 0, 470);
    tg.addColorStop(0, '#e0ad12');
    tg.addColorStop(1, '#a87800');
    ctx.font = `700 118px ${SERIF}`;
    ctx.fillStyle = tg;
    ctx.textAlign = 'center';
    ctx.fillText('СЕРТИФИКАТ', W / 2, 482);

    centered(ctx, `«${d.eventTitle}»`, 548, { size: 36, weight: 600, color: '#0a6f9c', maxWidth: 1400, maxLines: 2 });

    const T = TEXT[d.lang] || TEXT.ru;
    centered(ctx, T.intro, 640, { size: 32, color: MUTED });

    fitFont(ctx, d.fullName, { size: 86, weight: 800, family: SANS, maxWidth: 1500 });
    ctx.fillStyle = NAVY;
    ctx.fillText(d.fullName, W / 2, 742);
    ctx.strokeStyle = '#e2c25a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 640, 772);
    ctx.lineTo(W / 2 + 640, 772);
    ctx.stroke();

    let y = centered(ctx, `${d.gradeLabel} · ${d.institution}`, 826, { size: 34, weight: 600, color: INK, maxWidth: 1500 });
    y = centered(ctx, T.body, y + 22, { size: 31, color: INK, maxWidth: 1450 });
    // Строка результата: обычный текст + жирный балл + обычный текст
    const pre = T.scorePre;
    const score = T.score(d.score, d.total);
    const post = T.scorePost;
    ctx.font = `400 31px ${SANS}`;
    const wPre = ctx.measureText(pre).width;
    const wPost = ctx.measureText(post).width;
    ctx.font = `800 31px ${SANS}`;
    const wScore = ctx.measureText(score).width;
    const x0 = W / 2 - (wPre + wScore + wPost) / 2;
    ctx.textAlign = 'left';
    ctx.font = `400 31px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.fillText(pre, x0, y + 8);
    ctx.fillText(post, x0 + wPre + wScore, y + 8);
    ctx.font = `800 31px ${SANS}`;
    ctx.fillStyle = NAVY;
    ctx.fillText(score, x0 + wPre, y + 8);

    // Нижний блок: дата — медаль — подпись
    const by = 1150;
    const date = d.passedAt ? new Date(d.passedAt).toLocaleDateString('ru-RU') : '';
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = `600 24px ${SANS}`;
    ctx.fillText(T.date, 230, by - 20);
    ctx.fillStyle = NAVY;
    ctx.font = `800 38px ${SANS}`;
    ctx.fillText(date, 230, by + 26);
    ctx.fillStyle = INK;
    ctx.font = `500 26px ${SANS}`;
    ctx.fillText(d.city || '', 230, by + 66);

    medal(ctx, W / 2, by - 10, 92);

    ctx.textAlign = 'right';
    const rx = W - 230;
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx - 420, by + 18);
    ctx.lineTo(rx, by + 18);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(d.signerPosition || '', rx, by - 20);
    if (d.signerName) {
      ctx.fillStyle = NAVY;
      ctx.font = `700 28px ${SANS}`;
      ctx.fillText(d.signerName, rx, by + 60);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${SANS}`;
    ctx.fillText(`№ ${d.number}   ·   ${T.verify}: ${location.host}/verify`, W / 2, 1296);
    return canvas;
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), type, quality));
  }

  // Минимальный PDF с одной страницей A4 и JPEG-картинкой на всю страницу
  async function toPdf(canvas) {
    const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.93)).arrayBuffer());
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let offset = 0;
    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      parts.push(bytes);
      offset += bytes.length;
    };
    const obj = (n, ...body) => {
      offsets[n] = offset;
      push(`${n} 0 obj\n`);
      body.forEach(push);
      push('\nendobj\n');
    };
    const pw = 842;
    const ph = 595;
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    push('%PDF-1.4\n%âãÏÓ\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    obj(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
    obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xref = offset;
    push('xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  const toPng = (canvas) => canvasBlob(canvas, 'image/png');

  function fileName(d, ext) {
    const base = `Сертификат_${d.fullName}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');
    return `${base}.${ext}`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function share(blob, name, title) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return true;
    }
    return false;
  }

  const canShareFiles = () => {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));
    } catch {
      return false;
    }
  };

  SB.cert = { draw, toPdf, toPng, fileName, download, share, canShareFiles };
})();
