import { describe, expect, it } from "vitest"

import { findTestIntegrityViolations } from "./test-integrity.mjs"

function rulesFor(source) {
  return findTestIntegrityViolations("fixture.test.ts", source).map(
    (violation) => violation.rule
  )
}

describe("test integrity scanner", () => {
  it.each([
    "it.skip('disabled', () => { expect(1).toBe(1) })",
    "test.only('focused', () => { expect(1).toBe(1) })",
    "describe.todo('unfinished', () => {})",
  ])("rejects disabled or focused declarations: %s", (source) => {
    expect(rulesFor(source)).toContain("disabled-or-focused-test")
  })

  it.each([
    "it('constant', () => { expect(true).toBe(true) })",
    "test('constant', () => { expect(null).toEqual(null) })",
    "test('constant', () => { expect(undefined).toBe(undefined) })",
  ])("rejects an assertion that cannot observe production behavior", (source) => {
    expect(rulesFor(source)).toContain("constant-assertion")
  })

  it("rejects a test body with no assertion", () => {
    expect(
      rulesFor("it('empty', async () => { await performAction() })")
    ).toContain("assertionless-test")
  })

  it.each([
    "it('inline', () => { expect(result()).toBe('ok') })",
    "test('assert api', () => { assert.equal(result(), 'ok') })",
    "test('helper', async () => { await expectStatus('complete') })",
    "test.each([1, 2])('parameterized %s', (value) => { expect(value).toBeGreaterThan(0) })",
  ])("accepts an observable assertion: %s", (source) => {
    expect(findTestIntegrityViolations("fixture.test.ts", source)).toEqual([])
  })

  it("ignores disabled-test syntax inside comments and strings", () => {
    const source = `
      // test.skip('comment only')
      it('documents syntax', () => {
        const example = "expect(true).toBe(true); test.only('string only')"
        expect(example).toContain('test.only')
      })
    `

    expect(findTestIntegrityViolations("fixture.test.ts", source)).toEqual([])
  })
})
