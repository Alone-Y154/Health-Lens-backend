require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Path to tesseract executable (Windows vs Linux/Docker)
const isWindows = process.platform === 'win32';
const TESSERACT_PATH = isWindows 
  ? 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe' 
  : 'tesseract';

// OpenAI API key from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY not set in environment variables');
}

// Middleware
app.use(express.json({ limit: '1mb' }));

// Trust Render's reverse proxy for getting real client IP
app.set('trust proxy', 1);

// Rate limiter: 10 requests per minute per IP
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 6, // limit each IP to 6 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  statusCode: 429,
  keyGenerator: (req) => {
    // Use client IP address for rate limiting (works with trust proxy)
    return req.ip;
  },
  skip: (req) => {
    // Optional: Skip rate limiting for specific routes if needed
    return false;
  },
  handler: (req, res, next, options) => {
    // Custom handler when rate limit is exceeded
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

// Minimal request-id and privacy-preserving logger
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

// Multer setup (store in OS tmp; we'll remove files immediately)
const upload = multer({
  dest: path.join(__dirname, 'tmp_uploads'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper for error responses
function errorResponse(res, rid, code, message, status = 500) {
  return res.status(status).json({ error: { code, message }, rid });
}

// Helper to run Tesseract OCR
function runTesseract(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(TESSERACT_PATH, [imagePath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', '3'], (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve((stdout || '').trim());
    });
  });
}

// Helper to convert PDF to images using Ghostscript and extract text via OCR
async function convertPdfToImagesAndOCR(pdfPath, maxPages = 10) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(__dirname, 'tmp_uploads', `pdf_${Date.now()}`);
    
    try {
      // Create temp directory
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      // Use Ghostscript to convert PDF to PNG images
      const outputPattern = path.join(tmpDir, 'page_%d.png');
      const args = [
        '-q',
        '-dNOPAUSE',
        '-dBATCH',
        '-dSAFER',
        `-dLastPage=${maxPages}`,
        '-sDEVICE=png16m',
        '-r150',
        `-sOutputFile=${outputPattern}`,
        pdfPath
      ];
      
      // Use 'gs' on Linux/Docker, 'gswin64c' on Windows
      const gsCommand = isWindows ? 'gswin64c' : 'gs';
      execFile(gsCommand, args, async (error, stdout, stderr) => {
        if (error) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return reject(error);
        }
        
        try {
          // Get all PNG files created
          const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
          let combinedText = '';
          
          for (const file of files) {
            const imagePath = path.join(tmpDir, file);
            try {
              const pageText = await runTesseract(imagePath);
              combinedText += (pageText || '') + '\n';
            } catch (ocrErr) {
              console.error(`OCR error on ${file}:`, ocrErr && ocrErr.message);
            }
          }
          
          // Cleanup
          fs.rmSync(tmpDir, { recursive: true, force: true });
          resolve(combinedText.trim());
        } catch (err) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(err);
        }
      });
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    }
  });
}

// --- System endpoints ---
app.get('/system/healthz', (req, res) => {
  return res.json({ ok: true });
});

app.post('/system/validate-key', async (req, res) => {
  const rid = req.rid;
  if (!OPENAI_API_KEY) return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI API key not configured on server', 500);

  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } });
    if (r.ok) return res.json({ valid: true });
    // Non-200
    return res.status(401).json({ error: { code: 'INVALID_KEY', message: 'OpenAI rejected the API key' }, rid });
  } catch (err) {
    console.error('validate-key error', err && err.message);
    return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI validation failed', 401);
  }
});

