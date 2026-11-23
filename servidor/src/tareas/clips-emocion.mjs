// Emoción de un clip: cuánto «pasa» en su audio y en lo que se dice. Sirve para premiar los clips con reacciones fuertes
// (gritos, risas, subidas de voz) frente a los planos y monótonos. Barato: solo lee el audio del clip y su transcripción.
//  · dinámica: diferencia entre los momentos más fuertes y el nivel típico (LU, sonoridad momentánea EBU R128);
//  · subidones: veces por minuto que la voz sube 8 LU o más sobre su nivel típico durante al menos 0,3 s;
//  · exclamaciones: risas, gritos e interjecciones por minuto en la transcripción.
import { execFile } from 'node:child_process';

const INTERJ = /^(ja(ja)+|je(je)+|jsj+|ajaj+|wow+|guau+|ostia+s?|hostia+s?|madre|dios|joder|co[ñn]o|uff+|ay+|oh+|ah+|buah+|brutal|incre[ií]ble|qu[eé]|no+|s[ií]+|vamos+|toma+|venga+|mierda|wtf|omg|bro)$/i;

const ebur = (f) => new Promise((ok) => {
  execFile('nice', ['-n', '5', 'ffmpeg', '-hide_banner', '-nostats', '-i', f, '-vn', '-af', 'ebur128=metadata=1,ametadata=print:key=lavfi.r128.M', '-f', 'null', '-'],
    { timeout: 180000, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      const M = [...String(stderr).matchAll(/lavfi\.r128\.M=(-?[\d.]+)/g)].map((m) => Number(m[1])).filter((x) => x > -70);
      ok(M);
    });
});
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

// archivo: el clip; palabras: [{ w }] de su transcripción (opcional). Devuelve { emocion 0–100, detalle }.
export async function emocionClip(archivo, palabras = []) {
  const M = await ebur(archivo); // ~10 valores por segundo
  const dur = M.length / 10 || 1;
  const tipico = pct(M, 0.5), fuerte = pct(M, 0.95), dinamica = Math.max(0, fuerte - tipico);
  let subidones = 0, racha = 0;
  for (const x of M) { if (x >= tipico + 8) racha++; else { if (racha >= 3) subidones++; racha = 0; } }
  if (racha >= 3) subidones++;
  const excl = palabras.filter((p) => INTERJ.test(String(p.w || '').replace(/[^\p{L}]/gu, '')) || /[!¡]/.test(p.w || '')).length;
  const porMin = (x) => x / (dur / 60);
  const emocion = Math.round(Math.min(50, Math.max(0, (dinamica - 4) / 12 * 50)) + Math.min(30, porMin(subidones) / 8 * 30) + Math.min(20, porMin(excl) / 10 * 20));
  return { emocion, detalle: { dinamica: +dinamica.toFixed(1), subidones, exclamaciones: excl, segundos: Math.round(dur) } };
}
