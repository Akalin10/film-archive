/* ============================================================
  暗房 · Film Archive — Application Logic
  IndexedDB-backed static photo archive
  ============================================================ */

// ─── Database Layer ───────────────────────────────────────────
const DB_NAME = 'FilmArchive';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('dateTaken', 'dateTaken', { unique: false });
        photos.createIndex('dateUploaded', 'dateUploaded', { unique: false });
        photos.createIndex('albumId', 'albumId', { unique: false });
        photos.createIndex('isFeatured', 'isFeatured', { unique: false });
        photos.createIndex('isPublic', 'isPublic', { unique: false });
      }
      if (!db.objectStoreNames.contains('albums')) {
        const albums = db.createObjectStore('albums', { keyPath: 'id' });
        albums.createIndex('dateCreated', 'dateCreated', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbTransaction(storeName, mode = 'readonly') {
  return openDB().then(db => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    return { store, tx, db, done: new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = (e) => { db.close(); reject(e.target.error); };
      tx.onabort = () => { db.close(); reject(new Error('Transaction aborted')); };
    })};
  });
}

function dbGetAll(storeName) {
  return dbTransaction(storeName).then(({ store, done }) =>
    new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => done.then(() => resolve(req.result));
      req.onerror = () => reject(req.error);
    })
  );
}

function dbGet(storeName, id) {
  return dbTransaction(storeName).then(({ store, done }) =>
    new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => done.then(() => resolve(req.result));
      req.onerror = () => reject(req.error);
    })
  );
}

function dbPut(storeName, item) {
  return dbTransaction(storeName, 'readwrite').then(({ store, done }) =>
    new Promise((resolve, reject) => {
      const req = store.put(item);
      req.onsuccess = () => done.then(() => resolve(req.result));
      req.onerror = () => reject(req.error);
    })
  );
}

function dbDelete(storeName, id) {
  return dbTransaction(storeName, 'readwrite').then(({ store, done }) =>
    new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => done.then(() => resolve());
      req.onerror = () => reject(req.error);
    })
  );
}

async function dbGetSetting(key, defaultValue = null) {
  try {
    const result = await dbGet('settings', key);
    return result ? result.value : defaultValue;
  } catch { return defaultValue; }
}

async function dbSetSetting(key, value) {
  await dbPut('settings', { key, value });
}

// ─── State ────────────────────────────────────────────────────
const state = {
  currentView: 'gallery',
  currentFilter: 'all',       // 'all' | 'featured' | 'recent' | 'album'
  currentAlbumId: null,
  sortBy: 'dateTaken',
  sortOrder: 'desc',
  tagFilter: '',
  searchQuery: '',
  searchType: 'all',
  searchDateFrom: '',
  searchDateTo: '',
  isAuthenticated: false,
  photos: [],
  albums: [],
  currentLightboxIndex: -1,
  lightboxPhotos: [],
  uploadFiles: [],            // Array of { file, previewUrl, title, desc, date, location, tags }
};

// ─── Helpers ──────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ─── Toast ────────────────────────────────────────────────────
function toast(message, type = '') {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
    el.style.transition = 'all 200ms ease-in';
    setTimeout(() => el.remove(), 200);
  }, 2800);
}

// ─── Thumbnail Generation ─────────────────────────────────────
function createThumbnail(file, maxSize = 400) {
  return new Promise((resolve) => {
    const canvas = $('#thumbCanvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height *= maxSize / width; width = maxSize; }
      } else {
        if (height > maxSize) { width *= maxSize / height; height = maxSize; }
      }
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve({ blob, width, height }), 'image/jpeg', 0.75);
    };
    img.onerror = () => resolve(null);
    if (/\.(svg|gif)$/i.test(file.name)) {
      // For SVG/GIF, use original as thumbnail
      resolve({ blob: file, width: 0, height: 0 });
      return;
    }
    img.src = url;
  });
}

// ─── Theme ────────────────────────────────────────────────────
function getTheme() {
  return document.documentElement.dataset.theme || 'light';
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('film_archive_theme', theme);
  dbSetSetting('theme', theme).catch(() => {});
}

function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

// ─── Auth ─────────────────────────────────────────────────────
async function checkAuth() {
  const pwd = await dbGetSetting('adminPassword', '');
  if (!pwd) {
    // First time — set default password
    await dbSetSetting('adminPassword', 'darkroom');
    state.isAuthenticated = false;
    return;
  }
  const session = sessionStorage.getItem('film_archive_auth');
  state.isAuthenticated = session === 'true';
}

function requireAuth(action) {
  if (state.isAuthenticated) {
    action();
  } else {
    showLoginModal(action);
  }
}

function showLoginModal(onSuccess) {
  const modal = $('#loginModal');
  const input = $('#adminPasswordInput');
  const submit = $('#btnLoginSubmit');
  input.value = '';

  modal.classList.add('open');

  const cleanup = () => {
    modal.classList.remove('open');
    submit.removeEventListener('click', handler);
    $('#btnLoginCancel').removeEventListener('click', cancelHandler);
    $('#loginModalClose').removeEventListener('click', cancelHandler);
  };

  const cancelHandler = () => cleanup();

  const handler = async () => {
    const pwd = await dbGetSetting('adminPassword', 'darkroom');
    if (input.value === pwd) {
      state.isAuthenticated = true;
      sessionStorage.setItem('film_archive_auth', 'true');
      toast('登录成功', 'success');
      cleanup();
      if (onSuccess) onSuccess();
    } else {
      toast('密码错误', 'error');
    }
  };

  submit.addEventListener('click', handler);
  $('#btnLoginCancel').addEventListener('click', cancelHandler);
  $('#loginModalClose').addEventListener('click', cancelHandler);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
  input.focus();
}

// ─── Photo Data ───────────────────────────────────────────────
async function loadPhotos() {
  state.photos = await dbGetAll('photos');
}

async function savePhoto(photoData) {
  await dbPut('photos', photoData);
  await loadPhotos();
}

async function deletePhoto(id) {
  await dbDelete('photos', id);
  // Remove from albums cover references
  const albums = await dbGetAll('albums');
  for (const album of albums) {
    if (album.coverPhotoId === id) {
      album.coverPhotoId = null;
      await dbPut('albums', album);
    }
  }
  await loadPhotos();
  await loadAlbums();
}

async function loadAlbums() {
  state.albums = await dbGetAll('albums');
}

