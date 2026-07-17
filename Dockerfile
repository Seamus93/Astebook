FROM node:24-alpine AS build

WORKDIR /app
ENV DATABASE_URL=postgresql://astebook:astebook@db:5432/astebook?schema=public

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache curl libreoffice ttf-dejavu

COPY package*.json ./
COPY --from=build /app/prisma ./prisma
RUN npm ci --omit=dev

COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/media ./frontend/media
COPY --from=build /app/scripts ./scripts

EXPOSE 3000
CMD ["npm", "run", "start:prod"]
