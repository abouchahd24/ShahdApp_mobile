/* جسر بين المنصة وأندرويد: حفظ الملفات المُصدَّرة + الطباعة.
   لا يغيّر أي سلوك للمنصة على المتصفح؛ يُحقن داخل التطبيق فقط. */
(function () {
  'use strict';
  if (window.__shahdShim) return;
  window.__shahdShim = true;

  function bridge() { return window.AndroidBridge; }

  /* ---------- حفظ الملفات (blob: / data:) ---------- */
  function isSavable(a) {
    return a && a.hasAttribute && a.hasAttribute('download') && /^(blob:|data:)/i.test(a.href || '');
  }
  function nameOf(a) {
    return a.getAttribute('download') || 'shahd_file';
  }
  function saveFromUrl(url, name) {
    fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      var fr = new FileReader();
      fr.onloadend = function () {
        var s = String(fr.result || ''), i = s.indexOf(',');
        if (bridge() && i >= 0) bridge().saveBase64(name, blob.type || '', s.slice(i + 1));
      };
      fr.readAsDataURL(blob);
    }).catch(function () { alert('تعذّر حفظ الملف'); });
  }

  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isSavable(this)) { saveFromUrl(this.href, nameOf(this)); return; }
    return origClick.apply(this, arguments);
  };

  var origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && this instanceof HTMLAnchorElement && isSavable(this)) {
      saveFromUrl(this.href, nameOf(this));
      return true;
    }
    return origDispatch.apply(this, arguments);
  };

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && isSavable(a)) { e.preventDefault(); e.stopPropagation(); saveFromUrl(a.href, nameOf(a)); }
  }, true);

  /* ---------- الطباعة ---------- */
  // طباعة الصفحة نفسها
  window.print = function () {
    if (bridge()) bridge().printPage(document.title || '');
  };

  // طباعة محتوى إطار iframe (كما تفعل صفحات الغيابات والخدمات المدرسية)
  function printFrame(w) {
    try {
      var root = w.document.documentElement.cloneNode(true);
      var sc = root.querySelectorAll('script');
      for (var i = 0; i < sc.length; i++) sc[i].parentNode.removeChild(sc[i]);
      if (bridge()) bridge().printHtml('<!DOCTYPE html>' + root.outerHTML, w.document.title || document.title || '');
    } catch (e) {
      if (bridge()) bridge().printPage(document.title || '');
    }
  }
  var cwd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (cwd && cwd.get) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      enumerable: cwd.enumerable,
      get: function () {
        var w = cwd.get.call(this);
        try {
          if (w && !w.__shahdPrint) {
            w.__shahdPrint = true;
            w.print = function () { printFrame(w); };
          }
        } catch (e) { }
        return w;
      }
    });
  }
})();
