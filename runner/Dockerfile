FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git curl ripgrep build-essential ca-certificates jq \
    python3 python3-pip python3-venv nftables openssh-client dnsutils \
 && rm -rf /var/lib/apt/lists/*
# Node 22 (bridge.mjs requires Node 18+; ubuntu's apt nodejs is older)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
# OpenCode CLI — the agent runtime (installed via the official curl installer).
# The curl installer places the binary in /usr/local/bin or $HOME/.local/bin.
RUN curl -fsSL https://opencode.ai/install | bash \
 && ln -sf /root/.local/bin/opencode /usr/local/bin/opencode 2>/dev/null || true
ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /workspace
COPY firewall.sh /usr/local/bin/firewall.sh
COPY handshake.mjs /usr/local/bin/handshake.mjs
COPY opencode-bridge.mjs /usr/local/bin/opencode-bridge.mjs
COPY opencode-map.mjs /usr/local/bin/opencode-map.mjs
COPY supervisor.sh /usr/local/bin/supervisor
RUN chmod +x /usr/local/bin/supervisor /usr/local/bin/firewall.sh
ENTRYPOINT ["/usr/local/bin/supervisor"]
