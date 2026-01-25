// tgesotericabot.js
// Telegram эзотер-бот: Тарология, Гороскоп, Предсказание (GPT)
// by Balakhmatov AI

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const OpenAI = require('openai');
const { PERSONAS } = require('./personas');
const { setPersona } = require('./state');

const fs = require('fs');
const path = require('path');

// ==== ENV ====
const USE_LLM_TAROT = process.env.USE_LLM_TAROT === 'true';
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
let BOT_USERNAME = process.env.BOT_USERNAME || '';
if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is not set');
  process.exit(1);
}

// ==== INIT ====
const bot = new Telegraf(BOT_TOKEN);
bot.telegram.getMe().then(me => { BOT_USERNAME = me.username; }).catch(()=>{});
const { attachCardsCatcher } = require('./cards_catcher');
const admins = []; // например: [123456789]
attachCardsCatcher(bot, {
  storePath: path.join(__dirname, 'cards.json'),
  adminIds: admins,
});

// ==== OpenAI ====
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const GPT_MODEL = 'gpt-4o-mini';

// ==== STATE (in-memory) ====
/** chatId -> { section, sub, tmp: {...} } */
const S = new Map();

// ==== UI Helpers ====
// Главное меню
const mainKeyboard = () => Markup.keyboard([
  ['🔮 Тарология', '♈️ Гороскоп'],
  ['🃏 Карта дня', '🗣 Предсказание'],
  ['ℹ️ О нас']
]).resize();

// Меню Таро (без «Кельтского креста» и «Карты дня»)
const tarotKeyboard = () => Markup.keyboard([
  ['💰 Расклад на деньги', '🧭 Расклад на судьбу'],
  ['💞 Таро совместимость', '🔯 Таро знак'],
  ['⬅️ Назад в меню']
]).resize();

const predictKeyboard = () => Markup.keyboard([
  ['💘 Оракул любви', '💰 Оракул достатка'],
  ['🧭 Оракул предназначения'],
  ['⬅️ Назад в меню']
]).resize();

const PREDICT_BUTTON_TO_PERSONA = {
  '💘 Оракул любви': 'love_oracle',
  '💰 Оракул достатка': 'wealth_oracle',
  '🧭 Оракул предназначения': 'path_oracle'
};

// ==== PERSONA META (имена и приветствия) ====
const PERSONA_META = {
  love_oracle: {
    name: 'Лиора',
    title: 'оракул любви',
    hello:
`✨ Я — Лиора, оракул любви. Помогаю разбираться в чувствах, притяжении и тонкостях диалога.
Спроси о переписке, свидании, шансах на примирение, перспективах пары или о том, как встретить «своего» человека.
Примеры: 
• «Стоит ли писать первым/первой?» 
• «Куда движутся наши отношения?» 
• «Как мягко обсудить важное?» 💞`
  },
  wealth_oracle: {
    name: 'Август',
    title: 'оракул достатка',
    hello:
`✨ Я — Август, оракул достатка. Смотрю в траекторию денег, сделок и возможностей.
Помогу про фокус недели, ближайший риск и точку роста дохода. 
Примеры:
• «Какой шаг быстрее всего увеличит доход?» 
• «Как проходит сделка и где слабое место?» 
• «На что держать фокус 7 дней?» 💰`
  },
  path_oracle: {
    name: 'Аэон',
    title: 'оракул предназначения',
    hello:
`✨ Я — Аэон, оракул предназначения. Подсвечу поворот на пути, урок и следующий шаг.
Подходит для поиска себя, смены сферы, запуска проекта.
Примеры:
• «В каком направлении развиваться сейчас?» 
• «Что завершить, чтобы перейти на новый этап?» 
• «Какой один шаг даст ощутимый прогресс?» 🧭`
  }
};

// ==== DATA: Zodiac (для гороскопа и «Таро знак») ====
const ZODIAC = [
  { key: 'oven',      label: 'Овен',      emoji: '♈' },
  { key: 'telec',     label: 'Телец',     emoji: '♉' },
  { key: 'bliznecy',  label: 'Близнецы',  emoji: '♊' },
  { key: 'rak',       label: 'Рак',       emoji: '♋' },
  { key: 'lev',       label: 'Лев',       emoji: '♌' },
  { key: 'deva',      label: 'Дева',      emoji: '♍' },
  { key: 'vesy',      label: 'Весы',      emoji: '♎' },
  { key: 'skorpion',  label: 'Скорпион',  emoji: '♏' },
  { key: 'strelec',   label: 'Стрелец',   emoji: '♐' },
  { key: 'kozerog',   label: 'Козерог',   emoji: '♑' },
  { key: 'vodolej',   label: 'Водолей',   emoji: '♒' },
  { key: 'ryby',      label: 'Рыбы',      emoji: '♓' },
];
const labelToKey = {};
ZODIAC.forEach(z => labelToKey[`${z.emoji} ${z.label}`] = z.key);

