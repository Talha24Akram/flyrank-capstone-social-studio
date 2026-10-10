FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production DB_PATH=/data/studio.sqlite MEDIA_DIR=/data/media SECRETS_FILE=/data/secrets.env
VOLUME /data
USER node
ENTRYPOINT ["node", "--no-warnings", "bin/with-secrets.js"]
CMD ["node", "--no-warnings", "src/server.js"]
