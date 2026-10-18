/*!
 * report.js — English Games otomatik sonuç raporu (FormSubmit)
 * Sends: 1x "başladı" on load, 1x "bitti" per finished round,
 *        1x "yarıda kaldı" (sendBeacon) per round if the page is hidden/closed
 *        after at least one answer and before the final screen.
 * Never throws, never shows anything to the child.
 * See REPORT_NOTES.md for the contract new game pages must follow.
 */
(function () {
  'use strict';
  try {
    if (window.__gameReportLoaded) return;
    window.__gameReportLoaded = true;

    var ENDPOINT = 'https://formsubmit.co/ajax/isiltabag@gmail.com';
    var TZ = 'Europe/Istanbul';

    // Disable on local files / localhost (dev) unless ?report=1; always disable with ?noreport
    var qs = String(location.search || '');
    var host = String(location.hostname || '');
    if (/[?&]noreport\b/.test(qs)) return;
    if ((location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') && !/[?&]report=1\b/.test(qs)) return;

    // ---------- helpers (all defensive) ----------
    function g(name) { // read a top-level global (let/const/var/function) by name, safely
      try { return (0, eval)('typeof ' + name + " !== 'undefined' ? " + name + ' : undefined'); } catch (e) { return undefined; }
    }
    function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
    function fmt(d) {
      try {
        return d.toLocaleString('tr-TR', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) { try { return d.toString(); } catch (e2) { return ''; } }
    }
    function dur(ms) {
      var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), r = s % 60;
      return (m ? m + ' dk ' : '') + r + ' sn';
    }
    function dayNo() {
      var m = String(document.title || '').match(/Day\s*(\d+)/i);
      if (m) return m[1];
      m = String(location.pathname || '').match(/gun\s*(\d+)/i);
      if (m) return m[1];
      return '?';
    }
    function cfg() { var c = g('GAME_REPORT'); return (c && typeof c === 'object') ? c : {}; }

    // ---------- state ----------
    var DAY = dayNo();
    var GAME_TITLE = String(document.title || '');
    var round = { start: new Date(), state: 'playing', partialSent: false, clicks: 0 };
    var startedSent = false;
    var lastWriting = '';

    function totalQ() {
      var c = cfg(); if (num(c.total) !== null) return c.total;
      var t = num(g('total')); if (t !== null) return t;
      return null;
    }
    function correctN() {
      var c = cfg(); if (typeof c.correct === 'function') { try { return c.correct(); } catch (e) {} }
      return num(g('score'));
    }
    function wrongList() {
      var c = cfg(); if (typeof c.wrong === 'function') { try { return c.wrong() || []; } catch (e) {} }
      var w = g('wrong'); return (w && typeof w.length === 'number') ? w : [];
    }
    function speakN() { var c = cfg(); if (typeof c.speaking === 'function') { try { return c.speaking(); } catch (e) {} } return num(g('spk')); }
    function speakTotal() { var sp = g('SP'); return (sp && sp.length) ? sp.length : 3; }
    function answered() {
      var a = 0, s = correctN(), w = wrongList();
      if (s !== null) a = s + (w ? w.length : 0);
      var sk = speakN(); if (sk) a += sk;
      return Math.max(a, round.clicks);
    }

    function parseWrong(item) {
      try {
        if (item && typeof item === 'object') {
          return { q: String(item.q || item.question || ''), chosen: String(item.chosen || item.given || ''), correct: String(item.correct || item.answer || '') };
        }
        var s = String(item);
        var m = s.match(/^(.*?):\s(.*)\s\(Verdiği:\s(.*),\sDoğru:\s(.*)\)\s*$/);
        if (m) return { where: m[1], q: m[2], chosen: m[3], correct: m[4] };
        return { q: s, chosen: '', correct: '' };
      } catch (e) { return { q: String(item), chosen: '', correct: '' }; }
    }

    function finalScreenText() {
      try { var b = document.querySelector('[data-game-final], .big'); return b ? (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim() : ''; } catch (e) { return ''; }
    }

    function extraFields(fd) {
      var sk = speakN();
      if (sk !== null && sk !== undefined) fd.append('🎤 Konuşma', sk + '/' + speakTotal());
      if (lastWriting) fd.append('✏️ Yazdığı metin', lastWriting);
      var ph = g('phase'); if (typeof ph === 'string') fd.append('Aşama', ph);
      var c = cfg();
      if (c.extra) {
        try {
          var ex = typeof c.extra === 'function' ? c.extra() : c.extra;
          if (ex && typeof ex === 'object') {
            for (var key in ex) { if (Object.prototype.hasOwnProperty.call(ex, key)) fd.append(key, String(ex[key])); }
          } else if (ex) { fd.append('Ek bilgi', String(ex)); }
        } catch (e) {}
      }
    }

    function baseForm(subject, status) {
      var fd = new FormData();
      fd.append('_subject', subject);
      fd.append('_template', 'table');
      fd.append('_captcha', 'false');
      fd.append('Gün', 'Gün ' + DAY);
      fd.append('Oyun', GAME_TITLE);
      fd.append('Durum', status);
      return fd;
    }

    function post(fd, beacon) {
      try {
        if (beacon && navigator.sendBeacon) {
          if (navigator.sendBeacon(ENDPOINT, fd)) return;
        }
        if (window.fetch) {
          fetch(ENDPOINT, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' }, keepalive: true, mode: 'cors' })
            .catch(function () {});
        }
      } catch (e) {}
    }

    function scoreFields(fd, now) {
      var s = correctN(), w = wrongList(), t = totalQ();
      fd.append('Başlama', fmt(round.start));
      fd.append(now.label, fmt(now.date));
      fd.append('Süre', dur(now.date - round.start));
      fd.append('✅ Doğru', s === null ? '-' : String(s));
      fd.append('❌ Yanlış', String(w.length));
      fd.append('Toplam soru', t === null ? '-' : String(t));
      fd.append('Cevaplanan', String(answered()));
      if (!w.length) fd.append('Yanlışlar', s !== null && s > 0 ? 'Hepsi doğru 🎉' : 'Yok');
      for (var i = 0; i < w.length; i++) {
        var p = parseWrong(w[i]);
        fd.append('Yanlış ' + (i + 1), (p.where ? '[' + p.where + '] ' : '') + p.q + '  →  Verdiği: ' + (p.chosen || '?') + '  |  Doğru: ' + (p.correct || '?'));
      }
    }

    // ---------- reports ----------
    function sendStarted() {
      if (startedSent) return; startedSent = true;
      try {
        var fd = baseForm('▶️ Gün ' + DAY + ' başladı', 'Başladı ▶️');
        fd.append('Başlama', fmt(round.start));
        fd.append('Sayfa', location.href);
        post(fd, false);
      } catch (e) {}
    }

    function sendFinished() {
      try {
        var now = new Date(), s = correctN(), t = totalQ();
        var subj = '📚 Gün ' + DAY + ' bitti: ' + (s === null ? '?' : s) + '/' + (t === null ? '?' : t) + ' ✅';
        var sk = speakN(); if (sk !== null && sk !== undefined) subj += ' · 🎤 ' + sk + '/' + speakTotal();
        var fd = baseForm(subj, 'Bitti ✅');
        scoreFields(fd, { label: 'Bitiş', date: now });
        extraFields(fd);
        var ft = finalScreenText(); if (ft) fd.append('Sonuç ekranı', ft);
        post(fd, false);
      } catch (e) {}
    }

    function sendPartial() {
      try {
        if (round.state !== 'playing' || round.partialSent) return;
        if (answered() < 1) return;
        round.partialSent = true;
        var now = new Date(), t = totalQ();
        var subj = '⏸️ Gün ' + DAY + ' yarıda kaldı (' + answered() + '/' + (t === null ? '?' : t) + ')';
        var fd = baseForm(subj, 'Yarıda bıraktı ⏸️');
        scoreFields(fd, { label: 'Ayrılma', date: now });
        extraFields(fd);
        post(fd, true);
      } catch (e) {}
    }

    // ---------- final-screen detection ----------
    function isFinal() {
      try {
        if (document.querySelector('[data-game-final]')) return true;
        // every game's result screen shows the ❤️ mail() button
        return !!document.querySelector('[onclick*="mail()"]');
      } catch (e) { return false; }
    }
    function check() {
      try {
        if (isFinal()) {
          if (round.state !== 'finished') { round.state = 'finished'; sendFinished(); }
        } else if (round.state === 'finished') {
          // replay started: new round
          round = { start: new Date(), state: 'playing', partialSent: false, clicks: 0 }; lastWriting = '';
        }
      } catch (e) {}
    }

    // Public API for future games: GameReport.finished() forces a finished report
    window.GameReport = {
      finished: function () { try { if (round.state !== 'finished') { round.state = 'finished'; sendFinished(); } } catch (e) {} },
      restart: function () { round = { start: new Date(), state: 'playing', partialSent: false, clicks: 0 }; lastWriting = ''; },
      day: DAY
    };

    function init() {
      try {
        sendStarted();
        check();
        var target = document.body || document.documentElement;
        if (window.MutationObserver) {
          new MutationObserver(function () { check(); }).observe(target, { childList: true, subtree: true });
        }
        // count answer clicks (capture phase, before the game's own onclick disables buttons)
        document.addEventListener('click', function (ev) {
          try {
            var b = ev.target && ev.target.closest && ev.target.closest('button.opt, [data-answer]');
            if (b && !b.disabled && round.state === 'playing') round.clicks++;
          } catch (e) {}
        }, true);
        // remember free-writing text (Day 6 textarea) before the page re-renders
        document.addEventListener('input', function (ev) {
          try { var el = ev.target; if (el && el.tagName === 'TEXTAREA') lastWriting = String(el.value || '').slice(0, 2000); } catch (e) {}
        }, true);
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sendPartial(); });
        window.addEventListener('pagehide', sendPartial);
      } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  } catch (e) { /* silent */ }
})();
