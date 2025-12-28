const express = require('express');
const router = express.Router();
const { healthz, validateKey } = require('../controllers/systemController');

// Health check endpoint
router.get('/healthz', healthz);

// Validate API key endpoint
router.post('/validate-key', validateKey);

module.exports = router;