// ─── Filtered / Sorted Photos ─────────────────────────────────
function getFilteredPhotos() {
  let photos = [...state.photos];

  // Filter by current nav filter
  if (state.currentFilter === 'featured') {
    photos = photos.filter(p => p.isFeatured);
  } else if (state.currentFilter === 'recent') {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    photos = photos.filter(p => new Date(p.dateUploaded).getTime() > weekAgo);
  }

  // Filter by album
  if (state.currentAlbumId) {
    photos = photos.filter(p => p.albumId === state.currentAlbumId);
  }

  // Filter by tag
  if (state.tagFilter) {
    photos = photos.filter(p => p.tags && p.tags.some(t => t.toLowerCase() === state.tagFilter.toLowerCase()));
  }

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    photos = photos.filter(p => {
      const matchTitle = p.title && p.title.toLowerCase().includes(q);
      const matchTags = p.tags && p.tags.some(t => t.toLowerCase().includes(q));
      const matchLocation = p.location && p.location.toLowerCase().includes(q);
      const matchDesc = p.description && p.description.toLowerCase().includes(q);
      return matchTitle || matchTags || matchLocation || matchDesc;
    });
  }

  // Date range search
  if (state.searchDateFrom) {
    const from = new Date(state.searchDateFrom).getTime();
    photos = photos.filter(p => new Date(p.dateTaken || p.dateUploaded).getTime() >= from);
  }
  if (state.searchDateTo) {
    const to = new Date(state.searchDateTo).getTime() + 86400000; // end of day
    photos = photos.filter(p => new Date(p.dateTaken || p.dateUploaded).getTime() <= to);
  }

  // Search type filter
  if (state.searchType && state.searchType !== 'all' && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    if (state.searchType === 'title') {
      photos = photos.filter(p => p.title && p.title.toLowerCase().includes(q));
    } else if (state.searchType === 'tags') {
      photos = photos.filter(p => p.tags && p.tags.some(t => t.toLowerCase().includes(q)));
    } else if (state.searchType === 'location') {
      photos = photos.filter(p => p.location && p.location.toLowerCase().includes(q));
    }
  }

  // Sort
  photos.sort((a, b) => {
    let aVal, bVal;
    if (state.sortBy === 'dateTaken') {
      aVal = a.dateTaken || a.dateUploaded || '';
      bVal = b.dateTaken || b.dateUploaded || '';
    } else if (state.sortBy === 'dateUploaded') {
      aVal = a.dateUploaded || '';
      bVal = b.dateUploaded || '';
    } else if (state.sortBy === 'title') {
      aVal = (a.title || '').toLowerCase();
      bVal = (b.title || '').toLowerCase();
    }
    if (state.sortOrder === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    }
    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
  });

  return photos;
}

// ─── Rendering: Masonry Gallery ───────────────────────────────
function renderMasonry(photos, containerId) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';

  // Update photo count for gallery view
  const countEl = $('#photoCount');
  if (countEl && containerId === '#masonryGrid') {
    countEl.textContent = `共 ${photos.length} 张照片`;
  }

  if (photos.length === 0) {
    updateEmptyState();
    return;
  }

  container.setAttribute('role', 'list');

  photos.forEach((photo) => {
    const card = createPhotoCard(photo);
    container.appendChild(card);
  });

  // Set grid row spans based on aspect ratio
  function setRowSpans() {
    const cards = container.querySelectorAll('.photo-card:not([data-spanned])');
    const style = getComputedStyle(container);
    const gap = parseFloat(style.gap) || parseFloat(style.columnGap) || 8;
    const rowHeight = parseFloat(style.gridAutoRows) || 8;
    const filmBorder = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--film-border')) || 6;
    let anySet = false;
    cards.forEach(card => {
      const img = card.querySelector('img');
      if (!img) return;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (!w || !h) return;
      const cardWidth = card.offsetWidth;
      if (!cardWidth) return;
      const aspectRatio = w / h;
      const imgHeight = cardWidth / aspectRatio;
      const totalHeight = imgHeight + filmBorder * 2 + 4;
      const rows = Math.ceil((totalHeight + gap) / (rowHeight + gap));
      card.style.gridRowEnd = `span ${Math.max(1, rows)}`;
      card.dataset.spanned = '1';
      anySet = true;
    });
    return anySet;
  }

  // Try immediately (works for cached/loaded images)
  requestAnimationFrame(() => {
    if (!setRowSpans()) {
      // Retry after images load
      const imgs = container.querySelectorAll('img');
      let loaded = 0;
      const total = imgs.length;
      if (total === 0) return;
      imgs.forEach(img => {
        if (img.complete && img.naturalWidth) {
          loaded++;
        } else {
          img.addEventListener('load', () => {
            loaded++;
            if (loaded >= total) setRowSpans();
          }, { once: true });
          img.addEventListener('error', () => {
            loaded++;
            if (loaded >= total) setRowSpans();
          }, { once: true });
        }
      });
      if (loaded >= total) setRowSpans();
    }
  });
}

function createPhotoCard(photo) {
  const card = document.createElement('div');
  card.className = 'photo-card';
  if (photo.isFeatured) card.classList.add('featured');
  if (!photo.isPublic) card.classList.add('private');
  card.setAttribute('role', 'listitem');
  card.dataset.id = photo.id;

  const inner = document.createElement('div');
  inner.className = 'photo-card-inner';

  // Lazy-loaded image
  const img = document.createElement('img');
  // Use thumbnail if available, otherwise full image
  const imageUrl = photo.thumbnailData
    ? URL.createObjectURL(photo.thumbnailData)
    : (photo.imageData ? URL.createObjectURL(photo.imageData) : '');
  img.src = imageUrl;
  img.loading = 'lazy';
  img.alt = photo.title || '照片';
  img.className = photo.thumbnailData ? 'loaded' : 'lazy-load';

  if (!photo.thumbnailData && photo.imageData) {
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="%23EDE8DF" width="200" height="150"/><text x="100" y="75" text-anchor="middle" fill="%23C8C0B4" font-size="14" font-family="sans-serif">加载失败</text></svg>';
      img.classList.add('loaded');
    };
  }

  inner.appendChild(img);

  // Hover overlay
  const hover = document.createElement('div');
  hover.className = 'photo-card-hover';
  const info = document.createElement('div');
  info.className = 'photo-card-info';
  if (photo.title) {
    const title = document.createElement('div');
    title.className = 'photo-card-title';
    title.textContent = photo.title;
    info.appendChild(title);
  }
  const meta = document.createElement('div');
  meta.className = 'photo-card-meta';
  meta.textContent = formatDate(photo.dateTaken || photo.dateUploaded);
  info.appendChild(meta);
  hover.appendChild(info);
  inner.appendChild(hover);

  // Featured star
  const star = document.createElement('div');
  star.className = 'photo-card-featured';
  star.textContent = '★';
  inner.appendChild(star);

  // Private badge
  if (!photo.isPublic) {
    const priv = document.createElement('div');
    priv.className = 'photo-card-private';
    priv.textContent = '🔒';
    inner.appendChild(priv);
  }

  card.appendChild(inner);

  card.addEventListener('click', () => openLightbox(photo));

  return card;
}

