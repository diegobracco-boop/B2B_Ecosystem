# b2b-ecosystem en Ownia. Dependencias npm solo para el almacén de datos en DynamoDB (SDK de
# AWS); el resto es Node puro + el código de la app + gas/ y pipelines/ (copiados por
# scripts/sync-to-ownia-repo.js en el repo espejo).
#
# Python: para el botón "Actualizar reales" (server/reales-job.js), que corre acá
# pipelines/Daily_Dashboard/daily_sync.py. Debian slim y no alpine: lz4 (dependencia de trino) no
# tiene wheel para musl. Versiones = las que corren en las PCs del equipo (requirements-pipelines.txt).
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# tzdata: el proceso corre con TZ=America/Argentina/Buenos_Aires (la de los proyectos GAS,
# ver server/config.js); sin la base de zonas, la imagen caería a UTC.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
COPY requirements-pipelines.txt ./
RUN python3 -m venv /opt/py \
 && /opt/py/bin/pip install --no-cache-dir -r requirements-pipelines.txt
ENV PYTHON=/opt/py/bin/python
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 8000
CMD ["sh", "-c", "PORT=${PORT:-8000} node server/index.js"]
