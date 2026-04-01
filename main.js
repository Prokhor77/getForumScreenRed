const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('canvas');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ====== НАСТРОЙКИ ======
const TELEGRAM_TOKEN = '7428847499:AAGy5zYEU8vOtCHwOXr224xBBNLknfYgPvc';
const CHAT_ID = '602064856';
const COOKIES_FILE = path.join(__dirname, 'cookies.json');
// const DATALENS_COOKIES_FILE = path.join(__dirname, 'datalens_cookies.json');
const TEMP_COOKIE_FILE = path.join(__dirname, 'cookie.txt');
// const TEMP_DATALENS_COOKIE_FILE = path.join(__dirname, 'datalens_cookie.txt');

// API ключи для загрузки изображений
const IMGBB_API_KEY = '6090887c780d99638d99b78fc05b53ef';
const IMGUR_CLIENT_ID = 'b00e7b9fbc8dc07';

// Определяем, запущено ли на Linux
const isLinux = process.platform === 'linux';

// Современный User-Agent
const MODERN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const urls = [
  'https://forum.blackrussia.online/forums/%D0%96%D0%B0%D0%BB%D0%BE%D0%B1%D1%8B-%D0%BD%D0%B0-%D0%B0%D0%B4%D0%BC%D0%B8%D0%BD%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8E.86/',
  'https://forum.blackrussia.online/forums/%D0%96%D0%B0%D0%BB%D0%BE%D0%B1%D1%8B-%D0%BD%D0%B0-%D0%BB%D0%B8%D0%B4%D0%B5%D1%80%D0%BE%D0%B2.87/',
  'https://forum.blackrussia.online/forums/%D0%96%D0%B0%D0%BB%D0%BE%D0%B1%D1%8B-%D0%BD%D0%B0-%D0%B8%D0%B3%D1%80%D0%BE%D0%BA%D0%BE%D0%B2.88/',
  'https://forum.blackrussia.online/forums/%D0%9E%D0%B1%D0%B6%D0%B0%D0%BB%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5-%D0%BD%D0%B0%D0%BA%D0%B0%D0%B7%D0%B0%D0%BD%D0%B8%D0%B9.89/'
];

const descriptions = [
  'скриншот проверки раздела «жалобы на администрацию» - ',
  'скриншот проверки раздела «жалобы на лидеров» - ',
  'скриншот проверки раздела «жалобы на игроков» - ',
  'скриншот проверки раздела «обжалования наказаний» - '
];

let waitingForCookieFile = false;
// let waitingForDatalensCookieFile = false;

function loadCookies(isDatalens = false) {
  const cookieFile = isDatalens ? DATALENS_COOKIES_FILE : COOKIES_FILE;
  if (!fs.existsSync(cookieFile)) {
    throw new Error(`[COOKIES] Файл кук не найден: ${cookieFile}`);
  }
  const data = fs.readFileSync(cookieFile, 'utf8');
  const parsed = JSON.parse(data);
  console.log(`[COOKIES] Загружено ${parsed.length} кук из файла ${cookieFile}`);
  return parsed;
}

function saveCookies(cookies, isDatalens = false) {
  const cookieFile = isDatalens ? DATALENS_COOKIES_FILE : COOKIES_FILE;
  try {
    fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
    console.log(`Куки сохранены в файл ${cookieFile} (кол-во: ${cookies.length})`);
  } catch (error) {
    console.error('Ошибка сохранения кук:', error);
  }
}

function cleanCookies(cookies) {
  console.log(`[COOKIES] Очистка кук. Входящих кук: ${cookies.length}`);
  const cleaned = cookies.map(cookie => {
    const cleanedCookie = { ...cookie };
    if (cookie.sameSite === 'no_restriction') cleanedCookie.sameSite = 'None';
    else if (cookie.sameSite === 'strict') cleanedCookie.sameSite = 'Strict';
    else if (cookie.sameSite === 'lax') cleanedCookie.sameSite = 'Lax';
    else if (cookie.sameSite === null) delete cleanedCookie.sameSite;
    delete cleanedCookie.storeId;
    return cleanedCookie;
  });
  console.log(`[COOKIES] Очистка завершена. Кук после очистки: ${cleaned.length}`);
  return cleaned;
}

