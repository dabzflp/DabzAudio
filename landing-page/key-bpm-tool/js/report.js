/**
 * report.js
 *
 * On-demand, downloadable PDF analysis report. Fully additive: it does not
 * touch the upload/BPM/Live flows. It simply holds the latest results and,
 * only when the user clicks "Download report", lazy-loads the PDF library and
 * builds a DabzAudio-branded PDF. Nothing heavy runs until the button is
 * clicked, so it costs no extra memory while idle.
 */
(function () {
  'use strict';

  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var LOGO_URL = '../assets/img/logo.png';

  // Latest results captured from the page.
  var state = {
    file: null, // { name, key, camelot, confidence, bpm }
    live: null, // { key, camelot }
  };

  var btn = null;
  var labelEl = null;
  var jsPdfPromise = null;
  var logoPromise = null;

  function hasData() {
    return Boolean(state.file || state.live);
  }

  function updateButton() {
    if (!btn) return;
    btn.style.display = hasData() ? '' : 'none';
  }

  function setFileResult(data) {
    state.file = data && (data.key || data.bpm) ? data : null;
    updateButton();
  }

  function setLiveResult(data) {
    state.live = data && data.key ? data : null;
    updateButton();
  }

  // ---- Lazy loaders (only run on first download click) ----
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load PDF library')); };
      document.head.appendChild(s);
    });
  }

  function ensureJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfPromise) {
      jsPdfPromise = loadScript(JSPDF_URL).then(function () {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF library unavailable');
        return window.jspdf.jsPDF;
      });
    }
    return jsPdfPromise;
  }

  function ensureLogo() {
    if (!logoPromise) {
      logoPromise = fetch(LOGO_URL)
        .then(function (r) { return r.ok ? r.blob() : Promise.reject(new Error('no logo')); })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () {
              var dataUrl = reader.result;
              var img = new Image();
              img.onload = function () { resolve({ dataUrl: dataUrl, w: img.naturalWidth, h: img.naturalHeight }); };
              img.onerror = function () { resolve({ dataUrl: dataUrl, w: 0, h: 0 }); };
              img.src = dataUrl;
            };
            reader.onerror = function () { resolve(null); };
            reader.readAsDataURL(blob);
          });
        })
        .catch(function () { return null; });
    }
    return logoPromise;
  }

  // ---- Formatting helpers ----
  function fmtPct(c) {
    if (typeof c !== 'number' || !isFinite(c)) return null;
    var p = c <= 1 ? c * 100 : c;
    p = Math.max(0, Math.min(100, p));
    return Math.round(p) + '%';
  }

  function timestamp() {
    var d = new Date();
    try {
      return d.toLocaleString();
    } catch (e) {
      return d.toString();
    }
  }

  // ---- PDF build ----
  function buildPdf(jsPDF, logo) {
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var margin = 16;

    // Header band (charcoal) + orange accent line
    doc.setFillColor(43, 43, 43);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setFillColor(255, 122, 0);
    doc.rect(0, 30, pageW, 1.6, 'F');

    var textX = margin;
    if (logo && logo.dataUrl) {
      var logoH = 15;
      var logoW = logo.w && logo.h ? (logo.w / logo.h) * logoH : 15;
      doc.addImage(logo.dataUrl, 'PNG', margin, 7.5, logoW, logoH);
      textX = margin + logoW + 6;
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('DabzAudio', textX, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(255, 122, 0);
    doc.text('Audio Analysis Report', textX, 24);

    var y = 44;
    doc.setTextColor(120, 120, 120);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Generated ' + timestamp(), margin, y);
    y += 12;

    // ---- Breakdown ----
    y = sectionTitle(doc, 'Breakdown', margin, y);

    if (state.file) {
      y = subTitle(doc, 'Track Analysis', margin, y);
      if (state.file.name) y = row(doc, 'Source file', state.file.name, margin, y);
      if (state.file.bpm != null && state.file.bpm !== 'Unknown') {
        y = row(doc, 'Estimated tempo', String(state.file.bpm) + ' BPM', margin, y);
      }
      if (state.file.key && state.file.key !== 'Unknown') {
        y = row(doc, 'Detected key', state.file.key, margin, y);
      }
      if (state.file.camelot) y = row(doc, 'Camelot', state.file.camelot, margin, y);
      var conf = fmtPct(state.file.confidence);
      if (conf) y = row(doc, 'Confidence', conf, margin, y);
      y += 4;
    }

    if (state.live) {
      y = subTitle(doc, 'Live Detection', margin, y);
      if (state.live.key && state.live.key !== 'Unknown') {
        y = row(doc, 'Detected key', state.live.key, margin, y);
      }
      if (state.live.camelot) y = row(doc, 'Camelot', state.live.camelot, margin, y);
      y += 4;
    }

    // ---- Final result ----
    y += 4;
    var fr = finalResult();
    var boxX = margin;
    var boxW = pageW - margin * 2;
    var boxH = 38;
    doc.setFillColor(43, 43, 43);
    doc.roundedRect(boxX, y, boxW, boxH, 3, 3, 'F');
    doc.setFillColor(255, 122, 0);
    doc.rect(boxX, y, 2.4, boxH, 'F');

    doc.setTextColor(255, 122, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('FINAL RESULT', boxX + 10, y + 11);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    var col1 = boxX + 10;
    var col2 = boxX + boxW / 2 + 4;
    if (fr.key) {
      doc.setTextColor(155, 155, 155);
      doc.setFontSize(9);
      doc.text('KEY', col1, y + 21);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(fr.key, col1, y + 31);
      doc.setFont('helvetica', 'normal');
    }
    if (fr.bpm) {
      doc.setTextColor(155, 155, 155);
      doc.setFontSize(9);
      doc.text('BPM', col2, y + 21);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(fr.bpm, col2, y + 31);
      doc.setFont('helvetica', 'normal');
    }

    // Footer
    var pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(225, 225, 225);
    doc.line(margin, pageH - 16, pageW - margin, pageH - 16);
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(9);
    doc.text('DabzAudio - Key & BPM Finder', margin, pageH - 10);

    return doc;
  }

  function finalResult() {
    var key = null;
    var bpm = null;
    if (state.file) {
      if (state.file.key && state.file.key !== 'Unknown') key = state.file.key;
      if (state.file.bpm != null && state.file.bpm !== 'Unknown') bpm = String(state.file.bpm);
    }
    if (!key && state.live && state.live.key && state.live.key !== 'Unknown') {
      key = state.live.key;
    }
    return { key: key, bpm: bpm };
  }

  function sectionTitle(doc, text, x, y) {
    doc.setTextColor(43, 43, 43);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(text, x, y);
    doc.setDrawColor(255, 122, 0);
    doc.setLineWidth(0.6);
    doc.line(x, y + 2.5, x + 28, y + 2.5);
    doc.setLineWidth(0.2);
    return y + 11;
  }

  function subTitle(doc, text, x, y) {
    doc.setTextColor(255, 122, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(text, x, y);
    return y + 8;
  }

  function row(doc, label, value, x, y) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(110, 110, 110);
    doc.text(String(label), x + 2, y);
    doc.setTextColor(40, 40, 40);
    doc.setFont('helvetica', 'bold');
    var valX = x + 52;
    var maxW = doc.internal.pageSize.getWidth() - valX - 16;
    var lines = doc.splitTextToSize(String(value), maxW);
    doc.text(lines, valX, y);
    return y + 7 + (lines.length - 1) * 6;
  }

  function fileBaseName() {
    if (state.file && state.file.name) {
      return state.file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40);
    }
    return 'analysis';
  }

  function setBusy(busy) {
    if (!btn) return;
    btn.disabled = busy;
    if (labelEl) labelEl.textContent = busy ? 'Preparing…' : 'Download report';
  }

  function onDownload() {
    if (!hasData()) return;
    setBusy(true);
    Promise.all([ensureJsPdf(), ensureLogo()])
      .then(function (results) {
        var jsPDF = results[0];
        var logo = results[1];
        var doc = buildPdf(jsPDF, logo);
        doc.save('DabzAudio-Report-' + fileBaseName() + '.pdf');
      })
      .catch(function (err) {
        console.error('Report generation failed:', err);
        alert('Could not generate the report. Please check your connection and try again.');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    btn = document.getElementById('downloadReportBtn');
    if (btn) {
      labelEl = btn.querySelector('.download-report-label');
      btn.addEventListener('click', onDownload);
    }
    updateButton();
  });

  window.dabzReport = {
    setFileResult: setFileResult,
    setLiveResult: setLiveResult,
  };
})();
