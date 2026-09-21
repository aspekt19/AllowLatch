# Slim always-on AllowLatch OpenServ host (no AgentKit).
# Prefer: npm run deploy:host (OpenServ Cloud).
# Fallback: deploy this image on Railway/Fly/Render with DISABLE_TUNNEL=true
# and set the OpenServ Agent Endpoint to the public HTTPS URL.
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update -qq \
  && apt-get install -y -qq ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY host-package.json ./package.json
RUN npm install --legacy-peer-deps
COPY tsconfig.json ./
COPY src ./src
ENV DISABLE_TUNNEL=true
ENV PORT=7378
ENV ALLOWLATCH_EXECUTE_MODE=dry-run
EXPOSE 7378
CMD ["npx", "tsx", "src/agent.ts"]