function parseNetscapeCookies(content) {
  console.log('[COOKIES] Парсинг Netscape cookie файла...');
  const lines = content.split('\n');
  const cookies = [];
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parts = line.split('\t');
    if (parts.length >= 7) {
      cookies.push({
        domain: parts[0],
        hostOnly: parts[1] !== 'TRUE',
        path: parts[2],
        secure: parts[3] === 'TRUE',
        expirationDate: parseInt(parts[4]) || null,
        name: parts[5],
        value: parts[6],
        httpOnly: false,
        session: parseInt(parts[4]) === 0
      });
    }
  }
  console.log(`[COOKIES] Netscape cookie файл распарсен. Найдено кук: ${cookies.length}`);
  return cookies;
}

async function uploadToImgbb(base64Image) {
  try {
    console.log('[UPLOAD] Пытаюсь загрузить на ImgBB...');
    const formData = new URLSearchParams();
    formData.append('key', IMGBB_API_KEY);
    formData.append('image', base64Image);
    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData,
    });
  
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ImgBB API Error: ${response.status} - ${errorText}`);
      throw new Error(`Ошибка загрузки на ImgBB: ${response.status} - ${errorText}`);
    }
  
    const data = await response.json();
  
    if (!data.success) {
      console.error(`ImgBB API Error: ${data.error?.message || 'Unknown error'}`);
      throw new Error(`Ошибка загрузки на ImgBB: ${data.error?.message || 'Unknown error'}`);
    }
  
    console.log('[UPLOAD] Успешная загрузка на ImgBB:', data.data.url);
    return data.data.url;
  } catch (error) {
    console.error('Ошибка при загрузке на ImgBB:', error);
    throw error;
  }
}

async function uploadToImgur(base64Image) {
  try {
    console.log('[UPLOAD] Пытаюсь загрузить на Imgur...');
    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Image,
        type: 'base64',
        name: `screenshot_${Date.now()}.png`,
        description: 'Screenshot from forum bot'
      }),
    });
  
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Imgur API Error: ${response.status} - ${errorText}`);
      throw new Error(`Ошибка загрузки на Imgur: ${response.status} - ${errorText}`);
    }
  
    const data = await response.json();
  
    if (!data.success) {
      console.error(`Imgur API Error: ${data.data?.error || 'Unknown error'}`);
      throw new Error(`Ошибка загрузки на Imgur: ${data.data?.error || 'Unknown error'}`);
    }
  
    console.log('[UPLOAD] Успешная загрузка на Imgur:', data.data.link);
    return data.data.link;
  } catch (error) {
    console.error('Ошибка при загрузке на Imgur:', error);
    throw error;
  }
}

async function uploadImage(base64Image) {
  const imageSize = Math.ceil((base64Image.length * 3) / 4);
  console.log(`Размер изображения: ${(imageSize / 1024 / 1024).toFixed(2)} MB`);

  if (imageSize > 10 * 1024 * 1024) {
    console.log('Изображение слишком большое для Imgur, используем только ImgBB');
    try {
      const url = await uploadToImgbb(base64Image);
      return url;
    } catch (error) {
      console.error('[UPLOAD] Ошибка загрузки слишком большого изображения:', error.message);
      throw new Error(`Изображение слишком большое (${(imageSize / 1024 / 1024).toFixed(2)} MB) для загрузки`);
    }
  }

  try {
    console.log('Попытка загрузки на ImgBB...');
    return await uploadToImgbb(base64Image);
  } catch (error) {
    console.log('ImgBB не работает, пробуем Imgur...');
    try {
      return await uploadToImgur(base64Image);
    } catch (imgurError) {
      console.error('Оба сервиса недоступны:', error.message, imgurError.message);
      throw new Error(`Не удалось загрузить изображение ни на ImgBB, ни на Imgur`);
    }
  }
}

