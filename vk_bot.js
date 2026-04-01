// ====== VK БОТ: приём скриншотов → ImgBB → Telegram ======
// Запуск: node vk_bot.js


// ====== НАСТРОЙКИ ======
const VK_TOKEN        = 'vk1.a.wSn31eD2YZcLVyV_7kN9WSUBagj2XK0aJNlZDxG4Zza3oaWnnYh0N6UJuffdAQOwiDzJbFtsWwZKzUo0LceRzLz4wZ62D8m-8Tn4HBkbQGTUHG6Gm76ascgrvIdmEgBIPKvvPtEXBM9gazy31FXV-EnI_aM8yPswYb449sYk9YY-Ii6kU0wiokay3c0TqGfLNsNWTSaZUrbW0Tsw6I9u_w';
const VK_GROUP_ID     = 226282989;          // ID сообщества, БЕЗ минуса
const BOT_SCREEN_NAME = '@club226282989 '; // короткое имя для @упоминания

// Берём из окружения (передаёт main.js при запуске) либо из fallback-значений
const TELEGRAM_TOKEN   = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const IMGBB_API_KEY    = process.env.IMGBB_KEY;
const IMGUR_CLIENT_ID  = process.env.IMGUR_ID;

// Доступные варианты времени отчёта
const REPORT_TIMES = ['10:00', '13:00', '16:00', '19:00'];

// Сколько скриншотов ждём
const SCREENS_COUNT = 3;

// Таймаут сессии (минуты)
const SESSION_TIMEOUT_MIN = 7;
// ====== КОНЕЦ НАСТРОЕК ======

// Состояния сессии:
//   waiting_time  — ждём выбора времени отчёта
//   collecting    — собираем скриншоты
//
// SessionObject: { state, reportTime, step, photos[], peerId, userId, timer }
const sessions = new Map();

function sessionKey(userId, peerId) { return `${userId}_${peerId}`; }

function clearSession(key) {
  const s = sessions.get(key);
  if (s?.timer) clearTimeout(s.timer);
  sessions.delete(key);
}

function resetSessionTimer(key) {
  const s = sessions.get(key);
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    console.log(`[SESSION] Таймаут сессии ${key}`);
    sessions.delete(key);
  }, SESSION_TIMEOUT_MIN * 60 * 1000);
}

// ====== VK API ======
async function vkCall(method, params = {}) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  url.searchParams.set('access_token', VK_TOKEN);
  url.searchParams.set('v', '5.131');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res  = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(`VK [${method}]: ${data.error.error_code} — ${data.error.error_msg}`);
  return data.response;
}

// Отправка обычного сообщения
async function sendVkMessage(peerId, text) {
  await vkCall('messages.send', {
    peer_id:   peerId,
    message:   text,
    random_id: Date.now(),
  });
}

// Отправка сообщения с клавиатурой (кнопки выбора времени)
async function sendVkKeyboard(peerId, text) {
  // Строим одну строку кнопок: 10:00 | 13:00 | 16:00 | 20:00
  const buttons = [
    REPORT_TIMES.map(t => ({
      action: { type: 'text', label: t, payload: JSON.stringify({ time: t }) },
      color:  'primary',
    })),
  ];
  const keyboard = JSON.stringify({ one_time: true, buttons });

  await vkCall('messages.send', {
    peer_id:   peerId,
    message:   text,
    keyboard,
    random_id: Date.now(),
  });
}

// ====== PHOTO UTILS ======
function getBestPhotoUrl(photoObj) {
  const priority = ['w', 'z', 'y', 'x', 'r', 'q', 'p', 'o', 'm', 's'];
  const sizeMap  = {};
  for (const s of (photoObj.sizes || [])) sizeMap[s.type] = s.url;
  for (const t of priority) if (sizeMap[t]) return sizeMap[t];
  return photoObj.sizes?.[photoObj.sizes.length - 1]?.url || null;
}

async function downloadImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать фото: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