// --- OCR endpoint ---
// Accepts up to 1 PDF and 6 images. Returns text and meta for each.
app.post('/ocr/extract', upload.array('file', 7), async (req, res) => {
  const rid = req.rid;
  if (!req.files || req.files.length === 0) return errorResponse(res, rid, 'UNSUPPORTED_FILE', 'No files uploaded', 400);

  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  const results = [];
  const filePaths = [];

  // Validate file type counts
  let pdfCount = 0;
  let imageCount = 0;
  for (const file of req.files) {
    if (file.mimetype === 'application/pdf') pdfCount++;
    else if (['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype)) imageCount++;
  }

  if (pdfCount > 1) return errorResponse(res, rid, 'UNSUPPORTED_FILE', 'Maximum 1 PDF allowed', 400);
  if (imageCount > 6) return errorResponse(res, rid, 'UNSUPPORTED_FILE', 'Maximum 6 images allowed', 400);

  try {
    for (const file of req.files) {
      const { mimetype, path: filePath, originalname } = file;
      filePaths.push(filePath);

      // Validate MIME
      if (!allowed.includes(mimetype)) {
        results.push({ originalname, error: 'Unsupported file type', code: 'UNSUPPORTED_FILE' });
        continue;
      }

      try {
        if (mimetype === 'application/pdf') {
          const data = fs.readFileSync(filePath);
          const parsed = await pdfParse(data);
          let text = (parsed && parsed.text) ? parsed.text.trim() : '';
          const pages = parsed.numpages || parsed.numPages || (parsed.metadata && parsed.metadata.pages) || null;
          
          // If PDF has no extractable text, convert to images and use OCR
          if (!text) {
            try {
              console.log('PDF is image-based, converting to images for OCR...');
              text = await convertPdfToImagesAndOCR(filePath, 10);
            } catch (ocrErr) {
              console.error('PDF OCR conversion error:', ocrErr && ocrErr.message);
            }
          }
          
          if (!text) {
            results.push({
              originalname,
              error: 'PDF is image-based. Please upload as JPG/PNG images for OCR.',
              code: 'OCR_FAILED'
            });
          } else {
            results.push({
              originalname,
              text,
              meta: {
                pages: pages || 1,
                engine: text.length > 100 ? 'pdf-parse' : 'tesseract'
              }
            });
          }
        } else {
          // Image -> tesseract OCR
          try {
            const text = await runTesseract(filePath);
            results.push({ originalname, text: (text || '').trim(), meta: { pages: 1, engine: 'tesseract' } });
          } catch (tesseractErr) {
            console.error('Tesseract error for file', originalname, tesseractErr && tesseractErr.message);
            results.push({ originalname, error: 'Unable to extract text from image', code: 'OCR_FAILED' });
          }
        }
      } catch (err) {
        console.error('OCR error for file', originalname, err && err.message);
        results.push({ originalname, error: 'Unable to extract text', code: 'OCR_FAILED' });
      }
    }

    console.log('OCR results:', JSON.stringify(results, null, 2));
    if (results.length === 0) return errorResponse(res, rid, 'OCR_FAILED', 'Unable to process any files', 500);
    return res.json({ files: results });
  } catch (err) {
    console.error('OCR error', err && err.message);
    return errorResponse(res, rid, 'OCR_FAILED', 'Unable to extract text', 500);
  } finally {
    // ensure all files removed
    for (const filePath of filePaths) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
  }
});

// --- Labs parsing (simple heuristic parser) ---

app.post('/labs/parse', async (req, res) => {
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
    // ------------------------------
    // 1️⃣ AI Extraction Call
    // ------------------------------
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

    console.log("OPENAI RAW RESPONSE >>>", JSON.stringify(data, null, 2));

    if (!data?.choices?.[0]?.message?.content) {
      throw new Error("No AI result");
    }

let rawContent =
  data?.choices?.[0]?.message?.content ||
  data?.choices?.[0]?.message?.content?.[0]?.text;

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

    // ------------------------------
    // 2️⃣ Hard Validation Layer
    // ------------------------------
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

    const normalizeCode = (name) => {
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
    };

    markers = markers
      .map(m => {
        const code = normalizeCode(m.name || "");
        if (!code) return null;

        const value = Number(m.value);
        if (isNaN(value)) return null;

        // Reject Year / Phone Garbage
        if (value > 1900 && value < 2100) return null;

        // Medical sanity validation
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

    // ------------------------------
    // 3️⃣ Fallback to Regex Parser
    // ------------------------------
    try {
      const fallback = fallbackRegexParser(cleanText);
      if (!fallback || !fallback.length) {
        return errorResponse(res, rid, 'PARSE_FAILED', 'Unable to extract lab values', 422);
      }

      return res.json({ markers: fallback });

    } catch (err2) {
      return errorResponse(res, rid, 'PARSE_FAILED', 'Unable to extract lab values', 422);
    }
  }
});

// --- NLP / AI summary endpoint ---
app.post('/nlp/summary', async (req, res) => {
  const rid = req.rid;

  if (!OPENAI_API_KEY) return errorResponse(res, rid, 'INVALID_KEY', 'OpenAI API key not configured on server', 500);

  const { markers = [], language = 'en', ocrText = null } = req.body || {};
  if (!Array.isArray(markers) || markers.length === 0)
    return errorResponse(res, rid, 'AI_FAILED', 'Missing markers', 400);

  // ------------------------------
  // Helper: parse ref range → low/high
  // ------------------------------
  function parseRefRange(ref) {
    if (!ref || typeof ref !== 'string') return { low: null, high: null };
    const txt = ref.replace(/\s/g, '');
    if (/^(\d+(\.\d+)?)[-–](\d+(\.\d+)?)$/.test(txt)) {
      const parts = txt.split(/[-–]/).map(n => parseFloat(n));
      return { low: parts[0], high: parts[1] };
    }
    if (/^<\d+(\.\d+)?$/.test(txt)) return { low: null, high: parseFloat(txt.replace('<', '')) };
    if (/^>\d+(\.\d+)?$/.test(txt)) return { low: parseFloat(txt.replace('>', '')), high: null };
    // maybe ranges with "/" or "to"
    const toMatch = txt.match(/^(\d+(\.\d+)?)to(\d+(\.\d+)?)$/i);
    if (toMatch) return { low: parseFloat(toMatch[1]), high: parseFloat(toMatch[3]) };
    return { low: null, high: null };
  }

  // ------------------------------
  // 1) status + confidence
  // ------------------------------
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

  // ------------------------------
  // 2) severity, urgency, recheck days, immediate attention, uiHints
  // ------------------------------
  function applyClinicalWeighting(m) {
    // default
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

    // Creatinine (high is concerning)
    if (m.code === 'CREAT') {
      if (m.status === 'high') { severity = 'significant'; urgency = 'prompt'; recommendedRecheckDays = 7; immediateAttention = true; }
    }

    // Hemoglobin (low)
    if (m.code === 'HB' && m.status === 'low') {
      severity = 'moderate';
      urgency = 'soon';
      recommendedRecheckDays = 30;
    }

    // WBC (abnormal)
    if (m.code === 'WBC' && m.status !== 'normal') {
      severity = 'moderate';
      urgency = 'soon';
      recommendedRecheckDays = 30;
    }

    // simple UI hints
    let color = '#9CA3AF'; // neutral gray
    let icon = 'check-circle';
    if (severity === 'mild') { color = '#F59E0B'; icon = 'alert-circle'; }
    if (severity === 'moderate') { color = '#F97316'; icon = 'alert-triangle'; }
    if (severity === 'significant') { color = '#EF4444'; icon = 'alert-octagon'; }

    return { severity, urgency, recommendedRecheckDays, immediateAttention, ui: { color, icon } };
  }

  // ------------------------------
  // 3) Enrich markers and compute overall aggregates
  // ------------------------------
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
      // preserve source snippet if parser provided it (optional)
      sourceSnippet: m.sourceSnippet || null,
      observedAt: m.observedAt || null
    };
  });

  // overall recommendations (derive from worst severity / urgency)
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

  // compute overallConfidence (simple heuristic)
  const confidVals = enrichedMarkers.map(m => m.confidence === 'high' ? 1 : m.confidence === 'medium' ? 0.7 : 0.4);
  const avgConf = confidVals.reduce((a,b) => a+b,0) / Math.max(1, confidVals.length);
  const overallConfidence = avgConf >= 0.9 ? 'high' : avgConf >= 0.7 ? 'medium' : 'low';

  // ----------------------------------
  // Legal Notice (EU friendly)
  // ----------------------------------
  const DISCLAIMER = 'This summary is for educational purposes only and is not a medical diagnosis or treatment recommendation.';
  
  const LEGAL_NOTICE = `
Interpretation depends on laboratory reference ranges and clinical evaluation.
Do not use for emergency or treatment decisions. Consult a qualified healthcare professional for advice.
HealthLens processes data securely and does not permanently store personal medical data.
`.trim();

  // ----------------------------------
  // 4) Build AI prompt to generate the frontend-shaped summary
  // ----------------------------------
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
Disclaimer: ${DISCLAIMER}
LegalNotice: ${LEGAL_NOTICE}

Return EXACT JSON schema:
{
  "overallSummary": "",             // 1-3 sentences overview
  "keyObservations": [],            // short bullets
  "markerExplanations": [          // per marker, in same order as input
    { "name":"", "whatItMeasures":"", "whatItSuggests":"", "whyItMatters":"" }
  ],
  "wellnessConsiderations": [],     // general non-prescriptive tips
  "whenToSeekAdvice": [],           // user-friendly guidance & examples of symptoms
  "disclaimer": "",                 // brief cautionary statement (use provided disclaimer)
  "legalNotice": ""                 // full legal notice (use provided legal notice)
}
`;

  try {
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

    const data = await r.json();

    if (data?.error?.code === 'insufficient_quota')
      return errorResponse(res, rid, 'AI_QUOTA_EXCEEDED', 'OpenAI quota exceeded.', 402);
    if (data?.error) return errorResponse(res, rid, 'AI_PROVIDER_ERROR', data.error.message || 'AI error', 502);

    const content = data?.choices?.[0]?.message?.content;
    if (!content) return errorResponse(res, rid, 'AI_FAILED', 'Empty AI response', 502);

    let parsed;
    try { parsed = JSON.parse(content); } catch (e) {
      return errorResponse(res, rid, 'AI_FAILED', 'Invalid AI JSON', 502);
    }

    // safety scan
    const txt = JSON.stringify(parsed).toLowerCase();
    const banned = ['prescribe','start taking','take medication','diagnose','treatment plan'];
    if (banned.some(k => txt.includes(k))) {
      return errorResponse(res, rid, 'UNSAFE_RESPONSE', 'Unsafe content detected', 502);
    }

    // attach deterministic fields for frontend use
    parsed.enrichedMarkers = enrichedMarkers;
    parsed.overallRecommendation = overallRecommendation;
    parsed.overallRecheckDays = overallRecheckDays;
    parsed.immediateAttention = overallImmediate;
    parsed.overallConfidence = overallConfidence;
    parsed.disclaimer = DISCLAIMER;
    parsed.legalNotice = LEGAL_NOTICE;

    // optional debug info (no PHI) — only include small snippets if available
    parsed.extractionDebug = enrichedMarkers.map(m => ({
      code: m.code,
      sourceSnippet: m.sourceSnippet || null
    }));

    return res.json(parsed);

  } catch (err) {
    console.error('NLP SUMMARY ERROR', err);
    return errorResponse(res, rid, 'AI_FAILED', 'Summary generation failed', 500);
  }
});



// Generic 404
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' }, rid: req.rid });
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err && err.stack);
  return errorResponse(res, req.rid, 'INTERNAL_ERROR', 'Internal server error', 500);
});

// Ensure tmp_uploads exists
try { fs.mkdirSync(path.join(__dirname, 'tmp_uploads'), { recursive: true }); } catch (e) {}

// Start server
app.listen(PORT , '0.0.0.0' , () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