// ==== TAROT (Major Arcana) ====
const TAROT_MAJOR = [
  { key:'fool',name:'0 Шут',upright:'начало, спонтанность, доверие пути',reversed:'наивность, риск без плана',
    core:'старт нового цикла и смелость попробовать',vector:'идти, даже если нет полной карты местности',tip:'Оставь простор импровизации, но зафиксируй один маяк.'},
  { key:'magician',name:'I Маг',upright:'сила намерения, фокус, действие',reversed:'рассеянность, манипуляция',
    core:'канализация воли в результат',vector:'собрать ресурсы и применить здесь и сейчас',tip:'Скажи вслух цель и сделай первый практический шаг.'},
  { key:'priestess',name:'II Верховная Жрица',upright:'интуиция, тайна, внутренний голос',reversed:'закрытость, игнор интуиции',
    core:'глубинное знание, которое тихо подсказывает',vector:'замедлиться и услышать нюансы',tip:'Запиши сны/ощущения — это станет картой.'},
  { key:'empress',name:'III Императрица',upright:'изобилие, забота, творчество',reversed:'застой, лишний контроль',
    core:'рост, питание, плодородная среда',vector:'дать форму и тепло идее/людям',tip:'Укрась пространство — это ускорит рост.'},
  { key:'emperor',name:'IV Император',upright:'структура, авторитет, опора',reversed:'жёсткость, упрямство',
    core:'рамки, на которые можно опереться',vector:'зафиксировать правила и порядок',tip:'Опиши регламент и следуй ему неделю.'},
  { key:'hierophant',name:'V Иерофант',upright:'традиции, наставник, знание',reversed:'догмы, слепое следование',
    core:'связь с опытом школы/сообщества',vector:'опереться на метод/учителя',tip:'Возьми совет у авторитета и примени мягко.'},
  { key:'lovers',name:'VI Влюблённые',upright:'выбор сердцем, союз, гармония',reversed:'сомнения, разлад',
    core:'встреча ценностей и взаимность',vector:'согласовать «хочу» и «надо» и выбрать',tip:'Назови свои ценности перед шагом.'},
  { key:'chariot',name:'VII Колесница',upright:'воля, движение вперёд, победа',reversed:'импульсивность, торможение',
    core:'собранная сила и курс',vector:'держать руль и ускоряться, когда ясно',tip:'Отсечь отвлекающее и дать спринт-окно.'},
  { key:'strength',name:'VIII Сила',upright:'мужество, мягкая власть, стойкость',reversed:'неуверенность, подавление',
    core:'сердечная мощь и выдержка',vector:'укрощать, а не подавлять',tip:'Выбери один страх и посмотри спокойно.'},
  { key:'hermit',name:'IX Отшельник',upright:'поиск истины, тишина, осмысление',reversed:'изоляция, уход от жизни',
    core:'освещение дороги изнутри',vector:'побыть одному, чтобы понять суть',tip:'30 минут тишины с блокнотом — и яснее.'},
  { key:'fortune',name:'X Колесо Фортуны',upright:'поворот, шанс, цикл',reversed:'застревание, сопротивление переменам',
    core:'смена фазы, новый виток',vector:'увидеть окно удачи и шагнуть',tip:'Лови синхронии, не держись за старое.'},
  { key:'justice',name:'XI Справедливость',upright:'равновесие, закон, честность',reversed:'несоответствие, предвзятость',
    core:'баланс причины и следствия',vector:'сверить факты и уравновесить',tip:'Прими одно взрослое решение письменно.'},
  { key:'hanged',name:'XII Повешенный',upright:'пауза, новый взгляд, отпускание',reversed:'жертва без смысла, застой',
    core:'инсайт из другого ракурса',vector:'остановиться и посмотреть иначе',tip:'Поменяй порядок действий — увидишь путь.'},
  { key:'death',name:'XIII Смерть',upright:'завершение, трансформация, новая глава',reversed:'страх перемен, цепляние',
    core:'закрыть дверь, чтобы открыть следующую',vector:'завершить и перенастроиться',tip:'Сделай мини-ритуал завершения.'},
  { key:'temper',name:'XIV Умеренность',upright:'баланс, такт, постепенность',reversed:'перекосы, крайности',
    core:'смешивание в нужной пропорции',vector:'регулировать темп и дозировку',tip:'Делай по 20 минут — эффект сложится.'},
  { key:'devil',name:'XV Дьявол',upright:'искушение, привязки, тени',reversed:'освобождение, осознание оков',
    core:'сила желания и контракт с тенью',vector:'заметить, где рулит привычка',tip:'Назови привязку — власть ослабнет.'},
  { key:'tower',name:'XVI Башня',upright:'неожиданность, обрушение старого',reversed:'затянутая кризисность',
    core:'демонтаж ложной конструкции',vector:'быстро убрать мешающее сути',tip:'Собери базу заново — проще и честнее.'},
  { key:'star',name:'XVII Звезда',upright:'надежда, вдохновение, исцеление',reversed:'сомнение, потеря веры',
    core:'чистый ориентир и тихая вера',vector:'делать, опираясь на внутренний свет',tip:'Дай себе паузу — идеи всплывут.'},
  { key:'moon',name:'XVIII Луна',upright:'сновидность, подсознание, смутность',reversed:'прояснение, выход из тумана',
    core:'неявные смыслы и эмоции',vector:'наблюдать волны, не тонуть',tip:'Вечером — диджитал-детокс для ясности.'},
  { key:'sun',name:'XIX Солнце',upright:'радость, ясность, успех',reversed:'эго, выгорание',
    core:'жизненная энергия и простота',vector:'раскрыться и поделиться',tip:'Сделай дело при свете и отпразднуй малое.'},
  { key:'judgement',name:'XX Суд',upright:'пробуждение, итог, новый выбор',reversed:'самокритика, отсрочка решения',
    core:'зов к обновлению и честному ответу',vector:'подвести черту и откликнуться',tip:'Назови срок — и шагни сегодня.'},
  { key:'world',name:'XXI Мир',upright:'завершённость, интеграция, целостность',reversed:'незавершённость, повтор цикла',
    core:'собранная картина и круг, сошедшийся в точку',vector:'закрыть проект и перейти на уровень выше',tip:'Поставь финальную точку и открой новый трек.'},
];

let TAROT_IMAGES = {};
try {
  TAROT_IMAGES = require('./cards.json');
} catch {
  TAROT_IMAGES = {};
}
let _cardsMtime = 0;
const _cardsPath = path.join(__dirname, 'cards.json');
function _maybeReloadCards() {
  try {
    const m = fs.statSync(_cardsPath).mtimeMs || 0;
    if (m > _cardsMtime) {
      delete require.cache[require.resolve('./cards.json')];
      TAROT_IMAGES = require('./cards.json');
      _cardsMtime = m;
      console.log('[cards] reloaded:', new Date(m).toISOString());
    }
  } catch {}
}
setInterval(_maybeReloadCards, 60000);

