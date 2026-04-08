import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { isLocalDiagnosticsRequest } from "../../../rutere/debug/authDiagnostic.js";

function lagRequest(
  values: Partial<Pick<Request, "ip" | "ips" | "socket">>,
): Pick<Request, "ip" | "ips" | "socket"> {
  return {
    ip: values.ip ?? "",
    ips: values.ips ?? [],
    socket: {
      remoteAddress: values.socket?.remoteAddress ?? "",
    } as Request["socket"],
  };
}

describe("isLocalDiagnosticsRequest", () => {
  it("tillater IPv4 loopback", () => {
    expect(
      isLocalDiagnosticsRequest(
        lagRequest({
          ip: "127.0.0.1",
          socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
        }),
      ),
    ).toBe(true);
  });

  it("tillater IPv6 loopback og IPv4-mapped loopback", () => {
    expect(
      isLocalDiagnosticsRequest(
        lagRequest({
          ip: "::1",
          socket: { remoteAddress: "::ffff:127.0.0.1" } as Request["socket"],
        }),
      ),
    ).toBe(true);
  });

  it("avviser ekstern trafikk", () => {
    expect(
      isLocalDiagnosticsRequest(
        lagRequest({
          ip: "203.0.113.10",
          ips: ["203.0.113.10"],
          socket: { remoteAddress: "203.0.113.10" } as Request["socket"],
        }),
      ),
    ).toBe(false);
  });
});
