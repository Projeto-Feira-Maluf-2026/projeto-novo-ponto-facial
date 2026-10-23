FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_API_URL=/api/v1
ARG VITE_FACE_API_URL=/api/v1
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_API_URL=$VITE_API_URL \
    VITE_FACE_API_URL=$VITE_FACE_API_URL
RUN npm run build --workspace=web

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
COPY web/nginx-root.conf /etc/nginx/nginx.conf
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]

