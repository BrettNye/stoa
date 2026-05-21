# syntax=docker/dockerfile:1.7
FROM node:20-slim AS build
WORKDIR /build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY seed/ ./seed/
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /build/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/dist ./dist
COPY --from=build /build/seed ./seed
EXPOSE 8443
ENTRYPOINT ["node", "dist/bin.js"]
CMD ["serve", "--bind=0.0.0.0:8443"]
