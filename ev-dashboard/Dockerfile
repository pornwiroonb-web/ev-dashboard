FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY server.js ./server.js
COPY public ./public

ENV NODE_ENV=production
ENV APP_DATA_DIR=/data

RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "server.js"]
