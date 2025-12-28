const express = require('express');
const router = express.Router();
const { parse } = require('../controllers/labsController');

// Lab parsing endpoint
router.post('/parse', parse);

module.exports = router;
