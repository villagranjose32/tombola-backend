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
  generarPdfSeries(res, { tituloSorteo: datos.tituloSorteo, series: [datos] });
}

export function generarPdfSeries(res: Response, datos: {
  tituloSorteo: string;
  series: Array<{ numeroSerie: number; cartones: CartonParaPdf[] }>;
}) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  const nombre = datos.series.length === 1 ? `serie-${datos.series[0].numeroSerie}` : "mis-cartones";
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}.pdf"`);
  doc.pipe(res);
  datos.series.forEach((serie, indice) => {
    if (indice) doc.addPage();
    const encabezado = () => {
      doc.fillColor("#000").fontSize(18).text(datos.tituloSorteo, 40, 40, { align: "center" });
      doc.fontSize(12).fillColor("#555").text(`Serie N.º ${String(serie.numeroSerie).padStart(3, "0")}`, { align: "center" });
      doc.moveDown(2); doc.fillColor("#000");
      return doc.y;
    };
    let y = encabezado();
    for (const carton of serie.cartones) {
      if (y + 114 > doc.page.height - 40) { doc.addPage(); y = encabezado(); }
      dibujarCarton(doc, carton, 60, y + 14);
      y += 120;
    }
  });
  doc.end();
}
