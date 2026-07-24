/** Genera PDF simple (texto) para descargas del asistente. */

import PDFDocument from "pdfkit";
import fs from "node:fs";

function stripMd(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/\|/g, " ")
    .replace(/-{3,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function buildPdfBuffer(opts: {
  title: string;
  body: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: {
      Title: opts.title,
      Author: "Asistente CMU 2027",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header with system font if available (accents)
  const fontCandidates = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
  ];
  const fontPath = fontCandidates.find((f) => fs.existsSync(f));
  if (fontPath) {
    doc.registerFont("Body", fontPath);
    doc.font("Body");
  }

  doc
    .fillColor("#001850")
    .fontSize(16)
    .text("Colegio Mexicano de Urología Nacional", { continued: false });
  doc
    .fillColor("#3a6bb5")
    .fontSize(11)
    .text("Asistente · 50° Congreso 2026", { continued: false });
  doc.moveDown(0.4);
  doc
    .strokeColor("#001850")
    .lineWidth(1)
    .moveTo(54, doc.y)
    .lineTo(558, doc.y)
    .stroke();
  doc.moveDown(0.8);

  doc.fillColor("#001850").fontSize(13).text(opts.title, { continued: false });
  doc.moveDown(0.5);

  const text = stripMd(opts.body || "");
  doc.fillColor("#0c1830").fontSize(10).text(text, {
    align: "left",
    lineGap: 3,
  });

  doc.moveDown(1.2);
  doc
    .fillColor("#5c6b82")
    .fontSize(8)
    .text(
      `Generado ${new Date().toLocaleString("es-MX")} · Uso educativo · Asistente CMU 2027`,
      { align: "left" }
    );

  doc.end();
  return done;
}
