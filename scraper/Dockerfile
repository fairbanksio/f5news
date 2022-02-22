# Base
FROM node:16-slim as base
RUN apt-get update; apt-get install wget gpg -y
ENV NODE_ENV=production
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini.asc /tini.asc
RUN gpg --batch --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 595E85A6B1B4779EA4DAAEC70B588DFF0527A9B7 \
  && gpg --batch --verify /tini.asc /tini
RUN chmod +x /tini
RUN apt-get purge wget gpg -y; apt-get autoremove -y; apt-get autoclean; rm -rf /var/lib/{apt,dpkg,cache,log}/
RUN npm i npm@latest -g
# apt-get is unavailable after this point
RUN mkdir /app && chown -R node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package*.json ./
RUN npm install --no-optional --silent && npm cache clean --force > "/dev/null" 2>&1

# Development ENV
FROM base as dev
ENV NODE_ENV=development
ENV PATH=/app/node_modules/.bin:$PATH
RUN npm install --only=development --no-optional --silent && npm cache clean --force > "/dev/null" 2>&1
CMD ["nodemon", "server.js", "--inspect=0.0.0.0:9229"]

# Source
FROM base as source
COPY --chown=node:node . .

# Test ENV
FROM source as test
ENV NODE_ENV=development
ENV PATH=/app/node_modules/.bin:$PATH
COPY --from=dev /app/node_modules /app/node_modules
RUN eslint .
# RUN npm test // Disabled pending unit tests

# Audit ENV
FROM test as audit
USER root
RUN npm audit --audit-level critical

# Production ENV
FROM source as prod
ENTRYPOINT ["/tini", "--"]
CMD ["node", "index.js"]