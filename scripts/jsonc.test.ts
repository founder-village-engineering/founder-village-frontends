import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc.ts";

describe("parseJsonc", () => {
  it("supports comments and trailing commas without changing string contents", () => {
    expect(
      parseJsonc(`{
        // static Pages configuration
        "name": "commas,} and // stay",
        /* no Worker entrypoint */
        "pages_build_output_dir": "./dist",
      }`),
    ).toEqual({
      name: "commas,} and // stay",
      pages_build_output_dir: "./dist",
    });
  });

  it("rejects an unterminated block comment", () => {
    expect(() => parseJsonc("{/* nope")).toThrow("unterminated JSONC comment");
  });
});
