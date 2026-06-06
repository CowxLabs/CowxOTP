"use strict";

document.getElementById('version').textContent = APP.version;

const {
  BrowserQRCodeReader,
} = require('@zxing/library');

const TOTP = require('./totp');
const Cookies = require('./cookies');
const OTPAuthUrl = require('./otpauthUrl');
const Storage = require('./storage');

const QRCodeReader = new BrowserQRCodeReader();

/* ========== STATE ========== */

let accounts = [];
let totpInstances = {};
let isDarkMode = false;
let editingId = null;
let nextRenderTimeout = null;

/* ========== HELPERS ========== */

function copyToClipboard(text) {
  const input = document.createElement('input');
  input.setAttribute('value', text);
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.remove('show'), 2000);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatToken(token, type) {
  if (type === 'steam') return token;
  const half = Math.ceil(token.length / 2);
  return token.slice(0, half) + '<span class="sep"> </span>' + token.slice(half);
}

/* ========== TOTP MANAGEMENT ========== */

function buildTOTPInstance(account) {
  try {
    return new TOTP(account.secret, account.type, account.period);
  } catch {
    return null;
  }
}

function rebuildAllInstances() {
  totpInstances = {};
  accounts.forEach(a => {
    const inst = buildTOTPInstance(a);
    if (inst) totpInstances[a.id] = inst;
  });
}

/* ========== RENDER ========== */

