const express = require('express');
const router = express.Router();

const systemRoutes = require('./systemRoutes');
const ocrRoutes = require('./ocrRoutes');
const labsRoutes = require('./labsRoutes');
const nlpRoutes = require('./nlpRoutes');

// Mount all routes
router.use('/system', systemRoutes);
router.use('/ocr', ocrRoutes);
router.use('/labs', labsRoutes);
router.use('/nlp', nlpRoutes);

module.exports = router;
