'use strict';

/* Данные каталога изменяются только через products.json на GitHub */

/* ===== Настройки ===== */
const CONFIG = {
  contactUsername: 'ZloyDoctorius' // Telegram-username продавца, без «@»
};

/* ===== Размер порции «Показать ещё» (только в памяти сессии) ===== */
const PAGE_SIZE = 24;

/* Эмодзи-заглушки по категориям (используются, если у товара нет image и emoji) */
const CATEGORY_EMOJI = {
  'Жидкости': '🧪',
  'Одноразки': '💨',
  'POD-системы': '🔋',
  'Аксессуары': '🧰'
};

const DEFAULT_EMOJI = '📦';

/* ===== Медиа: одно изображение с ленивой загрузкой или эмодзи-заглушка ===== */

/* Размеры контейнера (1x — width/height) и запроса картинки (2x, ≤640) */
const MEDIA_SIZES = {
  'brand-img':      { box: 160, src: 320 }, // карточка бренда на главном экране
  'brand-head-img': { box: 240, src: 480 }, // шапка окна бренда (#brandModal)
  'modal-media':    { box: 240, src: 480 }  // модалка деталей (#detailModal)
};

function mediaSizeFor(sizeClass) {
  const key = String(sizeClass || '').trim();
  return MEDIA_SIZES[key] || MEDIA_SIZES['brand-img'];
}

/* Эмодзи-заглушка: эмодзи товара, иначе по категории */
function buildEmojiEl(item, sizeClass) {
  const span = document.createElement('span');
  span.className = 'media-emoji' + (sizeClass ? ' ' + sizeClass : '');
  span.textContent = item.emoji || CATEGORY_EMOJI[item.category] || DEFAULT_EMOJI;
  return span;
}

/* Эмодзи-фолбэк с пометкой, что картинка не загружалась */
function emojiFallback(item, sizeClass) {
  const el = buildEmojiEl(item, sizeClass);
  el.dataset.fallback = '1';
  return el;
}

/*
 * optimizedImageUrl(url, width, height) — чистая функция.
 * Для хостинга picsum.photos приводит размеры к нужным (2x от контейнера):
 *   https://picsum.photos/seed/<seed>/<w>/<h> и https://picsum.photos/<w>/<h>.
 * Ограничение — не больше 640. Для остальных хостов возвращает URL как есть.
 * Query-параметры и #якоря не теряются.
 */
function optimizedImageUrl(url, width, height) {
  if (typeof url !== 'string' || url === '') return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return url;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'picsum.photos') return url;

  const MAX = 640;
  const w = Math.min(MAX, Math.max(1, Math.round(Number(width) || 0)));
  const h = Math.min(MAX, Math.max(1, Math.round(Number(height) || 0)));
  if (!w || !h) return url;

  const isNum = (s) => /^\d+$/.test(s);
  const segments = parsed.pathname.split('/').filter((s) => s !== '');

  // /seed/<seed>/<w>/<h>
  if (segments.length === 4 && segments[0] === 'seed' &&
      isNum(segments[2]) && isNum(segments[3])) {
    parsed.pathname = '/seed/' + segments[1] + '/' + w + '/' + h;
    return parsed.toString();
  }

  // /<w>/<h>
  if (segments.length === 2 && isNum(segments[0]) && isNum(segments[1])) {
    parsed.pathname = '/' + w + '/' + h;
    return parsed.toString();
  }

  return url;
}

/*
 * imageHosts(items) — чистая функция: до 3 уникальных https-хостов
 * изображений из данных (для предварительного прогрева соединений).
 */
function imageHosts(items) {
  const out = [];
  const list = Array.isArray(items) ? items : [];

  list.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const raw = typeof item.image === 'string' ? item.image.trim() : '';
    if (raw.indexOf('https://') !== 0) return;

    let host = '';
    try {
      host = new URL(raw).hostname;
    } catch (e) {
      return;
    }
    if (host && out.indexOf(host) === -1 && out.length < 3) out.push(host);
  });

  return out;
}

/* Прогрев соединений: <link rel="preconnect" crossorigin> к найденным хостам */
function warmImageHosts(items) {
  if (!document.head) return;
  imageHosts(items).forEach((host) => {
    if (document.head.querySelector('link[rel="preconnect"][data-host="' + host + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://' + host;
    link.crossOrigin = 'anonymous';
    link.dataset.host = host;
    document.head.appendChild(link);
  });
}

/* ===== Ленивая подгрузка: data-src → src при приближении к окну просмотра ===== */
let mediaObserver = null;
let mediaObserverReady = false;

/*
 * loadLazyImage(img): переносит data-src в src только один раз.
 * Повторно не грузим — защита от перерисовок через dataset.loaded.
 */
function loadLazyImage(img) {
  if (!img || img.dataset.loaded === '1') return;
  const url = img.dataset.src;
  if (!url) return;
  img.dataset.loaded = '1';
  img.src = url;
}

/* Единый IntersectionObserver с rootMargin 300px; при отсутствии — грузим сразу */
function getMediaObserver() {
  if (mediaObserverReady) return mediaObserver;
  mediaObserverReady = true;

  if (typeof IntersectionObserver !== 'function') {
    mediaObserver = null;
    return null;
  }

  mediaObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      mediaObserver.unobserve(entry.target);
      loadLazyImage(entry.target);
    });
  }, { rootMargin: '300px 0px' });

  return mediaObserver;
}

/* Контейнер медиа: квадрат 1/1 с фоновой shimmer-заглушкой (см. style.css) */
function buildMediaHolder() {
  const holder = document.createElement('div');
  holder.className = 'media-holder';
  return holder;
}

/*
 * buildMediaEl(item, sizeClass, options) — единая фабрика медиа.
 * Возвращает контейнер .media-holder (aspect-ratio 1/1, фоновая заглушка),
 * внутри — либо <img> с ленивой загрузкой, либо span.media-emoji.
 * Используется только там, где фото есть по дизайну: карточка бренда,
 * шапка окна бренда и модалка деталей (список вкусов фото не показывает).
 *
 * options.priority === true → fetchpriority="high" (первые 4 карточки экрана),
 * иначе fetchpriority="low".
 *
 * <img> создаётся без src: адрес лежит в data-src и подставляется лениво тем,
 * кто первым «увидит» элемент (IntersectionObserver, rootMargin 300px), после
 * чего data-src удаляется. До загрузки — .img-loading (opacity 0), после
 * 'load' — .img-loaded (плавное появление). http:// (не https) и ошибка
 * загрузки → эмодзи-фолбэк с dataset.fallback='1' без повторных попыток.
 */
function buildMediaEl(item, sizeClass, options) {
  const size = mediaSizeFor(sizeClass);
  const rawImage = typeof item.image === 'string' ? item.image.trim() : '';
  const holder = buildMediaHolder();

  // Пустая ссылка — сразу эмодзи
  if (rawImage === '') {
    holder.appendChild(buildEmojiEl(item, sizeClass));
    return holder;
  }

  // Небезопасный http:// — не грузим, сразу эмодзи-фолбэк
  if (rawImage.indexOf('http://') === 0) {
    holder.appendChild(emojiFallback(item, sizeClass));
    return holder;
  }

  const img = document.createElement('img');
  img.className = (sizeClass || '') + ' img-loading';
  img.alt = item.name != null ? String(item.name) : '';
  img.width = size.box;
  img.height = size.box;
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  img.setAttribute('draggable', 'false');
  img.setAttribute('fetchpriority', (options && options.priority) ? 'high' : 'low');
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.dataset.src = optimizedImageUrl(rawImage, size.src, size.src);

  img.addEventListener('load', function () {
    this.classList.remove('img-loading');
    this.classList.add('img-loaded');
    if (this.dataset) delete this.dataset.src;
  }, false);

  img.addEventListener('error', function () {
    const fb = emojiFallback(item, sizeClass);
    if (typeof this.replaceWith === 'function') this.replaceWith(fb);
  }, false);

  holder.appendChild(img);

  const observer = getMediaObserver();
  if (observer) observer.observe(img);
  else loadLazyImage(img); // IntersectionObserver недоступен — грузим сразу

  return holder;
}

