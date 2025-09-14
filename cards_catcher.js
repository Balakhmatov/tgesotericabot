// cards_catcher.js
// Плагин для Telegraf: сбор file_id карт по подписям в cards.json + команды управления (в т.ч. из каналов)
const fs = require('fs');
const path = require('path');

function normalizeKey(s = '') {
  let x = s.toLowerCase().trim().replace(/ё/g, 'е');
  const replacements = [
    { from: /\bwands?\b/g, to: 'жезлы' },
    { from: /\bpentacles?\b/g, to: 'пентакли' },
    { from: /\bswords?\b/g, to: 'мечи' },
    { from: /\bcups?\b/g, to: 'кубки' },
    { from: /\bking\b/g, to: 'король' },
    { from: /\bqueen\b/g, to: 'королева' },
    { from: /\bknight\b/g, to: 'рыцарь' },
    { from: /\bpage\b/g, to: 'паж' },
    { from: /\bfool\b/g, to: 'шут' },
    { from: /\bmagician\b/g, to: 'маг' },
    { from: /\bhigh priestess\b/g, to: 'жрица' },
    { from: /\bempress\b/g, to: 'императрица' },
    { from: /\bemperor\b/g, to: 'император' },
    { from: /\bhierophant\b/g, to: 'жрец' },
    { from: /\blovers\b/g, to: 'влюблённые' },
    { from: /\bchariot\b/g, to: 'колесница' },
    { from: /\bstrength\b/g, to: 'сила' },
    { from: /\bhermit\b/g, to: 'отшельник' },
    { from: /\bwheel of fortune\b/g, to: 'колесо фортуны' },
    { from: /\bjustice\b/g, to: 'справедливость' },
    { from: /\bhanged man\b/g, to: 'повешенный' },
    { from: /\bdeath\b/g, to: 'смерть' },
    { from: /\btemperance\b/g, to: 'умеренность' },
    { from: /\bdevil\b/g, to: 'дьявол' },
    { from: /\btower\b/g, to: 'башня' },
    { from: /\bstar\b/g, to: 'звезда' },
    { from: /\bmoon\b/g, to: 'луна' },
    { from: /\bsun\b/g, to: 'солнце' },
    { from: /\bjudgement\b/g, to: 'суд' },
    { from: /\bworld\b/g, to: 'мир' },
  ];
  for (const r of replacements) x = x.replace(r.from, r.to);
  x = x.replace(/[^a-zа-я0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  return x;
}

function attachCardsCatcher(bot, {
  storePath = path.join(__dirname, 'cards.json'),
  adminIds = [], // если пусто — любой может включить режим; иначе ограничим
} = {}) {
  // === загрузка/сохранение стора
  let store = {};
  if (fs.existsSync(storePath)) {
    try { store = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}'); }
    catch { store = {}; }
  }
  const save = () => fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');

  // === режим ловца
  let captureOn = false;

  const isAdmin = (ctx) => {
    if (!adminIds.length) return true;
    const uid = ctx.from?.id || ctx.chat?.id; // в канале from может быть пуст
    return adminIds.includes(uid);
  };

  // ==== Команды (личка/группа) ====
  bot.command('cards_mode', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав для управления режимом.');
    const arg = (ctx.message.text.split(/\s+/)[1] || '').toLowerCase();
    if (!arg) {
      return ctx.reply(`Режим ловца: ${captureOn ? 'ON' : 'OFF'}\nИспользование: /cards_mode on | off`);
    }
    if (arg === 'on') { captureOn = true; return ctx.reply('Ловец карт включён. Шлите фото с подписями: "Король Мечей, King of Swords".'); }
    if (arg === 'off') { captureOn = false; return ctx.reply('Ловец карт выключен.'); }
    return ctx.reply('Использование: /cards_mode on | off');
  });

  bot.command('cards_keys', async (ctx) => {
    const keys = Object.keys(store).sort();
    if (!keys.length) return ctx.reply('Пока нет записей в cards.json.');
    const MAX = 3500; let chunk = '';
    for (const k of keys) {
      const line = `• ${k}\n`;
      if (chunk.length + line.length > MAX) { await ctx.reply(chunk); chunk = ''; }
      chunk += line;
    }
    if (chunk) await ctx.reply(chunk);
  });

  bot.command('cards_export', async (ctx) => {
    try { save(); await ctx.replyWithDocument({ source: storePath, filename: 'cards.json' }); }
    catch { await ctx.reply('Не удалось отдать cards.json.'); }
  });

  // ==== Фото (личка/группа) ====
  bot.on('photo', async (ctx, next) => {
    try {
      const photos = ctx.message.photo || [];
      if (!photos.length) return typeof next === 'function' ? next() : undefined;

      const best = photos[photos.length - 1];
      const fileId = best.file_id;

      if (!captureOn) {
        await ctx.reply(`file_id: \`${fileId}\``, { parse_mode: 'Markdown' });
        return typeof next === 'function' ? next() : undefined;
      }

      const caption = (ctx.message.caption || '').trim();
      if (!caption) {
        await ctx.reply('Подпись пустая. Добавьте подпись к фото (алиасы через запятую).');
        return;
      }

      const rawKeys = caption.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
      const added = [];
      for (const rk of rawKeys) {
        const key = normalizeKey(rk);
        if (key) { store[key] = fileId; added.push(key); }
      }
      if (added.length) {
        save();
        await ctx.reply(`Связал ${added.length} ключ(ей):\n` + added.map(a => `• ${a}`).join('\n'));
      } else {
        await ctx.reply('Не удалось распознать ключи. Пример: "Король Мечей, King of Swords".');
      }
    } catch (e) {
      console.error('[cards_catcher] photo error', e);
      await ctx.reply('Ошибка при сохранении привязки.');
    }
  });

  // ==== Поддержка КАНАЛОВ (channel_post) ====
  bot.on('channel_post', async (ctx, next) => {
    try {
      const post = ctx.update?.channel_post || {};
      const text = (post.text || '').trim();
      const photos = post.photo || [];
      const caption = (post.caption || '').trim();

      // Команды в канале (пишем: /cards_mode on  или  /cards_mode on@BotName)
      if (text.startsWith('/')) {
        const m1 = text.match(/^\/cards_mode(?:@\w+)?(?:\s+(on|off))?$/i);
        if (m1) {
          if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав для управления режимом.');
          const arg = (m1[1] || '').toLowerCase();
          if (!arg) return ctx.reply(`Режим ловца: ${captureOn ? 'ON' : 'OFF'}\nИспользование: /cards_mode on | off`);
          if (arg === 'on') { captureOn = true; return ctx.reply('Ловец карт включён. Шлите фото с подписями.'); }
          if (arg === 'off') { captureOn = false; return ctx.reply('Ловец карт выключен.'); }
        }

        if (/^\/cards_keys(?:@\w+)?$/i.test(text)) {
          const keys = Object.keys(store).sort();
          if (!keys.length) return ctx.reply('Пока нет записей в cards.json.');
          const MAX = 3500; let chunk = '';
          for (const k of keys) {
            const line = `• ${k}\n`;
            if (chunk.length + line.length > MAX) { await ctx.reply(chunk); chunk = ''; }
            chunk += line;
          }
          if (chunk) await ctx.reply(chunk);
          return;
        }

        if (/^\/cards_export(?:@\w+)?$/i.test(text)) {
          try { save(); await ctx.replyWithDocument({ source: storePath, filename: 'cards.json' }); }
          catch { await ctx.reply('Не удалось отдать cards.json.'); }
          return;
        }
      }

      // Фото в канале
      if (photos.length) {
        const best = photos[photos.length - 1];
        const fileId = best.file_id;

        if (!captureOn) {
          await ctx.reply(`file_id: \`${fileId}\``, { parse_mode: 'Markdown' });
          return;
        }

        if (!caption) {
          await ctx.reply('Подпись пустая. Добавьте подпись к фото (алиасы через запятую).');
          return;
        }

        const rawKeys = caption.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
        const added = [];
        for (const rk of rawKeys) {
          const key = normalizeKey(rk);
          if (key) { store[key] = fileId; added.push(key); }
        }
        if (added.length) {
          save();
          await ctx.reply(`Связал ${added.length} ключ(ей):\n` + added.map(a => `• ${a}`).join('\n'));
        } else {
          await ctx.reply('Не удалось распознать ключи. Пример: "Король Мечей, King of Swords".');
        }
        return;
      }

      if (typeof next === 'function') return next();
    } catch (e) {
      console.error('[cards_catcher] channel_post error', e);
      try { await ctx.reply('Ошибка обработки поста канала.'); } catch {}
    }
  });

  // === экспорт API модуля (на всякий случай)
  return {
    get captureOn() { return captureOn; },
    set captureOn(v) { captureOn = !!v; },
    get store() { return store; },
    save,
  };
}

module.exports = { attachCardsCatcher };
