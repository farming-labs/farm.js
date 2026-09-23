// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPrivateImageAddress } from "../image-server";

const MUST_BLOCK = [
  "127.0.0.1",
  "10.0.0.1",
  "192.168.1.1",
  "169.254.1.1",
  "172.16.0.1",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "198.18.0.1",
  "192.0.0.1",
  "::1",
  "::",
  "fd00::1",
  "fc00::1",
  "fe80::1",
  "ff02::1",
  "0:0:0:0:0:0:0:1",
  "0000:0000:0000:0000:0000:0000:0000:0001",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:7f00:0001",
  "[::ffff:7f00:1]",
  "0:0:0:0:0:ffff:7f00:1",
  "::ffff:a00:1",
  "::ffff:c0a8:1",
  "::ffff:a9fe:1",
  "::ffff:ac10:1",
  "::ffff:6440:1",
  "::7f00:1",
  "::ffff:0:7f00:1",
  "fe80::1%eth0",
];

const MUST_ALLOW = [
  "1.2.3.4",
  "8.8.8.8",
  "93.184.216.34",
  "172.32.0.1",
  "192.1.0.1",
  "100.128.0.1",
  "2606:2800:220:1:248:1893:25c8:1946",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8",
  "::ffff:808:808",
  "not-an-address",
  "",
  "example.com",
];

describe("private image address classification", () => {
  it("blocks every private form", () => {
    const leaked = MUST_BLOCK.filter((value) => !isPrivateImageAddress(value));
    expect(leaked).toEqual([]);
  });

  it("allows public addresses and non-addresses", () => {
    const overblocked = MUST_ALLOW.filter((value) => isPrivateImageAddress(value));
    expect(overblocked).toEqual([]);
  });
});
