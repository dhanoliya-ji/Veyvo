FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --create-home veyvo
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
USER veyvo
EXPOSE 8000
# Run migrations, then serve. Put a TLS-terminating proxy/load balancer in front in production.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
