const fetch = require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Parse reference range string to low/high values
function parseRefRange(ref) {
  if (!ref || typeof ref !== 'string') return { low: null, high: null };
  const txt = ref.replace(/\s/g, '');
  if (/^(\d+(\.\d+)?)[-–](\d+(\.\d+)?)$/.test(txt)) {
    const parts = txt.split(/[-–]/).map(n => parseFloat(n));
    return { low: parts[0], high: parts[1] };
  }
  if (/^<\d+(\.\d+)?$/.test(txt)) return { low: null, high: parseFloat(txt.replace('<', '')) };
  if (/^>\d+(\.\d+)?$/.test(txt)) return { low: parseFloat(txt.replace('>', '')), high: null };
  const toMatch = txt.match(/^(\d+(\.\d+)?)to(\d+(\.\d+)?)$/i);
  if (toMatch) return { low: parseFloat(toMatch[1]), high: parseFloat(toMatch[3]) };
  return { low: null, high: null };
}

// Compute marker status based on value and ref range
function computeMarkerStatus(m) {
  if (m.value == null || m.refRange == null) return { status: 'unknown', confidence: 'low' };
  const { low, high } = parseRefRange(String(m.refRange));
  if (low === null && high === null) return { status: 'unknown', confidence: 'medium' };

  const v = Number(m.value);
  if (Number.isNaN(v)) return { status: 'unknown', confidence: 'low' };

  if (high !== null && v > high) return { status: 'high', confidence: 'high' };
  if (low !== null && v < low) return { status: 'low', confidence: 'high' };
  return { status: 'normal', confidence: 'high' };
}

// Apply clinical weighting based on marker codes and values
function applyClinicalWeighting(m) {
  let severity = 'none';
  let urgency = 'routine';
  let recommendedRecheckDays = 180;
  let immediateAttention = false;

  if (m.status === 'high' || m.status === 'low') severity = 'mild';

  // HbA1c
  if (m.code === 'HBA1C') {
    if (m.value >= 6.5) { severity = 'moderate'; urgency = 'soon'; recommendedRecheckDays = 90; }
    if (m.value >= 8.0) { severity = 'significant'; urgency = 'prompt'; recommendedRecheckDays = 30; immediateAttention = true; }
  }

  // LDL
  if (m.code === 'LDL') {
    if (m.value >= 160) { severity = 'moderate'; urgency = 'soon'; recommendedRecheckDays = 90; }
    if (m.value >= 190) { severity = 'significant'; urgency = 'prompt'; recommendedRecheckDays = 30; immediateAttention = true; }
  }

  // Creatinine
  if (m.code === 'CREAT') {
    if (m.status === 'high') { severity = 'significant'; urgency = 'prompt'; recommendedRecheckDays = 7; immediateAttention = true; }
  }

  // Hemoglobin
  if (m.code === 'HB' && m.status === 'low') {
    severity = 'moderate';
    urgency = 'soon';
    recommendedRecheckDays = 30;
  }

  // WBC
  if (m.code === 'WBC' && m.status !== 'normal') {
    severity = 'moderate';
    urgency = 'soon';
    recommendedRecheckDays = 30;
  }

  let color = '#9CA3AF';
  let icon = 'check-circle';
  if (severity === 'mild') { color = '#F59E0B'; icon = 'alert-circle'; }
  if (severity === 'moderate') { color = '#F97316'; icon = 'alert-triangle'; }
  if (severity === 'significant') { color = '#EF4444'; icon = 'alert-octagon'; }

  return { severity, urgency, recommendedRecheckDays, immediateAttention, ui: { color, icon } };
}

// Generate AI summary
async function generateAISummary(enrichedMarkers, overallRecommendation, overallConfidence, language, disclaimer, legalNotice) {
  const systemPrompt = `
You are HealthLens AI — generate a friendly, medically cautious explanation.

STRICT RULES:
- Use ONLY the provided markers (values/status/severity/urgency/confidence).
- DO NOT diagnose or prescribe.
- Use cautious language (e.g., "may suggest", "is often associated with").
- Output JSON only and EXACTLY in the schema requested.
`;

  const userPrompt = `
Language: ${language}
Markers (enriched): ${JSON.stringify(enrichedMarkers)}
OverallRecommendation: ${overallRecommendation}
OverallConfidence: ${overallConfidence}
Disclaimer: ${disclaimer}
LegalNotice: ${legalNotice}

Return EXACT JSON schema:
{
  "overallSummary": "",
  "keyObservations": [],
  "markerExplanations": [
    { "name":"", "whatItMeasures":"", "whatItSuggests":"", "whyItMatters":"" }
  ],
  "wellnessConsiderations": [],
  "whenToSeekAdvice": [],
  "disclaimer": "",
  "legalNotice": ""
}
`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 1200
    })
  });

  return await r.json();
}

module.exports = {
  parseRefRange,
  computeMarkerStatus,
  applyClinicalWeighting,
  generateAISummary,
  OPENAI_API_KEY
};