async function makeScreenshot(page, url, index) {
  console.log(`[FORUM] Переход на страницу (${index + 1}): ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('[FORUM] Страница загружена, ждем 40 секунд для стабильности...');
  await new Promise(resolve => setTimeout(resolve, 40000));
  console.log('[FORUM] Делаем скриншот страницы (forum)...');
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  console.log(`[FORUM] Скриншот получен, размер буфера: ${(screenshotBuffer.length / 1024).toFixed(2)} KB`);
  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext('2d');
  const img = await loadImage(screenshotBuffer);
  ctx.drawImage(img, 0, 0, 1920, 1080);
  const now = new Date();
  const timeString = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const padding = 10;
  const fontSize = 24;
  ctx.font = `${fontSize}px Arial`;
  const textWidth = ctx.measureText(timeString).width;
  const boxWidth = textWidth + padding * 2;
  const boxHeight = fontSize + padding * 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(10, 10, boxWidth, boxHeight);
  ctx.fillStyle = 'white';
  ctx.fillText(timeString, 10 + padding, 10 + fontSize + padding / 2);
  console.log('[FORUM] Добавлена метка времени на скриншот');
  const base64Image = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  console.log('[FORUM] Конвертация скрина в base64 завершена, начинаем загрузку...');
  const imageUrl = await uploadImage(base64Image);
  console.log(`Скриншот ${index + 1} загружен: ${imageUrl}`);
  return imageUrl;
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  console.log('[TELEGRAM] Отправка сообщения:', text.slice(0, 120).replace(/\n/g, ' ') + (text.length > 120 ? '...' : ''));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      disable_web_page_preview: false
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('Ошибка отправки в Telegram:', res.status, errText);
  } else {
    const data = await res.json();
    console.log('[TELEGRAM] Сообщение отправлено успешно, result.ok =', data.ok);
  }
}

async function createScreenshots() {
  console.log('Запуск создания скриншотов форума');
  const cookies = loadCookies(false);
  const cleanedCookies = cleanCookies(cookies);
  
  const browserOptions = {
    headless: true,
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  };

  if (isLinux) {
    browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
  }

  console.log('[FORUM] Запуск браузера с опциями:', browserOptions);
  const browser = await puppeteer.launch(browserOptions);
  const page = await browser.newPage();
  console.log('[FORUM] Открыта новая страница');
  await page.setViewport({ width: 1920, height: 1080 });
  
  page.on('console', msg => {
    console.log('[FORUM PAGE LOG]', msg.type().toUpperCase(), msg.text());
  });

  await page.setUserAgent(MODERN_UA);
  console.log('[FORUM] Установлен User-Agent и viewport, устанавливаем куки...');
  
  await page.setCookie(...cleanedCookies);
  console.log('[FORUM] Куки установлены. Начинаем обход URL');

  const screenshotLinks = [];

  console.log(`Начинаем обработку ${urls.length} URL...`);

  for (let i = 0; i < urls.length; i++) {
    console.log(`Обрабатываем URL ${i + 1}/${urls.length}: ${urls[i]}`);
    try {
      const link = await makeScreenshot(page, urls[i], i);
      screenshotLinks.push(link);
      console.log(`✓ Успешно обработан URL ${i + 1}`);
    
      if (i < urls.length - 1) {
        console.log('Ожидание 7 секунды перед следующим скриншотом...');
        await new Promise(resolve => setTimeout(resolve, 7000));
      }
    } catch (e) {
      console.error(`✗ Ошибка при скриншоте URL ${urls[i]}:`, e.message);
      console.error(e.stack);
    
      if (e.message.includes('загрузки') || e.message.includes('upload')) {
        try {
          console.log('Попытка сохранения скриншота локально...');
          const screenshotBuffer = await page.screenshot({ fullPage: false });
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `screenshot_error_${i}_${timestamp}.png`;
          fs.writeFileSync(filename, screenshotBuffer);
          console.log(`Скриншот сохранен локально: ${filename}`);
        } catch (saveError) {
          console.error('Не удалось сохранить скриншот локально:', saveError.message);
        }
      }
    }
  }

  await browser.close();
  console.log(`Обработка завершена. Успешно: ${screenshotLinks.length}/${urls.length}`);

  if (screenshotLinks.length > 0) {
    const now = new Date();
    const dateString = now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
    const timeString = now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' });
    let message = `Скриншоты за ${dateString} ${timeString} МСК:\n\n`;
    for (let i = 0; i < screenshotLinks.length; i++) {
      message += `${descriptions[i]}${screenshotLinks[i]}\n`;
    }
    console.log('[FORUM] Отправка сообщения со ссылками на скриншоты в Telegram...');
    await sendTelegramMessage(message);
  } else {
    console.log('[FORUM] Не удалось получить ни одного скриншота форума. Отправляем сообщение в Telegram.');
    await sendTelegramMessage('Не удалось получить ни одного скриншота форума.');
  }
  console.log('Создание скриншотов форума завершено');
}

/* async function createDatalensScreenshot() {
  console.log('==================');
  console.log('Запуск создания скриншота Datalens');
  console.log('Платформа:', process.platform, 'isLinux =', isLinux);
  const cookies = loadCookies(true);
  const cleanedCookies = cleanCookies(cookies);
  console.log(`[DATALENS] Кол-во кук, которые будем устанавливать: ${cleanedCookies.length}`);
  
  const browserOptions = {
    headless: true,
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  };

  if (isLinux) {
    browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
  }

  console.log('[DATALENS] Запуск браузера с опциями:', browserOptions);
  const browser = await puppeteer.launch(browserOptions);
  const page = await browser.newPage();
  console.log('[DATALENS] Открыта новая страница');

  page.on('console', msg => {
    console.log('[DATALENS PAGE LOG]', msg.type().toUpperCase(), msg.text());
  });

  page.on('pageerror', err => {
    console.error('[DATALENS PAGE ERROR]', err);
  });

  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(MODERN_UA);
  console.log('[DATALENS] Установлен современный User-Agent и viewport, устанавливаем куки...');
  await page.setCookie(...cleanedCookies);
  console.log('[DATALENS] Куки установлены');

  try {
    const url = 'https://datalens.yandex.cloud/bso406qsd95yx-dashbord-ga?utm_referrer=about%3Ablank&tab=Wjm';
    console.log('[DATALENS] Переход по URL:', url);
    const gotoStart = Date.now();
    await page.goto(url, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 90000 });
    console.log('[DATALENS] page.goto завершился за', (Date.now() - gotoStart) / 1000, 'сек.');

    // Проверка окна "Ваш браузер устарел" / "Your browser is out of date"
    console.log('[DATALENS] Проверяем, есть ли окно про устаревший браузер...');
    try {
      await page.waitForFunction(() => {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        return buttons.some(b => {
          const text = b.textContent.trim().toLowerCase();
          return text.includes('попробовать') || text.includes('try it anyway');
        });
      }, { timeout: 5000 });

      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const btn = buttons.find(b => {
          const text = b.textContent.trim().toLowerCase();
          return text.includes('попробовать') || text.includes('try it anyway');
        });
        if (btn) btn.click();
      });
      console.log('[DATALENS] Нажали кнопку "Попробовать все равно" / "Try it anyway"');
      await new Promise(resolve => setTimeout(resolve, 7000));
    } catch (e) {
      console.log('[DATALENS] Окно про устаревший браузер не найдено или уже закрыто:', e.message);
    }

    const inputSelector = '.g-text-input__control.dl-datepicker__input';
    console.log('[DATALENS] Ожидание селектора поля дат', inputSelector, '...');
    await page.waitForSelector(inputSelector, { timeout: 90000, visible: true });
    console.log('[DATALENS] Поле дат найдено и видно. Дополнительно ждем полную загрузку дашборда...');

    try {
      console.log('[DATALENS] Ждем исчезновения лоадеров .dl-loader / .chartkit-loader (до 90 сек.)...');
      await page.waitForFunction(() => {
        const loadingElements = document.querySelectorAll('.dl-loader, .chartkit-loader');
        return loadingElements.length === 0 || 
               Array.from(loadingElements).every(el => el.style.display === 'none');
      }, { timeout: 90000 });
      console.log('[DATALENS] Лоадеры исчезли (или их нет).');
    } catch (e) {
      console.warn('[DATALENS] Время ожидания полной загрузки дашборда истекло, продолжаем...', e.message);
    }

    console.log('[DATALENS] Ждем ещё 40 секунд для стабильности UI...');
    await new Promise(resolve => setTimeout(resolve, 40000));

    const now = new Date();
    const mskNowString = now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' });
    console.log('[DATALENS] Текущее время (MSK, строка):', mskNowString);
    const mskNow = new Date(mskNowString);
    mskNow.setDate(mskNow.getDate() - 1);
    const day = String(mskNow.getDate()).padStart(2, '0');
    const month = String(mskNow.getMonth() + 1).padStart(2, '0');
    const year = mskNow.getFullYear();
    const currentDate = `${day}.${month}.${year}`;
    const startDate = `${currentDate} 00:00:00`;
    const endDate = `${currentDate} 23:59:59`;
    const dateRange = `${startDate} - ${endDate}`;

    console.log('[DATALENS] Расчитанный диапазон дат:');
    console.log('  currentDate:', currentDate);
    console.log('  startDate  :', startDate);
    console.log('  endDate    :', endDate);
    console.log('  dateRange  :', dateRange);

    console.log('[DATALENS] Фокус на поле дат:', inputSelector);
    await page.focus(inputSelector);
    await page.click(inputSelector, { clickCount: 3 });
    await page.keyboard.press('Backspace');

    const valueBefore = await page.$eval(inputSelector, el => el.value);
    console.log('[DATALENS] Значение поля дат после Backspace:', valueBefore);

    if (valueBefore !== '') {
      console.log('[DATALENS] Поле не пустое, жмем Delete для очистки...');
      await page.keyboard.press('Delete');
    }

    const valueAfterClear = await page.$eval(inputSelector, el => el.value);
    console.log('[DATALENS] Значение поля после полной очистки:', `"${valueAfterClear}"`);

    console.log('[DATALENS] Вводим диапазон дат посимвольно...');
    for (const char of dateRange) {
      await page.type(inputSelector, char, { delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const valueAfterType = await page.$eval(inputSelector, el => el.value);
    console.log('[DATALENS] Значение поля после ввода:', `"${valueAfterType}"`);

    console.log('[DATALENS] Ожидаем кнопку "Применить" [data-qa="control-button-apply"]...');
    await page.waitForSelector('[data-qa="control-button-apply"]', { timeout: 30000, visible: true });
    console.log('[DATALENS] Кнопка "Применить" найдена, кликаем...');
    await page.click('[data-qa="control-button-apply"]');

    console.log('[DATALENS] Ожидание начала обновления данных (появление лоадеров)...');
    try {
      await page.waitForSelector('.dl-loader, .chartkit-loader', { timeout: 10000, visible: true });
      console.log('[DATALENS] Лоадеры появились, данные начали обновляться.');
    } catch (e) {
      console.warn('[DATALENS] Индикатор загрузки не появился, возможно данные уже загружены...', e.message);
    }

    console.log('[DATALENS] Ожидание завершения обновления данных (исчезновение лоадеров)...');
    try {
      await page.waitForFunction(() => {
        const loadingElements = document.querySelectorAll('.dl-loader, .chartkit-loader');
        return loadingElements.length === 0 || 
               Array.from(loadingElements).every(el => el.style.display === 'none');
      }, { timeout: 120000 });
      console.log('[DATALENS] Лоадеры исчезли после обновления данных.');
    } catch (e) {
      console.warn('[DATALENS] Время ожидания завершения обновления данных истекло, продолжаем...', e.message);
    }

    console.log('[DATALENS] Дополнительно ждем, пока графики будут иметь ненулевой размер...');
    try {
      await page.waitForFunction(() => {
        const charts = document.querySelectorAll('.chartkit-base');
        return charts.length > 0 && 
               Array.from(charts).every(chart => chart.clientHeight > 0 && chart.clientWidth > 0);
      }, { timeout: 30000 });
      console.log('[DATALENS] Графики выглядят загруженными (есть размеры).');
    } catch (e) {
      console.warn('[DATALENS] Время ожидания обновления графиков истекло, продолжаем...', e.message);
    }

    const timeString = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    console.log('[DATALENS] Добавляем оверлей с временем на страницу:', timeString);
    await page.evaluate((timeString) => {
      const timeElement = document.createElement('div');
      timeElement.textContent = timeString;
      timeElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px 20px;
        font-size: 24px;
        font-weight: bold;
        font-family: Arial, sans-serif;
        z-index: 9999;
        border-radius: 0 0 8px 8px;
      `;
      document.body.appendChild(timeElement);
    }, timeString);

    console.log('[DATALENS] Оверлей добавлен, ждем 5 секунды перед скриншотом...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('[DATALENS] Делаем скриншот (fullPage, captureBeyondViewport)...');
    const screenshotBuffer = await page.screenshot({ fullPage: true, captureBeyondViewport: true });
    console.log('[DATALENS] Скриншот сделан, размер буфера:', (screenshotBuffer.length / 1024).toFixed(2), 'KB');

    const base64Image = screenshotBuffer.toString('base64');
    console.log('[DATALENS] Скриншот переведен в base64, длина строки:', base64Image.length);

    console.log('[DATALENS] Загружаем скриншот через uploadImage()...');
    const imageUrl = await uploadImage(base64Image);
    console.log('[DATALENS] Скриншот успешно загружен. URL:', imageUrl);

    const msg = `Скриншот выгружен за ${currentDate}\n\nскриншот проведенных мероприятий - ${imageUrl}`;
    console.log('[DATALENS] Отправляем сообщение в Telegram с ссылкой на скриншот...');
    await sendTelegramMessage(msg);
    console.log(`Скриншот Datalens загружен и отправлен: ${imageUrl}`);
  } catch (error) {
    console.error('Ошибка при создании скриншота Datalens:', error);
    console.error(error.stack);
    try {
      await sendTelegramMessage('Ошибка при создании скриншота Datalens. См. логи на сервере.');
    } catch (telegramErr) {
      console.error('[DATALENS] Доп. ошибка при отправке сообщения об ошибке в Telegram:', telegramErr);
    }
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `datalens_error_${timestamp}.png`;
      console.log('[DATALENS] Пытаемся сохранить скриншот ошибки локально:', filename);
      await page.screenshot({ path: filename, fullPage: true, captureBeyondViewport: true });
      console.log('[DATALENS] Скриншот ошибки сохранен:', filename);
    } catch (screenshotError) {
      console.error('[DATALENS] Не удалось сохранить скриншот ошибки:', screenshotError);
    }
  } finally {
    console.log('[DATALENS] Закрываем браузер...');
    await browser.close();
    console.log('[DATALENS] Браузер закрыт.');
  }
  console.log('Создание скриншота Datalens завершено');
  console.log('==================');
} */

