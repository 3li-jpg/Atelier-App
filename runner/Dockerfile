FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git curl ripgrep build-essential ca-certificates jq \
    python3 python3-pip python3-venv nftables openssh-client dnsutils \
 && rm -rf /var/lib/apt/lists/*
# Node 22 (bridge.mjs requires Node 18+; ubuntu's apt nodejs is older)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
# Hermes Agent — pinned version, installed via uv for fast reproducible installs
ARG HERMES_VERSION=0.18.2
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && /root/.local/bin/uv pip install --system "hermes-agent==${HERMES_VERSION}" aiohttp
# aiohttp is the API server's runtime dependency (check_api_server_requirements)
WORKDIR /workspace
COPY firewall.sh /usr/local/bin/firewall.sh
COPY handshake.mjs /usr/local/bin/handshake.mjs
COPY hermes-bridge.mjs /usr/local/bin/hermes-bridge.mjs
COPY map-event.mjs /usr/local/bin/map-event.mjs
COPY supervisor.sh /usr/local/bin/supervisor
RUN chmod +x /usr/local/bin/supervisor /usr/local/bin/firewall.sh
ENTRYPOINT ["/usr/local/bin/supervisor"]
