FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git curl ripgrep build-essential ca-certificates jq \
    nodejs npm python3 python3-pip nftables openssh-client dnsutils \
 && rm -rf /var/lib/apt/lists/*
# OpenCode — pin an exact version; treat as a vendored dependency
ARG OPENCODE_VERSION=1.17.13
RUN curl -fsSL https://opencode.ai/install | VERSION=${OPENCODE_VERSION} bash \
 && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode
WORKDIR /workspace
COPY firewall.sh /usr/local/bin/firewall.sh
COPY handshake.mjs /usr/local/bin/handshake.mjs
COPY bridge.mjs /usr/local/bin/bridge.mjs
COPY supervisor.sh /usr/local/bin/supervisor
RUN chmod +x /usr/local/bin/supervisor /usr/local/bin/firewall.sh
ENTRYPOINT ["/usr/local/bin/supervisor"]
