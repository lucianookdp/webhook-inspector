import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';

export class ForwardBlockedError extends Error {}

// Everything a forward target must never resolve to: loopback, private/
// carrier-grade-NAT/link-local ranges (169.254.0.0/16 covers the cloud
// metadata endpoint at 169.254.169.254), multicast, and the various IANA
// reserved/documentation/benchmark blocks. This is deliberately a blocklist
// of the *disallowed* ranges rather than an allowlist of "the public
// internet" — there's no such single range to allow — so anything not
// explicitly listed here is treated as reachable.
//
// IPv4 and IPv6 rules are kept in separate BlockList instances rather than
// one shared one: BlockList.check() treats an IPv4 address as also matching
// against IPv6 subnets it's equivalent to in mapped form, so an IPv6
// ::ffff:0:0/96 rule (added below to blanket-block IPv4-mapped addresses)
// in the same list ends up matching every plain IPv4 address too.
const blockListV4 = new BlockList();
const blockListV6 = new BlockList();

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
] as const) {
  blockListV4.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) addresses embed an
  // IPv4 address; blocking the whole mapped range rather than unpacking and
  // separately validating the embedded address is simpler and, since a
  // forward target has no legitimate reason to be expressed this way, costs
  // nothing real.
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockListV6.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockListV4.check(address, 'ipv4');
  if (family === 6) return blockListV6.check(address, 'ipv6');
  // Not a literal IP at all — the caller passed something malformed.
  return true;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

// Resolves a forward target's hostname and validates every answer, rejecting
// the whole hostname if any single answer is disallowed rather than only
// the bad one — a resolver returning a mix of public and internal addresses
// is itself a signal not to trust it. The returned address is meant to be
// used directly for the outbound connection (see routes/forward.js) instead
// of letting the HTTP client re-resolve the hostname at connect time, which
// would reopen exactly the DNS-rebinding gap this function exists to close.
export async function resolveSafeAddress(hostname: string): Promise<ResolvedAddress> {
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (isBlockedAddress(hostname)) {
      throw new ForwardBlockedError(`${hostname} is not a permitted forward target`);
    }
    return { address: hostname, family: literalFamily as 4 | 6 };
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ForwardBlockedError(`could not resolve ${hostname}`);
  }
  if (answers.length === 0) {
    throw new ForwardBlockedError(`could not resolve ${hostname}`);
  }
  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) {
      throw new ForwardBlockedError(`${hostname} resolves to a disallowed address`);
    }
  }

  const [first] = answers;
  return { address: first.address, family: first.family as 4 | 6 };
}