function updateEmptyState() {
  const empty = $('#emptyState');
  const photos = getFilteredPhotos();
  if (empty) {
    empty.style.display = photos.length === 0 && state.currentView === 'gallery' ? 'block' : 'none';
  }
}

// ─── Rendering: Albums ────────────────────────────────────────
function renderAlbums() {
  const container = $('#albumsGrid');
  const empty = $('#albumsEmpty');
  if (!container) return;

  container.innerHTML = '';

  if (state.albums.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  state.albums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-card';
    card.addEventListener('click', () => openAlbum(album));

    // Cover
    const cover = document.createElement('div');
    cover.className = 'album-cover';

    if (album.coverPhotoId) {
      const coverPhoto = state.photos.find(p => p.id === album.coverPhotoId);
      if (coverPhoto) {
        const img = document.createElement('img');
        img.src = coverPhoto.thumbnailData
          ? URL.createObjectURL(coverPhoto.thumbnailData)
          : (coverPhoto.imageData ? URL.createObjectURL(coverPhoto.imageData) : '');
        img.alt = album.name;
        cover.appendChild(img);
      } else {
        cover.innerHTML = '<div class="album-cover-placeholder">◈</div>';
      }
    } else {
      const albumPhotos = state.photos.filter(p => p.albumId === album.id);
      if (albumPhotos.length > 0) {
        const first = albumPhotos[0];
        const img = document.createElement('img');
        img.src = first.thumbnailData
          ? URL.createObjectURL(first.thumbnailData)
          : (first.imageData ? URL.createObjectURL(first.imageData) : '');
        img.alt = album.name;
        cover.appendChild(img);
      } else {
        cover.innerHTML = '<div class="album-cover-placeholder">◈</div>';
      }
    }

    card.appendChild(cover);

    // Info
    const info = document.createElement('div');
    info.className = 'album-info';
    const name = document.createElement('div');
    name.className = 'album-name';
    name.textContent = album.name;
    if (album.isPrivate) {
      const badge = document.createElement('span');
      badge.className = 'album-private-badge';
      badge.textContent = '🔒';
      name.appendChild(badge);
    }
    info.appendChild(name);

    const photosInAlbum = state.photos.filter(p => p.albumId === album.id);
    const count = document.createElement('div');
    count.className = 'album-count';
    count.textContent = `${photosInAlbum.length} 张照片`;
    info.appendChild(count);

    card.appendChild(info);
    container.appendChild(card);
  });
}

// ─── Album Navigation ─────────────────────────────────────────
function openAlbum(album) {
  if (album.isPrivate) {
    showAlbumPasswordModal(album, () => navigateToAlbum(album));
  } else {
    navigateToAlbum(album);
  }
}

function navigateToAlbum(album) {
  state.currentAlbumId = album.id;
  state.currentFilter = null;
  showView('albumDetail');

  const header = $('#albumDetailHeader');
  header.innerHTML = `
    <h2>${escapeHTML(album.name)}</h2>
    ${album.description ? `<p class="album-desc">${escapeHTML(album.description)}</p>` : ''}
    <div class="album-detail-actions">
      <button class="btn-small" id="btnEditAlbum">编辑相册</button>
      <button class="btn-small btn-danger" id="btnDeleteAlbum">删除相册</button>
    </div>
  `;

  $('#btnEditAlbum').addEventListener('click', () => showAlbumModal(album));
  $('#btnDeleteAlbum').addEventListener('click', () => {
    if (confirm('确认删除相册「' + album.name + '」？照片不会被删除。')) {
      dbDelete('albums', album.id).then(() => {
        loadAlbums().then(() => {
          state.currentAlbumId = null;
          showView('albums');
          renderAlbums();
          toast('相册已删除', 'success');
        });
      });
    }
  });

  const photos = getFilteredPhotos();
  renderMasonry(photos, '#albumMasonryGrid');
}

function showAlbumPasswordModal(album, onSuccess) {
  const modal = $('#passwordModal');
  const input = $('#albumPasswordInput');
  input.value = '';
  modal.classList.add('open');

  const cleanup = () => {
    modal.classList.remove('open');
    $('#btnPasswordSubmit').removeEventListener('click', handler);
    $('#btnPasswordCancel').removeEventListener('click', cancelHandler);
    $('#passwordModalClose').removeEventListener('click', cancelHandler);
  };

  const cancelHandler = () => cleanup();

  const handler = () => {
    if (input.value === album.password) {
      cleanup();
      onSuccess();
    } else {
      toast('密码错误', 'error');
    }
  };

  $('#btnPasswordSubmit').addEventListener('click', handler);
  $('#btnPasswordCancel').addEventListener('click', cancelHandler);
  $('#passwordModalClose').addEventListener('click', cancelHandler);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
  input.focus();
}

function showAlbumModal(existingAlbum = null) {
  const modal = $('#albumModal');
  const body = $('#albumModalBody');
  const title = $('#albumModalTitle');
  title.textContent = existingAlbum ? '编辑相册' : '新建相册';

  body.innerHTML = `
    <div class="form-group">
      <label>相册名称</label>
      <input type="text" id="albumNameInput" value="${escapeHTML(existingAlbum?.name || '')}" placeholder="相册名称">
    </div>
    <div class="form-group">
      <label>描述</label>
      <textarea id="albumDescInput" placeholder="可选描述">${escapeHTML(existingAlbum?.description || '')}</textarea>
    </div>
    <div class="form-check">
      <input type="checkbox" id="albumPrivateCheck" ${existingAlbum?.isPrivate ? 'checked' : ''}>
      <label for="albumPrivateCheck">私密相册（需要密码）</label>
    </div>
    <div class="form-group" id="albumPasswordGroup" style="display:${existingAlbum?.isPrivate ? 'block' : 'none'}">
      <label>相册密码</label>
      <input type="text" id="albumPasswordInput2" value="${escapeHTML(existingAlbum?.password || '')}" placeholder="设置访问密码">
    </div>
    ${existingAlbum ? `
      <div class="form-group">
        <label>封面照片</label>
        <select id="albumCoverSelect">
          <option value="">无封面</option>
          ${state.photos.filter(p => p.albumId === existingAlbum.id).map(p =>
            `<option value="${p.id}" ${existingAlbum.coverPhotoId === p.id ? 'selected' : ''}>${escapeHTML(p.title || '无标题')}</option>`
          ).join('')}
        </select>
      </div>
    ` : ''}
    <div class="modal-actions">
      <button class="btn-outline" id="btnAlbumCancel">取消</button>
      <button class="btn-primary" id="btnAlbumSave">${existingAlbum ? '保存' : '创建'}</button>
    </div>
  `;

  modal.classList.add('open');

  $('#albumPrivateCheck').addEventListener('change', function() {
    $('#albumPasswordGroup').style.display = this.checked ? 'block' : 'none';
  });

  const cleanup = () => {
    modal.classList.remove('open');
    $('#btnAlbumSave').removeEventListener('click', handler);
    $('#btnAlbumCancel').removeEventListener('click', cancelHandler);
    $('#albumModalClose').removeEventListener('click', cancelHandler);
  };

  const cancelHandler = () => cleanup();

  const handler = async () => {
    const name = $('#albumNameInput').value.trim();
    if (!name) { toast('请输入相册名称', 'error'); return; }

    const albumData = {
      id: existingAlbum ? existingAlbum.id : uuid(),
      name,
      description: $('#albumDescInput').value.trim(),
      isPrivate: $('#albumPrivateCheck').checked,
      password: $('#albumPrivateCheck').checked ? ($('#albumPasswordInput2').value || '') : '',
      coverPhotoId: existingAlbum ? ($('#albumCoverSelect')?.value || null) : null,
      dateCreated: existingAlbum ? existingAlbum.dateCreated : new Date().toISOString(),
    };

    await dbPut('albums', albumData);
    await loadAlbums();
    cleanup();
    if (state.currentView === 'albums') renderAlbums();
    toast(existingAlbum ? '相册已更新' : '相册已创建', 'success');
  };

  $('#btnAlbumSave').addEventListener('click', handler);
  $('#btnAlbumCancel').addEventListener('click', cancelHandler);
  $('#albumModalClose').addEventListener('click', cancelHandler);
}