/* ===== Ключи localStorage (только личные настройки пользователя) ===== */
const FAVS_KEY = 'vape_favs';        // JSON-массив id избранных товаров
const THEME_KEY = 'vape_theme';      // 'dark' | 'light'

/* ===== Состояние ===== */
/* Всё, кроме favs и theme, живёт только в памяти текущей сессии */
const state = {
  products: [],        // все товары (вкусы) из products.json
  brands: [],          // сгруппированные бренды (результат groupByBrand)
  search: '',          // текущий запрос
  category: 'Все',     // активная категория
  brand: 'Все бренды', // активный бренд (второй ряд чипов)
  favOnly: false,      // чип «Избранное»
  inStockOnly: false,  // toggle-чип «В наличии»
  limit: PAGE_SIZE,    // сколько брендов показано («Показать ещё»)
  sig: '',             // подпись фильтров: при смене лимит сбрасывается
  cart: new Map(),     // id товара -> количество
  favs: new Set(loadFavs()),      // id избранных товаров
  openBrandId: null,   // бренд, открытый в #brandModal ('' нет открытого окна)
  brandShowAll: false  // локально в окне бренда: показать все вкусы без фильтров
};

/* ===== Telegram WebApp ===== */
const tg = window.Telegram ? window.Telegram.WebApp : null;

/* ===== DOM ===== */
const catalogEl = document.getElementById('catalog');
const emptyStateEl = document.getElementById('emptyState');
const chipsEl = document.getElementById('chips');
const chips2El = document.getElementById('chips2');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const resetBtn = document.getElementById('resetBtn');
const countLabel = document.getElementById('countLabel');
const cartBtn = document.getElementById('cartBtn');
const cartBadgeEl = document.getElementById('cartBadge');
const cartModal = document.getElementById('cartModal');
const cartCloseBtn = document.getElementById('cartCloseBtn');
const cartModalBody = document.getElementById('cartModalBody');
const cartModalCountEl = document.getElementById('cartModalCount');
const toastEl = document.getElementById('toast');
const luckyBtn = document.getElementById('luckyBtn');
const themeToggle = document.getElementById('themeToggle');
const exportBtn = document.getElementById('exportBtn');

const toTopBtn = document.getElementById('toTop');
const loaderEl = document.getElementById('loader');
const skeletonEl = document.getElementById('skeleton');
const refreshBtn = document.getElementById('refreshBtn');
const shareBtn = document.getElementById('shareBtn');
const activeFiltersEl = document.getElementById('activeFilters');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const emptyResetBtn = document.getElementById('emptyResetBtn');
const detailModal = document.getElementById('detailModal');
const detailCloseBtn = document.getElementById('detailCloseBtn');
const detailBody = document.getElementById('detailBody');
const brandModal = document.getElementById('brandModal');
const brandCloseBtn = document.getElementById('brandCloseBtn');
const brandModalBody = document.getElementById('brandModalBody');

/* Данные каталога изменяются только через products.json на GitHub */

let detailItem = null; // текущий товар в модалке деталей

/* ===== Вибро-отклик (Telegram Haptics; безопасно в браузере) ===== */
function haptic(type) {
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    const hf = wa && wa.HapticFeedback;
    if (!hf) return;

    if (type === 'success' || type === 'warning' || type === 'error') {
      if (typeof hf.notificationOccurred === 'function') {
        hf.notificationOccurred(type);
      }
      return;
    }

    if (typeof hf.selectionChanged === 'function') hf.selectionChanged();
    if (typeof hf.impactOccurred === 'function') hf.impactOccurred('light');
  } catch (e) {}
}

/* ===== Сохранение позиции скролла при открытии/закрытии модалок ===== */
let savedScrollY = 0;

function rememberScroll() {
  try { savedScrollY = window.scrollY || 0; } catch (e) { savedScrollY = 0; }
}

function restoreScroll() {
  if (!savedScrollY) return;
  try {
    window.scrollTo({ top: savedScrollY, behavior: 'auto' });
  } catch (e) {
    try { window.scrollTo(0, savedScrollY); } catch (e2) {}
  }
}

/* Восстанавливаем скролл, только если не осталось открытых модалок */
function maybeRestoreScroll() {
  const anyOpen =
    (detailModal && detailModal.classList.contains('open')) ||
    (brandModal && brandModal.classList.contains('open')) ||
    (cartModal && cartModal.classList.contains('open'));
  if (anyOpen) return;
  restoreScroll();
}

/* Возвращает массив активных фильтров: { label, clear } */
function activeFilterTags() {
  const tags = [];
  const q = state.search.trim();

  if (q) {
    tags.push({ label: 'Поиск: ' + q, clear: () => { clearSearch(); } });
  }
  if (state.category !== 'Все') {
    tags.push({ label: 'Категория: ' + state.category, clear: () => { state.category = 'Все'; } });
  }
  if (state.brand !== 'Все бренды') {
    tags.push({ label: 'Бренд: ' + state.brand, clear: () => { state.brand = 'Все бренды'; } });
  }
  if (state.inStockOnly) {
    tags.push({ label: 'В наличии', clear: () => { state.inStockOnly = false; } });
  }
  if (state.favOnly) {
    tags.push({ label: 'Избранное', clear: () => { state.favOnly = false; } });
  }
  return tags;
}

/* ===== Панель активных фильтров ===== */
function renderActiveFilters() {
  if (!activeFiltersEl) return;

  activeFiltersEl.replaceChildren();
  const tags = activeFilterTags();

  if (tags.length === 0) {
    activeFiltersEl.hidden = true;
    return;
  }
  activeFiltersEl.hidden = false;

  tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'af-chip';

    const label = document.createElement('span');
    label.className = 'af-label';
    label.textContent = tag.label;

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'af-x';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Снять фильтр: ' + tag.label);
    x.addEventListener('click', () => {
      haptic('light');
      tag.clear();
      refreshViews();
    });

    chip.append(label, x);
    activeFiltersEl.appendChild(chip);
  });

  const resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.className = 'af-reset';
  resetAll.textContent = 'Сбросить всё';
  resetAll.addEventListener('click', () => {
    haptic('light');
    resetFilters();
  });
  activeFiltersEl.appendChild(resetAll);
}

/* ===== Пагинация «Показать ещё» ===== */
function filtersSignature() {
  return [
    state.search.trim(),
    state.category,
    state.brand,
    state.favOnly ? '1' : '0',
    state.inStockOnly ? '1' : '0'
  ].join('|');
}

function renderLoadMore(shown, total) {
  if (!loadMoreBtn) return;
  const rest = total - shown;
  if (rest > 0) {
    loadMoreBtn.hidden = false;
    loadMoreBtn.textContent = 'Показать ещё (осталось ' + rest + ')';
  } else {
    loadMoreBtn.hidden = true;
  }
}

/* ===== Скелетон первой загрузки ===== */
function hideSkeleton() {
  if (skeletonEl) skeletonEl.hidden = true;
}

/* ===== Прокрутка к каталогу (с учётом липкой шапки) ===== */
function scrollToCatalog() {
  try {
    if (!catalogEl || typeof catalogEl.getBoundingClientRect !== 'function') return;

    const header = (typeof document.querySelector === 'function') ? document.querySelector('.header') : null;
    const headerH = (header && typeof header.getBoundingClientRect === 'function')
      ? header.getBoundingClientRect().height : 0;
    const current = window.scrollY || 0;
    const target = catalogEl.getBoundingClientRect().top + current - headerH - 10;

    if (current < target) {
      catalogEl.style.scrollMarginTop = (headerH + 10) + 'px';
      if (typeof catalogEl.scrollIntoView === 'function') {
        catalogEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: target, behavior: 'smooth' });
      }
    }
  } catch (e) {}
}

/* ===== Горячие клавиши (десктоп) ===== */
function closeTopModal() {
  if (detailModal && detailModal.classList.contains('open')) { closeDetail(); return true; }
  if (brandModal && brandModal.classList.contains('open')) { closeBrandModal(); return true; }
  if (cartModal && cartModal.classList.contains('open')) { closeCart(); return true; }
  return false;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

function handleHotkey(event) {
  if (!event) return;
  const key = event.key;
  if (!key) return;

  const typing = isTypingTarget(event.target);

  if ((key === '/' && !typing) || ((key === 'k' || key === 'K') && (event.ctrlKey || event.metaKey))) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (searchInput && typeof searchInput.focus === 'function') searchInput.focus();
    return;
  }

  if (key === 'Escape') {
    if (closeTopModal()) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (searchInput && searchInput.value !== '') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      clearSearch();
    }
    return;
  }

  if (typing) return;

  if (key === 't' || key === 'T') { haptic('light'); toggleTheme(); return; }
}

