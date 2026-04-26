# ──────────── Stage 1: Frontend build ────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build

COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.node.json ./
COPY vite.config.ts tailwind.config.ts postcss.config.js ./

RUN npm ci

COPY app/static/src ./app/static/src

RUN npm run build

# ──────────── Stage 2: Runtime (CUDA + Python + built frontend) ────────────
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir paddlepaddle-gpu==3.0.0 \
        -i https://www.paddlepaddle.org.cn/packages/stable/cu126/ \
    && pip3 install --no-cache-dir -r requirements.txt \
    && pip3 install --no-cache-dir 'paddlex[ocr]==3.5.1'

COPY app/ app/

# Copy built frontend from stage 1 (overrides any app/static/dist baked into git ignore).
COPY --from=frontend-build /build/app/static/dist app/static/dist

ENV OCR_DATA_DIR=/app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