// ─── View Navigation ──────────────────────────────────────────
function showView(viewName) {
  state.currentView = viewName;

  // Clear photo count when not in gallery
  if (viewName !== 'gallery') {
    const countEl = $('#photoCount');
    if (countEl) countEl.textContent = '';
  }

  $$('.view').forEach(v => v.classList.remove('active'));
  const viewMap = {
    gallery: '#galleryView',
    albums: '#albumsView',
    upload: '#uploadView',
    search: '#searchView',
    albumDetail: '#albumDetailView',
  };
  const el = $(viewMap[viewName]);
  if (el) el.classList.add('active');

  // Clear search state when leaving search view
  if (viewName !== 'search') {
    state.searchQuery = '';
    state.searchType = 'all';
    state.searchDateFrom = '';
    state.searchDateTo = '';
  }

  // Reset album filter when going to main gallery
  if (viewName === 'gallery') {
    state.currentAlbumId = null;
  }

  // Update nav pills
  $$('.nav-pill').forEach(p => p.classList.remove('active'));
  if (viewName === 'gallery') {
    const activePill = $(`.nav-pill[data-filter="${state.currentFilter}"]`);
    if (activePill) activePill.classList.add('active');
  } else if (viewName === 'albums') {
    $('.nav-pill[data-view="albums"]')?.classList.add('active');
  }

  renderCurrentView();
  updateActiveFilters();
}

function renderCurrentView() {
  switch (state.currentView) {
    case 'gallery':
      renderMasonry(getFilteredPhotos(), '#masonryGrid');
      renderFilterChips();
      break;
    case 'albums':
      renderAlbums();
      break;
    case 'albumDetail':
      if (state.currentAlbumId) {
        renderMasonry(getFilteredPhotos(), '#albumMasonryGrid');
      }
      break;
    case 'search':
      renderSearchResults();
      break;
    case 'upload':
      // Handled by upload flow
      break;
  }
  updateEmptyState();
}

// ─── Filter Chips ─────────────────────────────────────────────
function renderFilterChips() {
  const container = $('#filterChips');
  if (!container) return;

  // Collect all unique tags
  const allTags = new Set();
  state.photos.forEach(p => {
    if (p.tags) p.tags.forEach(t => allTags.add(t));
  });

  container.innerHTML = '<button class="chip active" data-tag="">全部</button>';
  [...allTags].sort().forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.tag = tag;
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      state.tagFilter = state.tagFilter === tag ? '' : tag;
      container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      if (state.tagFilter) chip.classList.add('active');
      else container.querySelector('.chip[data-tag=""]').classList.add('active');
      renderMasonry(getFilteredPhotos(), '#masonryGrid');
      updateActiveFilters();
    });
    container.appendChild(chip);
  });
}

function updateActiveFilters() {
  const container = $('#activeFilters');
  if (!container) return;
  const filters = [];

  if (state.currentFilter === 'featured') filters.push({ label: '精选', clear: () => { state.currentFilter = 'all'; } });
  if (state.currentFilter === 'recent') filters.push({ label: '最近 7 天', clear: () => { state.currentFilter = 'all'; } });
  if (state.tagFilter) filters.push({ label: `标签: ${state.tagFilter}`, clear: () => {
    state.tagFilter = '';
    renderFilterChips();
    renderCurrentView();
  }});

  container.innerHTML = filters.map(f =>
    `<span class="filter-badge">${f.label}<button>&times;</button></span>`
  ).join('');

  // Wire up clear buttons
  container.querySelectorAll('.filter-badge button').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      filters[i].clear();
      showView('gallery');
      renderCurrentView();
      updateActiveFilters();
      $$('.nav-pill').forEach(p => p.classList.remove('active'));
      $('.nav-pill[data-filter="all"]')?.classList.add('active');
    });
  });
}

// ─── Search ───────────────────────────────────────────────────
function showSearch() {
  showView('search');
  $('#searchInput').focus();
}

function renderSearchResults() {
  const photos = getFilteredPhotos();
  renderMasonry(photos, '#searchResults');
  $('#searchEmpty').style.display = photos.length === 0 && (state.searchQuery || state.searchDateFrom || state.searchDateTo) ? 'block' : 'none';
}

let searchDebounce = null;
function handleSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.searchQuery = $('#searchInput').value.trim();
    renderSearchResults();
  }, 300);
}

