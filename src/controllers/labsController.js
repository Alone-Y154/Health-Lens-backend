const errorResponse = require('../utils/errorResponse');
const { VALID_RANGES, normalizeCode, extractMarkersWithAI, OPENAI_API_KEY } = require('../utils/labs');

// Parse lab results and extract markers
async function parse(req, res) {
  const rid = req.rid;
  const { text, locale } = req.body || {};

  if (!text || typeof text !== 'string') {
    return errorResponse(res, rid, 'PARSE_FAILED', 'Missing or invalid text field', 400);
  }

  if (!OPENAI_API_KEY) {
    return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI API key not configured on server', 500);
  }

  const normalizeLocaleDecimals = (s) => {
    if (locale && locale.toLowerCase().startsWith('de')) {
      return s.replace(/(\d),(\d)/g, '$1.$2');
    }
    return s;
  };

  const cleanText = normalizeLocaleDecimals(text);

  try {
    const data = await extractMarkersWithAI(cleanText);

    console.log("OPENAI RAW RESPONSE >>>", JSON.stringify(data, null, 2));

    if (!data?.choices?.[0]?.message?.content) {
      throw new Error("No AI result");
    }

    let rawContent = data?.choices?.[0]?.message?.content;

    if (!rawContent) {
      console.error("OPENAI ERROR RESPONSE >>>", JSON.stringify(data, null, 2));
      throw new Error("No AI content received");
    }

    let aiJson;
    try {
      aiJson = JSON.parse(rawContent);
    } catch (err) {
      console.error("AI returned non JSON content >>>", rawContent);
      throw new Error("AI returned invalid JSON");
    }

    let markers = aiJson?.markers || [];

    markers = markers
      .map(m => {
        const code = normalizeCode(m.name || "");
        if (!code) return null;

        const value = Number(m.value);
        if (isNaN(value)) return null;

        if (value > 1900 && value < 2100) return null;

        const range = VALID_RANGES[code];
        if (range && (value < range[0] || value > range[1])) return null;

        return {
          name: m.name,
          code,
          value,
          unit: m.unit || "",
          refRange: m.refRange || null,
          flag: null,
          observedAt: null
        };
      })
      .filter(Boolean);

    if (markers.length === 0) {
      throw new Error("AI extraction empty or invalid");
    }

    return res.json({ markers });

  } catch (err) {
    console.error("AI Parse error → falling back regex", err.message);
    return errorResponse(res, rid, 'PARSE_FAILED', 'Unable to extract lab values', 422);
  }
}

module.exports = {
  parse
};
