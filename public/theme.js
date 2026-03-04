(function () {
  const STORAGE_KEY = 'site-theme';
  const TRANSITION_STYLE_ID = 'site-theme-transition-style';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function getSavedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  function getCurrentTheme() {
    const forced = root.getAttribute('data-theme');
    if (forced === 'light' || forced === 'dark') return forced;
    return media.matches ? 'dark' : 'light';
  }

  function ensureTransitionStyle() {
    if (document.getElementById(TRANSITION_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = TRANSITION_STYLE_ID;
    style.textContent = `
      :root.theme-switching,
      :root.theme-switching *,
      :root.theme-switching *::before,
      :root.theme-switching *::after {
        transition: background-color .32s ease, color .32s ease, border-color .32s ease, box-shadow .32s ease, fill .32s ease, stroke .32s ease !important;
      }
    `;
    document.head.appendChild(style);
  }

  function updateThemeColorMeta() {
    const theme = getCurrentTheme();
    const color = theme === 'dark' ? '#0b0f17' : '#f5f5f7';

    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.setAttribute('name', 'theme-color');
      document.head.appendChild(metaTheme);
    }
    metaTheme.setAttribute('content', color);

    let metaApple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!metaApple) {
      metaApple = document.createElement('meta');
      metaApple.setAttribute('name', 'apple-mobile-web-app-status-bar-style');
      document.head.appendChild(metaApple);
    }
    metaApple.setAttribute('content', theme === 'dark' ? 'black' : 'default');
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
    updateToggleButtons();
    updateThemeColorMeta();
  }

  function applyThemeWithTransition(theme) {
    root.classList.add('theme-switching');
    applyTheme(theme);
    window.setTimeout(() => {
      root.classList.remove('theme-switching');
    }, 360);
  }

  function saveTheme(theme) {
    try {
      if (theme === 'light' || theme === 'dark') {
        localStorage.setItem(STORAGE_KEY, theme);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }

  function setTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      saveTheme(theme);
      applyThemeWithTransition(theme);
    }
  }

  function toggleTheme() {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  function getIcon(theme) {
    if (theme === 'dark') {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  }

  function updateToggleButtons() {
    const theme = getCurrentTheme();
    const title = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('data-theme-current', theme);
      button.setAttribute('aria-label', title);
      button.setAttribute('title', title);
      button.innerHTML = getIcon(theme);
    });
  }

  function bindToggleEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-theme-toggle]');
      if (!target) return;
      event.preventDefault();
      toggleTheme();
    });

    const onSystemThemeChange = () => {
      if (!getSavedTheme()) {
        updateToggleButtons();
      }
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onSystemThemeChange);
    } else if (typeof media.addListener === 'function') {
      media.addListener(onSystemThemeChange);
    }
  }

  function initTheme() {
    ensureTransitionStyle();
    applyTheme(getSavedTheme());
    bindToggleEvents();
    updateToggleButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  window.SiteTheme = {
    setTheme,
    toggleTheme,
    getCurrentTheme
  };
})();