/* ===== Поделиться ссылкой на каталог ===== */
async function shareCatalog() {
  const ok = await copyText("t.me/sibir_distro_bot/start");
  showToast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку');
}

/* ===== Обновление каталога (🔄) ===== */
async function refreshCatalog() {
  if (!refreshBtn || refreshBtn.disabled) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  showLoader(true);

  try {
    const response = await fetch('products.json');
    if (!response.ok) {
      throw new Error('Ошибка HTTP ' + response.status);
    }
    const parsed = parseJsonFile(await response.text(), 'products.json');
    if (!parsed.ok) {
      showToast('Не удалось обновить: ошибка в файле products.json');
      return;
    }
    applyProducts(parsed.data);
    renderChips();
    renderChips2();
    renderCatalog();
    renderBrandModal();
    showToast('Каталог обновлён: ' + state.brands.length + ' ' +
      plural(state.brands.length, ['бренд', 'бренда', 'брендов']) + ' · ' +
      state.products.length + ' ' +
      plural(state.products.length, ['вкус', 'вкуса', 'вкусов']));
  } catch (err) {
    showToast('Не удалось обновить: ' + (err && err.message ? err.message : 'неизвестная ошибка'));
  } finally {
    showLoader(false);
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
}

/* ===== Избранное ===== */
function loadFavs() {
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch (e) {
    return [];
  }
}

function saveFavs() {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs]));
  } catch (e) {}
}

function toggleFav(id) {
  const wasFav = state.favs.has(id);
  if (wasFav) state.favs.delete(id);
  else state.favs.add(id);
  saveFavs();
  haptic('light');
  refreshViews();
  // Анимация «сердечко наполнилось» (0.3s)
  if (!wasFav) {
    const btn = document.querySelector('.fav-btn[data-id="' + id + '"]');
    if (btn) {
      btn.classList.add('pop');
      setTimeout(function () { btn.classList.remove('pop'); }, 320);
    }
  }
}

/* ===== Инициализация Telegram ===== */
function initTelegram() {
  if (!tg) return;

  tg.ready();
  if (typeof tg.expand === 'function') tg.expand();

  // Применяем тему Telegram через CSS-переменные (фоллбэки уже в style.css)
  const tp = tg.themeParams || {};
  const themeMap = {
    '--tg-theme-bg-color': tp.bg_color,
    '--tg-theme-text-color': tp.text_color,
    '--tg-theme-hint-color': tp.hint_color,
    '--tg-theme-link-color': tp.link_color,
    '--tg-theme-button-color': tp.button_color,
    '--tg-theme-button-text-color': tp.button_text_color,
    '--tg-theme-secondary-bg-color': tp.secondary_bg_color
  };
  Object.entries(themeMap).forEach(([cssVar, value]) => {
    if (value) document.documentElement.style.setProperty(cssVar, value);
  });

  // BackButton: модалки по очереди (детали → бренд → корзина),
  // иначе закрытие приложения
  if (tg.BackButton) {
    tg.BackButton.onClick(() => {
      if (detailModal.classList.contains('open')) {
        closeDetail();
        return;
      }
      if (brandModal && brandModal.classList.contains('open')) {
        closeBrandModal();
        return;
      }
      if (cartModal && cartModal.classList.contains('open')) {
        closeCart();
        return;
      }
      if (typeof tg.close === 'function') {
        tg.close();
      }
    });
  }
}

/* ===== Тема ===== */
function applyTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  document.documentElement.classList.toggle('light', saved === 'light');
  updateThemeIcon();
}

function toggleTheme() {
  const light = document.documentElement.classList.toggle('light');
  try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (e) {}
  updateThemeIcon();
}

function updateThemeIcon() {
  if (!themeToggle) return;
  themeToggle.textContent = document.documentElement.classList.contains('light') ? '☀️' : '🌙';
}

/* ===== Прелоадер ===== */
function showLoader(visible) {
  if (!loaderEl) return;
  loaderEl.classList.toggle('hide', !visible);
  loaderEl.setAttribute('aria-hidden', String(!visible));
}

/* ===== Нормализация данных (устойчивость к ручной правке JSON) ===== */
function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return;
    const numId = Number(item.id);
    const id = (Number.isFinite(numId) && !Number.isNaN(numId)) ? numId : index + 1;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    out.push({
      id: id,
      name: (typeof item.name === 'string' && item.name.trim() !== '') ? item.name : 'Без названия',
      brand: typeof item.brand === 'string' ? item.brand : '',
      category: (typeof item.category === 'string' && item.category.trim() !== '') ? item.category : 'Другое',
      price: num(item.price),
      description: typeof item.description === 'string' ? item.description : '',
      image: typeof item.image === 'string' ? item.image : '',
      emoji: typeof item.emoji === 'string' ? item.emoji : '',
      available: item.available !== false
    });
  });
  return out;
}

/*
 * parseJsonFile(text, filename):
 * возвращает { ok: true, data } или { ok: false, message } —
 * при невалидном JSON интерфейс не падает, а показывает понятное сообщение.
 */
function parseJsonFile(text, filename) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const msg = err && err.message ? err.message : 'неизвестная ошибка';
    return { ok: false, message: 'Ошибка в файле ' + filename + ': ' + msg + '. Проверьте запятые, кавычки и скобки.' };
  }
  if (!Array.isArray(data)) {
    return { ok: false, message: 'Ошибка в файле ' + filename + ': ожидался массив записей. Проверьте запятые, кавычки и скобки.' };
  }
  return { ok: true, data: normalizeItems(data) };
}

/* Единая точка применения данных: сырые товары + сгруппированные бренды */
function applyProducts(list) {
  state.products = list;
  state.brands = groupByBrand(list);
}

/* ===== Загрузка товаров ===== */
async function loadProducts() {
  showLoader(true);
  try {
    const response = await fetch('products.json');
    if (!response.ok) {
      throw new Error('Ошибка HTTP ' + response.status);
    }
    const parsed = parseJsonFile(await response.text(), 'products.json');
    if (!parsed.ok) {
      showLoader(false);
      showLoadError(parsed.message, true);
      return;
    }
    state.products = parsed.data;
    warmImageHosts(parsed.data);
  } catch (err) {
    showLoader(false);
    showLoadError(err && err.message ? err.message : 'неизвестная ошибка', false);
    return;
  }
  state.brands = groupByBrand(state.products);
  showLoader(false);
  hideSkeleton();
  renderChips();
  renderChips2();
  renderCatalog();
}
function showLoadError(message, isParseError) {
  hideSkeleton();
  catalogEl.replaceChildren();
  emptyStateEl.hidden = true;

  const box = document.createElement('div');
  box.className = 'error-box';

  const emoji = document.createElement('div');
  emoji.className = 'error-emoji';
  emoji.textContent = '⚠️';
  box.appendChild(emoji);

  if (isParseError) {
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
  } else {
    const title = document.createElement('p');
    title.textContent = 'Не удалось загрузить товары';

    const sub = document.createElement('p');
    sub.className = 'error-sub';
    sub.textContent = message + '. Проверьте, что файл products.json лежит рядом с index.html.';
    box.append(title, sub);
  }

  catalogEl.appendChild(box);
}

