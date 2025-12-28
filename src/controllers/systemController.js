const fetch = require('node-fetch');
const errorResponse = require('../utils/errorResponse');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Health check endpoint
async function healthz(req, res) {
  return res.json({ ok: true });
}

// Validate OpenAI API key
async function validateKey(req, res) {
  const rid = req.rid;
  if (!OPENAI_API_KEY) return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI API key not configured on server', 500);

  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } });
    if (r.ok) return res.json({ valid: true });
    return res.status(401).json({ error: { code: 'INVALID_KEY', message: 'OpenAI rejected the API key' }, rid });
  } catch (err) {
    console.error('validate-key error', err && err.message);
    return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI validation failed', 401);
  }
}

module.exports = {
  healthz,
  validateKey
};
