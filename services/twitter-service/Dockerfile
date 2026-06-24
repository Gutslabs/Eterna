# Eterna Twitter service — runs the CoinTheHat/twitter-scraper wrapper.
# git is needed to install the scraper (a GitHub dependency that ships TS
# source); tsx runs server.ts directly, no build step.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

# The scraper is a public GitHub dependency; fetch it over HTTPS (the
# container has no SSH keys) regardless of how the URL is specified.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install

# App source (cookies come from env_file at runtime, never baked into the image).
COPY tsconfig.json server.ts ./

EXPOSE 8088
CMD ["npm", "start"]
