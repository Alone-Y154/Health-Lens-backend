const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Detect platform and set paths
const isWindows = process.platform === 'win32';
const TESSERACT_PATH = isWindows 
  ? 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe' 
  : 'tesseract';

// Helper to run Tesseract OCR
function runTesseract(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(TESSERACT_PATH, [imagePath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', '3'], (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve((stdout || '').trim());
    });
  });
}

// Helper to convert PDF to images using Ghostscript and extract text via OCR
async function convertPdfToImagesAndOCR(pdfPath, maxPages = 10) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(__dirname, '../../tmp_uploads', `pdf_${Date.now()}`);
    
    try {
      // Create temp directory
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      // Use Ghostscript to convert PDF to PNG images
      const outputPattern = path.join(tmpDir, 'page_%d.png');
      const args = [
        '-q',
        '-dNOPAUSE',
        '-dBATCH',
        '-dSAFER',
        `-dLastPage=${maxPages}`,
        '-sDEVICE=png16m',
        '-r150',
        `-sOutputFile=${outputPattern}`,
        pdfPath
      ];
      
      // Use 'gs' on Linux/Docker, 'gswin64c' on Windows
      const gsCommand = isWindows ? 'gswin64c' : 'gs';
      execFile(gsCommand, args, async (error, stdout, stderr) => {
        if (error) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return reject(error);
        }
        
        try {
          // Get all PNG files created
          const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
          let combinedText = '';
          
          for (const file of files) {
            const imagePath = path.join(tmpDir, file);
            try {
              const pageText = await runTesseract(imagePath);
              combinedText += (pageText || '') + '\n';
            } catch (ocrErr) {
              console.error(`OCR error on ${file}:`, ocrErr && ocrErr.message);
            }
          }
          
          // Cleanup
          fs.rmSync(tmpDir, { recursive: true, force: true });
          resolve(combinedText.trim());
        } catch (err) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(err);
        }
      });
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    }
  });
}

module.exports = {
  runTesseract,
  convertPdfToImagesAndOCR,
  isWindows,
  TESSERACT_PATH
};