function renderAccounts() {
  const list = document.getElementById('account-list');
  const empty = document.getElementById('empty-state');

  if (accounts.length === 0) {
    list.innerHTML = '';
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  list.style.display = 'flex';
  empty.style.display = 'none';

  let html = '';
  for (const account of accounts) {
    const inst = totpInstances[account.id];
    let token = '......';
    let remaining = 0;
    let stepSeconds = 30;
    let valid = true;

    if (inst) {
      try {
        token = inst.getToken();
        remaining = inst.getRemainingSeconds();
        stepSeconds = inst.getStepSeconds();
      } catch {
        valid = false;
        token = 'INVALID';
      }
    }

    const circ = 2 * Math.PI * 10;
    const offset = valid ? circ * (1 - remaining / stepSeconds) : 0;
    const isWarning = valid && remaining <= 10;
    const isCritical = valid && remaining <= 5;
    const ringClass = isCritical ? 'critical' : isWarning ? 'warning' : '';

    const typeLabel = account.type === 'steam' ? 'Steam' : 'TOTP';

    html += `
      <div class="account-card" data-id="${account.id}">
        <div class="account-card-header">
          <div class="account-info">
            <div class="account-issuer">${escHtml(account.issuer || account.account || 'Unknown')}</div>
            <div class="account-name">${escHtml(account.account && account.issuer ? account.account : '')}</div>
          </div>
          <span class="account-type-badge${account.type === 'steam' ? ' steam' : ''}">${typeLabel}</span>
          <button class="account-delete" data-id="${account.id}" title="Delete">&times;</button>
        </div>
        <div class="account-card-body">
          <div class="account-token">${formatToken(token, account.type)}</div>
          <div class="account-timer">
            <svg class="timer-ring" viewBox="0 0 24 24">
              <circle class="ring-bg" cx="12" cy="12" r="10"/>
              <circle class="ring-fg ${ringClass}" cx="12" cy="12" r="10"
                stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
            </svg>
            <span class="timer-seconds">${valid ? Math.ceil(remaining) : '--'}</span>
          </div>
        </div>
      </div>`;
  }

  list.innerHTML = html;

  // Attach events
  list.querySelectorAll('.account-card').forEach(card => {
    const id = card.dataset.id;

    card.addEventListener('click', e => {
      if (e.target.closest('.account-delete')) return;
      const inst = totpInstances[id];
      if (!inst) return;
      try {
        copyToClipboard(inst.getToken());
        showToast('Token copied!');
      } catch {}
    });

    card.querySelector('.account-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteAccount(id);
    });
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function scheduleRender() {
  if (nextRenderTimeout) return;
  nextRenderTimeout = setTimeout(() => {
    nextRenderTimeout = null;
    renderAccounts();
  }, 50);
}

/* ========== ACCOUNT CRUD ========== */

function loadAccounts() {
  accounts = Storage.getAll();
  rebuildAllInstances();
  renderAccounts();
}

function saveAccount(data) {
  if (editingId) {
    const updated = Storage.update(editingId, data);
    if (updated) {
      const idx = accounts.findIndex(a => a.id === editingId);
      if (idx !== -1) accounts[idx] = updated;
    }
    editingId = null;
  } else {
    const newAccount = Storage.add(data);
    accounts.unshift(newAccount);
  }
  rebuildAllInstances();
  renderAccounts();
}

function deleteAccount(id) {
  if (!Storage.remove(id)) return;
  accounts = accounts.filter(a => a.id !== id);
  delete totpInstances[id];
  renderAccounts();
  showToast('Account deleted');
}

/* ========== TOTP TIMER ========== */

function updateAllTokens() {
  for (const account of accounts) {
    const inst = totpInstances[account.id];
    if (!inst) continue;

    // Update the card's token and timer in-place for performance
    const card = document.querySelector(`.account-card[data-id="${account.id}"]`);
    if (!card) continue;

    try {
      const token = inst.getToken();
      const remaining = inst.getRemainingSeconds();
      const stepSeconds = inst.getStepSeconds();

      const tokenEl = card.querySelector('.account-token');
      tokenEl.innerHTML = formatToken(token, account.type);

      const secondsEl = card.querySelector('.timer-seconds');
      secondsEl.textContent = Math.ceil(remaining);

      const ring = card.querySelector('.timer-ring .ring-fg');
      const circ = 2 * Math.PI * 10;
      ring.style.strokeDashoffset = circ * (1 - remaining / stepSeconds);

      ring.classList.toggle('warning', remaining <= 10 && remaining > 5);
      ring.classList.toggle('critical', remaining <= 5);
    } catch {
      // stale instance, skip
    }
  }
}

/* ========== MODAL ========== */

function openModal(accountData) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');

  if (accountData) {
    editingId = accountData.id;
    title.textContent = 'Edit Account';
    document.getElementById('input-secret').value = accountData.secret || '';
    document.getElementById('input-account').value = accountData.account || '';
    document.getElementById('input-issuer').value = accountData.issuer || '';
    document.getElementById('input-period').value = accountData.period || 30;
    document.getElementById('input-type').value = accountData.type || 'totp';
  } else {
    editingId = null;
    title.textContent = 'Add Account';
    document.getElementById('input-secret').value = '';
    document.getElementById('input-account').value = '';
    document.getElementById('input-issuer').value = '';
    document.getElementById('input-period').value = '30';
    document.getElementById('input-type').value = 'totp';
  }

  updateQrPreview();
  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function getModalData() {
  return {
    secret: document.getElementById('input-secret').value.replace(/\s/g, ''),
    account: document.getElementById('input-account').value.trim(),
    issuer: document.getElementById('input-issuer').value.trim(),
    period: parseInt(document.getElementById('input-period').value) || 30,
    type: document.getElementById('input-type').value,
  };
}

function handleModalSave() {
  const data = getModalData();
  if (!data.secret) {
    showToast('Secret is required');
    return;
  }
  if (data.secret.length < 16 && data.type !== 'steam') {
    showToast('Secret must be at least 16 characters');
    return;
  }
  saveAccount(data);
  closeModal();
  showToast(editingId ? 'Account updated' : 'Account added');
}

/* ========== DARK MODE ========== */

function setDarkMode(enabled) {
  document.getElementById('dark-mode').disabled = !enabled;
  isDarkMode = enabled;
  Cookies.set('cowxotp.darkStyle', String(enabled));
}

/* ========== QR PREVIEW ========== */

function updateQrPreview() {
  const data = getModalData();
  const container = document.getElementById('qr-preview-container');
  const img = document.getElementById('qr-preview');
  const placeholder = document.getElementById('qr-preview-placeholder');

  if (!data.secret || !data.account) {
    img.style.display = 'none';
    placeholder.style.display = 'block';
    container.classList.remove('has-qr');
    return;
  }

  try {
    const qrMessage = OTPAuthUrl.build(
      data.secret.replace(/\s+/g, ''),
      data.account,
      data.issuer,
      data.period
    );

    const { BrowserQRCodeSvgWriter, EncodeHintType } = require('@zxing/library');
    const writer = new BrowserQRCodeSvgWriter();
    const svgEl = writer.write(qrMessage, 0, 0, new Map([
      [EncodeHintType.CHARACTER_SET, "UTF-8"],
      [EncodeHintType.ERROR_CORRECTION, "Q"],
      [EncodeHintType.MARGIN, 2],
    ]));

    const svgXml = new XMLSerializer().serializeToString(svgEl);
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgXml);

    img.src = dataUrl;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    container.classList.add('has-qr');
  } catch {
    img.style.display = 'none';
    placeholder.style.display = 'block';
    container.classList.remove('has-qr');
  }
}

/* ========== SCANNER ========== */

function openScanner() {
  const overlay = document.getElementById('scanner-overlay');
  overlay.classList.add('open');

  QRCodeReader.getVideoInputDevices()
    .then(devices => {
      let deviceId;
      if (devices.length === 0) {
        showToast('No camera available');
        overlay.classList.remove('open');
        return;
      }
      if (devices.length === 1) {
        deviceId = devices[0].deviceId;
      } else {
        const backCamera = devices.find(d =>
          /back|rear|environment/gi.test(d.label)
        );
        deviceId = backCamera ? backCamera.deviceId : undefined;
      }

      QRCodeReader.decodeOnceFromVideoDevice(deviceId, 'scanner-video')
        .then(result => {
          overlay.classList.remove('open');
          if (result.text.startsWith('otpauth://totp/')) {
            handleOtpauthUrl(result.text);
            showToast('QR code scanned!');
          } else {
            showToast('Invalid OTP auth QR code');
          }
        })
        .catch(err => {
          console.error(err);
          overlay.classList.remove('open');
          if (err.message && !err.message.includes('continuous')) {
            showToast('Camera access denied or unavailable');
          }
        });
    })
    .catch(err => {
      console.error(err);
      overlay.classList.remove('open');
      showToast('Camera access denied');
    });
}

document.getElementById('scanner-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    QRCodeReader.reset();
    document.getElementById('scanner-overlay').classList.remove('open');
  }
});

