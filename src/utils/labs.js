const fetch = require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Lab marker validation ranges
const VALID_RANGES = {
  HBA1C: [3, 20],
  GLU: [40, 600],
  CHOL: [80, 400],
  LDL: [20, 250],
  HDL: [20, 120],
  TG: [40, 800],
  CREAT: [0.2, 10],
  TSH: [0.01, 100],
  HB: [4, 20],
  WBC: [2000, 30000],
  PLT: [20000, 800000]
};

// Normalize lab marker codes
function normalizeCode(name) {
  name = name.toLowerCase();
  if (name.includes("hba1c")) return "HBA1C";
  if (name.includes("fasting") || name.includes("glucose")) return "GLU";
  if (name.includes("ldl")) return "LDL";
  if (name.includes("hdl")) return "HDL";
  if (name.includes("trig")) return "TG";
  if (name.includes("chol")) return "CHOL";
  if (name.includes("creat")) return "CREAT";
  if (name.includes("tsh")) return "TSH";
  if (name.includes("hb")) return "HB";
  if (name.includes("wbc")) return "WBC";
  if (name.includes("plate")) return "PLT";
  return null;
}

// Call OpenAI for lab marker extraction
async function extractMarkersWithAI(cleanText) {
  const openaiRes = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You are a medical lab result extraction engine.
STRICT RULES:
- Extract ONLY real lab markers that actually appear.
- NEVER guess or hallucinate values.
- Ignore narratives, diagnosis, discussion, ECG, echo, ultrasound text.
- Prefer numerical result column, NOT reference or date.
- Use ONLY values explicitly present in lab report.
- If unsure -> do not include marker.
- Return ONLY JSON.

Output structure:
{
 "markers": [
  {
    "name": "Human readable name",
    "code": "STANDARD_CODE",
    "value": number,
    "unit": "exact unit text",
    "refRange": "raw visible ref text or null"
  }
 ]
}

Allowed markers ONLY:
HbA1c, Glucose fasting, Glucose PP, Cholesterol, LDL, HDL, Triglycerides, Creatinine, Urea, TSH, CBC – Hb, RBC, Platelets, WBC.
`
          },
          {
            role: "user",
            content: cleanText
          }
        ],
        temperature: 0
      })
    }
  );

  const data = await openaiRes.json();
  return data;
}

module.exports = {
  VALID_RANGES,
  normalizeCode,
  extractMarkersWithAI,
  OPENAI_API_KEY
};
