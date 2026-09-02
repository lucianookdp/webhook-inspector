// Masks the low-order bits of an address rather than dropping it entirely,
// keeping it useful for coarse abuse patterns (same /24 or /48) without
// pinning down an individual caller.
export function maskIp(ip: string | undefined | null): string | undefined {
  if (!ip) return undefined;

  if (ip.includes(':')) {
    const groups = ip.split(':');
    return `${groups.slice(0, 3).join(':')}::`;
  }

  const octets = ip.split('.');
  if (octets.length === 4) {
    octets[3] = '0';
    return octets.join('.');
  }

  return ip;
}