// ====== UPLOAD TO HOSTING ======
async function uploadToImgbb(base64Image) {
  const form = new URLSearchParams();
  form.append('key', IMGBB_API_KEY);
  form.append('image', base64Image);
  const res  = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`ImgBB HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.success) throw new Error(`ImgBB: ${data.error?.message || 'Unknown error'}`);
  console.log('[UPLOAD] ImgBB OK:', data.data.url);
  return data.data.url;
}

async function uploadToImgur(base64Image) {
  const res = await fetch('https://api.imgur.com/3/image', {
    method:  'POST',
    headers: { 'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ image: base64Image, type: 'base64' }),
  });
  if (!res.ok) throw new Error(`Imgur HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.success) throw new Error(`Imgur: ${data.data?.error || 'Unknown error'}`);
  console.log('[UPLOAD] Imgur OK:', data.data.link);
  return data.data.link;
}

async function uploadImage(base64Image) {
  try { return await uploadToImgbb(base64Image); }
  catch (e) {
    console.log('[UPLOAD] ImgBB failed, trying Imgur...', e.message);
    return await uploadToImgur(base64Image);
  }
}

// ====== TELEGRAM ======
async function sendTelegramMessage(text) {
  const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMessage: ${data.description}`);
  return data;
}

// ====== CHAT TITLE CHECK ======
const ALLOWED_CHAT_TITLE = 'RED || Отчеты';

async function getChatTitle(peerId) {
  try {
    const res = await vkCall('messages.getConversationsById', { peer_ids: peerId });
    const conv = res?.items?.[0];
    return conv?.chat_settings?.title || conv?.peer?.local_id?.toString() || null;
  } catch (e) {
    console.error('[CHAT] Не удалось получить название чата:', e.message);
    return null;
  }
}

// ====== HANDLE MESSAGE ======
function isTrigger(text = '') {
  const lower = text.toLowerCase().trim();
  if (lower === '/screens') return true;
  if (lower.startsWith('/screens ')) return true;
  if (VK_GROUP_ID && lower.includes(`[club${VK_GROUP_ID}|`)) return true;
  if (lower.includes(BOT_SCREEN_NAME.toLowerCase())) return true;
  return false;
}

function parseTimeInput(text = '') {
  // Ищем время внутри строки (VK может добавить "@mention " перед текстом кнопки)
  for (const t of REPORT_TIMES) {
    if (text.includes(t)) return t;
    // Также принимаем просто число: "10", "13", "16", "19"
    if (text.trim() === t.split(':')[0]) return t;
  }
  return null;
}

function getPhotosFromAttachments(attachments = []) {
  return attachments.filter(a => a.type === 'photo').map(a => a.photo).filter(Boolean);
}

function todayString() {
  return new Date().toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  }); 
}

async function handleMessage(msg) {
  const userId      = msg.from_id;
  const peerId      = msg.peer_id;
  const text        = msg.text || '';
  const attachments = msg.attachments || [];
  const photos      = getPhotosFromAttachments(attachments);
  const key         = sessionKey(userId, peerId);

  if (!sessions.has(key)) {
    if (!isTrigger(text)) return;

    // Работаем только в разрешённом чате
    const chatTitle = await getChatTitle(peerId);
    if (!chatTitle || !chatTitle.includes(ALLOWED_CHAT_TITLE)) {
      console.log(`[IGNORED] Команда проигнорирована в чате "${chatTitle}"`);
      return;
    }

    sessions.set(key, { state: 'waiting_time', reportTime: null, step: 1, photos: [], peerId, userId, timer: null });
    resetSessionTimer(key);

    await sendVkKeyboard(peerId, '🕐 Выберите время, за которое подаёте отчёт:');
    return;
  }

  const session = sessions.get(key);

  if (session.state === 'waiting_time') {
    const chosenTime = parseTimeInput(text);

    if (!chosenTime) {
      await sendVkKeyboard(peerId,
        `⚠️ Пожалуйста, выберите время из предложенных вариантов: ${REPORT_TIMES.join(', ')}`
      );
      return;
    }

    session.reportTime = chosenTime;
    session.state      = 'collecting';
    resetSessionTimer(key);

    await sendVkMessage(peerId, `✅ Время отчёта: ${chosenTime}\n\n📸 Отправьте 1 скриншот`);
    return;
  }

  if (session.state === 'collecting') {
    if (photos.length === 0) {
      await sendVkMessage(peerId, `⚠️ Нужно фото. Отправьте скриншот ${session.step} из ${SCREENS_COUNT}`);
      return;
    }

    // Берём столько фото, сколько нужно до конца (не больше оставшихся)
    const needed = SCREENS_COUNT - session.photos.length;
    const batch  = photos.slice(0, needed);

    for (const photo of batch) {
      await acceptPhoto(key, photo);
      if (!sessions.has(key)) return; // сессия завершилась после последнего фото
    }
  }
}

// Загружает одно фото; если все собраны — финализирует
async function acceptPhoto(key, photoObj) {
  const session = sessions.get(key);
  if (!session) return;

  const photoUrl = getBestPhotoUrl(photoObj);
  if (!photoUrl) {
    await sendVkMessage(session.peerId, '❌ Не удалось получить URL фото. Попробуйте ещё раз.');
    return;
  }

  try {
    await sendVkMessage(session.peerId, `⏳ Загружаю скриншот ${session.step}...`);
    const base64    = await downloadImageAsBase64(photoUrl);
    const hostedUrl = await uploadImage(base64);
    session.photos.push(hostedUrl);
    console.log(`[SESSION] ${key} | скрин ${session.step}/${SCREENS_COUNT}: ${hostedUrl}`);
  } catch (e) {
    console.error('[SESSION] Ошибка загрузки фото:', e.message);
    await sendVkMessage(session.peerId, `❌ Ошибка загрузки: ${e.message}\nОтправьте скриншот ${session.step} ещё раз.`);
    return;
  }

  if (session.photos.length >= SCREENS_COUNT) {
    await finalizeSession(key);
  } else {
    session.step++;
    resetSessionTimer(key);
    await sendVkMessage(session.peerId, `📸 Отправьте скриншот ${session.step} из ${SCREENS_COUNT}`);
  }
}

async function finalizeSession(key) {
  const session = sessions.get(key);
  if (!session) return;
  clearSession(key);

  await sendToTelegram(session);
  await sendVkMessage(session.peerId, '✅ Все скриншоты загружены и отправлены!');
}

async function sendToTelegram(session) {
  const date = todayString();
  const lines = [
    `<b>${date}</b>`,
    `<b>${session.reportTime}</b>`,
    ``,
    ...session.photos.map((u, i) => `${u}`),
  ];
  try {
    await sendTelegramMessage(lines.join('\n'));
    console.log('[TELEGRAM] Отчёт отправлен. Дата:', date, 'Время:', session.reportTime);
  } catch (e) {
    console.error('[TELEGRAM] Ошибка отправки:', e.message);
  }
}

// ====== VK LONG POLL ======
async function getLongPollServer() {
  return await vkCall('groups.getLongPollServer', { group_id: VK_GROUP_ID });
}

async function poll(server, key, ts) {
  const res = await fetch(`${server}?act=a_check&key=${key}&ts=${ts}&wait=25`);
  return await res.json();
}

async function startPolling() {
  console.log('[VK] Запуск Long Poll...');
  let { server, key, ts } = await getLongPollServer();

  while (true) {
    try {
      const data = await poll(server, key, ts);

      if (data.failed) {
        console.log('[VK] Long Poll failed:', data.failed, '— переподключение...');
        if (data.failed === 2 || data.failed === 3) {
          const fresh = await getLongPollServer();
          server = fresh.server; key = fresh.key; ts = fresh.ts;
        } else if (data.failed === 1) {
          ts = data.ts;
        }
        continue;
      }

      ts = data.ts;

      for (const event of (data.updates || [])) {
        if (event.type !== 'message_new') continue;
        const msg = event.object?.message;
        if (!msg) continue;
        if (msg.from_id === -Math.abs(VK_GROUP_ID)) continue; // сообщение от самой группы
        if (msg.out) continue;

        handleMessage(msg).catch(e => console.error('[HANDLER]', e.message));
      }
    } catch (e) {
      console.error('[VK] Ошибка Long Poll:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ====== СТАРТ ======
process.on('unhandledRejection', r  => console.error('[UNHANDLED]', r));
process.on('uncaughtException',  e  => console.error('[EXCEPTION]', e));

console.log('====================================');
console.log('  VK Screen Bot | ImgBB → Telegram ');
console.log('====================================');
startPolling();
