FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /home/ocr/app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home ocr
COPY --chown=ocr:ocr app.py ./
USER ocr
ENV HOME=/home/ocr PYTHONUNBUFFERED=1
# Public model weights only; no document is processed or bundled during build.
RUN python -c "from app import load_engine; load_engine()"
ENV PADDLEOCR_HOST=0.0.0.0 PADDLEOCR_PORT=8001
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=3)"
CMD ["python", "app.py"]