/* ===== Чипы категорий (+ счётчики на весь каталог) ===== */
function renderChips() {
  chipsEl.replaceChildren();

  // Чип «❤ Избранное» — в начале списка, счётчик = число избранных
  const favChip = document.createElement('button');
  favChip.type = 'button';
  favChip.className = 'chip fav-chip' + (state.favOnly ? ' active' : '');
  favChip.dataset.fav = '';
  favChip.setAttribute('aria-pressed', String(state.favOnly));
  const favLabel = document.createElement('span');
  favLabel.textContent = '❤ Избранное';
  favChip.appendChild(favLabel);
  const favCount = document.createElement('span');
  favCount.className = 'chip-num';
  favCount.textContent = state.favs.size;
  favChip.appendChild(favCount);
  chipsEl.appendChild(favChip);

  const categories = ['Все', ...new Set(
    state.products.map((p) => p.category).filter(Boolean)
  )];

  categories.forEach((category) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + ((category === state.category && !state.favOnly) ? ' active' : '');
    chip.dataset.category = category;
    const label = document.createElement('span');
    label.textContent = category;
    chip.appendChild(label);
    // Счётчик: сколько записей в этой категории во ВСЁМ каталоге
    if (category !== 'Все') {
      const count = state.products.filter((p) => p.category === category).length;
      const counter = document.createElement('span');
      counter.className = 'chip-count';
      counter.textContent = count;
      chip.appendChild(counter);
    }
    chipsEl.appendChild(chip);
  });

  // Тоггл-чип «✓ В наличии»
  const stockChip = document.createElement('button');
  stockChip.type = 'button';
  stockChip.className = 'chip toggle-chip' + (state.inStockOnly ? ' active' : '');
  stockChip.dataset.toggle = 'stock';
  stockChip.setAttribute('aria-pressed', String(state.inStockOnly));
  stockChip.textContent = state.inStockOnly ? '✓ В наличии' : 'В наличии';
  chipsEl.appendChild(stockChip);
}

/* ===== Второй ряд чипов: бренды (максимум 8) ===== */
function renderChips2() {
  if (!chips2El) return;
  chips2El.replaceChildren();

  const brands = [...new Set(
    state.products.map((p) => p.brand).filter(Boolean)
  )].slice(0, 8);

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'chip' + (state.brand === 'Все бренды' ? ' active' : '');
  allChip.dataset.brand = 'Все бренды';
  allChip.textContent = 'Все бренды';
  chips2El.appendChild(allChip);

  brands.forEach((brand) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.brand === brand ? ' active' : '');
    chip.dataset.brand = brand;
    chip.textContent = brand;
    chips2El.appendChild(chip);
  });
}

/* ============================================================
   Группировка по брендам
   ============================================================ */

/*
 * groupByBrand(items) — чистая функция.
 * Возвращает массив групп в порядке первого появления бренда:
 * { brand, items, count, inStockCount, priceMin, priceMax, cover, emoji }
 * - ключ бренда: String(item.brand || 'Другое').trim() || 'Другое';
 * - cover — image первого товара с непустым image, иначе '';
 * - emoji — emoji первого товара или эмодзи его категории.
 */
function groupByBrand(items) {
  const list = Array.isArray(items) ? items : [];
  const groups = [];
  const index = new Map();

  list.forEach((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return;

    const rawBrand = (typeof item.brand === 'string') ? item.brand.trim() : '';
    const key = rawBrand !== '' ? rawBrand : 'Другое';

    let group = index.get(key);
    if (!group) {
      group = {
        brand: key,
        items: [],
        count: 0,
        inStockCount: 0,
        priceMin: 0,
        priceMax: 0,
        cover: '',
        emoji: ''
      };
      index.set(key, group);
      groups.push(group);
    }

    group.items.push(item);
    group.count += 1;

    if (item.available !== false) group.inStockCount += 1;

    const price = Number(item.price) || 0;
    if (group.count === 1) {
      group.priceMin = price;
      group.priceMax = price;
    } else {
      if (price < group.priceMin) group.priceMin = price;
      if (price > group.priceMax) group.priceMax = price;
    }

    if (group.cover === '' && typeof item.image === 'string' && item.image.trim() !== '') {
      group.cover = item.image.trim();
    }
    if (group.emoji === '' && typeof item.emoji === 'string' && item.emoji.trim() !== '') {
      group.emoji = item.emoji;
    }
  });

  groups.forEach((group) => {
    if (group.emoji !== '') return;
    const first = group.items[0] || {};
    group.emoji = first.emoji || CATEGORY_EMOJI[first.category] || DEFAULT_EMOJI;
  });

  return groups;
}

/* Псевдо-товар для buildMediaEl: фото бренда (cover) или эмодзи-заглушка */
function brandMediaItem(group) {
  return {
    image: group.cover,
    name: group.brand,
    emoji: group.emoji,
    category: ''
  };
}

/* Совпадение вкуса с поисковым запросом (название, описание, категория, бренд) */
function flavorMatchesQuery(item, query) {
  if (!query) return true;
  const hay = [item.name, item.description, item.category, item.brand, item.emoji]
    .filter((v) => typeof v === 'string' && v !== '')
    .join(' ')
    .toLowerCase();
  return hay.includes(query);
}

/* Активны ли фильтры, сужающие состав вкусов внутри окна бренда */
function hasFlavorFilters() {
  return Boolean(state.search.trim()) ||
    state.category !== 'Все' ||
    state.favOnly ||
    state.inStockOnly;
}

/* Вкусы бренда, подходящие под активные фильтры */
function filteredFlavorsOf(group) {
  const query = state.search.trim().toLowerCase();
  const brandHit = query !== '' && String(group.brand || '').toLowerCase().includes(query);

  return group.items.filter((item) => {
    if (state.category !== 'Все' && item.category !== state.category) return false;
    if (state.inStockOnly && item.available === false) return false;
    if (state.favOnly && !state.favs.has(item.id)) return false;
    if (query !== '' && brandHit === false && !flavorMatchesQuery(item, query)) return false;
    return true;
  });
}

/* Бренды текущей выборки: группы с суженным списком вкусов (filteredItems) */
function getFilteredBrands() {
  const out = [];
  state.brands.forEach((group) => {
    if (state.brand !== 'Все бренды' && group.brand !== state.brand) return;
    const items = filteredFlavorsOf(group);
    if (items.length === 0) return;
    out.push({
      brand: group.brand,
      items: group.items,
      filteredItems: items,
      count: group.count,
      inStockCount: group.inStockCount,
      priceMin: group.priceMin,
      priceMax: group.priceMax,
      cover: group.cover,
      emoji: group.emoji
    });
  });
  return out;
}

/* Плоский список вкусов текущей выборки (экспорт, «Мне повезёт», счётчики) */
function getFilteredFlavors() {
  const out = [];
  getFilteredBrands().forEach((group) => {
    group.filteredItems.forEach((item) => out.push(item));
  });
  return out;
}

/* ===== Фильтры ===== */
/* Порядок вывода — как в products.json (порядок массива), без сортировки */
function getFiltered() {
  return getFilteredFlavors();
}

/* Цена товара: единственная цена, хранится в поле price */
function effectivePrice(product) {
  return Number(product.price) || 0;
}

/* ===== Сброс фильтров ===== */
function hasActiveFilters() {
  return Boolean(state.search.trim()) ||
    state.category !== 'Все' ||
    state.favOnly ||
    state.inStockOnly ||
    state.brand !== 'Все бренды';
}

function updateResetBtn() {
  if (!resetBtn) return;
  resetBtn.classList.toggle('hidden', !hasActiveFilters());
}

function resetFilters() {
  state.search = '';
  if (searchInput) searchInput.value = '';
  state.category = 'Все';
  state.brand = 'Все бренды';
  state.favOnly = false;
  state.inStockOnly = false;
  state.brandShowAll = false;
  updateSearchClear();
  updateResetBtn();
  refreshViews();
}

/* Данные каталога изменяются только через products.json на GitHub */

/* ===== Поиск: очистка «✕» + дебаунс ===== */
function updateSearchClear(value) {
  if (!searchClear) return;
  const hasText = value !== undefined ? String(value).length > 0 : Boolean(searchInput && searchInput.value.length > 0);
  searchClear.classList.toggle('hidden', !hasText);
}

let searchTimer = null;

/* Полная очистка поиска (используется кнопкой ✕, Esc и тегами фильтров) */
function clearSearch() {
  clearTimeout(searchTimer);
  state.search = '';
  if (searchInput) searchInput.value = '';
  updateSearchClear('');
  refreshViews();
}