// ==== Utils ====
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffledSeeded(arr, seed) {
  const a = arr.slice();
  const rnd = mulberry32(seed >>> 0);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function getPeerId(ctx) {
  return (ctx.chat && ctx.chat.id) || (ctx.from && ctx.from.id) || null;
}
function getChatState(ctx) {
  const id = getPeerId(ctx);
  if (id == null) return null;
  if (!S.has(id)) S.set(id, { section: 'root', sub: null, tmp: {} });
  return S.get(id);
}
function setSection(ctx, section, sub = null) {
  const st = getChatState(ctx);
  if (!st) return;
  st.section = section; st.sub = sub; st.tmp = {};
}
function normalizeKeyForImg(s=''){
  return s.toLowerCase().trim()
    .replace(/ё/g,'е')
    .replace(/[^a-zа-я0-9\s-]/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function getImgIdByName(name){
  return TAROT_IMAGES[name] || TAROT_IMAGES[normalizeKeyForImg(name)];
}
// учитываем перевёрнутые варианты, если есть
function getImgIdForCard(c) {
  if (c?.isReversed) {
    const revKey1 = `${c.name} (перевёрнутая)`;
    const revKey2 = `${normalizeKeyForImg(c.name)} (перевёрнутая)`;
    if (TAROT_IMAGES[revKey1]) return TAROT_IMAGES[revKey1];
    if (TAROT_IMAGES[revKey2]) return TAROT_IMAGES[revKey2];
  }
  return getImgIdByName(c?.name);
}

function dailySeed(chatId) {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
  const str = `${chatId}|${ymd}`;
  let h = 0; for (let i = 0; i < str.length; i++) h = (h*31 + str.charCodeAt(i)) & 0xffffffff;
  return (h >>> 0);
}
function strHash32(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function stripCodeFences(s='') {
  return s.replace(/^```(?:json|md|markdown)?\s*/i, '').replace(/```$/i, '').trim();
}

const TAROT_READER_NAME = 'Аэлла';

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function typing(ctx, ms=1200) {
  try { await ctx.sendChatAction('typing'); } catch {}
  await sleep(ms);
}

// ==== SIMPLE DRAWS ====
function drawOneSeeded(chatId, salt=0){
  const seed = (dailySeed(chatId) ^ (0xD00D1234 + salt)) >>> 0;
  const deck = shuffledSeeded(TAROT_MAJOR, seed);
  const c = deck[0];
  const rev = (((seed>>5)%100) < 48);
  return { ...c, isReversed: rev, meaning: rev?c.reversed:c.upright };
}
function drawNSeeded(chatId, n, salt=0){
  const seed = (dailySeed(chatId) ^ (0xBEEF0000 + n + salt)) >>> 0;
  const deck = shuffledSeeded(TAROT_MAJOR, seed);
  return deck.slice(0,n).map((c,i)=>{
    const rev = ((((seed>>3)+(i*97))%100)<46);
    return { ...c, isReversed: rev, meaning: rev?c.reversed:c.upright };
  });
}

// ==== OFFLINE NARRATIVE HELPERS ====
function formatCardLine(c){
  return `• ${c.name}${c.isReversed ? ' (перевёрнутая)' : ''}`;
}

// ==== LLM TARО: Структурные расклады (опционально) ====
async function tarotNarrativeStructured(type, q, cards, extra = {}) {
  if (!client || !USE_LLM_TAROT) return null;

  const sys = `
Ты — таролог-рассказчик. Пиши по структуре и в контексте ТИПА расклада:
— money: {Потенциал, Риски, Ресурсы, Шаг}.
— fate:  {Сюжет, Урок, Поддержка, Препятствие, Следующий шаг}.
— compat:{Вы, Партнёр, Динамика, Ресурс связи, Слабое звено}.
— sign:  {Корень, Текущий узел, Шаг} — учитывай подпись знака, если передана.

Формат:
1) Вступление (1 предложение).
2) По каждой позиции: «Эмодзи + Название: КАРТА — 1–2 предложения трактовки (meaning/core/vector/tip)».
3) «Ответ на вопрос:» — 2–4 предложения и практический шаг.
130–220 слов.
`.trim();

  const positionsByType = {
    money: ['Потенциал','Риски','Ресурсы','Шаг'],
    fate:  ['Сюжет','Урок','Поддержка','Препятствие','Следующий шаг'],
    compat:['Вы','Партнёр','Динамика','Ресурс связи','Слабое звено'],
    sign:  ['Корень','Текущий узел','Шаг'],
  };

  const payload = {
    type, question: q, positions: positionsByType[type] || [],
    extra,
    cards: cards.map((c) => ({
      card: c.name,
      state: c.isReversed ? 'перевёрнутая' : 'прямая',
      meaning: c.meaning, core: c.core, vector: c.vector, tip: c.tip
    })),
  };

  const r = await client.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user',   content: JSON.stringify(payload) }
    ],
    temperature: 0.8,
    max_tokens: 700
  });

  return (r.choices?.[0]?.message?.content || '').trim();
}

function offlineStructuredAnswer(kind, q, extraSignLabel, cards) {
  const pick = (i) => cards[i] || {};
  const line = (emoji, title, c) => {
    const r = c.isReversed ? ' (перевёрнутая)' : '';
    const glue = [c.meaning, c.core, c.vector, c.tip].filter(Boolean).join('. ');
    return `${emoji} <b>${title}:</b> ${c.name}${r} — ${glue}.`;
  };

  if (kind === 'money') {
    return [
      `🔷 Расклад о финансах относительно запроса: «${q}».`,
      line('✨','Потенциал', pick(0)),
      line('⚠️','Риски',     pick(1)),
      line('🧰','Ресурсы',   pick(2)),
      line('🪄','Шаг',       pick(3)),
      `🔮 <b>Ответ на вопрос:</b> сосредоточьтесь на одном измеримом действии, избегайте очевидного риска и опирайтесь на имеющиеся связи/навыки.`
    ].join('\n\n');
  }
  if (kind === 'fate') {
    return [
      `🔷 Контур пути по теме: «${q}».`,
      line('✨','Сюжет',        pick(0)),
      line('📚','Урок',         pick(1)),
      line('🤝','Поддержка',    pick(2)),
      line('🚧','Препятствие',  pick(3)),
      line('🪄','Следующий шаг',pick(4)),
      `🔮 <b>Ответ на вопрос:</b> признайте смену фазы, уберите лишнее и сделайте небольшой, но решающий шаг — ясность придёт в движении.`
    ].join('\n\n');
  }
  if (kind === 'compat') {
    return [
      `🔷 Совместимость: «${q}».`,
      line('🙋','Вы',             pick(0)),
      line('🧩','Партнёр',        pick(1)),
      line('🔗','Динамика',       pick(2)),
      line('🛡️','Ресурс связи',  pick(3)),
      line('⚠️','Слабое звено',  pick(4)),
      `🔮 <b>Ответ на вопрос:</b> укрепляйте общие опоры и проговаривайте тонкие места без спешки; договорённость о темпе и границах снизит напряжение.`
    ].join('\n\n');
  }
  if (kind === 'sign') {
    const head = extraSignLabel ? ` (${extraSignLabel})` : '';
    return [
      `🔷 Таро-знак${head}. Вопрос: «${q}».`,
      line('🌱','Корень',        pick(0)),
      line('🧶','Текущий узел',  pick(1)),
      line('🪄','Шаг',           pick(2)),
      `🔮 <b>Ответ на вопрос:</b> держитесь сильных качеств знака и делайте шаги дозированно; маленькая последовательность даст больший эффект.`
    ].join('\n\n');
  }
  return `🔮 Карты предлагают действовать просто и последовательно.`;
}

function htmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- Follow-ups ---
const INLINE_FOLLOWUP_PREFIX = 'tarot:followup#';
const INLINE_CLARIFY_PREFIX  = 'tarot:clarify#';

const CB_STORE = new Map();
function cbSave(data, ttlMs = 15 * 60 * 1000) {
  const id = Math.random().toString(36).slice(2, 10);
  CB_STORE.set(id, data);
  setTimeout(() => CB_STORE.delete(id), ttlMs);
  return id;
}
function cbLoad(id) { return CB_STORE.get(id); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeFollowupSuggestions(kind, q, extra = {}) {
  if (kind === 'money') {
    return [
      { label: 'Какой один шаг быстрее всего увеличит доход?', q: 'Какой один шаг быстрее всего увеличит мой доход?' },
      { label: 'Где ближайший риск в финансах и как его смягчить?', q: 'Где ближайший риск в моих финансах и как его смягчить?' },
      { label: 'На что держать фокус 7 дней?', q: 'На чём держать фокус в деньгах ближайшие 7 дней?' },
      { label: 'Что мешает сделке пройти легче?', q: 'Что мешает сделке пройти легче и как убрать помеху?' },
    ];
  }
  if (kind === 'fate') {
    return [
      { label: 'Какой сюжет недели главный?', q: 'Какой сюжет недели для меня главный и где окно возможностей?' },
      { label: 'Что завершить для нового этапа?', q: 'Что мне стоит завершить прямо сейчас, чтобы открыть новый этап?' },
      { label: 'Какой смелый шаг упростит путь?', q: 'Какой один смелый шаг упростит мой путь?' },
      { label: 'Что отпустить, чтобы стало легче?', q: 'Что стоит отпустить, чтобы стало легче?' },
    ];
  }
  if (kind === 'compat') {
    return [
      { label: 'Как бережно выровнять диалог?', q: 'Как бережно выровнять наш диалог и снизить напряжение?' },
      { label: 'Где ближайшая точка роста пары?', q: 'В чём наша ближайшая точка роста как пары?' },
      { label: 'Что обсудить, чтобы не застрять?', q: 'Что лучше обсудить сейчас, чтобы не застрять?' },
      { label: 'Какие границы помогут сблизиться?', q: 'Какие границы помогут нам сблизиться?' },
    ];
  }
  if (kind === 'sign') {
    const sign = extra.sign ? `(${extra.sign}) ` : '';
    return [
      { label: 'Какая опора знака поможет сейчас?', q: `${sign}Какая опора моего знака поможет прямо сейчас?` },
      { label: 'Фокус на 7 дней?', q: `${sign}На чём держать фокус ближайшие 7 дней?` },
      { label: 'Как мягче пройти узел?', q: `${sign}Как мягче пройти текущий узел?` },
      { label: 'Какой шаг даст прогресс?', q: `${sign}Какой шаг даст ощутимый прогресс?` },
    ];
  }
  return [];
}
function pickFollowups(kind, q, extra = {}, salt = 0, lastShown = []) {
  const base = makeFollowupSuggestions(kind, q, extra);
  if (!base.length) return [];
  const filtered = base.filter(s => !lastShown.includes(s.label));
  const pool = filtered.length >= 2 ? filtered : base;
  return shuffle(pool).slice(0, 2);
}
function buildFollowupButtonsCb(kind, suggestions) {
  if (!suggestions?.length) return Markup.inlineKeyboard([]);
  const row = suggestions.map((s) => {
    const id = cbSave({ kind, q: s.q });
    return Markup.button.callback(s.label, INLINE_FOLLOWUP_PREFIX + id);
  });
  return Markup.inlineKeyboard([row]);
}
function buildClarifyButton(q = '') {
  const id = cbSave({ q: String(q || '').slice(0, 300) });
  return Markup.inlineKeyboard([
    [Markup.button.callback('🪄 Пояснительная карта', INLINE_CLARIFY_PREFIX + id)]
  ]);
}

// Показываем 1..n карт альбомом (если есть file_id), иначе — текст
async function sendCardsImageOrStub(ctx, spread){
  const chatId = getPeerId(ctx);
  const media = [];

  for (let i = 0; i < spread.length; i++) {
    const c = spread[i];
    const imgId = getImgIdForCard(c);
    if (imgId) {
      const caption = `• ${c.name}${c.isReversed ? ' (перевёрнутая)' : ''}`;
      media.push({ type: 'photo', media: imgId, caption });
    }
  }

  if (media.length) {
    await ctx.telegram.sendMediaGroup(chatId, media);
  } else {
    await ctx.reply('🃏 Карты готовы.');
  }
}

// Позиции под разные расклады
function positionsFor(kind) {
  if (kind === 'money')  return ['Потенциал','Риски','Ресурсы','Шаг'];
  if (kind === 'fate')   return ['Сюжет','Урок','Поддержка','Препятствие','Следующий шаг'];
  if (kind === 'compat') return ['Вы','Партнёр','Динамика','Ресурс связи','Слабое звено'];
  if (kind === 'sign')   return ['Корень','Текущий узел','Шаг'];
  return [];
}

function getSignLabelByKey(key) {
  const z = ZODIAC.find(z => z.key === key);
  return z ? `${z.emoji} ${z.label}` : key || '';
}

function buildCardByCardText(kind, spread) {
  const pos = positionsFor(kind);
  return spread.map((c, i) => {
    const head = pos[i] ? `<b>${htmlEscape(pos[i])}</b>` : `Карта ${i+1}`;
    const rev  = c.isReversed ? ' (перевёрнутая)' : '';
    const tip  = c.tip ? ` ${htmlEscape(c.tip)}` : '';
    return `— ${head}: ${htmlEscape(c.name)}${rev}. ${htmlEscape(c.meaning)}${tip}`;
  }).join('\n');
}

// ==== Tarot answer flow ====
async function performTarotAnswer(ctx, kind, q, opts = {}) {
  const { isFollowup = false } = opts;
  const st = getChatState(ctx);
  const chatId = getPeerId(ctx);

  const round = st?.tmp?.rounds || 0;
  const salt = (
    dailySeed(chatId) ^
    strHash32(kind || '') ^
    strHash32(q || '') ^
    (isFollowup ? (round * 99991) : 0)
  ) >>> 0;

  let n = 0;
  let extra = {};
  if (kind === 'money') n = 4;
  else if (kind === 'fate') n = 5;
  else if (kind === 'compat') n = 5;
  else if (kind === 'sign') { n = 3; extra.sign = getSignLabelByKey(st?.tmp?.signKey); }
  else { await ctx.reply('Неизвестный тип расклада.'); return; }

  const spread = drawNSeeded(chatId, n, salt);

  await sendCardsImageOrStub(ctx, spread);
  await ctx.reply('🔮 Читаю твои карты… 🌀 Сейчас всё расскажу 🌀');

  let narrative = null;
  try {
    narrative = await tarotNarrativeStructured(kind, q, spread, extra);
  } catch (e) {
    console.error('tarotNarrativeStructured error:', e);
  }
  if (!narrative) {
    narrative = offlineStructuredAnswer(kind, q, extra.sign, spread);
  }

  const prev = st?.tmp?.lastFollowups || [];
  const suggestions = pickFollowups(kind, q, extra, salt, prev);
  const buttons = buildFollowupButtonsCb(kind, suggestions);

  const headSign = (kind === 'sign' && extra.sign) ? `(${htmlEscape(extra.sign)})\n` : '';
  const finalText =
    `${headSign}${htmlEscape(narrative)}\n\n` +
    `✨ <b>Спроси у колоды</b>:`; // кнопки придут как reply_markup

  await ctx.reply(finalText, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...buttons
  });

  const st2 = getChatState(ctx);
  if (st2) {
    st2.tmp.rounds        = (st2.tmp.rounds || 0) + (isFollowup ? 1 : 0);
    st2.tmp.lastQ         = q;
    st2.tmp.lastKind      = kind;
    st2.tmp.lastFollowups = suggestions.map(s => s.label);
    st2.sub = 'tarot-active';
  }
}

// ==== Daily Tarot Narrative (человечный текст) ====
async function tarotDailyNarrative(card) {
  if (!client || !USE_LLM_TAROT) {
    const name = `${card.name}${card.isReversed ? ' (перевёрнутая)' : ''}`;
    return `${name} напоминает о простых шагах и внимательности к себе. Смотрите на события дня как на возможность потренировать осознанность и спокойный фокус. Одно небольшое действие по делу — лучше, чем десяток планов. ✨`;
  }

  const sys = `
Ты таролог-рассказчик. Напиши связный текст 90–130 слов о значении карты дня.
Не используй ярлыки "Энергия/Вектор/Совет".
Говори просто, как другу: что несёт карта, чему учит, как применить сегодня.
Опирайся на meaning/core/vector/tip, не придумывай новых трактовок.
Добавь 1–2 уместных эмодзи.
`.trim();

  const payload = {
    card: card.name,
    state: card.isReversed ? 'перевёрнутая' : 'прямая',
    meaning: card.meaning,
    core: card.core,
    vector: card.vector,
    tip: card.tip
  };

  const r = await client.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(payload) }
    ],
    temperature: 0.85,
    max_tokens: 380
  });

  return (r.choices?.[0]?.message?.content || '').trim();
}

