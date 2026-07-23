/**
 * invoice-pdf.js
 *
 * On-demand, client-side invoice PDF. The PDF is built in the browser only when
 * the user clicks "Download" (jsPDF is lazy-loaded from a CDN on first use), so
 * the server does zero rendering work — no extra CPU/memory on the backend.
 *
 * Works for both parties, registered or not: the public invoice page and the
 * signed-in owner panel both call window.LBInvoicePDF.download(invoice).
 */
(function () {
  "use strict";

  var JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  var jsPdfPromise = null;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Failed to load PDF library")); };
      document.head.appendChild(s);
    });
  }

  function ensureJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfPromise) {
      jsPdfPromise = loadScript(JSPDF_URL).then(function () {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("PDF library unavailable");
        return window.jspdf.jsPDF;
      });
    }
    return jsPdfPromise;
  }

  function money(cents, currency) {
    var cur = String(currency || "gbp").toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format((Number(cents) || 0) / 100);
    } catch (e) {
      return cur + " " + ((Number(cents) || 0) / 100).toFixed(2);
    }
  }

  function statusLabel(st) {
    if (st === "honored") return "PAID";
    if (st === "awaiting_confirmation") return "AWAITING CONFIRMATION";
    if (st === "cancelled") return "CANCELLED";
    return "UNPAID";
  }

  function dateStr(d) {
    if (!d) return "";
    try { return new Date(d).toLocaleDateString(); } catch (e) { return String(d); }
  }

  function build(jsPDF, inv) {
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    var pageW = doc.internal.pageSize.getWidth();
    var margin = 16;
    var cur = inv.currency || "gbp";
    var y = 0;

    // Header band + orange accent.
    doc.setFillColor(43, 43, 43);
    doc.rect(0, 0, pageW, 26, "F");
    doc.setFillColor(255, 122, 0);
    doc.rect(0, 26, pageW, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("DabzAudio", margin, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(255, 122, 0);
    doc.text("INVOICE", pageW - margin, 16, { align: "right" });

    y = 40;
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(String(inv.number || "Invoice"), margin, y);

    // Status pill (right aligned).
    var st = statusLabel(inv.status);
    doc.setFontSize(10);
    if (inv.status === "honored") doc.setTextColor(30, 150, 70);
    else if (inv.status === "cancelled") doc.setTextColor(200, 60, 60);
    else doc.setTextColor(190, 130, 20);
    doc.text(st, pageW - margin, y, { align: "right" });

    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    if (inv.fromName) { doc.text("From: " + inv.fromName, margin, y); y += 5; }
    var billTo = inv.toName || inv.toEmail || "";
    if (billTo) { doc.text("Billed to: " + billTo, margin, y); y += 5; }
    if (inv.createdAt) { doc.text("Issued: " + dateStr(inv.createdAt), margin, y); y += 5; }
    if (inv.dueDate) { doc.text("Due: " + dateStr(inv.dueDate), margin, y); y += 5; }

    y += 4;
    // Items table header.
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y, pageW - margin * 2, 8, "F");
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Description", margin + 2, y + 5.5);
    doc.text("Qty", pageW - margin - 78, y + 5.5, { align: "right" });
    doc.text("Unit", pageW - margin - 42, y + 5.5, { align: "right" });
    doc.text("Amount", pageW - margin - 2, y + 5.5, { align: "right" });
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    (inv.items || []).forEach(function (it) {
      var lineTotal = Math.round((Number(it.quantity) || 0) * (Number(it.unitCents) || 0));
      var descLines = doc.splitTextToSize(String(it.description || ""), pageW - margin * 2 - 86);
      var rowH = Math.max(7, descLines.length * 5 + 2);
      if (y + rowH > 270) { doc.addPage(); y = 20; }
      doc.text(descLines, margin + 2, y + 5);
      doc.text(String(it.quantity), pageW - margin - 78, y + 5, { align: "right" });
      doc.text(money(it.unitCents, cur), pageW - margin - 42, y + 5, { align: "right" });
      doc.text(money(lineTotal, cur), pageW - margin - 2, y + 5, { align: "right" });
      y += rowH;
      doc.setDrawColor(235, 235, 235);
      doc.line(margin, y, pageW - margin, y);
    });

    y += 6;
    var labelX = pageW - margin - 60;
    var valX = pageW - margin - 2;
    function totalRow(label, value, bold) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setTextColor(bold ? 20 : 90, bold ? 20 : 90, bold ? 20 : 90);
      doc.text(label, labelX, y, { align: "right" });
      doc.text(value, valX, y, { align: "right" });
      y += 6;
    }
    totalRow("Subtotal", money(inv.subtotalCents, cur), false);
    if (inv.taxMode === "exclusive" && inv.taxRateBps > 0) {
      totalRow((inv.taxLabel || "VAT") + " (" + (inv.taxRateBps / 100) + "%)", money(inv.taxCents, cur), false);
    } else if (inv.taxMode === "inclusive" && inv.taxRateBps > 0) {
      totalRow("Includes " + (inv.taxLabel || "VAT") + " (" + (inv.taxRateBps / 100) + "%)", money(inv.taxCents, cur), false);
    }
    doc.setDrawColor(255, 122, 0);
    doc.line(labelX - 10, y - 2, valX, y - 2);
    totalRow(inv.status === "honored" ? "Total paid" : "Total due", money(inv.totalCents, cur), true);

    if (inv.note) {
      y += 4;
      doc.setFont("helvetica", "italic");
      doc.setTextColor(90, 90, 90);
      doc.setFontSize(9);
      var noteLines = doc.splitTextToSize("Note: " + inv.note, pageW - margin * 2);
      doc.text(noteLines, margin, y);
      y += noteLines.length * 4.5;
    }

    // Footer fineprint.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    var fine = "Invoicing tool provided by DabzAudio. Payments are processed securely by Stripe (cards) or Paystack (Naira). " +
      "Any tax shown is set by the sender and is their responsibility — DabzAudio is not the merchant of record or a tax adviser.";
    doc.text(doc.splitTextToSize(fine, pageW - margin * 2), margin, 285);

    return doc;
  }

  function download(inv) {
    if (!inv) return Promise.reject(new Error("No invoice"));
    return ensureJsPdf().then(function (jsPDF) {
      var doc = build(jsPDF, inv);
      var name = String(inv.number || "invoice").replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";
      doc.save(name);
    });
  }

  window.LBInvoicePDF = { download: download };
})();