/* ===== Рендер ===== */
function renderCount() {
  if (!countLabel) return;

  const totalBrands = state.brands.length;
  const totalFlavors = state.products.length;
  const shownBrands = getFilteredBrands().length;
  const shownFlavors = getFilteredFlavors().length;

  const brandsWord = (n) => plural(n, ['бренд', 'бренда', 'брендов']);
  const flavorsWord = (n) => plural(n, ['вкус', 'вкуса', 'вкусов']);

  if (!hasActiveFilters()) {
    countLabel.textContent = totalBrands + ' ' + brandsWord(totalBrands) +
      ' · ' + totalFlavors + ' ' + flavorsWord(totalFlavors);
    return;
  }

  countLabel.textContent = shownBrands + ' ' + brandsWord(shownBrands) +
    ' из ' + totalBrands +
    ' · ' + shownFlavors + ' ' + flavorsWord(shownFlavors);
}

/*
 * plural(n, one, few, many) — русские окончания.
 * Поддерживает и массив форм: plural(2, ['вкус', 'вкуса', 'вкусов']).
 */
function plural(n, one, few, many) {
  const forms = Array.isArray(one) ? one : [one, few, many];
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function renderCatalog() {
  renderCount();
  renderActiveFilters();

  // Всегда рендерим отфильтрованные БРЕНДЫ из state.brands
  const filtered = getFilteredBrands();

  // Лимит «Показать ещё» сбрасывается в 24 при смене фильтров/поиска
  const sig = filtersSignature();
  if (state.sig !== sig) {
    state.sig = sig;
    state.limit = PAGE_SIZE;
  }
  const visible = filtered.slice(0, state.limit);

  catalogEl.replaceChildren();

  if (filtered.length === 0) {
    hideSkeleton();
    emptyStateEl.hidden = false;
    renderLoadMore(0, 0);
    renderCartUI();
    updateResetBtn();
    return;
  }
  emptyStateEl.hidden = true;
  hideSkeleton();

  const query = state.search.trim().toLowerCase();

  visible.forEach((group, i) => {
    const card = createBrandCard(group, i < 4);
    // Стаггер-анимация: порядковый номер в --i
    card.style.setProperty('--i', String(i));
    // Подсветка поиска: название бренда, безопасно (без innerHTML)
    if (query) {
      const nameEl = card.querySelector('.brand-name');
      if (nameEl) markText(nameEl, query);
    }
    catalogEl.appendChild(card);
  });

  renderLoadMore(visible.length, filtered.length);
  renderCartUI();
  updateResetBtn();
}

/* ===== Подсветка поиска (безопасно: обход текстовых узлов, без innerHTML) ===== */
function markText(element, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const text = node.nodeValue || '';
    if (!text.toLowerCase().includes(q)) return;

    const fragment = document.createDocumentFragment();
    let rest = text;
    let index = rest.toLowerCase().indexOf(q);

    while (index !== -1) {
      if (index > 0) fragment.appendChild(document.createTextNode(rest.slice(0, index)));
      const mark = document.createElement('mark');
      mark.textContent = rest.slice(index, index + q.length);
      fragment.appendChild(mark);
      rest = rest.slice(index + q.length);
      index = rest.toLowerCase().indexOf(q);
    }
    if (rest) fragment.appendChild(document.createTextNode(rest));
    node.parentNode.replaceChild(fragment, node);
  });
}

/* ============================================================
   Главный экран: карточки брендов
   ============================================================ */

/* Карточка бренда в сетке .catalog */
function createBrandCard(group, priority) {
  const card = document.createElement('article');
  card.className = 'brand-card';
  card.dataset.brand = group.brand;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'Бренд ' + group.brand + ': ' + group.count + ' ' +
    plural(group.count, ['вкус', 'вкуса', 'вкусов']));

  const media = document.createElement('div');
  media.className = 'brand-media';
  media.appendChild(buildMediaEl(brandMediaItem(group), 'brand-img', { priority: !!priority }));

  const info = document.createElement('div');
  info.className = 'brand-info';

  const name = document.createElement('h3');
  name.className = 'brand-name';
  name.textContent = group.brand;

  const count = document.createElement('p');
  count.className = 'brand-count';
  count.textContent = group.count + ' ' + plural(group.count, ['вкус', 'вкуса', 'вкусов']);

  const price = document.createElement('p');
  price.className = 'brand-price';
  price.textContent = group.count > 1
    ? ('от ' + formatPrice(group.priceMin))
    : formatPrice(group.priceMin);

  info.append(name, count, price);

  const stock = document.createElement('span');
  stock.className = 'brand-stock' + (group.inStockCount === 0 ? ' out' : '');
  stock.textContent = group.inStockCount === 0
    ? 'нет в наличии'
    : (group.inStockCount + ' в наличии');

  card.append(media, info, stock);
  return card;
}