// ==== MIDDLEWARE ====
bot.use(async (ctx, next) => {
  const id = getPeerId(ctx);
  if (id == null) return;
  if (!S.has(id)) S.set(id, { section: 'root', sub: null, tmp: {} });
  return next();
});

// ==== NAV ====
bot.start(async (ctx) => {
  setSection(ctx, 'root');

  const payload = (ctx.startPayload || '').trim();
  if (payload && payload.startsWith('ask_')) {
    try {
      const json = b64urlDecode(payload.slice(4));
      const data = JSON.parse(json);
      const kind = data.kind;
      const q    = data.q || '';

      const st = getChatState(ctx);
      st.section = 'tarot';
      st.sub = 'tarot-active';

      await typing(ctx, 800);
      await performTarotAnswer(ctx, kind, q, { isFollowup: true });
      return;
    } catch (e) {
      console.error('start payload parse error:', e);
    }
  }

  await ctx.reply(
    'Привет! Я TG Esoterica Bot — проводник по Тарологии, Гороскопам и Предсказаниям.\nВыбирай раздел ниже 👇',
    mainKeyboard()
  );
});

bot.command('catch', async (ctx) => {
  await ctx.reply('Пришлите фото/документ, я верну file_id.');
});

bot.command('persona', (ctx) => {
  const arg = (ctx.message.text.split(' ')[1] || '').toLowerCase();
  const map = { love: 'love_oracle', money: 'wealth_oracle', path: 'path_oracle' };
  const key = map[arg];
  if (!key) return ctx.reply('Выбери: /persona love | /persona money | /persona path');
  setPersona(ctx.chat.id, key);
  return ctx.reply(`Персона переключена: ${key}`);
});

