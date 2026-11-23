FROM node:24-bookworm-slim
WORKDIR /app
COPY serve.mjs config.example.json ./
COPY public ./public
USER node
CMD ["node", "serve.mjs"]