// ─── Lightbox ─────────────────────────────────────────────────
function openLightbox(photo) {
  const photos = getFilteredPhotos();
  state.lightboxPhotos = photos;
  state.currentLightboxIndex = photos.findIndex(p => p.id === photo.id);
  if (state.currentLightboxIndex === -1) state.currentLightboxIndex = 0;

  renderLightbox();
  $('#lightboxOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  $('#lightboxOverlay').classList.remove('open');
  document.body.style.overflow = '';
  state.currentLightboxIndex = -1;
}

function navigateLightbox(direction) {
  const photos = state.lightboxPhotos;
  if (photos.length === 0) return;
  state.currentLightboxIndex = (state.currentLightboxIndex + direction + photos.length) % photos.length;
  renderLightbox();
}

function renderLightbox() {
  const photos = state.lightboxPhotos;
  const photo = photos[state.currentLightboxIndex];
  if (!photo) return;

  const img = $('#lightboxImage');
  const placeholder = $('#lightboxPlaceholder');

  placeholder.style.display = 'block';
  img.style.display = 'none';

  const imageUrl = photo.imageData ? URL.createObjectURL(photo.imageData) : '';
  img.src = imageUrl;

  img.onload = () => {
    placeholder.style.display = 'none';
    img.style.display = 'block';
  };
  img.onerror = () => {
    placeholder.textContent = '无法加载图片';
    placeholder.style.display = 'block';
    img.style.display = 'none';
  };

  $('#lightboxTitle').textContent = photo.title || '无标题';
  $('#lightboxDate').textContent = formatDate(photo.dateTaken || photo.dateUploaded);
  $('#lightboxLocation').textContent = photo.location || '';
  $('#lightboxLocation').style.display = photo.location ? 'inline' : 'none';
  $('#lightboxDesc').textContent = photo.description || '';
  $('#lightboxDesc').style.display = photo.description ? 'block' : 'none';

  const tagsContainer = $('#lightboxTags');
  tagsContainer.innerHTML = '';
  if (photo.tags && photo.tags.length > 0) {
    photo.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'lightbox-tag';
      tagEl.textContent = tag;
      tagsContainer.appendChild(tagEl);
    });
  }

  $('#lightboxCounter').textContent = `${state.currentLightboxIndex + 1} / ${photos.length}`;

  // Make tags clickable
  tagsContainer.querySelectorAll('.lightbox-tag').forEach(tagEl => {
    tagEl.style.cursor = 'pointer';
    tagEl.addEventListener('click', () => {
      closeLightbox();
      state.tagFilter = tagEl.textContent;
      state.currentFilter = 'all';
      showView('gallery');
      renderFilterChips();
      renderCurrentView();
      updateActiveFilters();
    });
  });

  // Actions
  $('#lightboxToggleFeatured').textContent = photo.isFeatured ? '★ 精选' : '☆ 精选';
  $('#lightboxTogglePublic').textContent = photo.isPublic ? '🌐 公开' : '🔒 私密';

  // Clear old listeners
  const newEdit = $('#lightboxEdit').cloneNode(true);
  const newDelete = $('#lightboxDelete').cloneNode(true);
  const newFeatured = $('#lightboxToggleFeatured').cloneNode(true);
  const newPublic = $('#lightboxTogglePublic').cloneNode(true);

  $('#lightboxEdit').replaceWith(newEdit);
  $('#lightboxDelete').replaceWith(newDelete);
  $('#lightboxToggleFeatured').replaceWith(newFeatured);
  $('#lightboxTogglePublic').replaceWith(newPublic);

  newEdit.addEventListener('click', (e) => { e.stopPropagation(); showEditPhotoModal(photo); });
  newDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('确认删除这张照片？此操作不可撤销。')) {
      deletePhoto(photo.id).then(() => {
        state.lightboxPhotos = getFilteredPhotos();
        if (state.lightboxPhotos.length === 0) {
          closeLightbox();
        } else {
          state.currentLightboxIndex = Math.min(state.currentLightboxIndex, state.lightboxPhotos.length - 1);
          renderLightbox();
        }
        renderCurrentView();
        toast('照片已删除');
      });
    }
  });
  newFeatured.addEventListener('click', (e) => {
    e.stopPropagation();
    const updated = { ...photo, isFeatured: !photo.isFeatured };
    savePhoto(updated).then(() => {
      state.lightboxPhotos = getFilteredPhotos();
      renderLightbox();
      renderCurrentView();
    });
  });
  newPublic.addEventListener('click', (e) => {
    e.stopPropagation();
    const updated = { ...photo, isPublic: !photo.isPublic };
    savePhoto(updated).then(() => {
      state.lightboxPhotos = getFilteredPhotos();
      renderLightbox();
      renderCurrentView();
    });
  });
}

