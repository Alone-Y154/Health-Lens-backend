# ============================================================================
# HealthLens Server - Multi-stage Dockerfile with complete dependencies
# ============================================================================

FROM node:22-slim

# ============================================================================
# SYSTEM DEPENDENCIES - Core Libraries and Tools
# ============================================================================
# These are Linux system packages required for the application to function

RUN apt-get update && apt-get install -y \
    \
    # --- OCR (Optical Character Recognition) ---
    # tesseract-ocr: Main OCR engine for extracting text from images
    # libtesseract-dev: Development headers for tesseract (required for node-tesseract-ocr)
    tesseract-ocr \
    libtesseract-dev \
    \
    # --- PDF Processing ---
    # ghostscript: Converts PDF files to images (PNG), used in convertPdfToImagesAndOCR()
    #              Replaces the Windows 'gswin64c' command with 'gs' on Linux
    ghostscript \
    \
    # --- Image Processing (Optional but recommended) ---
    # imagemagick: Advanced image manipulation and conversion
    # graphicsmagick: Faster alternative/complement to ImageMagick
    imagemagick \
    graphicsmagick \
    \
    # --- Utility Tools ---
    # curl: HTTP client (useful for health checks and debugging)
    # ca-certificates: SSL/TLS certificates for HTTPS connections
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ============================================================================
# IMAGEMAGICK PDF POLICY FIX
# ============================================================================
# By default, ImageMagick blocks PDF processing for security reasons.
# This policy change allows PDF processing while maintaining other restrictions.
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml || true

# ============================================================================
# NODE.JS DEPENDENCIES - Application Framework
# ============================================================================
# Set working directory
WORKDIR /app

# Copy package files (with optional package-lock.json for reproducible builds)
COPY package*.json ./

# Install npm dependencies
# Key dependencies installed via npm:
# - express: Web server framework
# - express-rate-limit: Rate limiting middleware (10 req/min per IP)
# - multer: File upload handling (multipart/form-data)
# - pdf-parse: PDF text extraction (for text-based PDFs)
# - node-fetch: HTTP client for OpenAI API calls
# - uuid: Generate unique request IDs for tracking
# - dotenv: Load environment variables from .env file
# - other utilities: canvas, pdf-image, pdf2pic, pdfjs-dist
RUN npm install

# ============================================================================
# APPLICATION CODE
# ============================================================================
# Copy source code
COPY src ./src

# Copy additional files if needed (e.g., .env defaults, config files)
# COPY .env.example .env

# ============================================================================
# TEMPORARY UPLOAD DIRECTORY
# ============================================================================
# Create directory for storing uploaded files during processing
# Files are automatically cleaned up after processing
RUN mkdir -p tmp_uploads

# ============================================================================
# EXPOSE AND START
# ============================================================================
# Expose port 3000 (matches process.env.PORT || 3000 in index.js)
EXPOSE 3000

# Health check (optional but recommended for production)
# Checks if the server is responding to /system/healthz endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/system/healthz || exit 1

# Start the application
CMD ["npm", "start"]
