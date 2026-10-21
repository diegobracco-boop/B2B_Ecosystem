# b2b-ecosystem en Ownia. Dependencias npm solo para el almacén de datos en DynamoDB (SDK de
# AWS); el resto es Node puro + el código de la app + gas/ (copiado por
# scripts/sync-to-ownia-repo.js en el repo espejo).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# tzdata: el proceso corre con TZ=America/Argentina/Buenos_Aires (la de los proyectos GAS,
# ver server/config.js); sin la base de zonas, la imagen alpine caería a UTC.
RUN apk add --no-cache tzdata
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 8000
CMD ["sh", "-c", "PORT=${PORT:-8000} node server/index.js"]