/* Сердечко избранного (переиспользуется в списке вкусов окна бренда) */
function createFavButton(product) {
  const isFav = state.favs.has(product.id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fav-btn' + (isFav ? ' active' : '');
  btn.dataset.id = product.id;
  btn.setAttribute('aria-label', isFav ? 'Убрать из избранного' : 'Добавить в избранное');
  btn.setAttribute('aria-pressed', String(isFav));
  btn.textContent = isFav ? '❤' : '🤍';
  return btn;
}

/* ============================================================
   Окно бренда #brandModal — список всех вкусов
   ============================================================ */

/* Одна строка вкуса внутри #brandModal — БЕЗ медиа: название, категория,
   цена, сердечко ❤ и кнопка «+ Добавить» → степпер «− N +».
   Фото/эмодзи есть только у бренда (карточка и шапка окна бренда). */
function createFlavorRow(item, query) {
  const row = document.createElement('div');
  row.className = 'flavor-row' + (item.available === false ? ' unavailable' : '');
  row.dataset.id = item.id;

  /* Текстовый блок: название, категория, цена */
  const info = document.createElement('div');
  info.className = 'flavor-info';

  const name = document.createElement('p');
  name.className = 'flavor-name';
  name.textContent = item.name || 'Без названия';
  info.appendChild(name);

  const cat = document.createElement('p');
  cat.className = 'flavor-cat';
  cat.textContent = item.category || '';
  info.appendChild(cat);

  const priceRow = document.createElement('div');
  priceRow.className = 'flavor-price-row';

  const price = document.createElement('span');
  price.className = 'flavor-price';
  price.textContent = formatPrice(item.price);
  priceRow.appendChild(price);

  info.appendChild(priceRow);

  if (item.available === false) {
    const stock = document.createElement('p');
    stock.className = 'flavor-stock out';
    stock.textContent = 'нет в наличии';
    info.appendChild(stock);
  }

  /* Действия справа: сердечко ❤ и корзина (кнопка «+ Добавить» / степпер).
     Для недоступного вкуса createControls отдаёт disabled-кнопку. */
  const actions = document.createElement('div');
  actions.className = 'flavor-actions';
  actions.appendChild(createFavButton(item));
  actions.appendChild(createControls(item, 'Добавить'));

  row.append(info, actions);

  if (query) {
    markText(name, query);
    if (cat.textContent) markText(cat, query);
  }

  return row;
}

/* Полный рендер содержимого окна бренда (переиспользуется при обновлении) */
function renderBrandModal() {
  if (!brandModal || !brandModalBody) return;
  const brandName = state.openBrandId;
  if (brandName === null) return;

  const group = state.brands.find((g) => g.brand === brandName);
  if (!group) { closeBrandModal(); return; }

  const allItems = group.items;
  const filtered = filteredFlavorsOf(group);
  const showAll = state.brandShowAll;
  const shown = showAll ? allItems : filtered;
  const query = state.search.trim().toLowerCase();

  brandModalBody.replaceChildren();

  // Шапка: фото бренда 120px, название, «N вкусов», «от X ₽»
  const head = document.createElement('div');
  head.className = 'brand-head';

  const media = document.createElement('div');
  media.className = 'brand-head-media';
  media.appendChild(buildMediaEl(brandMediaItem(group), 'brand-head-img'));

  const info = document.createElement('div');
  info.className = 'brand-head-info';

  const nameEl = document.createElement('h2');
  nameEl.className = 'brand-head-name';
  nameEl.textContent = group.brand;

  const countEl = document.createElement('p');
  countEl.className = 'brand-head-count';
  countEl.textContent = group.count + ' ' + plural(group.count, ['вкус', 'вкуса', 'вкусов']) +
    ' · ' + group.inStockCount + ' в наличии';

  const priceEl = document.createElement('p');
  priceEl.className = 'brand-head-price';
  priceEl.textContent = group.count > 1
    ? ('от ' + formatPrice(group.priceMin))
    : formatPrice(group.priceMin);

  info.append(nameEl, countEl, priceEl);
  head.append(media, info);
  brandModalBody.appendChild(head);

  if (query) markText(nameEl, query);

  // Строка-заметка о фильтрах: «Показано K из N вкусов (действуют фильтры) ✕»
  const filtersApplied = hasFlavorFilters() && filtered.length < allItems.length;

  if (filtersApplied && !showAll) {
    const note = document.createElement('div');
    note.className = 'brand-note';

    const text = document.createElement('span');
    text.textContent = 'Показано ' + filtered.length + ' из ' + allItems.length +
      ' вкусов (действуют фильтры)';
    note.appendChild(text);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'brand-note-clear';
    clear.textContent = '✕';
    clear.setAttribute('aria-label', 'Показать все вкусы бренда без фильтров');
    clear.addEventListener('click', () => {
      haptic('light');
      state.brandShowAll = true;
      renderBrandModal();
    });
    note.appendChild(clear);
    brandModalBody.appendChild(note);
  } else if (filtersApplied && showAll) {
    const note = document.createElement('div');
    note.className = 'brand-note';
    note.appendChild(document.createTextNode('Фильтры сняты для просмотра — показаны все вкусы'));

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'brand-note-clear';
    back.textContent = '↺';
    back.setAttribute('aria-label', 'Вернуть фильтры');
    back.addEventListener('click', () => {
      haptic('light');
      state.brandShowAll = false;
      renderBrandModal();
    });
    note.appendChild(back);
    brandModalBody.appendChild(note);
  }

  // Список вкусов
  if (shown.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'brand-empty';
    empty.textContent = 'Под текущие фильтры не подходит ни один вкус этого бренда.';
    brandModalBody.appendChild(empty);
  } else {
    shown.forEach((item) => {
      brandModalBody.appendChild(createFlavorRow(item, query));
    });
  }

  // Футер: добавить весь бренд в корзину
  const actions = document.createElement('div');
  actions.className = 'brand-actions';

  const addAll = document.createElement('button');
  addAll.type = 'button';
  addAll.className = 'brand-add-all-btn';
  addAll.textContent = '➕ Добавить весь бренд в корзину';
  addAll.disabled = shown.filter((it) => it.available !== false).length === 0;
  addAll.addEventListener('click', addWholeBrand);
  actions.appendChild(addAll);
  brandModalBody.appendChild(actions);
}

function openBrandModal(brandName) {
  if (!brandModal) return;
  const group = state.brands.find((g) => g.brand === brandName);
  if (!group) return;

  state.openBrandId = brandName;
  state.brandShowAll = false;

  renderBrandModal();
  rememberScroll();
  brandModal.classList.add('open');
  brandModal.setAttribute('aria-hidden', 'false');
  updateBackButton();
}

function closeBrandModal() {
  if (!brandModal) return;
  brandModal.classList.remove('open');
  brandModal.setAttribute('aria-hidden', 'true');
  state.openBrandId = null;
  state.brandShowAll = false;
  updateBackButton();
  maybeRestoreScroll();
}

/* Временная подсветка строки вкуса (после «Мне повезёт») */
function highlightFlavorRow(id) {
  if (!brandModalBody) return;
  const row = brandModalBody.querySelector('.flavor-row[data-id="' + id + '"]');
  if (!row) return;

  row.classList.add('flavor-highlight');
  if (typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  setTimeout(() => row.classList.remove('flavor-highlight'), 1500);
}

/* «➕ Добавить весь бренд в корзину» — по 1 шт каждого доступного вкуса */
function addWholeBrand() {
  const group = state.brands.find((g) => g.brand === state.openBrandId);
  if (!group) return;

  const shown = state.brandShowAll ? group.items : filteredFlavorsOf(group);
  const items = shown.filter((item) => item.available !== false);

  if (items.length === 0) {
    showToast('Нет доступных вкусов для добавления');
    return;
  }

  items.forEach((item) => {
    state.cart.set(item.id, (state.cart.get(item.id) || 0) + 1);
  });
  haptic('success');
  renderAll();
  showToast('Добавлено в корзину: ' + items.length + ' ' +
    plural(items.length, ['вкус', 'вкуса', 'вкусов']));
}

function createControls(product, label) {
  const controls = document.createElement('div');
  controls.className = 'card-controls';

  const unavailable = product.available === false;
  const qty = unavailable ? 0 : (state.cart.get(product.id) || 0);
  const wrap = document.createElement('div');
  wrap.className = 'qty-row';

  if (qty > 0) {
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'qty-btn';
    minus.textContent = '−';
    minus.dataset.action = 'minus';
    minus.dataset.id = product.id;
    minus.setAttribute('aria-label', 'Убрать одну штуку');

    const count = document.createElement('span');
    count.className = 'qty-count';
    count.textContent = qty;

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'qty-btn plus';
    plus.textContent = '+';
    plus.dataset.action = 'plus';
    plus.dataset.id = product.id;
    plus.setAttribute('aria-label', 'Добавить ещё одну штуку');

    wrap.append(minus, count, plus);
  } else {
    // Нет в корзине: «+ Добавить». У недоступного вкуса кнопка disabled.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-btn';
    add.dataset.action = 'plus';
    add.dataset.id = product.id;
    if (unavailable) {
      add.disabled = true;
      add.setAttribute('aria-label', 'Нет в наличии');
    } else {
      add.setAttribute('aria-label', 'Добавить в корзину');
    }
    if (label) {
      const plus = document.createElement('span');
      plus.className = 'add-btn-plus';
      plus.textContent = '+';
      const text = document.createElement('span');
      text.className = 'add-btn-label';
      text.textContent = label;
      add.append(plus, text);
    } else {
      add.textContent = '+';
    }
    wrap.appendChild(add);
  }

  controls.appendChild(wrap);
  return controls;
}

/* ===== Корзина ===== */
function formatPrice(value) {
  return Number(value || 0).toLocaleString('ru-RU') + ' ₽';
}

function cartQty() {
  let n = 0;
  state.cart.forEach((qty) => { n += qty; });
  return n;
}

function cartTotal() {
  let sum = 0;
  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (product) sum += (product.price || 0) * qty;
  });
  return sum;
}

function updateBackButton() {
  if (!tg || !tg.BackButton) return;
  const anyOpen =
    (detailModal && detailModal.classList.contains('open')) ||
    (brandModal && brandModal.classList.contains('open')) ||
    (cartModal && cartModal.classList.contains('open'));
  if (anyOpen) {
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

/* ===== Корзина: бейдж в шапке + содержимое окна #cartModal ===== */

function renderCartUI() {
  renderCartBadge();
  renderCartModal();
  updateBackButton();
}

function renderCartBadge() {
  if (!cartBadgeEl) return;
  const count = cartQty();
  cartBadgeEl.textContent = String(count);
  cartBadgeEl.classList.toggle('hidden', count === 0);
  if (cartBtn) {
    cartBtn.setAttribute('aria-label', count > 0 ? ('Корзина: ' + count) : 'Корзина');
  }
}

/*
 * renderCartModal() — перерисовывает тело окна корзины из state.cart.
 * Вызывается при любом изменении корзины и при открытии окна.
 */
function renderCartModal() {
  if (!cartModalBody) return;

  if (cartModalCountEl) {
    cartModalCountEl.textContent = state.cart.size > 0
      ? (state.cart.size + ' ' + plural(state.cart.size, ['позиция', 'позиции', 'позиций']))
      : '';
  }

  cartModalBody.replaceChildren();

  if (state.cart.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'cart-empty';

    const text = document.createElement('p');
    text.className = 'cart-empty-text';
    text.textContent = 'Корзина пуста';

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'cart-empty-btn';
    go.textContent = 'Перейти в каталог';
    go.addEventListener('click', () => {
      haptic('light');
      closeCart();
    });

    empty.append(text, go);
    cartModalBody.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'cart-list';

  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;

    const li = document.createElement('li');
    li.className = 'cart-list-item';
    li.dataset.id = String(id);

    const info = document.createElement('div');
    info.className = 'cart-item-info';

    const name = document.createElement('span');
    name.className = 'cart-item-name';
    name.textContent = product.name || 'Товар';

    const brand = document.createElement('span');
    brand.className = 'cart-item-brand';
    brand.textContent = product.brand || product.category || '';

    info.append(name, brand);

    const sum = document.createElement('span');
    sum.className = 'cart-item-sum';
    sum.textContent = formatPrice((Number(product.price) || 0) * qty);

    const controls = createControls(product, null);

    li.append(info, sum, controls);
    list.appendChild(li);
  });

  cartModalBody.appendChild(list);

  const totalRow = document.createElement('div');
  totalRow.className = 'cart-total-row';

  const totalLabel = document.createElement('span');
  totalLabel.className = 'cart-total-label';
  totalLabel.textContent = 'Итого: ';

  const totalValue = document.createElement('span');
  totalValue.id = 'cartTotal';
  totalValue.className = 'cart-total-value';
  totalValue.textContent = formatPrice(cartTotal());

  totalRow.append(totalLabel, totalValue);

  const actions = document.createElement('div');
  actions.className = 'cart-modal-actions';

  const send = document.createElement('button');
  send.type = 'button';
  send.id = 'sendOrderBtn';
  send.className = 'send-button';
  send.textContent = 'Отправить заказ';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.id = 'clearCartBtn';
  clear.className = 'clear-button';
  clear.textContent = 'Очистить корзину';

  actions.append(send, clear);
  cartModalBody.append(totalRow, actions);
}

function addToCart(id) {
  state.cart.set(id, (state.cart.get(id) || 0) + 1);
  haptic('success');
  renderAll();
}

function removeFromCart(id) {
  const next = (state.cart.get(id) || 0) - 1;
  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, next);
  renderAll();
}

