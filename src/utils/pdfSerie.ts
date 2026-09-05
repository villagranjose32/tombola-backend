import PDFDocument from "pdfkit";
import { Response } from "express";
import { GrillaCarton } from "./bingoGenerator";

interface CartonParaPdf {
  posicion: number;
  contenido: GrillaCarton;
}

/** Dibuja un cartón (3x9) en la posición de página actual y devuelve el doc para encadenar. */
function dibujarCarton(doc: PDFKit.PDFDocument, carton: CartonParaPdf, x: number, y: number) {
  const anchoTotal = 460;
  const alto = 90;
  const colAncho = anchoTotal / 9;
  const filaAlto = alto / 3;

  doc.rect(x, y, anchoTotal, alto).stroke();
  doc
    .fontSize(9)
    .text(`Cartón ${carton.posicion}`, x, y - 14);

  carton.contenido.forEach((fila, filaIdx) => {
    fila.forEach((celda, colIdx) => {
      const cellX = x + colIdx * colAncho;
      const cellY = y + filaIdx * filaAlto;
      doc.rect(cellX, cellY, colAncho, filaAlto).stroke();
      if (celda !== null) {
        doc
          .fontSize(12)
          .text(String(celda), cellX, cellY + filaAlto / 2 - 6, {
            width: colAncho,
            align: "center",
          });
      }
    });
  });
}

export function generarPdfSerie(
  res: Response,
  datos: { tituloSorteo: string; numeroSerie: number; cartones: CartonParaPdf[] }
) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="serie-${datos.numeroSerie}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(datos.tituloSorteo, { align: "center" });
  doc.fontSize(12).fillColor("#555").text(`Serie N.º ${String(datos.numeroSerie).padStart(3, "0")}`, {
    align: "center",
  });
  doc.moveDown(2);
  doc.fillColor("#000");

  let y = doc.y;
  const espacioEntreCartones = 120;

  for (const carton of datos.cartones) {
    if (y + 100 > doc.page.height - 40) {
      doc.addPage();
      y = 60;
    }
    dibujarCarton(doc, carton, 60, y + 14);
    y += espacioEntreCartones;
  }

  doc.end();
}
