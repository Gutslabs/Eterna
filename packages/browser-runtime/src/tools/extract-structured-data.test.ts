import { describe, expect, it } from "vitest";
import { buildFieldContract } from "./extract-structured-data";

describe("buildFieldContract", () => {
  it("annotates each field with its hint and asks the model to fill them", () => {
    const { fieldList, instruction } = buildFieldContract([
      { name: "price", hint: "current price with currency" },
      { name: "sku" },
    ]);
    expect(fieldList).toEqual(["price (current price with currency)", "sku"]);
    expect(instruction).toContain("price (current price with currency)");
    expect(instruction).toContain("sku");
    // The model fills the values — instruction tells it to use null when absent.
    expect(instruction).toContain("null");
  });

  it("degrades gracefully when no fields are requested", () => {
    const { fieldList, instruction } = buildFieldContract([]);
    expect(fieldList).toEqual([]);
    expect(instruction).toBe("No fields were requested.");
  });
});