/* Полная очистка корзины с подтверждением (вторичная кнопка в окне) */
function clearCart() {
  if (state.cart.size === 0) {
    showToast('Корзина пуста');
    return;
  }

  const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
    ? window.confirm('Очистить корзину целиком?')
    : true;
  if (!ok) return;

  state.cart.clear();
  haptic('warning');
  renderAll();
  showToast('Корзина очищена');
}

/* Открытие/закрытие окна корзины */
function openCart() {
  if (!cartModal) return;
  renderCartModal();
  rememberScroll();
  cartModal.classList.add('open');
  cartModal.setAttribute('aria-hidden', 'false');
  updateBackButton();
}

function closeCart() {
  if (!cartModal) return;
  cartModal.classList.remove('open');
  cartModal.setAttribute('aria-hidden', 'true');
  updateBackButton();
  maybeRestoreScroll();
}

function renderAll() {
  renderCatalog();      // сетка брендов + счётчики
  renderBrandModal();   // если окно бренда открыто — обновить степперы
  renderCartUI();       // бейдж в шапке + окно корзины (если открыто)
}

/* Полное обновление всех представлений после смены фильтров/избранного */
function refreshViews() {
  renderChips();
  renderChips2();
  renderCatalog();
  renderBrandModal();
}

/* ===== Отправка заказа ===== */

/* Лимит длины готовой ссылки: Telegram ограничивает размер предзаполненного текста */
const ORDER_LINK_LIMIT = 9999;

/* Позиции корзины для заказа: [{ name, qty, sum }, ...] */
function cartItemsForOrder() {
  const items = [];
  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    items.push({
      name: product.name || 'Товар',
      qty: qty,
      sum: (product.price || 0) * qty
    });
  });
  return items;
}

/* Чистая функция: текст заказа в прежнем формате */
function buildOrderText(cartItems, total) {
  const lines = ['Заказ:'];
  (cartItems || []).forEach((item, i) => {
    lines.push(
      (i + 1) + ') ' + ((item && item.name) || 'Товар') +
      ' — ' + ((item && item.qty) || 0) + ' шт — ' + ((item && item.sum) || 0) + ' ₽'
    );
  });
  lines.push('Итого: ' + (Number(total) || 0) + ' ₽');
  return lines.join('\n');
}

/* Чистая функция: ссылка на чат с предзаполненным текстом заказа */
function buildOrderLink(username, text) {
  return 'https://t.me/' + username + '?text=' + encodeURIComponent(text);
}

/* Чистая функция: обрезает список позиций, чтобы ссылка влезла в лимит */
function fitOrderText(items, total, username, limit) {
  const user = username || CONFIG.contactUsername;
  const maxUrl = Number(limit) || ORDER_LINK_LIMIT;
  const list = Array.isArray(items) ? items : [];

  const full = buildOrderText(list, total);
  if (buildOrderLink(user, full).length <= maxUrl) return full;

  // Режем только целые позиции (не посреди строки), добавляем «…и ещё N позиций»
  for (let keep = list.length - 1; keep >= 0; keep -= 1) {
    const omitted = list.length - keep;
    const text = buildOrderText(list.slice(0, keep), total) +
      '\n…и ещё ' + omitted + ' позиций';
    if (buildOrderLink(user, text).length <= maxUrl) return text;
  }

  return 'Заказ:\nИтого: ' + (Number(total) || 0) + ' ₽';
}

/* Открытие ссылки: Telegram Mini App, иначе обычное окно */
function openTelegramLink(url) {
  const wa = window.Telegram && window.Telegram.WebApp;
  if (wa && typeof wa.openTelegramLink === 'function') {
    wa.openTelegramLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // переходим к fallback ниже
    }
  }
  // Fallback для сред без Clipboard API
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function sendOrder() {
  if (state.cart.size === 0) {
    showToast('Корзина пуста');
    return;
  }

  const text = fitOrderText(cartItemsForOrder(), cartTotal());
  const link = buildOrderLink(CONFIG.contactUsername, text);

  haptic('success');
  openTelegramLink(link);
  showToast('Открываю чат с продавцом — нажмите «Отправить» в Telegram');
  // Корзину намеренно не очищаем: заказ можно поправить и отправить повторно
}

/* ===== Тост ===== */
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/* ===== Модалка деталей ===== */
function openDetail(item) {
  detailItem = item;
  renderDetail(item);
  rememberScroll();
  detailModal.classList.add('open');
  detailModal.setAttribute('aria-hidden', 'false');
  updateBackButton();
}

function closeDetail() {
  detailModal.classList.remove('open');
  detailModal.setAttribute('aria-hidden', 'true');
  detailItem = null;
  updateBackButton();
  maybeRestoreScroll();
}

function renderDetail(item) {
  detailBody.replaceChildren();

  // Медиа-шапка: фото или эмодзи-заглушка (buildMediaEl, квадрат)
  const media = document.createElement('div');
  media.className = 'detail-media';
  media.appendChild(buildMediaEl(item, 'modal-media'));
  detailBody.appendChild(media);

  // Название
  const name = document.createElement('h2');
  name.className = 'detail-name';
  name.textContent = item.name || 'Без названия';
  detailBody.appendChild(name);

  // Бренд
  if (item.brand) {
    const brand = document.createElement('span');
    brand.className = 'detail-brand';
    brand.textContent = item.brand;
    detailBody.appendChild(brand);
  }

  // Цена — единственная, без зачёркнутой
  const priceRow = document.createElement('div');
  priceRow.className = 'detail-price-row';

  const price = document.createElement('span');
  price.className = 'detail-price';
  price.textContent = formatPrice(item.price);
  priceRow.appendChild(price);
  detailBody.appendChild(priceRow);

  // Кликабельная категория: «📁 <категория>»
  if (item.category) {
    const catBtn = document.createElement('button');
    catBtn.type = 'button';
    catBtn.className = 'detail-category-btn';
    catBtn.textContent = '📁 ' + item.category;
    detailBody.appendChild(catBtn);
  }

  // Наличие
  const stock = document.createElement('p');
  stock.className = 'detail-stock' + (item.available === false ? ' out' : '');
  stock.textContent = item.available === false ? 'Нет в наличии' : 'В наличии';
  detailBody.appendChild(stock);

  // Описание — полное, без clamp
  if (item.description) {
    const desc = document.createElement('p');
    desc.className = 'detail-desc';
    desc.textContent = item.description;
    detailBody.appendChild(desc);
  }

  // Кнопки CTA
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'detail-add-btn';
  addBtn.textContent = '+ В корзину';
  addBtn.disabled = item.available === false;
  actions.appendChild(addBtn);

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'detail-share-btn';
  shareBtn.textContent = 'Поделиться';
  actions.appendChild(shareBtn);

  detailBody.appendChild(actions);
}

