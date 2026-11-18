(function () {
  var storageKey = 'vwan-visual-topology:language:v1';
  var titles = {
    en: 'Azure Network Simulator (AzNetSim) — Documentation & Worked Examples',
    ja: 'Azure ネットワーク シミュレーター (AzNetSim) — ドキュメントと実践サンプル'
  };
  function resolveInitialLanguage() {
    try {
      var param = new URLSearchParams(window.location.search).get('lang');
      if (param === 'ja' || param === 'en') {
        try { localStorage.setItem(storageKey, param); } catch {}
        return param;
      }
    } catch {}
    try {
      return localStorage.getItem(storageKey) === 'ja' ? 'ja' : 'en';
    } catch {
      return 'en';
    }
  }
  var initial = resolveInitialLanguage();
  document.documentElement.lang = initial;
  document.title = titles[initial];

  document.addEventListener('DOMContentLoaded', function () {
    var select = document.getElementById('doc-language-selector');
    var toc = document.getElementById('doc-toc');

    function applyLanguage(next, updateUrl) {
      var lang = next === 'ja' ? 'ja' : 'en';
      document.documentElement.lang = lang;
      document.title = titles[lang];
      try { localStorage.setItem(storageKey, lang); } catch {}
      if (select) {
        select.value = lang;
        select.setAttribute('aria-label', lang === 'ja' ? '言語 / Language' : 'Language / 言語');
      }
      if (toc) {
        toc.setAttribute('aria-label', lang === 'ja' ? '目次' : 'Table of contents');
      }
      var images = document.querySelectorAll('img[data-alt-en][data-alt-ja]');
      for (var i = 0; i < images.length; i++) {
        var img = images[i];
        var alt = img.getAttribute(lang === 'ja' ? 'data-alt-ja' : 'data-alt-en');
        if (alt) img.setAttribute('alt', alt);
      }
      if (updateUrl && window.history && window.history.replaceState) {
        try {
          var url = new URL(window.location.href);
          if (lang === 'ja') {
            url.searchParams.set('lang', 'ja');
          } else {
            url.searchParams.delete('lang');
          }
          window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch {}
      }
    }

    applyLanguage(initial, false);
    if (select) {
      select.addEventListener('change', function (event) {
        applyLanguage(event.target.value, true);
      });
    }
  });
})();