async function getUpdates(offset = 0) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}`;
  try {
    console.log('[TELEGRAM] Запрос обновлений с offset =', offset);
    const response = await fetch(url);
    const data = await response.json();
    console.log('[TELEGRAM] Получено обновлений:', (data.result || []).length);
    return data.result || [];
  } catch (error) {
    console.error('Ошибка получения обновлений:', error);
    return [];
  }
}

async function downloadFile(fileId, destPath) {
  try {
    console.log('[TELEGRAM] Запрос информации о файле, file_id =', fileId);
    const fileInfoResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
    const fileInfo = await fileInfoResponse.json();
    console.log('[TELEGRAM] Ответ getFile:', fileInfo);
    if (!fileInfo.ok) throw new Error('Не удалось получить информацию о файле');

    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
    console.log('[TELEGRAM] Скачиваем файл по URL:', fileUrl);
    const fileResponse = await fetch(fileUrl);
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    console.log('Файл успешно скачан в', destPath);
  } catch (error) {
    console.error('Ошибка скачивания файла:', error);
    throw error;
  }
}

function parseAndSaveCookieFile(isDatalens = false) {
  const tempFile = isDatalens ? TEMP_DATALENS_COOKIE_FILE : TEMP_COOKIE_FILE;
  console.log(`[COOKIES] Обработка cookie файла: ${tempFile} (isDatalens=${isDatalens})`);
  try {
    const content = fs.readFileSync(tempFile, 'utf8');
    console.log('[COOKIES] Размер файла кук:', content.length, 'символов');
    let cookies = [];
    if (content.trim().startsWith('[') || content.trim().startsWith('{')) {
      console.log('[COOKIES] Похоже на JSON формат, пробуем парсить...');
      try {
        cookies = JSON.parse(content);
        if (!Array.isArray(cookies)) cookies = [cookies];
      } catch (e) {
        console.error('[COOKIES] Ошибка парсинга JSON файла кук:', e);
        throw new Error('Файл не является валидным JSON');
      }
    } else if (content.includes('# Netscape HTTP Cookie File') || content.includes('\t')) {
      console.log('[COOKIES] Похоже на Netscape формат, парсим...');
      cookies = parseNetscapeCookies(content);
    } else {
      console.error('[COOKIES] Неизвестный формат cookie файла');
      throw new Error('Неизвестный формат cookie файла');
    }
    if (cookies.length === 0) {
      console.error('[COOKIES] В файле не найдено ни одной cookie');
      throw new Error('В файле не найдено ни одной cookie');
    }
    saveCookies(cookies, isDatalens);
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
      console.log('[COOKIES] Временный файл кук удален:', tempFile);
    }
    console.log(`Обработано ${cookies.length} cookies для ${isDatalens ? 'Datalens' : 'форума'}`);
    return true;
  } catch (error) {
    console.error('Ошибка обработки cookie файла:', error);
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
      console.log('[COOKIES] Временный файл кук удален из-за ошибки:', tempFile);
    }
    return false;
  }
}

async function handleBotMessages() {
  let lastUpdateId = 0;
  console.log('[BOT] Старт цикла обработки сообщений Telegram бота...');
  while (true) {
    try {
      const updates = await getUpdates(lastUpdateId + 1);
      for (const update of updates) {
        lastUpdateId = update.update_id;
        if (update.message && update.message.chat.id.toString() === CHAT_ID) {
          const text = update.message.text;
          console.log('[BOT] Получено сообщение:', text);
          if (text === '/cookiefile') {
            waitingForCookieFile = true;
            // waitingForDatalensCookieFile = false;
            await sendTelegramMessage('Отправьте файл cookie.txt для форума (поддерживается JSON и Netscape формат):');
          // } else if (text === '/cookiefiledatalens') {
          //   waitingForDatalensCookieFile = true;
          //   waitingForCookieFile = false;
          //   await sendTelegramMessage('Отправьте файл cookie.txt для Datalens (поддерживается JSON и Netscape формат):');
          } else if (text === '/screenshot') {
            await sendTelegramMessage('Запускаю создание скриншотов форума...');
            await createScreenshots();
          // } else if (text === '/screenshotdatalens') {
          //   await sendTelegramMessage('Запускаю создание скриншота Datalens...');
          //   await createDatalensScreenshot();
          } else if (text === '/testupload') {
            await sendTelegramMessage('Тестирую загрузку изображений...');
            try {
              const canvas = createCanvas(100, 100);
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = 'red';
              ctx.fillRect(0, 0, 100, 100);
              ctx.fillStyle = 'white';
              ctx.font = '20px Arial';
              ctx.fillText('TEST', 20, 60);
            
              const base64Image = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
              const imageUrl = await uploadImage(base64Image);
              await sendTelegramMessage(`✅ Тест загрузки успешен: ${imageUrl}`);
            } catch (error) {
              console.error('[BOT] Ошибка во время теста загрузки:', error);
              await sendTelegramMessage(`❌ Ошибка теста загрузки: ${error.message}`);
            }
          } else if (text === '/help') {
            const helpMessage = `Доступные команды:
