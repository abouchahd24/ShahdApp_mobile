/* منصّة شهد — نظام الترخيص (اشتراك سنوي، تحقق عبر الإنترنت)
   ─────────────────────────────────────────────────────────
   يُعدَّل هذا الملف مرة واحدة فقط (القيم الثلاث أدناه) ثم يُوزَّع مع المنصة.
   url      : رابط تطبيق الويب (Apps Script) الخاص بك — انظر «دليل_البائع.md»
   pub      : المفتاح العام الذي يُنتجه «مولد_مفاتيح_الترخيص.html»
   contact  : نص يظهر للمشتري للتفعيل أو التجديد (رقم هاتف، واتساب، بريد…)
   إن تُركت url أو pub فارغتين تعمل المنصة بلا ترخيص (وضع التجربة). */
(function () {
  'use strict';
  const CFG = {
    url: '',
    pub: '',
    contact: '',
    grace: 7,            // أيام يُسمح فيها بالعمل بلا اتصال بعد آخر تحقق ناجح
    recheckHours: 12,    // كل كم ساعة يُعاد التحقق بصمت في الخلفية
    warnDays: 14,        // التنبيه قبل انتهاء الاشتراك بعدد الأيام
  };
  const LK = 'shahd.license.v1', DK = 'shahd.device.v1', SK = 'shahd.license.seen';
  const reveal = () => { const h = document.getElementById('lic-hide'); if (h) h.remove(); };
  if (!CFG.url || !CFG.pub) { window.ShahdLicense = { enabled: false }; reveal(); return; }

  const DAY = 864e5, enc = new TextEncoder();
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } }, del: k => { try { localStorage.removeItem(k); } catch (e) { } } };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b2u8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const dev = () => { let d = ls.get(DK); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)); ls.set(DK, d); } return d; };
  const expEnd = exp => new Date(exp + 'T23:59:59').getTime();
  const fmtD = exp => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exp || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : exp; };
  let pubKey = null;
  async function verify(payload, sig) {
    try {
      if (!crypto.subtle) return false;
      pubKey = pubKey || await crypto.subtle.importKey('spki', b2u8(CFG.pub.replace(/\s+/g, '')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pubKey, b2u8(sig), enc.encode(payload));
    } catch (e) { return false; }
  }
  const rec = () => { try { return JSON.parse(ls.get(LK)); } catch (e) { return null; } };

  /* ---- تحقق عبر الخادم ---- */
  async function online(key) {
    let r;
    try { r = await fetch(CFG.url + (CFG.url.includes('?') ? '&' : '?') + 'action=check&key=' + encodeURIComponent(key) + '&dev=' + encodeURIComponent(dev()), { cache: 'no-store' }); }
    catch (e) { return { net: true, msg: 'تعذّر الاتصال بخادم الترخيص. تحقق من الإنترنت ثم أعد المحاولة.' }; }
    let j; try { j = await r.json(); } catch (e) { return { net: true, msg: 'ردّ غير مفهوم من خادم الترخيص.' }; }
    if (!j.ok) return { msg: j.msg || 'المفتاح غير صالح.' };
    if (!(await verify(j.payload, j.sig))) return { msg: 'تعذّر التحقق من صحة ردّ الخادم.' };
    const p = JSON.parse(j.payload);
    if (p.k !== key || p.dev !== dev()) return { msg: 'ردّ الخادم لا يطابق هذا الجهاز.' };
    if (Math.abs(Date.now() - p.ts) > 2 * DAY) return { msg: 'ساعة هذا الجهاز غير مضبوطة. صحّح التاريخ والوقت ثم أعد المحاولة.' };
    if (expEnd(p.exp) < Date.now()) return { msg: 'انتهى الاشتراك بتاريخ ' + fmtD(p.exp) + '.', expired: true, exp: p.exp };
    ls.set(LK, JSON.stringify({ key, payload: j.payload, sig: j.sig, at: Date.now() }));
    return { ok: true, p };
  }
  /* ---- فحص محلي (بلا شبكة) للترخيص المحفوظ ---- */
  async function local() {
    const r = rec(); if (!r) return { why: 'none' };
    if (!(await verify(r.payload, r.sig))) return { why: 'invalid', r };
    const p = JSON.parse(r.payload), now = Date.now(), seen = +ls.get(SK) || 0;
    if (p.dev !== dev()) return { why: 'invalid', r };
    if (now < seen - 36e5) return { why: 'clock', r, p };          // رجوع بالساعة إلى الوراء
    ls.set(SK, String(Math.max(seen, now)));
    if (expEnd(p.exp) < now) return { why: 'expired', r, p };
    if (now - r.at > CFG.grace * DAY) return { why: 'stale', r, p };
    return { ok: true, r, p };
  }

  /* ---- الواجهة ---- */
  function exportBackup() {
    const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^shahd/i.test(k) && k !== LK && k !== DK && k !== SK) o[k] = localStorage.getItem(k); } } catch (e) { }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(o)], { type: 'application/json' })); a.download = 'shahd_backup_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  }
  function overlay(msg, opts = {}) {
    let ov = document.getElementById('lic-ov'); if (ov) ov.remove();
    ov = document.createElement('div'); ov.id = 'lic-ov';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(11,31,58,.97);display:flex;align-items:center;justify-content:center;padding:18px;direction:rtl;font-family:PortalCairo,"Segoe UI",Tahoma,Arial,sans-serif;visibility:visible');
    ov.innerHTML = `<div style="background:#FDFBF6;border:1px solid #C9A24B;border-radius:18px;padding:26px 28px;width:100%;max-width:470px;color:#2B2416;box-shadow:0 30px 70px -20px rgba(0,0,0,.6)">
      <div style="font-size:23px;font-weight:700;color:#0B1F3A;margin-bottom:6px">منصّة شهد — تفعيل الاشتراك</div>
      <div id="lic-m" style="font-size:14px;line-height:1.9;color:${opts.err ? '#A8432F' : '#6b644f'};margin-bottom:14px">${esc(msg)}</div>
      <input id="lic-k" dir="ltr" placeholder="SHD-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" style="width:100%;font:700 16px monospace;letter-spacing:1px;text-align:center;padding:11px;border:1px solid #E3DAC4;border-radius:11px;background:#fff;box-sizing:border-box">
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button id="lic-go" style="flex:1;font-weight:700;font-size:15px;font-family:inherit;padding:11px 18px;border-radius:99px;border:1px solid #8A6D1F;background:linear-gradient(180deg,#d8b45f,#C9A24B);color:#0B1F3A;cursor:pointer">تفعيل</button>${opts.backup ? '<button id="lic-bk" style="font-weight:700;font-size:13.5px;font-family:inherit;padding:11px 16px;border-radius:99px;border:1px solid #0B1F3A;background:#FDFBF6;color:#0B1F3A;cursor:pointer">تصدير نسخة احتياطية من بياناتي</button>' : ''}</div>
      ${CFG.contact ? `<div style="margin-top:16px;font-size:12.5px;color:#8A6D1F;line-height:1.8;border-top:1px solid #E3DAC4;padding-top:10px">${esc(CFG.contact)}</div>` : ''}</div>`;
    document.body.appendChild(ov);
    const k = ov.querySelector('#lic-k'), go = ov.querySelector('#lic-go'), m = ov.querySelector('#lic-m');
    const prev = rec(); if (prev && prev.key) k.value = prev.key; k.focus();
    ov.querySelector('#lic-bk') && (ov.querySelector('#lic-bk').onclick = exportBackup);
    const run = async () => {
      const key = k.value.trim().toUpperCase(); if (!key) { m.textContent = 'اكتب مفتاح الاشتراك.'; m.style.color = '#A8432F'; return; }
      go.disabled = true; go.textContent = 'جارٍ التحقق…'; m.style.color = '#6b644f'; m.textContent = 'جارٍ التحقق من المفتاح عبر الإنترنت…';
      const r = await online(key); go.disabled = false; go.textContent = 'تفعيل';
      if (r.ok) { ov.remove(); accept(r.p); } else { m.style.color = '#A8432F'; m.textContent = r.msg; }
    };
    go.onclick = run; k.onkeydown = e => { if (e.key === 'Enter') run(); };
  }
  function accept(p) {
    reveal();
    const st = document.getElementById('lic-wm') || document.createElement('style'); st.id = 'lic-wm';
    st.textContent = `@media print{body::after{content:"مرخَّص لـ: ${String(p.inst).replace(/["\\\n]/g, ' ')} — صالح حتى ${fmtD(p.exp)}";position:fixed;bottom:1.5mm;left:0;right:0;text-align:center;font:9px sans-serif;color:#666;direction:rtl}}`;
    document.head.appendChild(st);
    window.ShahdLicense = Object.assign(window.ShahdLicense || { enabled: true }, { info: () => ({ inst: p.inst, exp: p.exp }) });
    const left = Math.ceil((expEnd(p.exp) - Date.now()) / DAY);
    if (left <= CFG.warnDays && !sessionStorage.getItem('lic-warn')) {
      const b = document.createElement('div'); b.id = 'lic-bar';
      b.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#8A6D1F;color:#fff;font:700 13px PortalCairo,Tahoma,sans-serif;text-align:center;padding:5px 36px;direction:rtl');
      b.innerHTML = `ينتهي اشتراك مؤسستكم بتاريخ ${fmtD(p.exp)} (بعد ${left} يوماً) — للتجديد: ${esc(CFG.contact || 'تواصل مع البائع')}<span id="lic-x" style="position:absolute;left:12px;cursor:pointer">✕</span>`;
      document.body.appendChild(b); b.querySelector('#lic-x').onclick = () => { b.remove(); try { sessionStorage.setItem('lic-warn', '1'); } catch (e) { } };
      const ps = document.createElement('style'); ps.textContent = '@media print{#lic-bar{display:none!important}}'; document.head.appendChild(ps);
    }
  }
  async function boot() {
    window.ShahdLicense = { enabled: true };
    const L = await local();
    if (L.ok) {
      accept(L.p);
      if (Date.now() - L.r.at > CFG.recheckHours * 36e5) online(L.r.key).then(r => { if (r.ok) accept(r.p); else if (!r.net) { ls.del(LK); location.reload(); } });
      return;
    }
    if (L.r && L.r.key && (L.why === 'stale' || L.why === 'clock')) {                 // محاولة تجديد التحقق تلقائياً
      const r = await online(L.r.key);
      if (r.ok) { accept(r.p); return; }
      return overlay(r.net ? 'يلزم الاتصال بالإنترنت لتجديد التحقق من الاشتراك.' : r.msg, { err: true, backup: !!r.expired });
    }
    if (L.why === 'expired') return overlay('انتهى اشتراك مؤسستكم بتاريخ ' + fmtD(L.p.exp) + '. أدخل مفتاح التجديد لمتابعة العمل، وبياناتكم محفوظة على جهازكم.', { err: true, backup: true });
    if (L.why === 'invalid') { ls.del(LK); return overlay('بيانات الترخيص غير صالحة على هذا الجهاز. أعد إدخال المفتاح.', { err: true }); }
    overlay('أدخل مفتاح الاشتراك الذي استلمته لتفعيل المنصة (يلزم اتصال بالإنترنت عند التفعيل).');
  }
  const start = () => boot().catch(e => { console.error(e); overlay('تعذّر فحص الترخيص: ' + e.message, { err: true }); });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
