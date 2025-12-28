const errorResponse = require('../utils/errorResponse');
const { parseRefRange, computeMarkerStatus, applyClinicalWeighting, generateAISummary, OPENAI_API_KEY } = require('../utils/nlp');

// Generate AI summary for lab results
async function summary(req, res) {
  const rid = req.rid;

  if (!OPENAI_API_KEY) return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI API key not configured on server', 500);

  const { markers = [], language = 'en', ocrText = null } = req.body || {};
  if (!Array.isArray(markers) || markers.length === 0)
    return errorResponse(res, rid, 'AI_FAILED', 'Missing markers', 400);

  const DISCLAIMER = 'This summary is for educational purposes only and is not a medical diagnosis or treatment recommendation.';
  const LEGAL_NOTICE = `
Interpretation depends on laboratory reference ranges and clinical evaluation.
Do not use for emergency or treatment decisions. Consult a qualified healthcare professional for advice.
HealthLens processes data securely and does not permanently store personal medical data.
`.trim();

  const enrichedMarkers = markers.map(m => {
    const s = computeMarkerStatus(m);
    const risk = applyClinicalWeighting({ ...m, status: s.status });
    return {
      ...m,
      status: s.status,
      confidence: s.confidence,
      severity: risk.severity,
      urgency: risk.urgency,
      recommendedRecheckDays: risk.recommendedRecheckDays,
      immediateAttention: risk.immediateAttention,
      uiHints: risk.ui,
      sourceSnippet: m.sourceSnippet || null,
      observedAt: m.observedAt || null
    };
  });

  const severityOrder = { none: 0, mild: 1, moderate: 2, significant: 3 };
  const overallWorst = enrichedMarkers.reduce((acc, m) => {
    if (!acc) return m;
    return severityOrder[m.severity] > severityOrder[acc.severity] ? m : acc;
  }, null);

  let overallRecommendation = 'Routine follow-up as needed';
  let overallRecheckDays = 180;
  let overallImmediate = false;
  if (overallWorst) {
    overallRecheckDays = overallWorst.recommendedRecheckDays;
    overallImmediate = overallWorst.immediateAttention;
    overallRecommendation = overallImmediate
      ? 'Seek medical evaluation promptly'
      : `Recommended recheck in approximately ${overallRecheckDays} days`;
  }

  const confidVals = enrichedMarkers.map(m => m.confidence === 'high' ? 1 : m.confidence === 'medium' ? 0.7 : 0.4);
  const avgConf = confidVals.reduce((a,b) => a+b,0) / Math.max(1, confidVals.length);
  const overallConfidence = avgConf >= 0.9 ? 'high' : avgConf >= 0.7 ? 'medium' : 'low';

  try {
    const data = await generateAISummary(enrichedMarkers, overallRecommendation, overallConfidence, language, DISCLAIMER, LEGAL_NOTICE);

    if (data?.error?.code === 'insufficient_quota')
      return errorResponse(res, rid, 'AI_QUOTA_EXCEEDED', 'OpenAI quota exceeded.', 402);
    if (data?.error) return errorResponse(res, rid, 'AI_PROVIDER_ERROR', data.error.message || 'AI error', 502);

    const content = data?.choices?.[0]?.message?.content;
    if (!content) return errorResponse(res, rid, 'AI_FAILED', 'Empty AI response', 502);

    let parsed;
    try { parsed = JSON.parse(content); } catch (e) {
      return errorResponse(res, rid, 'AI_FAILED', 'Invalid AI JSON', 502);
    }

    const txt = JSON.stringify(parsed).toLowerCase();
    const banned = ['prescribe','start taking','take medication','diagnose','treatment plan'];
    if (banned.some(k => txt.includes(k))) {
      return errorResponse(res, rid, 'UNSAFE_RESPONSE', 'Unsafe content detected', 502);
    }

    parsed.enrichedMarkers = enrichedMarkers;
    parsed.overallRecommendation = overallRecommendation;
    parsed.overallRecheckDays = overallRecheckDays;
    parsed.immediateAttention = overallImmediate;
    parsed.overallConfidence = overallConfidence;
    parsed.disclaimer = DISCLAIMER;
    parsed.legalNotice = LEGAL_NOTICE;
    parsed.extractionDebug = enrichedMarkers.map(m => ({
      code: m.code,
      sourceSnippet: m.sourceSnippet || null
    }));

    return res.json(parsed);

  } catch (err) {
    console.error('NLP SUMMARY ERROR', err);
    return errorResponse(res, rid, 'AI_FAILED', 'Summary generation failed', 500);
  }
}

module.exports = {
  summary
};