bot.hears(['🔮 Тарология'], async (ctx) => {
  setSection(ctx, 'tarot');
  await ctx.reply('✨ Какие тайны хотите раскрыть сегодня? Выберите расклад.', tarotKeyboard());
});

bot.hears(['♈️ Гороскоп'], async (ctx) => {
  setSection(ctx, 'horoscope');
  await ctx.reply('Выберите ваш знак Зодиака:', Markup.keyboard([
    ['♈ Овен','♉ Телец','♊ Близнецы'],
    ['♋ Рак','♌ Лев','♍ Дева'],
    ['♎ Весы','♏ Скорпион','♐ Стрелец'],
    ['♑ Козерог','♒ Водолей','♓ Рыбы'],
    ['⬅️ Назад в меню']
  ]).resize());
});

bot.hears(['🗣 Предсказание'], async (ctx) => {
  setSection(ctx, 'predict');
  await ctx.reply('Кем хотите, чтобы было предсказание?', predictKeyboard());
});

bot.hears(['ℹ️ О нас'], async (ctx) => {
  setSection(ctx, 'root');
  await ctx.reply('Balakhmatov AI — креативная команда. Здесь — эзотерический бот: таро, гороскопы и предсказания. «Идиогия» — наш авторский раздел (скоро).', mainKeyboard());
});

bot.hears(['⬅️ Назад в меню'], async (ctx) => {
  setSection(ctx, 'root');
  await ctx.reply('Главное меню:', mainKeyboard());
});
bot.hears(['⬅️ Назад к знакам'], async (ctx) => {
  const st = getChatState(ctx);
  if (st.section === 'horoscope') {
    st.sub = null; st.tmp = {};
    await ctx.reply('Выберите ваш знак Зодиака:', Markup.keyboard([
      ['♈ Овен','♉ Телец','♊ Близнецы'],
      ['♋ Рак','♌ Лев','♍ Дева'],
      ['♎ Весы','♏ Скорпион','♐ Стрелец'],
      ['♑ Козерог','♒ Водолей','♓ Рыбы'],
      ['⬅️ Назад в меню']
    ]).resize());
  } else {
    await ctx.reply('Главное меню:', mainKeyboard());
  }
});

// ===== TAROT =====

// 🃏 Карта дня — «человечный» текст
bot.hears(['🃏 Карта дня'], async (ctx) => {
  const chatId = getPeerId(ctx);
  const seed = (dailySeed(chatId) * 2654435761) >>> 0;
  const idx = seed % TAROT_MAJOR.length;
  const base = TAROT_MAJOR[idx];
  const rev = ((seed >> 5) % 100) < 48;
  const card = { ...base, isReversed: rev, meaning: rev ? base.reversed : base.upright };

  const title = `🃏 Карта дня\n• ${card.name}${card.isReversed ? ' (перевёрнутая)' : ''}`;

  let narrative;
  try {
    narrative = await tarotDailyNarrative(card);
  } catch (e) {
    console.error('tarotDailyNarrative error:', e);
    narrative = `${card.name}${card.isReversed ? ' (перевёрнутая)' : ''} подсказывает: ${card.meaning}. Держите естественный темп и сделайте одно маленькое действие по делу. ✨`;
  }

  const imgId = getImgIdByName(card.name);
  if (imgId) {
    await ctx.replyWithPhoto(imgId, { caption: `${title}\n\n${narrative}` });
  } else {
    await ctx.reply(`${title}\n\n${narrative}`);
  }
});

