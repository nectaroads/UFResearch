FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.mjs auth.mjs validation.mjs schema.sql ./
CMD ["node", "index.mjs"]
