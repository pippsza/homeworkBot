# Stage 1: Build React frontend
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production backend
FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY index.js ./
COPY --from=client-build /app/client/dist ./client/dist

EXPOSE 3000
CMD ["node", "index.js"]
