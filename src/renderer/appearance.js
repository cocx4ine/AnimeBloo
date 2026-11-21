import { gsap } from 'gsap';
import logoSource from '../../assets/logo/animebloo.svg';

const storageKey = 'animebloo.appearance.v1';
export const defaultAccent = '#588de4';
export function normalizeHex(value) {
  const hex = String(value).trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) return '#' + [...hex].map(c => c + c).join('').toLowerCase();
  return /^[\da-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
}
export function toHSV(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export function fromHSV({ h, s, v }) {
  const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, '0'); };
  return '#' + f(5) + f(3) + f(1);
}
let accent = defaultAccent;
let hsv = toHSV(accent);
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  accent = normalizeHex(saved?.accent) || defaultAccent;
  hsv = toHSV(accent);
  if (saved?.hsv && ['h', 's', 'v'].every(k => Number.isFinite(saved.hsv[k])) && saved.hsv.h >= 0 && saved.hsv.h <= 360 && saved.hsv.s >= 0 && saved.hsv.s <= 1 && saved.hsv.v >= 0 && saved.hsv.v <= 1 && fromHSV(saved.hsv) === accent) hsv = saved.hsv;
} catch { /* Use defaults if local preferences are unavailable. */ }

export function applyAccent() {
  const root = document.documentElement;
  const rgb = accent.slice(1).match(/../g).map(c => parseInt(c, 16));
  // Preserve the chosen HEX; compensate the light-theme logo against global surfaces.
  const luminance = channels => channels.reduce((sum, c, i) => sum + [.2126, .7152, .0722][i] * (c / 255 <= .04045 ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4), 0);
  const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  let logo = rgb;
  if (root.dataset.theme === 'light') {
    const probe = document.createElement('span');
    probe.style.setProperty('transition', 'none', 'important');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    root.append(probe);
    const resolve = token => {
      probe.style.color = 'var(' + token + ')';
      return getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    };
    const primary = resolve('--text');
    const surfaces = ['--bg', '--surface', '--input'].map(token => luminance(resolve(token)));
    probe.remove();
    for (let step = 0; step <= 100; step++) {
      logo = rgb.map((c, i) => Math.round(c + (primary[i] - c) * step / 100));
      if (surfaces.every(bg => contrast(luminance(logo), bg) >= 4.5)) break;
    }
  }
  root.style.setProperty('--accent-logo-color', 'rgb(' + logo.join(', ') + ')');
  root.style.setProperty('--accent-color', accent);
  root.style.setProperty('--accent-rgb', rgb.join(', '));
  root.style.setProperty('--accent-light', '#' + rgb.map(c => Math.round(c + (255 - c) * .35).toString(16).padStart(2, '0')).join(''));
  root.style.setProperty('--accent-dark', '#' + rgb.map(c => Math.round(c * .78).toString(16).padStart(2, '0')).join(''));
  root.style.setProperty('--accent-contrast', (rgb.reduce((sum, c, i) => sum + [0.2126, 0.7152, 0.0722][i] * ((c / 255 <= .04045) ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4), 0) > .179) ? '#090a0d' : '#ffffff');
}
applyAccent();

// Reuse the original SVG paths; inline instances inherit the live accent.
export function tintLogos(scope = document) {
  scope.querySelectorAll('img[src$="/animebloo.svg"]').forEach(img => {
    const svg = new DOMParser().parseFromString(logoSource, 'image/svg+xml').documentElement;
    svg.removeAttribute('id');
    svg.querySelectorAll('style').forEach(style => style.remove());
    [...img.attributes].forEach(attr => { if (!['src', 'alt'].includes(attr.name)) svg.setAttribute(attr.name, attr.value); });
    svg.classList.add('accent-logo');
    svg.setAttribute('aria-hidden', 'true');
    svg.querySelectorAll('path').forEach(path => { path.setAttribute('fill', 'var(--accent-logo-color)'); });
    img.replaceWith(document.importNode(svg, true));
  });
}

