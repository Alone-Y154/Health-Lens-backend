const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { extract } = require('../controllers/ocrController');

// Multer setup
const upload = multer({
  dest: path.join(__dirname, '../../tmp_uploads'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// OCR extract endpoint
router.post('/extract', upload.array('file', 7), extract);

module.exports = router;
