/**
 * Expand an IPv6 address into its eight 16-bit hextets, or null when the value
 * is not a parseable IPv6 address.
 *
 * Textual comparison is not enough for this boundary: the same address has many
 * spellings, and `new URL()` rewrites some of them. `::ffff:127.0.0.1` becomes
 * `::ffff:7f00:1`, and `::1` may arrive fully expanded, so every form has to be
 * reduced to numbers before any range check.
 */
function parseIpv6Hextets(value: string): number[] | null {
  // Drop any zone index (fe80::1%eth0); it does not affect the address.
  let text = value.split("%", 1)[0] ?? "";
  if (!text.includes(":")) return null;

  // A trailing dotted quad (::ffff:127.0.0.1) contributes the low two hextets.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const candidate = text.slice(lastColon + 1);
  if (candidate.includes(".")) {
    const octets = parseIpv4Octets(candidate);
    if (!octets) return null;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = text.slice(0, lastColon);
    // In "64:ff9b::1.2.3.4" the tail's colon closes a "::"; restore it, or the
    // compression parses as a trailing empty group and the address is dropped.
    if (text.endsWith(":")) text += ":";
    // "::1.2.3.4" leaves "::" here, and "1.2.3.4" alone leaves "" — not IPv6.
    if (text === "") return null;
  }

  const compressionParts = text.split("::");
  if (compressionParts.length > 2) return null;

  const parseGroup = (group: string): number[] | null => {
    if (group === "") return [];
    const hextets: number[] = [];
    for (const part of group.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      hextets.push(Number.parseInt(part, 16));
    }
    return hextets;
  };

  const head = parseGroup(compressionParts[0] ?? "");
  const rest = parseGroup(compressionParts[1] ?? "");
  if (!head || !rest) return null;

  const explicit = [...head, ...rest, ...tail];
  if (compressionParts.length === 1) {
    return explicit.length === 8 ? explicit : null;
  }

  // "::" stands for at least one zero hextet.
  if (explicit.length >= 8) return null;
  const zeros = Array.from({ length: 8 - explicit.length }, () => 0);
  return [...head, ...zeros, ...rest, ...tail];
}

function parseIpv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.some((part) => part > 255) ? null : octets;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets as [number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/**
 * True when `address` is an IP address a server-side fetch must not connect to: private
 * networks, loopback, link-local (including cloud metadata at 169.254.169.254), carrier-grade
 * NAT, benchmarking, documentation, multicast and reserved space, in IPv4 or any IPv6 form that
 * carries one of those IPv4 addresses. A value that is not an IP address, such as a hostname,
 * returns false: resolve it first and check every address it resolves to.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  const hextets = parseIpv6Hextets(value);
  if (hextets) {
    const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const zeroPrefix = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0;

    // An address that embeds IPv4 is only as safe as that IPv4 address:
    // IPv4-mapped (::ffff:0:0/96), IPv4-translated (::ffff:0:0:0/96), and the
    // deprecated IPv4-compatible (::/96) forms all reach the v4 host.
    const embedsIpv4 =
      zeroPrefix &&
      ((h4 === 0 && h5 === 0xffff) || (h4 === 0xffff && h5 === 0) || (h4 === 0 && h5 === 0));
    if (embedsIpv4 && (h6 !== 0 || h7 !== 0)) {
      return isPrivateIpv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
    }
    // Translation prefixes route to the IPv4 host they carry, so they are as
    // private as it: NAT64 (64:ff9b::/96) holds it in the low 32 bits and
    // 6to4 (2002::/16) in bits 16-47. Local-use NAT64 (64:ff9b:1::/48) may
    // place it at any RFC 6052 offset, so none of that prefix is public.
    if (h0 === 0x64 && h1 === 0xff9b) {
      if (h2 === 1) return true;
      if (h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
        return isPrivateIpv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
      }
    }
    if (h0 === 0x2002) {
      return isPrivateIpv4([h1 >> 8, h1 & 0xff, h2 >> 8, h2 & 0xff]);
    }

    // Unspecified (::) and loopback (::1) in any spelling.
    if (zeroPrefix && h4 === 0 && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) return true;
    // Discard-only 100::/64, IETF protocol assignments 2001::/23 (Teredo 2001::/32 carries an
    // IPv4 address too), and documentation 2001:db8::/32.
    if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true;
    if (h0 === 0x2001 && (h1 < 0x200 || h1 === 0xdb8)) return true;
    // Unique-local fc00::/7, link-local fe80::/10, deprecated site-local fec0::/10, multicast
    // ff00::/8.
    if ((h0 & 0xfe00) === 0xfc00) return true;
    if ((h0 & 0xffc0) === 0xfe80) return true;
    if ((h0 & 0xffc0) === 0xfec0) return true;
    if ((h0 & 0xff00) === 0xff00) return true;
    return false;
  }

  const octets = parseIpv4Octets(value);
  return octets ? isPrivateIpv4(octets) : false;
}
