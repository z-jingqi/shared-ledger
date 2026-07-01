import { describe, expect, it } from "vitest";
import {
  assertToolBelongsToSkill,
  getLedgerSkill,
  getLedgerTool,
  ledgerSkillNames,
  ledgerSkillRegistry,
  ledgerToolStepSchema,
  listLedgerSkills,
} from "../src";

describe("ledger skill registry", () => {
  it("covers every declared UI capability domain with at least one tool", () => {
    expect(listLedgerSkills().map((skill) => skill.name)).toEqual([...ledgerSkillNames]);
    for (const skillName of ledgerSkillNames) {
      const skill = getLedgerSkill(skillName);
      expect(skill, `${skillName} must be registered`).toBeTruthy();
      expect(skill?.description.trim(), `${skillName} needs a model-facing description`).toBeTruthy();
      expect(skill?.useWhen.trim(), `${skillName} needs selection guidance`).toBeTruthy();
      expect(skill?.tools.length, `${skillName} needs at least one tool`).toBeGreaterThan(0);
    }
  });

  it("requires high-impact tools to use confirmation cards", () => {
    const alwaysConfirm = [
      ["ledger.records", "delete-record"],
      ["ledger.imports", "confirm-import-batch"],
      ["ledger.imports", "cancel-task"],
      ["ledger.categories", "delete-category"],
      ["ledger.books", "delete-book"],
      ["ledger.members", "invite-member"],
      ["ledger.members", "remove-member"],
      ["ledger.export", "export-book"],
    ] as const;

    for (const [skillName, toolName] of alwaysConfirm) {
      expect(getLedgerTool(toolName, skillName)?.confirmation, `${skillName}.${toolName}`).toBe("always");
    }
  });

  it("rejects tool steps that assign a valid tool to the wrong skill", () => {
    const parsed = ledgerToolStepSchema.parse({
      skillName: "ledger.search",
      toolName: "delete-record",
      args: {},
      confidence: 1,
    });

    expect(() => assertToolBelongsToSkill(parsed)).toThrow("不属于 Skill");
  });

  it("does not register duplicate skill names or duplicate tools inside a skill", () => {
    expect(new Set(ledgerSkillRegistry.map((skill) => skill.name)).size).toBe(ledgerSkillRegistry.length);
    for (const skill of ledgerSkillRegistry) {
      expect(new Set(skill.tools.map((tool) => tool.name)).size, skill.name).toBe(skill.tools.length);
    }
  });
});
