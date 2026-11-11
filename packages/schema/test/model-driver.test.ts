/** @file Tests for `driverOf`: a model value that names its driver (RFC-015). */

import { describe, expect, it } from "vitest";

import { driverOf } from "../src/index.ts";

const DRIVERS = ["claude-code", "open-code", "command-code"];

describe("driverOf", () => {
  it("splits a registered driver id from the model", () => {
    expect(driverOf("claude-code.sonnet", DRIVERS)).toEqual({
      driver: "claude-code",
      model: "sonnet",
    });
  });

  it("hands the rest to the tool as it is, dots and slashes included", () => {
    expect(
      driverOf("command-code.deepseek/deepseek-v4.1-flash", DRIVERS),
    ).toEqual({
      driver: "command-code",
      model: "deepseek/deepseek-v4.1-flash",
    });
    expect(driverOf("open-code.anthropic/claude-sonnet-5-5", DRIVERS)).toEqual({
      driver: "open-code",
      model: "anthropic/claude-sonnet-5-5",
    });
  });

  it("keeps a plain model whole, even with a dot or a slash", () => {
    expect(driverOf("sonnet", DRIVERS)).toEqual({ model: "sonnet" });
    expect(driverOf("deepseek/deepseek-v4.1-flash", DRIVERS)).toEqual({
      model: "deepseek/deepseek-v4.1-flash",
    });
    expect(driverOf("gpt-5.1", DRIVERS)).toEqual({ model: "gpt-5.1" });
  });

  it("does not take a driver that is not registered", () => {
    expect(driverOf("claude-code.sonnet", ["open-code"])).toEqual({
      model: "claude-code.sonnet",
    });
  });

  it("does not take an empty prefix", () => {
    expect(driverOf(".sonnet", DRIVERS)).toEqual({ model: ".sonnet" });
  });
});
