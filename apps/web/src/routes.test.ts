import { describe, expect, it } from "vitest";
import { inSection, matchRoute, navigationFor } from "./routes";

describe("Connect an agent", () => {
  it("opens from Settings at its own address, and is not in the navigation", () => {
    expect(matchRoute("/settings/agents")).toMatchObject({ label: "Connect an agent", width: "reading" });
    expect(matchRoute("/settings/agents/")).toMatchObject({ label: "Connect an agent" });
    expect(navigationFor("student").map((route) => route.path)).not.toContain("/settings/agents");
    expect(navigationFor("admin").map((route) => route.path)).not.toContain("/settings/agents");
  });

  it("keeps Settings selected, and Home only on Home", () => {
    expect(inSection("/settings/agents", "/settings")).toBe(true);
    expect(inSection("/settings", "/settings")).toBe(true);
    expect(inSection("/settings-old", "/settings")).toBe(false);
    expect(inSection("/settings/agents", "/")).toBe(false);
    expect(inSection("/", "/")).toBe(true);
  });
});

describe("Make questions", () => {
  it("keeps Import selected, and is not its own item in the navigation", () => {
    expect(inSection("/import/make", "/import")).toBe(true);
    expect(inSection("/import/make/6a1f0b8e-2c4d-4e6f-8a0b-1c2d3e4f5a6b", "/import")).toBe(true);
    expect(inSection("/import/make", "/")).toBe(false);
    expect(navigationFor("student").map((route) => route.path)).not.toContain("/import/make");
  });
});

describe("Home's Recently deleted", () => {
  it("opens from Home at its own address, keeps Home selected, and is not in the navigation", () => {
    expect(matchRoute("/deleted")).toMatchObject({ label: "Recently deleted", width: "reading" });
    expect(inSection("/deleted", "/")).toBe(true);
    expect(inSection("/deleted", "/settings")).toBe(false);
    expect(navigationFor("student").map((route) => route.path)).not.toContain("/deleted");
  });
});
