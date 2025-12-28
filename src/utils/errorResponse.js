// Helper for error responses
function errorResponse(res, rid, code, message, status = 500) {
  return res.status(status).json({ error: { code, message }, rid });
}

module.exports = errorResponse;