async function shareProduct() {
  const item = detailItem;
  if (!item) return;
  const text = '🔞 ' + (item.name || '') + ' ' + (item.brand || '') +
    ' — ' + formatPrice(item.price) + '\nПодробнее в VapeCatalog';
  const ok = await copyText(text);
  showToast(ok ? 'Скопировано' : 'Не удалось скопировать');
}

/* ===== Экспорт выборки ===== */
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return dd + '.' + mm + '.' + date.getFullYear();
}

function exportSelection() {
  const groups = getFilteredBrands();
  let flavorsCount = 0;
  groups.forEach((group) => { flavorsCount += group.filteredItems.length; });

  if (groups.length === 0 || flavorsCount === 0) {
    showToast('Нет записей для экспорта');
    return;
  }

  const lines = ['Прайс VapeCatalog ' + formatDate(new Date()), ''];
  groups.forEach((group) => {
    lines.push('— ' + group.brand + ' —');
    group.filteredItems.forEach((item) => {
      lines.push((item.name || 'Без названия') + ' — ' +
        (Number(item.price) || 0).toLocaleString('ru-RU') + ' ₽');
    });
    lines.push('');
  });

  const text = lines.join('\n').replace(/\s+$/, '');
  copyText('https://t.me/sibir_distro').then((ok) => {
    showToast(ok
      ? 'Ссылка на канал с прайсом скопирована  (' + groups.length + ' ' +
        plural(groups.length, ['бренд', 'бренда', 'брендов']) + ', ' +
        flavorsCount + ' ' + plural(flavorsCount, ['вкус', 'вкуса', 'вкусов']) + ')'
      : 'Не удалось скопировать прайс');
  });
}



/* ===== События ===== */
document.addEventListener('scroll', function () {
  if (!toTopBtn) return;
  toTopBtn.classList.toggle('show', window.scrollY > 600);
}, { passive: true });

toTopBtn.addEventListener('click', function () {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

chipsEl.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  let isCategoryChip = false;
  if (chip.hasAttribute('data-fav')) {
    state.favOnly = !state.favOnly;
    if (state.favOnly) {
      state.category = 'Все';
    }
  } else if (chip.hasAttribute('data-toggle')) {
    state.inStockOnly = !state.inStockOnly;
  } else if (chip.dataset.category !== undefined) {
    state.category = chip.dataset.category;
    state.favOnly = false;
    isCategoryChip = true;
  }
  haptic('light');
  refreshViews();
  if (isCategoryChip) scrollToCatalog();
});

chips2El.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.brand === undefined) return;
  state.brand = chip.dataset.brand;
  haptic('light');
  refreshViews();
});

searchInput.addEventListener('input', (event) => {
  const value = event.target.value;
  updateSearchClear(value);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = value;
    renderCatalog();
  }, 250);
});

searchClear.addEventListener('click', () => {
  clearSearch();
  searchInput.focus();
});

resetBtn.addEventListener('click', resetFilters);

catalogEl.addEventListener('click', (event) => {
  // Кнопки внутри карточки (на будущее) не открывают окно бренда
  if (event.target.closest('button')) return;

  const card = event.target.closest('.brand-card');
  if (card && card.dataset.brand) {
    haptic('light');
    openBrandModal(card.dataset.brand);
  }
});

catalogEl.addEventListener('keydown', (event) => {
  const card = event.target && event.target.closest ? event.target.closest('.brand-card') : null;
  if (!card) return;
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    haptic('light');
    openBrandModal(card.dataset.brand);
  }
});

detailBody.addEventListener('click', (event) => {
  const addBtn = event.target.closest('.detail-add-btn');
  if (addBtn) {
    if (detailItem) {
      addToCart(detailItem.id);
      showToast('Добавлено в корзину');
    }
    return;
  }
  const catBtn = event.target.closest('.detail-category-btn');
  if (catBtn) {
    if (detailItem && detailItem.category) {
      const cat = detailItem.category;
      closeDetail();
      state.search = '';
      searchInput.value = '';
      state.favOnly = false;
      state.category = cat;
      updateSearchClear();
      refreshViews();
      showToast('Категория: ' + cat);
    }
    return;
  }
  const shareBtn = event.target.closest('.detail-share-btn');
  if (shareBtn) {
    shareProduct();
  }
});

detailCloseBtn.addEventListener('click', closeDetail);
detailModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-close-detail')) closeDetail();
});

/* ===== События окна бренда ===== */
brandCloseBtn.addEventListener('click', closeBrandModal);
brandModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-close-brand')) closeBrandModal();
});

brandModalBody.addEventListener('click', (event) => {
  const target = event.target;

  const favBtn = target.closest('.fav-btn');
  if (favBtn) {
    toggleFav(Number(favBtn.dataset.id));
    return;
  }

  const btn = target.closest('button[data-action]');
  if (btn) {
    if (btn.disabled) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'plus') addToCart(id);
    else if (btn.dataset.action === 'minus') removeFromCart(id);
    return;
  }

  const row = target.closest('.flavor-row');
  if (row && row.dataset.id) {
    const product = state.products.find((p) => Number(p.id) === Number(row.dataset.id));
    if (product) openDetail(product);
  }
});

exportBtn.addEventListener('click', exportSelection);

luckyBtn.addEventListener('click', () => {
  // Выбор только среди доступных вкусов текущей выборки
  const items = getFilteredFlavors().filter((p) => p.available !== false);
  if (items.length === 0) {
    showToast('Нет доступных вкусов для выбора');
    return;
  }
  spinLucky(items);
});

themeToggle.addEventListener('click', () => {
  haptic('light');
  toggleTheme();
});

/* ===== События окна корзины ===== */
cartBtn.addEventListener('click', () => {
  haptic('light');
  openCart();
});

cartCloseBtn.addEventListener('click', closeCart);

cartModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-close-cart')) closeCart();
});

cartModalBody.addEventListener('click', (event) => {
  const target = event.target;

  const send = target.closest('#sendOrderBtn');
  if (send) { sendOrder(); return; }

  const clear = target.closest('#clearCartBtn');
  if (clear) { clearCart(); return; }

  const btn = target.closest('button[data-action]');
  if (btn) {
    if (btn.disabled) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'plus') addToCart(id);
    else if (btn.dataset.action === 'minus') removeFromCart(id);
  }
});

/* Новые кнопки удобства */
refreshBtn.addEventListener('click', refreshCatalog);
shareBtn.addEventListener('click', shareCatalog);

loadMoreBtn.addEventListener('click', () => {
  state.limit += PAGE_SIZE;
  haptic('light');
  renderCatalog();
});

emptyResetBtn.addEventListener('click', () => {
  haptic('light');
  resetFilters();
});

/* Горячие клавиши (десктоп) */
document.addEventListener('keydown', handleHotkey);

/* ===== Старт ===== */
applyTheme();
initTelegram();
updateSearchClear();
updateResetBtn();
loadProducts();

/* Экспорт внутренних функций — для отладки и автотестов
   (на работу приложения не влияет) */
if (typeof window !== 'undefined') {
  window.VapeApp = {
    state: state,
    groupByBrand: groupByBrand,
    plural: plural,
    openBrandModal: openBrandModal,
    closeBrandModal: closeBrandModal,
    renderBrandModal: renderBrandModal,
    getFilteredBrands: getFilteredBrands,
    getFilteredFlavors: getFilteredFlavors,
    renderCatalog: renderCatalog,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    toggleFav: toggleFav,
    cartItemsForOrder: cartItemsForOrder,
    cartTotal: cartTotal,
    cartQty: cartQty,
    openCart: openCart,
    closeCart: closeCart,
    clearCart: clearCart,
    renderCartUI: renderCartUI,
    buildOrderText: buildOrderText,
    buildOrderLink: buildOrderLink,
    fitOrderText: fitOrderText,
    formatPrice: formatPrice,
    haptic: haptic
  };
}
