# HealthLens Server

A Node.js/Express medical document processing server with OCR (Optical Character Recognition), lab result parsing, and AI-powered analysis using OpenAI.

---

## Table of Contents

1. [Features](#features)
2. [Technology Stack](#technology-stack)
3. [API Keys & Environment Setup](#api-keys--environment-setup)
4. [Installation & Running](#installation--running)
5. [API Endpoints](#api-endpoints)
6. [System Architecture](#system-architecture)
7. [Docker Deployment](#docker-deployment)

---

## Features

✅ **OCR Processing**: Extract text from PDFs and images using Tesseract  
✅ **PDF Support**: Handle both text-based and image-based PDFs  
✅ **Lab Result Parsing**: AI-powered extraction of medical markers  
✅ **AI Summaries**: Generate patient-friendly medical summaries  
✅ **Rate Limiting**: 10 requests per minute per IP (production-safe)  
✅ **Privacy-Focused**: Minimal logging, no permanent storage of medical data  
✅ **Cross-Platform**: Works on Windows, Linux, and Docker  

---

## Technology Stack

### System Dependencies
- **Node.js 22** - JavaScript runtime
- **Express 4.18** - Web framework
- **Tesseract OCR** - Optical character recognition
- **Ghostscript** - PDF to image conversion
- **ImageMagick** - Image processing

### Core npm Packages
- `express-rate-limit` - Rate limiting middleware
- `multer` - File upload handling (multipart/form-data)
- `pdf-parse` - Extract text from PDFs
- `node-fetch` - HTTP client for OpenAI API
- `uuid` - Generate request IDs
- `dotenv` - Environment variable management

---

## API Keys & Environment Setup

### Required Environment Variables

Create a `.env` file in the project root:

```env
# OpenAI API Configuration
OPENAI_API_KEY=sk-your-actual-openai-api-key-here

# Optional: Server Port (default: 3000)
PORT=3000
```

### Getting Your OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Click **Create new secret key**
5. Copy the key and paste it into your `.env` file
6. **⚠️ Keep this key secret** - never commit it to version control

### Why We Use OpenAI

The `/labs/parse` and `/nlp/summary` endpoints use OpenAI's GPT-4o-mini model for:
- **Accurate medical marker extraction** from noisy OCR text
- **Intelligent lab value interpretation** with clinical context
- **Patient-friendly summaries** of lab results

---

## Installation & Running

### Prerequisites

**Windows:**
- Node.js 20+ (https://nodejs.org)
- Tesseract OCR (https://github.com/UB-Mannheim/tesseract/wiki)
- Ghostscript (https://www.ghostscriptplus.com)

**Linux/Docker:**
- All dependencies are included in the Docker image

### Local Development (Windows)

```bash
# 1. Install dependencies
npm install

# 2. Create .env file with OpenAI key
echo OPENAI_API_KEY=sk_your_key > .env

# 3. Run the server
npm start

# Server runs on http://localhost:3000
```

### Docker Deployment (Recommended for Production)

```bash
# 1. Build the Docker image
docker build -t healthlens-server .

# 2. Run the container
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=sk_your_key \
  healthlens-server

# 3. Or use Docker Compose (if available)
docker-compose up
```

### Render.com Deployment

1. Push code to GitHub
2. Create new Web Service on Render
3. Connect GitHub repository
4. Set environment variable: `OPENAI_API_KEY=sk_your_key`
5. Deploy (port automatically set to 3000)
6. Rate limiting automatically uses client IPs via `trust proxy`

---

## API Endpoints

### 1. Health Check
**Endpoint:** `GET /system/healthz`

Simple health check endpoint for monitoring/load balancers.

**Request:**
```bash
curl http://localhost:3000/system/healthz
```

**Response:**
```json
{
  "ok": true
}
```

**Use Case:** Docker health checks, monitoring systems, deployment verification

---

### 2. OCR Extraction
**Endpoint:** `POST /ocr/extract`

Extract text from images and PDFs using Tesseract OCR.

**How it works:**
1. Accepts up to 1 PDF + 6 images per request (max 10MB total)
2. For **PDFs with text**: Uses `pdf-parse` library (faster)
3. For **image-based PDFs**: Converts to PNG using Ghostscript, then runs Tesseract
4. For **images** (JPG/PNG): Directly runs Tesseract OCR
5. Returns extracted text + metadata (engine used, page count)

**Request:**
```bash
curl -X POST http://localhost:3000/ocr/extract \
  -F "file=@medical_report.pdf" \
  -F "file=@lab_image.jpg"
```

**Response:**
```json
{
  "files": [
    {
      "originalname": "medical_report.pdf",
      "text": "Patient Name: John Doe\nHemoglobin: 14.5 g/dL...",
      "meta": {
        "pages": 3,
        "engine": "pdf-parse"
      }
    },
    {
      "originalname": "lab_image.jpg",
      "text": "Test Result: 120 mg/dL...",
      "meta": {
        "pages": 1,
        "engine": "tesseract"
      }
    }
  ]
}
```

**Supported Formats:**
- PDF (text-based and image-based)
- JPEG, JPG, PNG

**Error Responses:**
```json
{
  "error": {
    "code": "UNSUPPORTED_FILE",
    "message": "Maximum 1 PDF allowed"
  },
  "rid": "unique-request-id"
}
```

---

### 3. Lab Result Parsing
**Endpoint:** `POST /labs/parse`

AI-powered extraction of medical markers from OCR text.

**How it works:**
1. Takes raw OCR text (from `/ocr/extract` response)
2. Sends to OpenAI GPT-4o-mini with medical lab extraction prompt
3. AI extracts: marker name, code, value, unit, reference range
4. Hard validation layer rejects invalid values (e.g., years as test results)
5. Falls back to regex parsing if AI fails

**Request:**
```bash
curl -X POST http://localhost:3000/labs/parse \
  -H "Content-Type: application/json" \
  -d '{
    "text": "HbA1c: 7.2 (ref: 4.0-6.0)\nGlucose Fasting: 125 mg/dL\nLDL: 150",
    "locale": "en"
  }'
```

**Response:**
```json
{
  "markers": [
    {
      "name": "HbA1c",
      "code": "HBA1C",
      "value": 7.2,
      "unit": "%",
      "refRange": "4.0-6.0",
      "flag": null,
      "observedAt": null
    },
    {
      "name": "Glucose Fasting",
      "code": "GLU",
      "value": 125,
      "unit": "mg/dL",
      "refRange": null,
      "flag": null,
      "observedAt": null
    }
  ]
}
```

**Supported Markers:**
- HbA1c, Glucose (fasting & postprandial)
- Cholesterol, LDL, HDL, Triglycerides
- Creatinine, Urea, TSH
- CBC: Hemoglobin, RBC, Platelets, WBC

**Locale Support:**
- `"locale": "en"` (English) - Default
- `"locale": "de"` (German) - Converts German decimals (1,5 → 1.5)

---

### 4. AI Summary Generation
**Endpoint:** `POST /nlp/summary`

Generate patient-friendly medical summaries with clinical weighting.

**How it works:**
1. Takes parsed markers from `/labs/parse`
2. Computes status (normal/high/low) based on reference ranges
3. Applies clinical severity weighting (mild/moderate/significant)
4. Sends to OpenAI for human-friendly explanation
5. Adds legal disclaimers and recommendations
6. Returns structured JSON for frontend rendering

**Request:**
```bash
curl -X POST http://localhost:3000/nlp/summary \
  -H "Content-Type: application/json" \
  -d '{
    "markers": [
      {
        "name": "HbA1c",
        "code": "HBA1C",
        "value": 8.1,
        "unit": "%",
        "refRange": "4.0-6.0"
      }
    ],
    "language": "en"
  }'
```

**Response:**
```json
{
  "overallSummary": "Your lab results show elevated glucose control, which may suggest diabetes concern. Please consult a healthcare provider for personalized guidance.",
  
  "keyObservations": [
    "HbA1c is elevated (8.1%), indicating suboptimal glucose control",
    "This suggests longer-term blood sugar levels are above target"
  ],
  
  "markerExplanations": [
    {
      "name": "HbA1c",
      "whatItMeasures": "Average blood glucose over 2-3 months",
      "whatItSuggests": "Current glucose control may need management",
      "whyItMatters": "HbA1c below 6.0% is generally considered optimal"
    }
  ],
  
  "wellnessConsiderations": [
    "Maintain consistent physical activity",
    "Monitor carbohydrate intake",
    "Regular follow-up testing recommended"
  ],
  
  "whenToSeekAdvice": [
    "Schedule appointment with endocrinologist",
    "If experiencing fatigue, excessive thirst, or vision changes",
    "Within 2-4 weeks for management planning"
  ],
  
  "disclaimer": "This summary is for educational purposes only and is not a medical diagnosis or treatment recommendation.",
  "legalNotice": "Interpretation depends on laboratory reference ranges and clinical evaluation. Do not use for emergency or treatment decisions...",
  
  "enrichedMarkers": [...],
  "overallRecommendation": "Recommended recheck in approximately 30 days",
  "immediateAttention": true,
  "overallConfidence": "high"
}
```

**Clinical Weighting Rules:**
- **HbA1c ≥ 8.0%**: Significant severity, 30-day recheck
- **LDL ≥ 190**: Significant severity, 30-day recheck
- **Creatinine (high)**: Significant severity, 7-day recheck (kidney concern)
- **Hemoglobin (low)**: Moderate severity, 30-day recheck
- **WBC (abnormal)**: Moderate severity, 30-day recheck

---

## System Architecture

### Request Flow

```
┌─────────────────────────────────┐
│   Client Request (File Upload)  │
└──────────────┬──────────────────┘
               │
               ▼
         ┌──────────────────┐
         │ Express Middleware│
         ├──────────────────┤
         │ Rate Limiter     │ (10 req/min per IP)
         │ Request Logger   │ (Generate request ID)
         │ Body Parser      │
         └──────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │   /ocr/extract Endpoint       │
    ├──────────────────────────────┤
    │ 1. Validate file types (PDF) │
    │ 2. Extract text:             │
    │    - PDF with text → pdf-parse
    │    - Image-based PDF → GS → Tesseract
    │    - Images → Tesseract      │
    │ 3. Return text + metadata    │
    └──────────────────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │  /labs/parse Endpoint         │
    ├──────────────────────────────┤
    │ 1. OpenAI Extraction:         │
    │    - Send text to GPT-4o-mini │
    │    - Extract markers (JSON)   │
    │ 2. Validation Layer:          │
    │    - Sanity check values      │
    │    - Reject outliers          │
    │ 3. Fallback to Regex if needed│
    │ 4. Return structured markers  │
    └──────────────────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │  /nlp/summary Endpoint        │
    ├──────────────────────────────┤
    │ 1. Compute marker status      │
    │    (normal/high/low)          │
    │ 2. Apply clinical weighting   │
    │ 3. OpenAI generates summary   │
    │ 4. Add disclaimers            │
    │ 5. Return formatted response  │
    └──────────────────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │   JSON Response to Client     │
    └──────────────────────────────┘
```

### File Processing Pipeline

**For Image-Based PDFs:**
```
PDF File
   │
   ├─ Try pdf-parse ─→ No text extracted
   │
   └─ Ghostscript: PDF → page_1.png, page_2.png, ...
      │
      └─ Tesseract: Each PNG → Text
         │
         └─ Combine all page text
            │
            └─ Clean up temp files
```

**For Images (JPG/PNG):**
```
Image File
   │
   └─ Tesseract OCR
      │
      └─ Return extracted text
```

---

## Rate Limiting

**Configuration:** 10 requests per minute per IP address

- Uses client IP (not proxy IP) via `trust proxy` on Render
- Returns HTTP 429 when limit exceeded
- Message: "Too many requests from this IP, please try again later."
- Logging: Warns when limits are reached

**Example:**
```
Request 1-10 in 60 seconds: ✅ Success
Request 11+ in 60 seconds: ❌ 429 Too Many Requests
After 60 seconds: ✅ Counter resets
```

---

## Docker Deployment

### Building the Image

```bash
docker build -t healthlens-server:latest .
```

**What the Dockerfile includes:**
- Node.js 22 base image
- Tesseract OCR + language data
- Ghostscript (PDF conversion)
- ImageMagick & GraphicsMagick
- SSL certificates for HTTPS
- Health check endpoint

### Running the Container

```bash
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=sk_your_key \
  -v uploads:/app/tmp_uploads \
  healthlens-server:latest
```

**Environment Variables:**
- `OPENAI_API_KEY` (Required) - Your OpenAI API key
- `PORT` (Optional) - Server port (default: 3000)

---

## Error Handling

### Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `UNSUPPORTED_FILE` | Invalid file type or too many files | Check file format (PDF/JPG/PNG max) |
| `OCR_FAILED` | OCR processing error | Try different image quality |
| `PARSE_FAILED` | Lab parsing failed | Ensure text contains medical markers |
| `INVALID_KEY` | OpenAI API key issue | Check `.env` file and API quota |
| `AI_FAILED` | OpenAI API error | Check internet connection, API status |
| `AI_QUOTA_EXCEEDED` | Ran out of API credits | Add billing method to OpenAI account |
| `NOT_FOUND` | Endpoint doesn't exist | Check request URL |
| `INTERNAL_ERROR` | Server error | Check logs, try again |

---

## Development Tips

### Testing Endpoints

```bash
# 1. Health check
curl http://localhost:3000/system/healthz

# 2. OCR test
curl -X POST http://localhost:3000/ocr/extract \
  -F "file=@test.jpg"

# 3. Lab parsing test
curl -X POST http://localhost:3000/labs/parse \
  -H "Content-Type: application/json" \
  -d '{"text":"HbA1c: 7.2"}'

# 4. Summary test
curl -X POST http://localhost:3000/nlp/summary \
  -H "Content-Type: application/json" \
  -d '{"markers":[{"name":"HbA1c","value":7.2,"refRange":"4-6"}]}'
```

### Viewing Logs

```bash
# Local development
npm start

# Docker container
docker logs -f container_id
```

### Debugging

- Check `/tmp_uploads` for temporary files (auto-cleaned)
- Enable verbose logging by modifying index.js
- Test with simpler documents first

---

## Security Considerations

✅ **Privacy:** No permanent storage of medical data  
✅ **HIPAA-ready:** Minimal logging, request IDs for tracking  
✅ **Rate limiting:** Prevents abuse  
✅ **Input validation:** File type and size checks  
✅ **Error sanitization:** No sensitive details in error messages  
✅ **Cross-platform paths:** Works on Windows & Linux  

---

## Support

For issues or questions:
1. Check the Docker logs
2. Verify `.env` file exists and has valid OpenAI key
3. Ensure system dependencies are installed
4. Test with simple test files first

---

## License

Proprietary - HealthLens Medical Processing System
