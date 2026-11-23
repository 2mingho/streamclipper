/*
 * Convierte el manual en PDF:
 *   node docs/manual/generar.cjs
 * Necesita las dependencias del servidor (cd servidor && npm install) y Chromium o Chrome instalado.
 * El navegador se elige con CHROMIUM=/ruta (por defecto /usr/bin/chromium).
 * Con REVISION=<carpeta> guarda además una imagen de cada página para revisarla.
 */
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { createRequire } = require("module");
const { chromium } = createRequire(path.join(__dirname, "../../servidor/package.json"))("playwright-core");

const HTML = path.join(__dirname, "primeros-pasos.html");
const PDF = path.join(__dirname, "StreamClipper-Primeros-pasos.pdf");

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/usr/bin/chromium" });
  const p = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.5 });
  await p.goto(pathToFileURL(HTML).href, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: PDF, preferCSSPageSize: true, printBackground: true });

  // Nada puede pasar del pie de su página ni quedar debajo de la banda amarilla.
  const desbordes = await p.evaluate(() => [...document.querySelectorAll(".pag")].flatMap((s, i) => {
    const pie = s.querySelector(".folio")?.getBoundingClientRect().top ?? s.getBoundingClientRect().bottom;
    const banda = s.querySelector(".banda")?.getBoundingClientRect().top ?? pie;
    return [...s.children].filter((e) => !e.classList.contains("folio") && !e.classList.contains("banda"))
      .filter((e) => e.getBoundingClientRect().bottom > Math.min(pie, banda) + 1)
      .map((e) => `pág. ${i + 1}: ${e.tagName}.${e.className} acaba en ${Math.round(e.getBoundingClientRect().bottom)} (límite ${Math.round(Math.min(pie, banda))})`);
  }));
  // Fuentes de verdad: Barlow cargada.
  const barlow = await p.evaluate(() => document.fonts.check("600 12pt Barlow"));
  console.log(desbordes.length ? desbordes.join("\n") : "sin desbordes", "·", barlow ? "Barlow cargada" : "Barlow NO cargada");

  const revision = process.env.REVISION;
  if (revision) {
    fs.mkdirSync(revision, { recursive: true });
    const paginas = await p.locator(".pag").all();
    for (let i = 0; i < paginas.length; i++) await paginas[i].screenshot({ path: path.join(revision, `pagina-${i + 1}.png`) });
  }
  await b.close();
  console.log(`PDF: ${PDF}`);
})().catch((e) => { console.error(e); process.exit(1); });
