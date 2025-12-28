const fs = require('fs');
const pdfParse = require('pdf-parse');
const errorResponse = require('../utils/errorResponse');
const { runTesseract, convertPdfToImagesAndOCR } = require('../utils/ocr');

// Extract text from images and PDFs
async function extract(req, res) {
  const rid = req.rid;
  if (!req.files || req.files.length === 0) return errorResponse(res, rid, 'UNSUPPORTED_FILE', 'No files uploaded', 400);

  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  const results = [];
  const filePaths = [];

  // Validate file type counts
  let pdfCount = 0;
  let imageCount = 0;
  for (const file of req.files) {
    if (file.mimetype === 'application/pdf') pdfCount++;
    else if (['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype)) imageCount++;
  }

  if (pdfCount > 1) return errorResponse(res, rid, 'UNSUPPORTED_FILE', 'Maximum 1 PDF allowed', 400);
  if (imageCount > 6) return errorResponse(res, rid, 'UNSUPPORTED_FILE', 'Maximum 6 images allowed', 400);

  try {
    for (const file of req.files) {
      const { mimetype, path: filePath, originalname } = file;
      filePaths.push(filePath);

      if (!allowed.includes(mimetype)) {
        results.push({ originalname, error: 'Unsupported file type', code: 'UNSUPPORTED_FILE' });
        continue;
      }

      try {
        if (mimetype === 'application/pdf') {
          const data = fs.readFileSync(filePath);
          const parsed = await pdfParse(data);
          let text = (parsed && parsed.text) ? parsed.text.trim() : '';
          const pages = parsed.numpages || parsed.numPages || (parsed.metadata && parsed.metadata.pages) || null;
          
          if (!text) {
            try {
              console.log('PDF is image-based, converting to images for OCR...');
              text = await convertPdfToImagesAndOCR(filePath, 10);
            } catch (ocrErr) {
              console.error('PDF OCR conversion error:', ocrErr && ocrErr.message);
            }
          }
          
          if (!text) {
            results.push({
              originalname,
              error: 'PDF is image-based. Please upload as JPG/PNG images for OCR.',
              code: 'OCR_FAILED'
            });
          } else {
            results.push({
              originalname,
              text,
              meta: {
                pages: pages || 1,
                engine: text.length > 100 ? 'pdf-parse' : 'tesseract'
              }
            });
          }
        } else {
          try {
            const text = await runTesseract(filePath);
            results.push({ originalname, text: (text || '').trim(), meta: { pages: 1, engine: 'tesseract' } });
          } catch (tesseractErr) {
            console.error('Tesseract error for file', originalname, tesseractErr && tesseractErr.message);
            results.push({ originalname, error: 'Unable to extract text from image', code: 'OCR_FAILED' });
          }
        }
      } catch (err) {
        console.error('OCR error for file', originalname, err && err.message);
        results.push({ originalname, error: 'Unable to extract text', code: 'OCR_FAILED' });
      }
    }

    console.log('OCR results:', JSON.stringify(results, null, 2));
    if (results.length === 0) return errorResponse(res, rid, 'OCR_FAILED', 'Unable to process any files', 500);
    return res.json({ files: results });
  } catch (err) {
    console.error('OCR error', err && err.message);
    return errorResponse(res, rid, 'OCR_FAILED', 'Unable to extract text', 500);
  } finally {
    for (const filePath of filePaths) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
  }
}

module.exports = {
  extract
};
