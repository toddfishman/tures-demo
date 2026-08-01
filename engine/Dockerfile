# Tures Engine — container image for Fly.io / Render.
FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching. tsx (a devDependency) runs the TS directly at start,
# so we keep dev deps — there is no separate build step.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# No hardcoded PORT: the host (Render/Fly) injects PORT and the app binds it on 0.0.0.0
# (src/server.ts → config.port, default 8787 if unset). EXPOSE is doc-only.
EXPOSE 8787

CMD ["npm", "start"]
