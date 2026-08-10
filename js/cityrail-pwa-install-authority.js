(function(){
  'use strict';
  const W = window;
  const D = document;
  const VERSION = 'v598-pwa-install-authority';
  if (W.CityRailPwaInstall && W.CityRailPwaInstall.version === VERSION) return;

  let deferredPrompt = null;
  let installed = false;

  function isStandalone() {
    return (W.matchMedia && W.matchMedia('(display-mode: standalone)').matches) ||
      W.navigator.standalone === true ||
      D.referrer.startsWith('android-app://');
  }

  function isiOSSafari() {
    const ua = W.navigator.userAgent || '';
    const iOS = /iphone|ipad|ipod/i.test(ua) || (W.navigator.platform === 'MacIntel' && W.navigator.maxTouchPoints > 1);
    const safari = /safari/i.test(ua) && !/crios|fxios|edgios|micromessenger|qqbrowser|mqqbrowser|xhs|xiaohongshu/i.test(ua);
    return iOS && safari;
  }

  function canShowInstall() {
    return !installed && !isStandalone() && (deferredPrompt || isiOSSafari());
  }

  function ensureStyle() {
    if (D.getElementById('cityrail-pwa-install-style')) return;
    const style = D.createElement('style');
    style.id = 'cityrail-pwa-install-style';
    style.textContent = [
      '.cityrail-pwa-install{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));z-index:10020;display:none;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(2,11,24,.88);color:#fff;padding:10px 14px;font:600 14px/1.1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.32);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}',
      '.cityrail-pwa-install.is-visible{display:flex;}',
      '.cityrail-pwa-install svg{width:17px;height:17px;flex:none;}',
      '.cityrail-pwa-sheet{position:fixed;inset:0;z-index:10030;display:none;align-items:flex-end;justify-content:center;background:rgba(2,8,18,.46);padding:18px;}',
      '.cityrail-pwa-sheet.is-visible{display:flex;}',
      '.cityrail-pwa-card{width:min(420px,100%);border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#071427;color:#fff;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.42);font:500 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.cityrail-pwa-card h2{margin:0 0 10px;font-size:18px;line-height:1.25;}',
      '.cityrail-pwa-card p{margin:0 0 12px;color:rgba(255,255,255,.82);}',
      '.cityrail-pwa-card button{width:100%;height:42px;border:0;border-radius:10px;background:#1aa7ff;color:#001223;font-weight:700;}',
      '@media (display-mode:standalone){.cityrail-pwa-install,.cityrail-pwa-sheet{display:none!important;}}'
    ].join('\n');
    (D.head || D.documentElement).appendChild(style);
  }

  function installIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function ensureButton() {
    ensureStyle();
    let btn = D.getElementById('cityrail-pwa-install');
    if (!btn) {
      btn = D.createElement('button');
      btn.id = 'cityrail-pwa-install';
      btn.type = 'button';
      btn.className = 'cityrail-pwa-install';
      btn.innerHTML = installIcon() + '<span>安装到桌面</span>';
      btn.addEventListener('click', install);
      D.body.appendChild(btn);
    }
    btn.classList.toggle('is-visible', canShowInstall());
    return btn;
  }

  function showIOSGuide() {
    ensureStyle();
    let sheet = D.getElementById('cityrail-pwa-sheet');
    if (!sheet) {
      sheet = D.createElement('div');
      sheet.id = 'cityrail-pwa-sheet';
      sheet.className = 'cityrail-pwa-sheet';
      sheet.innerHTML = '<div class="cityrail-pwa-card" role="dialog" aria-modal="true"><h2>添加 CityRail 到主屏幕</h2><p>在 Safari 底部点分享按钮，然后选择“添加到主屏幕”。完成后就能像 App 一样从桌面打开。</p><button type="button">知道了</button></div>';
      sheet.addEventListener('click', event => {
        if (event.target === sheet || event.target.tagName === 'BUTTON') sheet.classList.remove('is-visible');
      });
      D.body.appendChild(sheet);
    }
    sheet.classList.add('is-visible');
  }

  async function install() {
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      try {
        prompt.prompt();
        await prompt.userChoice;
      } catch(e) {}
      sync();
      return;
    }
    if (isiOSSafari()) showIOSGuide();
  }

  function sync() {
    installed = isStandalone();
    if (!D.body) return;
    ensureButton();
    D.documentElement.dataset.cityrailPwa = installed ? 'standalone' : (canShowInstall() ? 'installable' : 'browser');
  }

  W.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    sync();
  });
  W.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    sync();
  });
  W.addEventListener('DOMContentLoaded', sync, { once: true });
  W.addEventListener('load', sync);

  W.CityRailPwaInstall = {
    version: VERSION,
    install,
    sync,
    report: () => ({
      version: VERSION,
      standalone: isStandalone(),
      iosSafari: isiOSSafari(),
      installPromptReady: !!deferredPrompt,
      installable: canShowInstall()
    })
  };
})();
