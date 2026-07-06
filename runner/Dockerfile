FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git curl ripgrep build-essential ca-certificates jq \
    python3 python3-pip nftables openssh-client dnsutils \
 && rm -rf /var/lib/apt/lists/*
# Node 22 (openchamber requires >=22; ubuntu's apt nodejs is older)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
# OpenCode — pin an exact version; treat as a vendored dependency
ARG OPENCODE_VERSION=1.17.13
RUN curl -fsSL https://opencode.ai/install | VERSION=${OPENCODE_VERSION} bash \
 && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode
# openchamber — the per-session workspace UI (handoff-openchamber.md)
ARG OPENCHAMBER_VERSION=1.14.0
RUN npm install -g @openchamber/web@${OPENCHAMBER_VERSION}
WORKDIR /workspace
COPY firewall.sh /usr/local/bin/firewall.sh
COPY handshake.mjs /usr/local/bin/handshake.mjs
COPY bridge.mjs /usr/local/bin/bridge.mjs
COPY supervisor.sh /usr/local/bin/supervisor
RUN chmod +x /usr/local/bin/supervisor /usr/local/bin/firewall.sh
ENTRYPOINT ["/usr/local/bin/supervisor"]
