# Tures Engine — container image for Fly.io / Render.
FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching. tsx (a devDependency) runs the TS directly at start,
# so we keep dev deps — there is no separate build step.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV PORT=8787
EXPOSE 8787

# Honors PORT; binds 0.0.0.0 (see src/server.ts).
CMD ["npm", "start"]
