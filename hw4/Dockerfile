FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/hw4
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY tracker.py ./
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "tracker:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "8"]