/screenshot - создать скриншоты форума вручную
/cookiefile - загрузить куки для форума из файла
/testupload - протестировать загрузку изображений
/help - показать эту справку`;
            await sendTelegramMessage(helpMessage);
          }

          if (update.message.document && (waitingForCookieFile /* || waitingForDatalensCookieFile */)) {
            const fileId = update.message.document.file_id;
            const fileName = update.message.document.file_name || 'cookie.txt';
            // const isDatalens = waitingForDatalensCookieFile;
            const isDatalens = false; // datalens отключён
            const tempFile = /* isDatalens ? TEMP_DATALENS_COOKIE_FILE : */ TEMP_COOKIE_FILE;
            console.log(`[BOT] Получен документ "${fileName}", file_id=${fileId}`);
            await sendTelegramMessage(`Файл "${fileName}" получен, обрабатываю...`);
            try {
              await downloadFile(fileId, tempFile);
              if (parseAndSaveCookieFile(isDatalens)) {
                const service = /* isDatalens ? 'Datalens' : */ 'форума';
                await sendTelegramMessage(`Куки для ${service} из файла успешно обновлены!`);
              } else {
                await sendTelegramMessage('Ошибка обработки cookie файла. Проверьте формат файла (поддерживается JSON и Netscape формат).');
              }
            } catch (error) {
              console.error('[BOT] Ошибка обработки cookie файла:', error);
              await sendTelegramMessage('Ошибка при обработке файла. Попробуйте еще раз.');
            }
            waitingForCookieFile = false;
            // waitingForDatalensCookieFile = false;
          }
        }
      }
    } catch (error) {
      console.error('Ошибка обработки сообщений бота:', error);
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
}

function getRandomTimeInRange() {
  const hour = 15;
  const minute = Math.floor(Math.random() * 60);
  return { hour, minute };
}

/* function getRandomTimeInRangeDatalens() {
  const hour = 13;
  const minute = Math.floor(Math.random() * 60);
  return { hour, minute };
} */

function scheduleDailyScreenshots() {
  console.log('[SCHEDULE] Настраиваем ежедневные задания cron...');
  schedule.scheduleJob('0 15 * * *', async () => {
    const { hour, minute } = getRandomTimeInRange();
    const delay = minute * 60 * 1000;
    console.log(`Запланировано создание скриншотов форума через ${minute} минут (в 15:${minute.toString().padStart(2, '0')})`);
    setTimeout(async () => {
      console.log('Выполнение запланированного создания скриншотов форума');
      await createScreenshots();
    }, delay);
  });

  /* schedule.scheduleJob('0 13 * * *', async () => {
    const { hour, minute } = getRandomTimeInRangeDatalens();
    const delay = minute * 60 * 1000;
    console.log(`Запланировано создание скриншота Datalens через ${minute} минут (в 13:${minute.toString().padStart(2, '0')})`);
    setTimeout(async () => {
      console.log('Выполнение запланированного создания скриншота Datalens');
      await createDatalensScreenshot();
    }, delay);
  }); */
}

console.log('Запуск бота и планировщика скриншотов...');
console.log(`Платформа: ${process.platform}`);
console.log('Доступные команды:');
console.log('/help - справка по командам');
console.log('/cookiefile - загрузить куки для форума из файла');
// console.log('/cookiefiledatalens - загрузить куки для Datalens из файла');
console.log('/screenshot - создать скриншоты форума вручную');
// console.log('/screenshotdatalens - создать скриншот Datalens вручную');
console.log('/testupload - протестировать загрузку изображений');

handleBotMessages();
scheduleDailyScreenshots();

// Автозапуск VK бота
const vkBot = spawn('node', [path.join(__dirname, 'vk_bot.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TG_TOKEN:   TELEGRAM_TOKEN,
    TG_CHAT_ID: CHAT_ID,
    IMGBB_KEY:  IMGBB_API_KEY,
    IMGUR_ID:   IMGUR_CLIENT_ID,
  },
});
vkBot.on('error', (err) => console.error('[VK BOT] Ошибка запуска:', err.message));
vkBot.on('exit', (code) => console.log(`[VK BOT] Процесс завершился с кодом ${code}`));
console.log('[VK BOT] Запущен автоматически.');

console.log('Бот запущен.');
console.log('Ежедневные скриншоты форума будут создаваться между 15:00 и 16:00 МСК.');
// console.log('Ежедневные скриншоты Datalens будут создаваться между 13:00 и 14:00 МСК (за прошлый день).');
console.log('Отправьте /help для получения списка команд.');