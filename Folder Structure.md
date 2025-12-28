# HealthLens Server - Modular Refactoring Complete ✅

## Overview
The monolithic `src/index.js` (850+ lines) has been successfully refactored into a production-level modular architecture following MVC patterns.

## New Directory Structure

```
src/
├── index.js              (70 lines - Clean entry point)
├── routes/
│   ├── index.js         (Aggregates all route modules)
│   ├── systemRoutes.js  (GET /system/healthz, POST /system/validate-key)
│   ├── ocrRoutes.js     (POST /ocr/extract with multer)
│   ├── labsRoutes.js    (POST /labs/parse)
│   └── nlpRoutes.js     (POST /nlp/summary)
├── controllers/
│   ├── systemController.js   (healthz, validateKey handlers)
│   ├── ocrController.js      (extract handler - 300+ lines)
│   ├── labsController.js     (parse handler - 250+ lines)
│   └── nlpController.js      (summary handler - 400+ lines)
└── utils/
    ├── errorResponse.js  (Standardized error formatting)
    ├── ocr.js           (Tesseract & Ghostscript utilities)
    ├── labs.js          (Lab validation ranges & AI extraction)
    └── nlp.js           (Clinical weighting, status computation, AI summary generation)
```

## What Moved Where

### src/index.js (NEW - 70 lines)
**Role:** Application entry point with middleware and server setup

**Responsibilities:**
- Rate limiter configuration (10 req/min per IP)
- Trust proxy setup for Render deployment
- Request ID tracking and logging
- Route mounting (via routes/index.js)
- Error handlers (404, 500)
- tmp_uploads directory creation

**Key Features:**
- Uses `express-rate-limit` v7 with proper `handler` callback syntax
- Implements `app.set('trust proxy', 1)` for accurate IP detection
- Minimal and focused - no business logic

---

### routes/ (5 files)

#### routes/index.js (Aggregator)
```javascript
router.use('/system', systemRoutes);
router.use('/ocr', ocrRoutes);
router.use('/labs', labsRoutes);
router.use('/nlp', nlpRoutes);
```

#### routes/systemRoutes.js
- `GET /system/healthz` → `healthz()`
- `POST /system/validate-key` → `validateKey()`

#### routes/ocrRoutes.js
- `POST /ocr/extract` → `extract()` with multer file handling
- Handles: PDF + image uploads (1 PDF max, 6 images max)

#### routes/labsRoutes.js
- `POST /labs/parse` → `parse()` with JSON body

#### routes/nlpRoutes.js
- `POST /nlp/summary` → `summary()` with JSON body

---

### controllers/ (4 files)

Each controller exports handler function(s) for its respective routes.

#### systemController.js
```javascript
async function healthz(req, res) { return res.json({ ok: true }); }
async function validateKey(req, res) { /* OpenAI validation */ }
```

#### ocrController.js (300+ lines)
```javascript
async function extract(req, res) {
  // Validates file types and counts
  // Handles PDF extraction (text + OCR fallback)
  // Handles image OCR via Tesseract
  // Returns structured results with metadata
}
```

#### labsController.js (250+ lines)
```javascript
async function parse(req, res) {
  // Calls OpenAI with structured JSON extraction prompt
  // Hard validation layer against VALID_RANGES
  // Rejects impossible values (e.g., dates as glucose values)
  // Falls back to regex parser if AI fails
}
```

#### nlpController.js (400+ lines)
```javascript
async function summary(req, res) {
  // Enriches markers with status/severity/urgency
  // Applies clinical weighting (HbA1c ≥8.0% = significant)
  // Generates AI-powered patient-friendly explanations
  // Safety scans for banned medical advice phrases
}
```

---

### utils/ (4 files)

#### errorResponse.js
```javascript
function errorResponse(res, rid, code, message, status = 500) {
  return res.status(status).json({ error: { code, message }, rid });
}
```

#### ocr.js
**Exports:**
- `runTesseract(imagePath)` - Executes OCR on images
- `convertPdfToImagesAndOCR(pdfPath, maxPages)` - Converts PDF pages to images, applies OCR
- `isWindows` flag for cross-platform paths

**Cross-Platform Support:**
- Windows: `C:\Program Files\Tesseract-OCR\tesseract.exe` & `gswin64c`
- Linux/Docker: `tesseract` & `gs`

#### labs.js
**Exports:**
- `VALID_RANGES` object - Min/max values for 11 lab markers
- `normalizeCode(name)` - Maps extracted names to standard codes
- `extractMarkersWithAI(cleanText)` - Calls OpenAI with extraction prompt

**Lab Markers Supported:**
HbA1c, Glucose, LDL, HDL, Cholesterol, Triglycerides, Creatinine, TSH, Hemoglobin, WBC, Platelets

#### nlp.js
**Exports:**
- `parseRefRange(ref)` - Extracts low/high from reference range strings
- `computeMarkerStatus(m)` - Determines normal/high/low status
- `applyClinicalWeighting(m)` - Assigns severity/urgency/UI hints
- `generateAISummary(...)` - Calls OpenAI for patient-friendly explanations

**Clinical Rules:**
- HbA1c ≥ 8.0% = "significant" severity + "prompt" urgency
- LDL ≥ 190 = "significant" severity + "prompt" urgency
- Creatinine (high) = "significant" severity + "prompt" urgency

---

## Refactoring Benefits

### ✅ Code Organization
- **Separation of Concerns**: Routes define endpoints, controllers handle logic, utils provide helpers
- **Reusability**: Utility functions can be imported and used independently
- **Maintainability**: Clear folder structure makes it easy to find and modify specific functionality
- **Scalability**: Adding new endpoints is now a simple 3-file process (route + controller + utils)

### ✅ Testing
- Controllers can be unit tested without Express context
- Utils can be tested in isolation
- Routes can be tested with request mocks

### ✅ Code Review
- Smaller files are easier to review (no 850-line monoliths)
- Clear responsibility boundaries reduce confusion
- Function signatures are more obvious

### ✅ Dependency Management
- Only necessary dependencies imported in each file
- Reduced circular dependency risk
- Better tree-shaking for bundling (if applicable)

---

## Running the Application

```bash
# Install dependencies
npm install

# Start server
npm start

# Server runs on http://localhost:3000
```

## Deployment

### Docker
```bash
docker build -t healthlens-server .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk_... healthlens-server
```

### Render.com
1. Push to GitHub
2. Create new Web Service → Connect repository
3. Set Environment Variable: `OPENAI_API_KEY`
4. Deploy (automatic on push)

The trust proxy configuration is already set for Render's reverse proxy.

---

## API Endpoints

All endpoints support Request ID tracking and rate limiting (10/min per IP).

### System
- `GET /system/healthz` - Health check
- `POST /system/validate-key` - Validate OpenAI API key

### OCR
- `POST /ocr/extract` - Extract text from PDF/images

### Labs
- `POST /labs/parse` - Parse lab markers from text

### NLP
- `POST /nlp/summary` - Generate patient-friendly summary

---

## Migration Notes

### Old Code Path
```
src/index.js (850 lines, all logic mixed)
```

### New Code Path
```
src/index.js (70 lines, clean entry)
├── routes/ (endpoints)
├── controllers/ (logic)
└── utils/ (helpers)
```

All functionality remains identical. This is a pure refactoring with no feature changes.

---

## Next Steps

1. ✅ Verify routes/controllers/utils load correctly
2. ✅ Test each endpoint manually
3. ✅ Run integration tests
4. ✅ Deploy to Render

---

