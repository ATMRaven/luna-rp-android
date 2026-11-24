/**
 * DownloadApp Web Component (Dark Swiss Minimalist Theme)
 * - In Android/Desktop browser: fetches /api/apk/latest.json and shows direct APK download + desktop QR.
 * - Inside Capacitor native APK: hides download CTA and shows Check for Updates row in Settings.
 */
class DownloadAppElement extends HTMLElement {
  static get observedAttributes() {
    return ['manifest-url', 'variant'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.manifestData = null;
    this.isNative = this.checkIsNative();
  }

  connectedCallback() {
    this.render();
    if (!this.isNative) {
      this.fetchManifest();
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) this.render();
  }

  checkIsNative() {
    try {
      return Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch {
      return false;
    }
  }

  async fetchManifest() {
    const url = this.getAttribute('manifest-url') || '/api/apk/latest.json';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        this.manifestData = await res.json();
        this.render();
      }
    } catch {
      // No release published yet
    }
  }

  detectOS() {
    const ua = navigator.userAgent || navigator.vendor || '';
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    return 'desktop';
  }

  render() {
    if (!this.shadowRoot) return;
    const variant = this.getAttribute('variant') || 'settings';
    const os = this.detectOS();

    if (this.isNative) {
      if (variant === 'settings') {
        this.renderNativeSettingsRow();
      } else {
        this.shadowRoot.innerHTML = '';
      }
      return;
    }

    if (!this.manifestData || !this.manifestData.apkUrl) {
      this.shadowRoot.innerHTML = '';
      return;
    }

    const apkUrl = this.manifestData.apkUrl;
    const versionName = this.manifestData.versionName ? `v${this.manifestData.versionName}` : '';
    const sizeMb = this.manifestData.sizeBytes ? `${(this.manifestData.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : '';
    const badgeText = [versionName, sizeMb].filter(Boolean).join(' · ');

    const styles = `
      :host { display: block; width: 100%; font-family: inherit; box-sizing: border-box; }
      *, *::before, *::after { box-sizing: inherit; }
      .card {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 12px; background: #1b1d20; border: 1px solid #26292e; border-radius: 12px;
      }
      .meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .title { font-size: 13.5px; font-weight: 600; color: #f4f4f5; }
      .sub { font-size: 11.5px; color: #a1a1aa; }
      .actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .btn-download {
        display: inline-flex; align-items: center; gap: 6px;
        background: #f4f4f5; color: #0c0d0e; padding: 8px 14px; border-radius: 9999px;
        font-size: 12.5px; font-weight: 600; text-decoration: none; white-space: nowrap;
      }
      .qr-trigger {
        position: relative; display: inline-flex; align-items: center; justify-content: center;
        width: 34px; height: 34px; background: #23262b; border: 1px solid #3f444c;
        border-radius: 8px; cursor: pointer; color: #f4f4f5;
      }
      .qr-popover {
        display: none; position: absolute; bottom: 120%; right: 0;
        background: #ffffff; padding: 12px; border-radius: 12px;
        box-shadow: 0 12px 28px rgba(0,0,0,0.45); z-index: 1000; text-align: center;
      }
      .qr-trigger:hover .qr-popover, .qr-trigger:focus-within .qr-popover { display: block; }
      .qr-img { width: 132px; height: 132px; display: block; margin-bottom: 6px; }
      .qr-hint { font-size: 11px; color: #334155; font-weight: 600; }
    `;

    const downloadSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const qrSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;

    if (os === 'ios') {
      this.shadowRoot.innerHTML = `<style>${styles}</style><div class="card"><div class="meta"><span class="title">Android App</span><span class="sub">APK available (${badgeText})</span></div></div>`;
      return;
    }

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(apkUrl)}`;
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="card">
        <div class="meta">
          <span class="title">Android App (APK)</span>
          <span class="sub">${badgeText || 'Latest signed build'}</span>
        </div>
        <div class="actions">
          <a href="${apkUrl}" class="btn-download" download>${downloadSvg}<span>Download</span></a>
          ${os === 'desktop' ? `
            <div class="qr-trigger" tabindex="0" role="button" aria-label="QR code for APK download">
              ${qrSvg}
              <div class="qr-popover">
                <img class="qr-img" src="${qrUrl}" alt="APK QR" loading="lazy" />
                <div class="qr-hint">Scan on Android</div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderNativeSettingsRow() {
    const styles = `
      :host { display: block; width: 100%; box-sizing: border-box; }
      .row {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 12px; background: #1b1d20; border: 1px solid #26292e; border-radius: 12px;
      }
      .meta { display: flex; flex-direction: column; gap: 2px; }
      .title { font-size: 13.5px; font-weight: 600; color: #f4f4f5; }
      .sub { font-size: 11.5px; color: #a1a1aa; }
      .btn {
        background: #23262b; color: #f4f4f5; border: 1px solid #444954;
        padding: 7px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      }
    `;
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="row">
        <div class="meta">
          <span class="title">Luna RP Android</span>
          <span class="sub" id="native-ver">Installed Build</span>
        </div>
        <button type="button" class="btn" id="btn-check-apk">Check Updates</button>
      </div>
    `;

    this.shadowRoot.getElementById('btn-check-apk')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('check-for-updates', { bubbles: true, composed: true }));
    });

    try {
      window.Capacitor?.Plugins?.App?.getInfo().then((info) => {
        const el = this.shadowRoot.getElementById('native-ver');
        if (el) el.textContent = `v${info.version} (Build ${info.build})`;
      });
    } catch {}
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('download-app')) {
  customElements.define('download-app', DownloadAppElement);
}