// ─── Edit Photo Modal ─────────────────────────────────────────
function showEditPhotoModal(photo) {
  const modal = $('#editModal');
  const body = $('#editModalBody');

  body.innerHTML = `
    <div class="form-group">
      <label>标题</label>
      <input type="text" id="editTitle" value="${escapeHTML(photo.title || '')}" placeholder="照片标题">
    </div>
    <div class="form-group">
      <label>描述</label>
      <textarea id="editDesc" placeholder="描述">${escapeHTML(photo.description || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>拍摄日期</label>
        <input type="date" id="editDate" value="${photo.dateTaken ? photo.dateTaken.substring(0,10) : ''}">
      </div>
      <div class="form-group">
        <label>地点</label>
        <input type="text" id="editLocation" value="${escapeHTML(photo.location || '')}" placeholder="拍摄地点">
      </div>
    </div>
    <div class="form-group">
      <label>标签（逗号分隔）</label>
      <input type="text" id="editTags" value="${(photo.tags || []).join(', ')}" placeholder="例如: 旅行, 风景, 人像">
    </div>
    <div class="form-group">
      <label>所属相册</label>
      <select id="editAlbum">
        <option value="">无相册</option>
        ${state.albums.map(a => `<option value="${a.id}" ${photo.albumId === a.id ? 'selected' : ''}>${escapeHTML(a.name)}${a.isPrivate ? ' 🔒' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-check">
      <input type="checkbox" id="editFeatured" ${photo.isFeatured ? 'checked' : ''}>
      <label for="editFeatured">设为精选</label>
    </div>
    <div class="form-check">
      <input type="checkbox" id="editPublic" ${photo.isPublic ? 'checked' : ''}>
      <label for="editPublic">公开展示</label>
    </div>
    <div class="modal-actions">
      <button class="btn-outline" id="btnEditCancel">取消</button>
      <button class="btn-primary" id="btnEditSave">保存</button>
    </div>
  `;

  modal.classList.add('open');

  const cleanup = () => {
    modal.classList.remove('open');
  };

  $('#btnEditCancel').addEventListener('click', cleanup);
  $('#editModalClose').addEventListener('click', cleanup);

  $('#btnEditSave').addEventListener('click', async () => {
    const updated = {
      ...photo,
      title: $('#editTitle').value.trim(),
      description: $('#editDesc').value.trim(),
      dateTaken: $('#editDate').value ? $('#editDate').value + 'T00:00:00.000Z' : photo.dateTaken,
      location: $('#editLocation').value.trim(),
      tags: $('#editTags').value.split(',').map(t => t.trim()).filter(Boolean),
      albumId: $('#editAlbum').value || null,
      isFeatured: $('#editFeatured').checked,
      isPublic: $('#editPublic').checked,
    };
    await savePhoto(updated);
    state.lightboxPhotos = getFilteredPhotos();
    renderLightbox();
    renderCurrentView();
    cleanup();
    toast('照片信息已更新', 'success');
  });
}

// ─── Upload System ────────────────────────────────────────────
function showUpload() {
  requireAuth(() => {
    state.uploadFiles = [];
    renderUploadPreviews();
    showView('upload');
  });
}

function initDropZone() {
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFilesSelected(fileInput.files));

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFilesSelected(e.dataTransfer.files);
  });

  // Global paste support
  document.addEventListener('paste', (e) => {
    if (state.currentView !== 'upload') return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        files.push(item.getAsFile());
      }
    }
    if (files.length > 0) {
      handleFilesArray(files);
    }
  });
}

function handleFilesSelected(fileList) {
  handleFilesArray(Array.from(fileList));
}

function handleFilesArray(files) {
  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    toast('请选择图片文件', 'error');
    return;
  }

  imageFiles.forEach(file => {
    const previewUrl = URL.createObjectURL(file);
    state.uploadFiles.push({
      file,
      previewUrl,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      description: '',
      date: '',
      location: '',
      tags: '',
      albumId: '',
      isPublic: true,
      isFeatured: false,
    });
  });

  renderUploadPreviews();
}

function renderUploadPreviews() {
  const container = $('#uploadPreviews');
  const actions = $('#uploadActions');

  container.innerHTML = '';
  actions.style.display = state.uploadFiles.length > 0 ? 'flex' : 'none';

  state.uploadFiles.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'upload-preview-card';

    const img = document.createElement('img');
    img.src = item.previewUrl;
    img.alt = item.title;
    card.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'upload-preview-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      URL.revokeObjectURL(item.previewUrl);
      state.uploadFiles.splice(index, 1);
      renderUploadPreviews();
    });
    card.appendChild(removeBtn);

    const info = document.createElement('div');
    info.className = 'upload-preview-info';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = item.title;
    titleInput.placeholder = '标题';
    titleInput.addEventListener('input', () => { item.title = titleInput.value; });
    info.appendChild(titleInput);

    const descInput = document.createElement('textarea');
    descInput.value = item.description;
    descInput.placeholder = '描述（可选）';
    descInput.addEventListener('input', () => { item.description = descInput.value; });
    info.appendChild(descInput);

    const rowInputs = document.createElement('div');
    rowInputs.style.cssText = 'display:flex;gap:4px;margin-bottom:2px;';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = item.date;
    dateInput.style.cssText = 'flex:1;';
    dateInput.addEventListener('input', () => { item.date = dateInput.value; });
    rowInputs.appendChild(dateInput);

    const locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.value = item.location;
    locInput.placeholder = '地点';
    locInput.style.cssText = 'flex:1;';
    locInput.addEventListener('input', () => { item.location = locInput.value; });
    rowInputs.appendChild(locInput);

    info.appendChild(rowInputs);

    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.value = item.tags;
    tagsInput.placeholder = '标签（逗号分隔）';
    tagsInput.addEventListener('input', () => { item.tags = tagsInput.value; });
    info.appendChild(tagsInput);

    const albumSelect = document.createElement('select');
    albumSelect.style.cssText = 'width:100%;padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;font-size:var(--text-xs);background:var(--color-bg);margin-bottom:2px;';
    albumSelect.innerHTML = '<option value="">无相册</option>' +
      state.albums.map(a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');
    albumSelect.value = item.albumId;
    albumSelect.addEventListener('change', () => { item.albumId = albumSelect.value; });
    info.appendChild(albumSelect);

    card.appendChild(info);
    container.appendChild(card);
  });
}

async function saveUploads() {
  if (state.uploadFiles.length === 0) return;

  const btn = $('#btnSaveUploads');
  const total = state.uploadFiles.length;
  btn.disabled = true;
  btn.textContent = '保存中...';
  toast(`正在保存 ${total} 张照片...`);

  let saved = 0;
  for (const item of state.uploadFiles) {
    try {
      const thumb = await createThumbnail(item.file, 400);

      let width = thumb?.width || 0;
      let height = thumb?.height || 0;

      if (!width || !height) {
        const dims = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve({ width: 0, height: 0 });
          img.src = item.previewUrl;
        });
        width = dims.width;
        height = dims.height;
      }

      const photoData = {
        id: uuid(),
        title: item.title || item.file.name.replace(/\.[^.]+$/, ''),
        description: item.description,
        dateTaken: item.date ? item.date + 'T00:00:00.000Z' : new Date().toISOString(),
        dateUploaded: new Date().toISOString(),
        location: item.location,
        tags: item.tags.split(',').map(t => t.trim()).filter(Boolean),
        albumId: item.albumId || null,
        isFeatured: item.isFeatured,
        isPublic: item.isPublic,
        imageData: item.file,
        thumbnailData: thumb?.blob || null,
        width: width || 0,
        height: height || 0,
      };

      await dbPut('photos', photoData);
      saved++;
    } catch (err) {
      console.error('Failed to save:', item.file.name, err);
    }
  }

  // Clean up preview URLs
  state.uploadFiles.forEach(item => URL.revokeObjectURL(item.previewUrl));
  state.uploadFiles = [];
  renderUploadPreviews();

  await loadPhotos();
  btn.disabled = false;
  btn.textContent = '保存全部';
  showView('gallery');
  toast(`成功上传 ${saved} 张照片`, 'success');
}

// ─── Event Handlers ───────────────────────────────────────────

// Navigation
function initNavigation() {
  // Nav pills
  $$('.nav-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const view = pill.dataset.view;
      const filter = pill.dataset.filter;
      if (filter) {
        state.currentFilter = filter;
        state.currentAlbumId = null;
        state.tagFilter = '';
        showView('gallery');
      } else {
        showView(view);
      }
    });
  });

  // Brand
  $('#navBrand').addEventListener('click', () => {
    state.currentFilter = 'all';
    state.currentAlbumId = null;
    state.tagFilter = '';
    showView('gallery');
  });

  // Upload button
  $('#btnUpload').addEventListener('click', showUpload);

  // Theme toggle
  $('#btnTheme').addEventListener('click', toggleTheme);

  // Search button
  $('#btnSearch').addEventListener('click', showSearch);

  // Hamburger
  $('#btnHamburger').addEventListener('click', () => {
    const menu = $('#mobileMenu');
    const isOpen = menu.classList.toggle('open');
    // Sync sort state to mobile sort
    if (isOpen) {
      $('#mobSort').value = `${state.sortBy}-${state.sortOrder}`;
    }
  });

  // Close mobile menu on outside click
  document.addEventListener('click', (e) => {
    const menu = $('#mobileMenu');
    if (!menu.classList.contains('open')) return;
    if (!menu.contains(e.target) && e.target !== $('#btnHamburger') && !$('#btnHamburger').contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  // Mobile menu items
  $('#mobileMenu').querySelectorAll('button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      $('#mobileMenu').classList.remove('open');
      const filter = btn.dataset.filter;
      if (filter) {
        state.currentFilter = filter;
        state.currentAlbumId = null;
        state.tagFilter = '';
        showView('gallery');
      } else {
        showView(btn.dataset.view);
      }
    });
  });

  $('#mobSearch').addEventListener('click', () => {
    $('#mobileMenu').classList.remove('open');
    showSearch();
  });

  $('#mobUpload').addEventListener('click', () => {
    $('#mobileMenu').classList.remove('open');
    showUpload();
  });

  $('#mobSort').addEventListener('change', function() {
    const [sortBy, order] = this.value.split('-');
    state.sortBy = sortBy;
    state.sortOrder = order;
    $('#sortLabel').textContent = this.selectedOptions[0].textContent;
    renderCurrentView();
  });

  // Sort dropdown
  $('#btnSort').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#sortMenu').classList.toggle('open');
  });

  document.addEventListener('click', () => {
    $('#sortMenu').classList.remove('open');
  });

  $('#sortMenu').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.sortBy = btn.dataset.sort;
      state.sortOrder = btn.dataset.order;
      $('#sortLabel').textContent = btn.textContent.trim();
      $('#sortMenu').classList.remove('open');
      renderCurrentView();
    });
  });

  // Back buttons
  $('#btnUploadBack').addEventListener('click', () => showView('gallery'));
  $('#btnAlbumBack').addEventListener('click', () => {
    state.currentAlbumId = null;
    showView('albums');
    renderAlbums();
  });
  $('#btnSearchBack').addEventListener('click', () => {
    state.searchQuery = '';
    state.searchDateFrom = '';
    state.searchDateTo = '';
    showView('gallery');
  });

  // Create album
  $('#btnCreateAlbum').addEventListener('click', () => showAlbumModal());

  // Empty state upload
  $('#emptyUploadBtn').addEventListener('click', showUpload);
}

// Lightbox events
function initLightbox() {
  $('#lightboxClose').addEventListener('click', closeLightbox);
  $('.lightbox-backdrop').addEventListener('click', closeLightbox);
  $('#lightboxPrev').addEventListener('click', () => navigateLightbox(-1));
  $('#lightboxNext').addEventListener('click', () => navigateLightbox(1));

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (state.currentLightboxIndex === -1) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  });

  // Touch swipe
  let touchStartX = 0;
  $('#lightboxOverlay').addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  });
  $('#lightboxOverlay').addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 80) {
      navigateLightbox(diff > 0 ? 1 : -1);
    }
  });
}

// Upload save
function initUploadActions() {
  $('#btnSaveUploads').addEventListener('click', () => saveUploads());
  $('#btnClearUploads').addEventListener('click', () => {
    state.uploadFiles.forEach(item => URL.revokeObjectURL(item.previewUrl));
    state.uploadFiles = [];
    renderUploadPreviews();
  });
}

// Search input
function initSearch() {
  $('#searchInput').addEventListener('input', handleSearchInput);
  $('#searchType').addEventListener('change', function() {
    state.searchType = this.value;
    renderSearchResults();
  });
  $('#searchDateFrom').addEventListener('change', function() {
    state.searchDateFrom = this.value;
    renderSearchResults();
  });
  $('#searchDateTo').addEventListener('change', function() {
    state.searchDateTo = this.value;
    renderSearchResults();
  });
}

// ─── Demo Data ────────────────────────────────────────────────
async function loadDemoDataIfEmpty() {
  const photos = await dbGetAll('photos');
  if (photos.length > 0) return;

  // Generate sample photos using SVG placeholders
  const demos = [
    { title: '晨光中的山脊', desc: '清晨第一缕阳光照亮山脊线', dateTaken: '2026-03-15T06:30:00.000Z', location: '黄山', tags: ['风景', '山', '日出'], isFeatured: true, w: 600, h: 400, color: '8B9DAF' },
    { title: '城市剪影', desc: '落日余晖下的城市天际线', dateTaken: '2026-02-20T18:00:00.000Z', location: '上海', tags: ['城市', '日落', '建筑'], isFeatured: true, w: 400, h: 600, color: 'C8963E' },
    { title: '老街巷弄', desc: '午后的老城区巷弄', dateTaken: '2026-01-10T14:00:00.000Z', location: '北京', tags: ['街道', '人文', '胡同'], isFeatured: false, w: 400, h: 500, color: 'A09080' },
    { title: '海边落日', desc: '金色的海面与归来的渔船', dateTaken: '2026-03-01T17:45:00.000Z', location: '厦门', tags: ['海', '日落', '渔船'], isFeatured: true, w: 600, h: 380, color: 'D4A574' },
    { title: '樱花季', desc: '公园里盛开的樱花', dateTaken: '2026-04-05T10:00:00.000Z', location: '武汉', tags: ['花', '春天', '自然'], isFeatured: false, w: 500, h: 650, color: 'E8C8D0' },
    { title: '雪后寺庙', desc: '大雪覆盖的古寺', dateTaken: '2025-12-20T09:00:00.000Z', location: '京都', tags: ['雪', '建筑', '寺庙'], isFeatured: true, w: 500, h: 400, color: 'C8D8E8' },
    { title: '夜市烟火', desc: '夜市里的烟火气息', dateTaken: '2026-05-10T20:30:00.000Z', location: '成都', tags: ['城市', '夜景', '美食'], isFeatured: false, w: 550, h: 400, color: '403020' },
    { title: '竹林深处', desc: '阳光透过竹叶洒下斑驳光影', dateTaken: '2026-03-25T11:00:00.000Z', location: '杭州', tags: ['自然', '竹子', '光影'], isFeatured: false, w: 400, h: 700, color: '5A7A4A' },
    { title: '草原牧歌', desc: '辽阔草原上的牧羊人', dateTaken: '2026-06-01T15:00:00.000Z', location: '呼伦贝尔', tags: ['草原', '旅行', '人文'], isFeatured: true, w: 700, h: 350, color: '8AAA70' },
    { title: '星空下的帐篷', desc: '银河下的一顶帐篷', dateTaken: '2026-06-15T02:00:00.000Z', location: '青海', tags: ['星空', '露营', '夜景'], isFeatured: false, w: 550, h: 450, color: '1A2A4A' },
    { title: '雨后的花', desc: '雨滴挂在花瓣上', dateTaken: '2026-04-20T08:00:00.000Z', location: '苏州', tags: ['花', '微距', '雨'], isFeatured: false, w: 350, h: 500, color: 'E07080' },
    { title: '老茶馆', desc: '老茶馆里的一盏清茶', dateTaken: '2026-02-08T16:00:00.000Z', location: '重庆', tags: ['人文', '茶', '室内'], isFeatured: false, w: 450, h: 450, color: '6B5040' },
  ];

  for (const demo of demos) {
    // Generate placeholder image using canvas
    const canvas = document.createElement('canvas');
    canvas.width = demo.w;
    canvas.height = demo.h;
    const ctx = canvas.getContext('2d');

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, demo.w, demo.h);
    gradient.addColorStop(0, `#${demo.color}`);
    gradient.addColorStop(1, `#${demo.color}88`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, demo.w, demo.h);

    // Add simple geometric elements for visual interest
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 5; i++) {
      const rx = Math.random() * demo.w;
      const ry = Math.random() * demo.h;
      const rr = Math.min(demo.w, demo.h) * (0.1 + Math.random() * 0.3);
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add subtle grid pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSize = Math.min(demo.w, demo.h) / 6;
    for (let x = gridSize; x < demo.w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, demo.h);
      ctx.stroke();
    }
    for (let y = gridSize; y < demo.h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(demo.w, y);
      ctx.stroke();
    }

    const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));

    // Thumbnail
    const thumbCanvas = document.createElement('canvas');
    const maxThumb = 300;
    let tw = demo.w, th = demo.h;
    if (tw > th) {
      if (tw > maxThumb) { th *= maxThumb / tw; tw = maxThumb; }
    } else {
      if (th > maxThumb) { tw *= maxThumb / th; th = maxThumb; }
    }
    thumbCanvas.width = Math.round(tw);
    thumbCanvas.height = Math.round(th);
    const tctx = thumbCanvas.getContext('2d');
    const tempImg = new Image();
    const tempUrl = URL.createObjectURL(imageBlob);
    await new Promise((resolve) => {
      tempImg.onload = () => {
        tctx.drawImage(tempImg, 0, 0, tw, th);
        URL.revokeObjectURL(tempUrl);
        resolve();
      };
      tempImg.src = tempUrl;
    });
    const thumbBlob = await new Promise(resolve => thumbCanvas.toBlob(resolve, 'image/jpeg', 0.6));

    const photo = {
      id: uuid(),
      title: demo.title,
      description: demo.desc,
      dateTaken: demo.dateTaken,
      dateUploaded: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
      location: demo.location,
      tags: demo.tags,
      albumId: null,
      isFeatured: demo.isFeatured,
      isPublic: true,
      imageData: imageBlob,
      thumbnailData: thumbBlob,
      width: demo.w,
      height: demo.h,
    };

    await dbPut('photos', photo);
  }

  // Create a demo album
  const albumId = uuid();
  const allPhotos = await dbGetAll('photos');
  const featuredPhotos = allPhotos.filter(p => p.isFeatured);
  for (const p of featuredPhotos) {
    p.albumId = albumId;
    await dbPut('photos', p);
  }

  await dbPut('albums', {
    id: albumId,
    name: '精选集',
    description: '最满意的作品合集',
    coverPhotoId: featuredPhotos[0]?.id || null,
    isPrivate: false,
    password: '',
    dateCreated: new Date().toISOString(),
  });
}

