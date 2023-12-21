FROM node:20-slim as base
ENV NODE_ENV=production
EXPOSE 3000
RUN mkdir /app && chown -R node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock*.json ./
RUN npm ci && npm cache clean --force > "/dev/null" 2>&1

FROM base as dev
ENV NODE_ENV=development
ENV PATH=/app/node_modules/.bin:$PATH
RUN npm i && npm cache clean --force > "/dev/null" 2>&1
CMD ["react-scripts", "start", "--inspect=0.0.0.0:9229"]

FROM base as source
COPY --chown=node:node . .

FROM source as build
ARG REACT_APP_API=""
ENV REACT_APP_API=$REACT_APP_API
RUN npm run build

FROM nginx:1.16-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY ./nginx/error.html /usr/share/nginx/html
COPY ./nginx/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]