const express = require('express');
const router = express.Router();
const { summary } = require('../controllers/nlpController');

// NLP summary endpoint
router.post('/summary', summary);

module.exports = router;