// === Новые расклады, требующие вопроса ===
function tarotAskPrompt(kind) {
  const lines = {
    money: `Привет, я ${TAROT_READER_NAME}, ваш личный таролог.\nКолода готова. Сформулируйте вопрос о деньгах/доходе/сделке — и я сделаю расклад.`,
    fate:  `Привет, я ${TAROT_READER_NAME}.\nГотова к раскладу о судьбе. Напишите, что именно волнует — и посмотрим контур пути.`,
    compat:`Привет, я ${TAROT_READER_NAME}.\nСделаю расклад на совместимость. Напишите ваш вопрос или краткий контекст пары.`,
    sign:  `Привет, я ${TAROT_READER_NAME}.\nСначала выберите ваш знак, затем задайте вопрос — и я сверю расклад с энергетикой знака.`
  };
  return lines[kind] || `Привет, я ${TAROT_READER_NAME}. Напишите вопрос — и я сделаю расклад.`;
}

bot.hears(['💰 Расклад на деньги'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'tarot') return;
  st.sub = 'await-q-money'; st.tmp = {};
  await ctx.reply(tarotAskPrompt('money'));
});
bot.hears(['🧭 Расклад на судьбу'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'tarot') return;
  st.sub = 'await-q-fate'; st.tmp = {};
  await ctx.reply(tarotAskPrompt('fate'));
});
bot.hears(['💞 Таро совместимость'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'tarot') return;
  st.sub = 'await-q-compat'; st.tmp = { rounds: 0 };
  await ctx.reply(tarotAskPrompt('compat'));
});
bot.hears(['🔯 Таро знак'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'tarot') return;
  st.sub = 'await-sign'; st.tmp = {};
  await ctx.reply(tarotAskPrompt('sign'), Markup.keyboard([
    ['♈ Овен','♉ Телец','♊ Близнецы'],
    ['♋ Рак','♌ Лев','♍ Дева'],
    ['♎ Весы','♏ Скорпион','♐ Стрелец'],
    ['♑ Козерог','♒ Водолей','♓ Рыбы'],
    ['⬅️ Назад в меню']
  ]).resize());
});

// Выбор знака для «Таро знак» ИЛИ гороскопов
bot.hears([
  '♈ Овен','♉ Телец','♊ Близнецы',
  '♋ Рак','♌ Лев','♍ Дева',
  '♎ Весы','♏ Скорпион','♐ Стрелец',
  '♑ Козерог','♒ Водолей','♓ Рыбы',
], async (ctx, next) => {
  const st = getChatState(ctx);

  // Ветвь для "Таро знак"
  if (st.section === 'tarot' && st.sub === 'await-sign') {
    const key = labelToKey[ctx.message.text];
    if (!key) return;
    st.tmp.signKey = key;
    st.sub = 'await-q-sign';
    await ctx.reply(
      `Вы выбрали знак: ${ctx.message.text}\nТеперь напишите вопрос — и я сделаю расклад.`,
      Markup.removeKeyboard()
    );
    return;
  }

  // Если это не «Таро знак», отдаём управление гороскопу
  if (st.section !== 'horoscope') return typeof next === 'function' ? next() : undefined;

  // ==== ГОРOСКОПЫ ====
  if (st.sub === 'compat-wait-second') {
    const keyB = labelToKey[ctx.message.text];
    const keyA = st.tmp?.z1;
    if (!keyA || !keyB) return ctx.reply('Пожалуйста, выберите знак из списка.');
    await ctx.reply('Изучаю твои звезды… ✨');
    try {
      const txt = await gptZodiacReply({ type: 'compat', signA: keyA, signB: keyB });
      const a = ZODIAC.find(z => z.key === keyA), b = ZODIAC.find(z => z.key === keyB);
      await ctx.reply(`Совместимость ${a.emoji} ${a.label} + ${b.emoji} ${b.label}\n\n${txt}`);
    } catch (e) {
      console.error(e);
      await ctx.reply('Не удалось рассчитать совместимость. Проверьте OPENAI_API_KEY.');
    }
    st.sub = 'zodiac-picked';
    return;
  }

  const key = labelToKey[ctx.message.text];
  if (!key) return;
  st.sub = 'zodiac-picked';
  st.tmp.z1 = key;
  const z = ZODIAC.find(x => x.key === key);
  await ctx.reply(`Вы выбрали: ${z.emoji} ${z.label}. Что показать?`, Markup.keyboard([
    ['📅 Общий','❤️ Любовный','🔗 Совместимость'],
    ['🗓 Неделя','🗓 Месяц'],
    ['💼 Работа/Дела','🩺 Здоровье/Ресурс'],
    ['⬅️ Назад к знакам','⬅️ Назад в меню']
  ]).resize());
});

// ===== Гороскопы =====
const ZODIAC_PROMPTS = {
  general: `
Ты — мистический астролог-повествователь. Пиши ёмко, без "воды".
Учитывай архетип знака (traits/pitfalls), не противоречь ему.
Формат: 2–3 предложения про ближайшие дни + деталь темпа/переговоров + короткий совет.
90–140 слов, без списков. 1–3 эмодзи допустимы.
`.trim(),
  love: `
Ты — мистический астролог о любви. Учитывай архетип знака.
Формат: тенденция в отношениях/развилка + деталь коммуникации/тайминга + короткий совет.
90–130 слов, без списков. 1–3 эмодзи допустимы.
`.trim(),
  compat: `
Ты — астролог совместимости. Используй архетипы обоих знаков.
Формат: сила дуэта/трения/условия + деталь про границы/общение + короткий совет.
100–150 слов, без списков.
`.trim(),
  week: `
Ты — астролог-нарратолог. Учитывай архетип знака.
Формат: сюжет недели (начало/середина/выходные) + одна ключевая тема + короткий совет.
110–170 слов, без списков.
`.trim(),
  month: `
Ты — астролог-повествователь. Учитывай архетип знака.
Формат: линия месяца (старт/середина/развязка) + ключевой ресурс месяца + короткий совет.
130–190 слов, без списков.
`.trim(),
  work: `
Ты — астролог по делам и карьере. Учитывай архетип знака.
Формат: траектория задач/сделок/репутации + деталь процесса + совет.
100–150 слов, без списков.
`.trim(),
  health: `
Ты — астролог про ресурс/самочувствие (не врач). Учитывай архетип знака.
Формат: общий фон энергии + 1–2 детали режима (без диагнозов) + совет.
90–130 слов.
`.trim(),
};

