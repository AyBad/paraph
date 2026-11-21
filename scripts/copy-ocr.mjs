// Copies the OCR engine (tesseract.js) and the French language data into public/ocr so the app works offline.
import fs from 'fs';
const out = 'public/ocr';
fs.mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz', 'fra.traineddata.gz']
];
for (const [src, dst] of files) {
  const d = `${out}/${dst}`;
  if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(src).size) fs.copyFileSync(src, d);
}
console.log('OCR assets ready');