function handleOtpauthUrl(url) {
  const params = OTPAuthUrl.parse(url);
  if (params.secret) {
    document.getElementById('input-secret').value = params.secret;
  }
  if (params.issuer) {
    document.getElementById('input-issuer').value = params.issuer;
  }
  if (params.account) {
    document.getElementById('input-account').value = params.account;
  }
  if (params.period) {
    document.getElementById('input-period').value = params.period;
  }
  updateQrPreview();
}

/* ========== EVENTS ========== */

// FAB
document.getElementById('fab').addEventListener('click', () => openModal());

// Modal close
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// Modal save
document.getElementById('modal-save').addEventListener('click', handleModalSave);

// Enter key in modal
document.querySelectorAll('#modal-sheet .form-input, #modal-sheet .form-select').forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalSave();
  });
});

// Form inputs -> QR preview
document.getElementById('input-secret').addEventListener('input', () => {
  const val = document.getElementById('input-secret').value;
  if (val.startsWith('otpauth://totp/')) {
    handleOtpauthUrl(val);
  }
  updateQrPreview();
});

document.getElementById('input-account').addEventListener('input', updateQrPreview);
document.getElementById('input-issuer').addEventListener('input', updateQrPreview);
document.getElementById('input-period').addEventListener('input', updateQrPreview);

// QR scan: camera
document.getElementById('scan-video').addEventListener('click', openScanner);

// QR scan: image
document.getElementById('scan-image-btn').addEventListener('click', () => {
  document.getElementById('input-image').click();
});

document.getElementById('input-image').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;

  const image = new Image();
  const reader = new FileReader();
  reader.onload = e => image.src = e.target.result;
  reader.readAsDataURL(file);

  image.onload = () => {
    QRCodeReader.decodeFromImage(image)
      .then(result => {
        if (result.text.startsWith('otpauth://totp/')) {
          handleOtpauthUrl(result.text);
          showToast('QR code scanned!');
        } else {
          showToast('Invalid OTP auth QR code');
        }
      })
      .catch(() => showToast('No QR code found in image'));
  };
});

// Dark mode toggle
document.getElementById('dark-toggle').addEventListener('click', () => {
  setDarkMode(!isDarkMode);
});

/* ========== INIT ========== */

function init() {
  // Dark mode
  const cookiePref = Cookies.get('cowxotp.darkStyle');
  if (cookiePref === 'true') {
    setDarkMode(true);
  } else if (cookiePref === undefined && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setDarkMode(true);
  }

  loadAccounts();

  // Update tokens every second
  setInterval(updateAllTokens, 1000);
}

init();