const ZODIAC_ARCHETYPES = {
  oven:     { traits: 'импульс, инициативность, прямота, смелость, соревновательность', pitfalls: 'нетерпение, поспешность, резкость' },
  telec:    { traits: 'стабильность, практичность, терпение, вкусы, ресурсность', pitfalls: 'упрямство, инерция, материальная привязка' },
  bliznecy: { traits: 'ум, общительность, любопытство, гибкость, многозадачность', pitfalls: 'поверхностность, распыление, непостоянство' },
  rak:      { traits: 'эмпатия, забота, память, дом, интуиция', pitfalls: 'обидчивость, излишняя осторожность, ностальгия' },
  lev:      { traits: 'харизма, щедрость, творчество, лидерство, сцена', pitfalls: 'гордыня, драматизация, потребность в признании' },
  deva:     { traits: 'аналитика, аккуратность, сервис, здоровье, эффективность', pitfalls: 'перфекционизм, критичность, тревожность' },
  vesy:     { traits: 'дипломатия, вкус, баланс, партнёрство, эстетика', pitfalls: 'колебания, зависимость от одобрения' },
  skorpion: { traits: 'глубина, страсть, трансформация, стратегия, проницательность', pitfalls: 'ревность, крайности, скрытность' },
  strelec:  { traits: 'оптимизм, свобода, смысл, путешествия, обучение', pitfalls: 'излишний риск, прямолинейность, расплывчатые детали' },
  kozerog:  { traits: 'дисциплина, амбиции, структура, выносливость, стратегия', pitfalls: 'жёсткость, пессимизм, задержка удовольствий' },
  vodolej:  { traits: 'новаторство, независимость, круг общения, идеи, гуманизм', pitfalls: 'эксцентричность, отстранённость, упрямство' },
  ryby:     { traits: 'сочувствие, вдохновение, интуиция, мечтательность, духовность', pitfalls: 'размытые границы, уход от реальности' },
};

function _findZodiacByKey(key) { return ZODIAC.find(z => z.key === key); }

async function gptZodiacReply({ type, signA, signB = null, extraUserText = '' }) {
  if (!client) throw new Error('OpenAI client not configured');
  const sys = ZODIAC_PROMPTS[type];
  if (!sys) throw new Error(`Unknown zodiac type: ${type}`);

  const zA = _findZodiacByKey(signA);
  if (!zA) throw new Error(`Unknown signA: ${signA}`);
  const aArch = ZODIAC_ARCHETYPES[zA.key];

  let payload = {
    type,
    signA: `${zA.emoji} ${zA.label}`,
    signA_archetype: aArch,
    note: extraUserText?.slice(0, 400) || ''
  };

  if (signB) {
    const zB = _findZodiacByKey(signB);
    if (!zB) throw new Error(`Unknown signB: ${signB}`);
    payload.signB = `${zB.emoji} ${zB.label}`;
    payload.signB_archetype = ZODIAC_ARCHETYPES[zB.key];
  }

  const completion = await client.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(payload) }
    ],
    temperature: 0.9,
    max_tokens: 520,
    presence_penalty: 0.35,
    frequency_penalty: 0.25
  });
  return completion.choices?.[0]?.message?.content?.trim() || 'Сегодня звёзды молчат, но это тоже знак…';
}

// Гороскопные хендлеры
bot.hears(['📅 Общий'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  if (!client) return ctx.reply('Гороскоп временно недоступен.');
  const zKey = st.tmp?.z1; if (!zKey) return ctx.reply('Сначала выберите знак.');
  await ctx.reply('Гадаю… ✨');
  try {
    const txt = await gptZodiacReply({ type: 'general', signA: zKey });
    const z = _findZodiacByKey(zKey);
    await ctx.reply(`(${z.emoji} ${z.label})\n${txt}`);
  } catch (e) { console.error(e); await ctx.reply('Не удалось получить гороскоп.'); }
});
bot.hears(['❤️ Любовный'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  if (!client) return ctx.reply('Гороскоп временно недоступен.');
  const zKey = st.tmp?.z1; if (!zKey) return ctx.reply('Сначала выберите знак.');
  await ctx.reply('Гадаю… ✨');
  try {
    const txt = await gptZodiacReply({ type: 'love', signA: zKey });
    const z = _findZodiacByKey(zKey);
    await ctx.reply(`(${z.emoji} ${z.label})\n${txt}`);
  } catch (e) { console.error(e); await ctx.reply('Не удалось получить любовный прогноз.'); }
});
bot.hears(['🗓 Неделя'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  if (!client) return ctx.reply('Гороскоп временно недоступен.');
  const zKey = st.tmp?.z1; if (!zKey) return ctx.reply('Сначала выберите знак.');
  await ctx.reply('Гадаю… ✨');
  try {
    const txt = await gptZodiacReply({ type: 'week', signA: zKey });
    const z = _findZodiacByKey(zKey);
    await ctx.reply(`(${z.emoji} ${z.label}) — Неделя\n${txt}`);
  } catch (e) { console.error(e); await ctx.reply('Не удалось получить недельный прогноз.'); }
});
bot.hears(['🗓 Месяц'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  if (!client) return ctx.reply('Гороскоп временно недоступен.');
  const zKey = st.tmp?.z1; if (!zKey) return ctx.reply('Сначала выберите знак.');
  await ctx.reply('Гадаю… ✨');
  try {
    const txt = await gptZodiacReply({ type: 'month', signA: zKey });
    const z = _findZodiacByKey(zKey);
    await ctx.reply(`(${z.emoji} ${z.label}) — Месяц\n${txt}`);
  } catch (e) { console.error(e); await ctx.reply('Не удалось получить месячный прогноз.'); }
});
bot.hears(['💼 Работа/Дела'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  if (!client) return ctx.reply('Гороскоп временно недоступен.');
  const zKey = st.tmp?.z1; if (!zKey) return ctx.reply('Сначала выберите знак.');
  await ctx.reply('Гадаю… ✨');
  try {
    const txt = await gptZodiacReply({ type: 'work', signA: zKey });
    const z = _findZodiacByKey(zKey);
    await ctx.reply(`(${z.emoji} ${z.label}) — Работа/Дела\n${txt}`);
  } catch (e) { console.error(e); await ctx.reply('Не удалось получить рабочий прогноз.'); }
});
bot.hears(['🩺 Здоровье/Ресурс'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  if (!client) return ctx.reply('Гороскоп временно недоступен.');
  const zKey = st.tmp?.z1; if (!zKey) return ctx.reply('Сначала выберите знак.');
  await ctx.reply('Гадаю… ✨');
  try {
    const txt = await gptZodiacReply({ type: 'health', signA: zKey });
    const z = _findZodiacByKey(zKey);
    await ctx.reply(`(${z.emoji} ${z.label}) — Ресурс\n${txt}`);
  } catch (e) { console.error(e); await ctx.reply('Не удалось получить ресурсный прогноз.'); }
});
bot.hears(['🔗 Совместимость'], async (ctx) => {
  const st = getChatState(ctx); if (st.section !== 'horoscope' || st.sub !== 'zodiac-picked') return;
  st.sub = 'compat-wait-second';
  await ctx.reply('Выберите второй знак для сравнения:', Markup.keyboard([
    ['♈ Овен','♉ Телец','♊ Близнецы'],
    ['♋ Рак','♌ Лев','♍ Дева'],
    ['♎ Весы','♏ Скорпион','♐ Стрелец'],
    ['♑ Козерог','♒ Водолей','♓ Рыбы'],
    ['⬅️ Назад в меню']
  ]).resize());
});

