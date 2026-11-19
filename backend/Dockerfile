FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
COPY scripts ./scripts
RUN useradd --system --uid 10001 projeta && mkdir -p var && chown projeta var
USER projeta
EXPOSE 8000
# As migrações rodam na partida da API (lifespan).
CMD ["uvicorn", "projeta.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
