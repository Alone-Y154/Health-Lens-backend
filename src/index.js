require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

// Import routes aggregator
const apiRoutes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Check for required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY not set in environment variables');
}

// ===== MIDDLEWARE =====

// JSON parsing
app.use(express.json({ limit: '1mb' }));

// Trust Render's reverse proxy for getting real client IP
app.set('trust proxy', 1);

// Rate limiter: 10 requests per minute per IP
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 6, // limit each IP to 6 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  statusCode: 429,
  keyGenerator: (req) => req.ip,
  handler: (req, res, next, options) => {
    // Custom handler when rate limit is exceeded (express-rate-limit v7)
    console.warn(`Rate limit reached for IP: ${req.ip}`);
    res.status(options.statusCode).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: options.message
      },
      rid: req.rid
    });
  }
});

// Apply rate limiter to all routes
app.use(limiter);

// Request ID and logging middleware
app.use((req, res, next) => {
  const rid = uuidv4();
  req.rid = rid;
  const start = Date.now();

  res.once('finish', () => {
    const duration = Date.now() - start;
    // Only log safe, non-PHI fields
    console.log(JSON.stringify({ rid, endpoint: req.originalUrl, status: res.statusCode, duration }));
  });

  next();
});

// ===== ROUTES =====
app.use('/', apiRoutes);

// ===== ERROR HANDLERS =====

// Generic 404
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' }, rid: req.rid });
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err && err.stack);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, rid: req.rid });
});

// ===== STARTUP =====

// Ensure tmp_uploads directory exists
try {
  fs.mkdirSync(path.join(__dirname, '../tmp_uploads'), { recursive: true });
} catch (e) {}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
