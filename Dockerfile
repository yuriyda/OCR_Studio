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

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