const labels = {
  it: ['Colore d’accento', 'Anteprima in tempo reale su logo, bagliori e animazioni.', 'Tonalità', 'Saturazione', 'Luminosità / scurezza', 'Colore esadecimale', 'Salva', 'Ripristina', 'Aspetto salvato.', 'Inserisci un colore valido: #RGB o #RRGGBB.', 'Impossibile salvare l’aspetto. Riprova.'],
  en: ['Accent color', 'Live preview on the logo, glow and animations.', 'Hue', 'Saturation', 'Brightness / darkness', 'Hex color', 'Save', 'Reset', 'Appearance saved.', 'Enter a valid color: #RGB or #RRGGBB.', 'Unable to save appearance. Try again.'],
  fr: ['Couleur d’accent', 'Aperçu du logo, des lueurs et animations.', 'Teinte', 'Saturation', 'Luminosité', 'Couleur hexadécimale', 'Enregistrer', 'Réinitialiser', 'Apparence enregistrée.', 'Saisissez #RGB ou #RRGGBB.', 'Enregistrement impossible. Réessayez.'],
  es: ['Color de acento', 'Vista previa del logo, brillos y animaciones.', 'Tono', 'Saturación', 'Luminosidad', 'Color hexadecimal', 'Guardar', 'Restablecer', 'Apariencia guardada.', 'Introduce #RGB o #RRGGBB.', 'No se pudo guardar. Inténtalo de nuevo.'],
  ja: ['アクセントカラー', 'ロゴ、光とアニメーションをプレビュー。', '色相', '彩度', '明るさ', 'HEX カラー', '保存', 'リセット', '保存しました。', '#RGB または #RRGGBB を入力してください。', '保存できませんでした。再試行してください。'],
  de: ['Akzentfarbe', 'Live-Vorschau für Logo, Leuchten und Animationen.', 'Farbton', 'Sättigung', 'Helligkeit', 'Hex-Farbe', 'Speichern', 'Zurücksetzen', 'Darstellung gespeichert.', 'Gib eine gültige Farbe ein: #RGB oder #RRGGBB.', 'Darstellung konnte nicht gespeichert werden. Versuche es erneut.'],
  'pt-BR': ['Cor de destaque', 'Prévia em tempo real do logo, brilho e animações.', 'Matiz', 'Saturação', 'Brilho', 'Cor hexadecimal', 'Salvar', 'Redefinir', 'Aparência salva.', 'Digite uma cor válida: #RGB ou #RRGGBB.', 'Não foi possível salvar a aparência. Tente novamente.'],
  ro: ['Culoare de accent', 'Previzualizare în timp real pentru logo, strălucire și animații.', 'Nuanță', 'Saturație', 'Luminozitate', 'Culoare hexazecimală', 'Salvează', 'Resetează', 'Aspect salvat.', 'Introdu o culoare validă: #RGB sau #RRGGBB.', 'Aspectul nu a putut fi salvat. Încearcă din nou.']
};
const panelLabels = {
  it: ['Personalizza il colore', 'Annulla', 'Chiudi', 'Colori rapidi', 'AnimeBloo · predefinito', 'Modifica colore'],
  en: ['Customize color', 'Cancel', 'Close', 'Quick colors', 'AnimeBloo · default', 'Edit color'],
  fr: ['Personnaliser la couleur', 'Annuler', 'Fermer', 'Couleurs rapides', 'AnimeBloo · par défaut', 'Modifier la couleur'],
  es: ['Personalizar color', 'Cancelar', 'Cerrar', 'Colores rápidos', 'AnimeBloo · predeterminado', 'Editar color'],
  ja: ['カラーをカスタマイズ', 'キャンセル', '閉じる', 'クイックカラー', 'AnimeBloo · デフォルト', 'カラーを編集'],
  de: ['Farbe anpassen', 'Abbrechen', 'Schließen', 'Schnellfarben', 'AnimeBloo · Standard', 'Farbe bearbeiten'],
  'pt-BR': ['Personalizar cor', 'Cancelar', 'Fechar', 'Cores rápidas', 'AnimeBloo · padrão', 'Editar cor'],
  ro: ['Personalizează culoarea', 'Anulează', 'Închide', 'Culori rapide', 'AnimeBloo · implicit', 'Editează culoarea']
};
export function appearanceMarkup(language) {
  const l = labels[language] || labels.en, p = panelLabels[language] || panelLabels.en;
  return `<div class="accent-editor"><div class="accent-summary"><div class="settings-copy"><h3>${l[0]}</h3><p>${l[1]}</p></div>
    <button class="settings-action accent-trigger" type="button" data-appearance-open aria-haspopup="dialog" aria-controls="accent-dialog" aria-expanded="false" aria-label="${p[5]}"><span class="accent-trigger-swatch" aria-hidden="true"></span><span data-accent-code>${accent.toUpperCase()}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div>
    <p class="accent-saved-status" role="status" aria-live="polite"></p>
    <dialog class="accent-dialog" id="accent-dialog" aria-labelledby="accent-title" aria-describedby="accent-description">
      <div class="accent-panel"><header class="accent-panel-header"><div><span class="accent-panel-eyebrow">AnimeBloo</span><h2 id="accent-title">${p[0]}</h2></div><button type="button" class="accent-close" data-appearance-cancel aria-label="${p[2]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
      <p id="accent-description">${l[1]}</p>
      <div class="accent-live-preview"><img src="../../assets/logo/animebloo.svg" alt="" /><span>Anime<span class="accent-wordmark">Bloo</span></span><span class="accent-preview" aria-hidden="true"></span></div>
      <div class="accent-controls"><div class="accent-wheel" role="slider" tabindex="0" aria-label="${l[2]} / ${l[3]}" aria-valuemin="0" aria-valuemax="359" aria-valuenow="${Math.round(hsv.h) % 360}"><span class="accent-wheel-thumb"></span></div>
      <div class="accent-fields"><label>${l[4]} <output data-brightness-output></output><input type="range" min="0" max="100" step="0.1" data-accent-brightness aria-label="${l[4]}" /></label>
      <label for="accent-hex">HEX</label><div class="accent-hex-field"><span aria-hidden="true">#</span><input id="accent-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" value="${accent.slice(1)}" aria-label="${l[5]}" aria-describedby="accent-status" /></div>
      <div class="accent-presets" role="group" aria-label="${p[3]}">${[defaultAccent, '#a879ff', '#ef6797', '#f4a340', '#58c99a', '#e5e5e5'].map(color => `<button type="button" data-accent-preset="${color}" style="--preset:${color}" title="${color === defaultAccent ? p[4] : color.toUpperCase()}" aria-label="${color === defaultAccent ? p[4] : color.toUpperCase()}" aria-pressed="${accent === color}"></button>`).join('')}</div></div></div>
      <p id="accent-status" role="status" aria-live="polite"></p><footer class="accent-actions"><button type="button" data-appearance-reset>${l[7]}</button><div><button type="button" data-appearance-cancel>${p[1]}</button><button type="button" data-appearance-save>${l[6]}</button></div></footer></div>
    </dialog></div>`;
}