// ─── Global Keyboard Shortcuts ────────────────────────────────
function initGlobalKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't handle if user is typing in an input
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;

    // Esc: close lightbox, modals, mobile menu
    if (e.key === 'Escape') {
      if (state.currentLightboxIndex !== -1) {
        closeLightbox();
        return;
      }
      if ($('#editModal').classList.contains('open')) {
        $('#editModal').classList.remove('open');
        return;
      }
      if ($('#albumModal').classList.contains('open')) {
        $('#albumModal').classList.remove('open');
        return;
      }
      if ($('#passwordModal').classList.contains('open')) {
        $('#passwordModal').classList.remove('open');
        return;
      }
      if ($('#loginModal').classList.contains('open')) {
        $('#loginModal').classList.remove('open');
        return;
      }
      if ($('#mobileMenu').classList.contains('open')) {
        $('#mobileMenu').classList.remove('open');
        return;
      }
      // Clear tag filter on Escape in gallery
      if (state.tagFilter && state.currentView === 'gallery') {
        state.tagFilter = '';
        showView('gallery');
        renderCurrentView();
        updateActiveFilters();
      }
    }

    // Ctrl+K or / for search
    if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !isInput)) {
      e.preventDefault();
      showSearch();
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────
async function init() {
  try {
    // Check IndexedDB availability
    if (!window.indexedDB) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center;padding:2rem;"><div><h1 style="font-size:1.5rem;margin-bottom:0.5rem;">浏览器不支持 IndexedDB</h1><p style="color:#666;">请使用现代浏览器打开此应用（Chrome、Firefox、Safari、Edge）。<br>隐私模式可能导致 IndexedDB 不可用。</p></div></div>';
      return;
    }

    // Check auth
    await checkAuth();

    // Load demo data if empty
    await loadDemoDataIfEmpty();

    // Load data
    await loadPhotos();
    await loadAlbums();

    // Load saved theme preference
    const savedTheme = await dbGetSetting('theme', 'light');
    if (savedTheme === 'dark') setTheme('dark');

    // Init UI components
    initNavigation();
    initLightbox();
    initDropZone();
    initUploadActions();
    initSearch();
    initGlobalKeyboard();

    // Register service worker for offline support
    if ('serviceWorker' in navigator) {
      // Service worker for basic offline caching
    }

    // Set initial sort label
    $('#sortLabel').textContent = '拍摄时间 ↓';
    $('#mobSort').value = 'dateTaken-desc';

    // Dismiss splash — event-driven, no hard cut
    const splash = $('#splash');
    const brand = $('#splashBrand');
    const welcome = $('#splashWelcome');

    if (splash && welcome) {
      // Wait for the *last* animation to finish (welcome ends at 1.35s)
      welcome.addEventListener('animationend', function onAnimEnd(e) {
        if (e.target !== welcome) return; // ignore bubbled events
        welcome.removeEventListener('animationend', onAnimEnd);

        // Snap to static final state — filter:none drops GPU compositing
        brand.classList.add('done');
        welcome.classList.add('done');

        // Brief hold, then fade out
        setTimeout(() => {
          splash.classList.add('fade-out');

          // Hide only after opacity transition fully completes
          splash.addEventListener('transitionend', function onTransEnd(e2) {
            if (e2.propertyName !== 'opacity') return;
            splash.removeEventListener('transitionend', onTransEnd);
            splash.classList.add('hidden');
          });
        }, 500);
      });
    }

    // Initial render
    renderCurrentView();
    updateActiveFilters();

    console.log('暗房 · Film Archive ready — ' + state.photos.length + ' photos loaded');
  } catch (err) {
    console.error('Initialization failed:', err);
    toast('初始化失败，请刷新页面重试', 'error');
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
