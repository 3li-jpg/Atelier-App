#!/usr/bin/env bash
# Egress allow-list: drop all outbound except DNS + HTTPS to the given hosts.
# Usage: firewall.sh <url-or-host> [host...]
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
    for ip in $(resolve "$h"); do
      echo "    ip daddr $ip tcp dport 443 accept"
    done
    for ip in $(resolve6 "$h"); do
      echo "    ip6 daddr $ip tcp dport 443 accept"
    done
  done
  echo "  }"
  echo "}"
} | nft -f -

# ponytail: IPs resolved once at boot; CDN rotation can break long sessions.
# Upgrade path: dnsmasq + ipset-style dynamic sets in the production supervisor.
echo "egress firewall active for: ${hosts[*]}"