// ==== ВВОД ВОПРОСА ДЛЯ РАСКЛАДОВ ====
bot.on('text', async (ctx, next) => {
  const st = getChatState(ctx);

  // Ветка «Предсказание»: ожидание вопроса после выбора персонажа
  if (st && st.section === 'predict' && st.sub === 'persona-wait-q') {
    const q = (ctx.message.text || '').trim();
    if (!q || q.startsWith('/')) return typeof next === 'function' ? next() : undefined;

    await ctx.reply('Гадаю… ✨');
    try {
      const ans = await personaReply(st.tmp.persona, q, []);
      await ctx.reply(ans || 'Ответ сейчас не сформировался. Попробуйте переформулировать вопрос.');
    } catch (e) {
      console.error(e);
      await ctx.reply('Не удалось получить предсказание. Проверьте OPENAI_API_KEY.');
    }
    return;
  }

  // Ветка «Тарология»
  if (!st || st.section !== 'tarot') {
    return typeof next === 'function' ? next() : undefined;
  }

  const q = (ctx.message.text || '').trim();
  if (!q || q.startsWith('/')) {
    return typeof next === 'function' ? next() : undefined;
  }

  if (st.sub === 'await-q-money') {
    st.tmp.kind = 'money';
    st.tmp.rounds = 0;
    await performTarotAnswer(ctx, 'money', q, { isFollowup: false });
    return;
  }
  if (st.sub === 'await-q-fate') {
    st.tmp.kind = 'fate';
    st.tmp.rounds = 0;
    await performTarotAnswer(ctx, 'fate', q, { isFollowup: false });
    return;
  }
  if (st.sub === 'await-q-compat') {
    st.tmp.kind = 'compat';
    st.tmp.rounds = 0;
    await performTarotAnswer(ctx, 'compat', q, { isFollowup: false });
    return;
  }
  if (st.sub === 'await-q-sign') {
    if (!st.tmp.signKey) {
      await ctx.reply('Сначала выберите знак, затем задайте вопрос.');
      return;
    }
    st.tmp.kind = 'sign';
    st.tmp.rounds = 0;
    await performTarotAnswer(ctx, 'sign', q, { isFollowup: false });
    return;
  }

  return typeof next === 'function' ? next() : undefined;
});

// ===== PREDICTION (PERSONAS) =====
bot.hears(['💘 Оракул любви','💰 Оракул достатка','🧭 Оракул предназначения'], async (ctx) => {
  const st = getChatState(ctx);
  if (st.section !== 'predict') return;

  const key = PREDICT_BUTTON_TO_PERSONA[ctx.message.text];
  if (!key) return;

  const meta = PERSONA_META[key];
  st.sub = 'persona-wait-q';
  st.tmp.persona = key;

  // Приветствие выбранного предсказателя
  const hello = meta
    ? `Вы выбрали: ${ctx.message.text}\n\n${meta.hello}`
    : `Предсказатель готов. Сформулируйте вопрос.`;

  await ctx.reply(hello, Markup.keyboard([
    ['⬅️ Назад в меню']
  ]).resize());
});

async function personaReply(personaKey, userText, history = []) {
  if (!client) throw new Error('OpenAI client not configured');
  if (!PERSONAS || !PERSONAS[personaKey]) throw new Error(`Unknown persona: ${personaKey}`);
  const systemPrompt = PERSONAS[personaKey];
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),
    { role: 'user', content: userText.slice(0, 1000) }
  ];
  const completion = await client.chat.completions.create({
    model: GPT_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 450,
    presence_penalty: 0.1,
    frequency_penalty: 0.1
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

// ==== INLINE-КНОПКИ: Followup и Пояснительная карта ====
bot.action(new RegExp('^' + INLINE_FOLLOWUP_PREFIX), async (ctx) => {
  try {
    const data = ctx.callbackQuery?.data || '';
    const id = data.slice(INLINE_FOLLOWUP_PREFIX.length);
    const saved = cbLoad(id);
    if (!saved) {
      await ctx.answerCbQuery('Кнопка устарела. Сделайте новый расклад.', { show_alert: true });
      return;
    }
    const { kind, q } = saved;
    const st = getChatState(ctx) || {};
    if (!st.tmp) st.tmp = {};
    st.tmp.kind = kind || st.tmp.kind || 'fate';

    await ctx.answerCbQuery('Спрашиваю колоду…');
    await performTarotAnswer(ctx, st.tmp.kind, q || '', { isFollowup: true });
  } catch (e) {
    console.error('followup action error:', e);
    await ctx.answerCbQuery('Не удалось спросить колоду', { show_alert: true });
  }
});

bot.action(new RegExp('^' + INLINE_CLARIFY_PREFIX), async (ctx) => {
  try {
    const data = ctx.callbackQuery?.data || '';
    const id = data.slice(INLINE_CLARIFY_PREFIX.length);
    const saved = cbLoad(id);
    if (!saved) {
      await ctx.answerCbQuery('Кнопка устарела.', { show_alert: true });
      return;
    }
    const { q } = saved;
    const st = getChatState(ctx) || {};
    const chatId = getPeerId(ctx);

    const salt = (strHash32(q || '') + (st.tmp?.rounds || 0) * 99991 + 424242) >>> 0;
    const c = drawOneSeeded(chatId, salt);

    await ctx.answerCbQuery('Пояснительная карта');
    const imgId = getImgIdByName(c.name);
    const head = `🪄 Пояснительная карта\n• ${c.name}${c.isReversed ? ' (перевёрнутая)' : ''}`;
    if (imgId) await ctx.replyWithPhoto(imgId, { caption: head });
    else await ctx.reply(head);
    await ctx.reply(`Уточнение: ${c.meaning}. ${c.vector}. ${c.tip}`);
  } catch (e) {
    console.error('clarify action error:', e);
    await ctx.answerCbQuery('Не удалось вытянуть карту', { show_alert: true });
  }
});

bot.launch().then(() => console.log('TG Esoterica Bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
