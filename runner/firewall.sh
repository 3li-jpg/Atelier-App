#!/usr/bin/env bash
# Egress allow-list: drop all outbound except DNS + HTTPS to the given hosts.
# Usage: firewall.sh <url-or-host> [host...]
#
# Cross-session isolation boundary (audit M4): the default-drop policy here is
# what stops one sandbox machine reaching another's openchamber (:3000) over Fly
# 6PN. Inbound is intentionally unfiltered (the workspace proxy is the legit
# ingress). This is fail-closed — supervisor.sh runs under `set -e`, so if nft
# fails to apply, the session never starts. Don't add broad allow rules without
# considering cross-session reachability.
set -euo pipefail

hosts=()
for arg in "$@"; do
  h="${arg#*://}"; h="${h%%/*}"; h="${h%%:*}"
  hosts+=("$h")
done

resolve() { dig +short "$1" A | grep -E '^[0-9.]+$' || true; }
resolve6() { dig +short "$1" AAAA | grep -E '^[0-9a-fA-F:]+$' || true; }

{
  echo "flush ruleset"
  echo "table inet egress {"
  echo "  chain output {"
  echo "    type filter hook output priority 0; policy drop;"
  echo "    ct state established,related accept"
  echo "    oif lo accept"
  # ICMPv6 neighbor discovery — without it IPv6 is dead, incl. Fly's fdaa::3 DNS
  echo "    meta l4proto ipv6-icmp accept"
  echo "    udp dport 53 accept"
  echo "    tcp dport 53 accept"
  for h in "${hosts[@]}"; do
    ips=$(resolve "$h"); ip6s=$(resolve6 "$h")
    if [[ -z "$ips" && -z "$ip6s" ]]; then
      echo "firewall: WARNING: no IPs resolved for $h — it will be unreachable" >&2
    fi
    for ip in $ips; do echo "    ip daddr $ip tcp dport 443 accept"; done
    for ip in $ip6s; do echo "    ip6 daddr $ip tcp dport 443 accept"; done
  done
  echo "  }"
  echo "}"
} | nft -f -

# ponytail: IPs resolved once at boot; CDN rotation can break long sessions.
# Upgrade path: dnsmasq + ipset-style dynamic sets in the production supervisor.
echo "egress firewall active for: ${hosts[*]}"