export function mountAppearance(scope, language, getTheme) {
  const editor = scope.querySelector('.accent-editor');
  if (!editor) return;
  const l = labels[language] || labels.en;
  const dialog = editor.querySelector('.accent-dialog'), panel = editor.querySelector('.accent-panel');
  const trigger = editor.querySelector('[data-appearance-open]');
  const wheel = editor.querySelector('.accent-wheel'), hex = editor.querySelector('#accent-hex');
  const brightness = editor.querySelector('[data-accent-brightness]'), status = editor.querySelector('#accent-status');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let snapshot, closing = false, motion;
  function sync() {
    hex.value = accent.slice(1).toUpperCase();
    hex.setCustomValidity(''); hex.removeAttribute('aria-invalid');
    brightness.value = hsv.v * 100;
    editor.querySelector('[data-brightness-output]').textContent = `${Math.round(hsv.v * 100)}%`;
    wheel.setAttribute('aria-valuenow', Math.round(hsv.h) % 360);
    wheel.setAttribute('aria-valuetext', `${l[2]} ${Math.round(hsv.h)}°, ${l[3]} ${Math.round(hsv.s * 100)}%`);
    const angle = hsv.h * Math.PI / 180;
    wheel.style.setProperty('--thumb-x', `${50 + Math.sin(angle) * hsv.s * 46}%`);
    wheel.style.setProperty('--thumb-y', `${50 - Math.cos(angle) * hsv.s * 46}%`);
    wheel.style.setProperty('--wheel-brightness', hsv.v);
    brightness.style.background = `linear-gradient(to right, #000, ${fromHSV({ ...hsv, v: 1 })})`;
    editor.querySelector('[data-accent-code]').textContent = accent.toUpperCase();
    editor.querySelectorAll('[data-accent-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accentPreset === accent)));
    status.textContent = '';
    applyAccent();
  }
  function open() {
    if (dialog.open || closing) return;
    snapshot = { accent, hsv: { ...hsv } };
    sync();
    editor.querySelector('.accent-saved-status').textContent = '';
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    wheel.focus({ preventScroll: true });
    if (!reducedMotion.matches) motion = gsap.timeline()
      .fromTo(dialog, { opacity: 0 }, { opacity: 1, duration: .22, clearProps: 'opacity' }, 0)
      .fromTo(panel, { y: 18, scale: .97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: .34, ease: 'power3.out', clearProps: 'transform,opacity,visibility' }, 0);
  }
  function close(saved = false) {
    if (!dialog.open || closing) return;
    closing = true;
    motion?.kill();
    // Dismissal rolls back the live preview; only Save commits the color.
    if (!saved) { accent = snapshot.accent; hsv = { ...snapshot.hsv }; sync(); }
    const finish = () => {
      dialog.close();
      gsap.set([dialog, panel], { clearProps: 'transform,opacity,visibility' });
      trigger.setAttribute('aria-expanded', 'false');
      closing = false;
      trigger.focus({ preventScroll: true });
      if (saved) editor.querySelector('.accent-saved-status').textContent = l[8];
    };
    if (reducedMotion.matches) finish();
    else motion = gsap.timeline({ onComplete: finish })
      .to(panel, { y: 10, scale: .985, autoAlpha: 0, duration: .16, ease: 'power2.in' }, 0)
      .to(dialog, { opacity: 0, duration: .2 }, 0);
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  let backdropDown = false;
  dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog; });
  dialog.addEventListener('click', event => { if (backdropDown && event.target === dialog) close(); backdropDown = false; });
  function updateHSV() { if (closing) return; accent = fromHSV(hsv); sync(); }
  function pick(event) {
    const rect = wheel.getBoundingClientRect(), x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
    hsv.h = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    hsv.s = Math.min(1, Math.hypot(x, y) / (rect.width * .46));
    updateHSV();
  }
  wheel.addEventListener('pointerdown', event => { if (event.button !== 0 || closing) return; wheel.setPointerCapture(event.pointerId); pick(event); });
  wheel.addEventListener('pointermove', event => { if (!closing && wheel.hasPointerCapture(event.pointerId)) pick(event); });
  wheel.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || closing) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) hsv.s = Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowUp' ? step : -step) / 100));
    else hsv.h = event.key === 'Home' ? 0 : event.key === 'End' ? 359 : (hsv.h + (event.key === 'ArrowRight' ? step : -step) + 360) % 360;
    updateHSV();
  });
  brightness.addEventListener('input', () => { if (!closing) { hsv.v = Number(brightness.value) / 100; updateHSV(); } });
  function readHex() {
    if (closing) return false;
    const next = normalizeHex(hex.value);
    hex.setCustomValidity(next ? '' : l[9]); hex.setAttribute('aria-invalid', String(!next));
    if (!next) { status.textContent = l[9]; return false; }
    if (next !== accent) { accent = next; hsv = toHSV(accent); } sync(); return true;
  }
  hex.addEventListener('input', () => { if (/^#?(?:[\da-f]{6})$/i.test(hex.value.trim())) readHex(); else { hex.setCustomValidity(normalizeHex(hex.value) ? '' : l[9]); hex.setAttribute('aria-invalid', String(!normalizeHex(hex.value))); } });
  hex.addEventListener('change', readHex);
  hex.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); editor.querySelector('[data-appearance-save]').click(); } });
  editor.addEventListener('click', event => {
    if (event.target.closest('[data-appearance-open]')) { open(); return; }
    if (closing || !dialog.open) return;
    if (event.target.closest('[data-appearance-cancel]')) { close(); return; }
    const preset = event.target.closest('[data-accent-preset]');
    if (preset) { accent = preset.dataset.accentPreset; hsv = toHSV(accent); sync(); }
    if (event.target.closest('[data-appearance-reset]')) { accent = defaultAccent; hsv = toHSV(accent); sync(); }
    if (event.target.closest('[data-appearance-save]')) {
      if (!readHex()) { hex.focus(); return; }
      try {
        localStorage.setItem(storageKey, JSON.stringify({ accent, hsv: { ...hsv }, theme: getTheme() }));
        close(true);
      } catch { status.textContent = l[10]; }
    }
    if (preset && !reducedMotion.matches) gsap.fromTo(preset, { scale: .85 }, { scale: 1, duration: .28, ease: 'back.out(1.7)', clearProps: 'transform', overwrite: 'auto' });
  });
  editor.querySelectorAll('button').forEach(button => {
    button.addEventListener('pointerdown', () => { if (!reducedMotion.matches) gsap.to(button, { scale: .96, duration: .12, overwrite: 'auto' }); });
    const release = () => { if (!reducedMotion.matches) gsap.to(button, { scale: 1, duration: .22, ease: 'power2.out', clearProps: 'transform', overwrite: 'auto' }); };
    button.addEventListener('pointerup', release); button.addEventListener('pointerleave', release); button.addEventListener('pointercancel', release);
  });
  sync();
}
