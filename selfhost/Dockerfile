FROM node:24-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc fonts-noto-cjk ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npx playwright install --with-deps chromium && chmod -R a+rX /opt/playwright
COPY --chown=node:node . .
RUN npm run home:build && mkdir -p /data /app/.next/cache && chown node:node /data && chown -R node:node /app/.next/cache
ENV NODE_ENV=production HOME_BIND=0.0.0.0 CHULJANG_DATA_DIR=/data PORT=3000
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "home:start"]
