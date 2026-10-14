import { describe, expect, it } from "vitest"

import { evaluateSheet } from "@/lib/sheet/evaluate"
import { NOW, book, calc, err } from "@/lib/sheet/sheet.test-support"

describe("operators and precedence", () => {
  it.each([
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["-2^2", 4],
    ["2^3^2", 64],
    ["2*-3^2", 18],
    ["2^-1", 0.5],
    ["10%", 0.1],
    ["50%*200", 100],
    ["-10%", -0.1],
    ['"a"&1', "a1"],
    ['1+1&"x"', "2x"],
    ["1+2=3", true],
    ["1<>2", true],
    ["3>=3", true],
    ['"abc"="ABC"', true],
    ['"a"<"B"', true],
    ['1<"a"', true],
    ['"z"<TRUE', true],
    ['1="1"', false],
    ["1e3+.5", 1000.5],
    ['"say ""hi"""', 'say "hi"'],
    ["7/2", 3.5],
    ["+\"a\"", "a"],
    ["--5", 5],
    ["  1 +  2 ", 3],
    ["true", true],
  ])("%s → %j", (formula, expected) => {
    expect(calc(formula)).toEqual(expected)
  })
})

describe("coercion", () => {
  const around = { A1: null, B1: "5", C1: true, D1: "abc" }

  it.each([
    ['"3"+1', 3 + 1],
    ['"abc"+1', err("#VALUE!")],
    ['""+1', err("#VALUE!")],
    ['"TRUE"+1', err("#VALUE!")],
    ["TRUE+1", 2],
    ['"1,000"+1', 1001],
    ['"50%"*2', 1],
    ['"$12.50"*2', 25],
    ['" 3 "+1', 4],
    ['"2024-01-15"+0', 45306],
    ["A1+1", 1],
    ['A1&"x"', "x"],
    ["A1", 0],
    ["A1=0", true],
    ['A1=""', true],
    ["A1=FALSE", true],
    ["B1*2", 10],
    ["C1*2", 2],
    ["D1*2", err("#VALUE!")],
    ['IF("TRUE",1,2)', 1],
    ['IF("abc",1,2)', err("#VALUE!")],
    ["A1:B1", err("#VALUE!")],
    ['1&TRUE', "1TRUE"],
    ['(1/3)&""', "0.333333333333333"],
    ['10^15&""', "1E+15"],
    ['0.0001&""', "0.0001"],
  ])("%s → %j", (formula, expected) => {
    expect(calc(formula, around)).toEqual(expected)
  })
})

describe("errors", () => {
  const around = { A1: "=1/0", A2: 2, A3: "=FOO(1)" }

  it.each([
    ["1/0", "#DIV/0!"],
    ["#N/A+1", "#N/A"],
    ["#N/A+#DIV/0!", "#N/A"],
    ["#N/A=#N/A", "#N/A"],
    ["SUM(A1:A3)", "#DIV/0!"],
    ["A3", "#NAME?"],
    ["FOO(1)", "#NAME?"],
    ["unknownName+1", "#NAME?"],
    ["SUM(A:A)", "#REF!"],
    ["SUM(1:1)", "#REF!"],
    ["BA1", "#REF!"],
    ["A2001", "#REF!"],
    ["Nope!A1", "#REF!"],
    ["ROUND(1,2,3)", "#VALUE!"],
    ["ROUND()", "#VALUE!"],
    ["SQRT(-1)", "#NUM!"],
    ["0^0", "#NUM!"],
    ["10^400", "#NUM!"],
    ["1+", "#ERROR!"],
    ["(1", "#ERROR!"],
    ['"open', "#ERROR!"],
    ["1 2", "#ERROR!"],
    ["{1,2}", "#ERROR!"],
    ["SUM(" + "(".repeat(300) + "1" + ")".repeat(300) + ")", "#ERROR!"],
    ["-".repeat(400) + "1", "#ERROR!"],
    ["1" + "+1".repeat(500), "#ERROR!"],
  ])("%s → %s", (formula, code) => {
    expect(calc(formula, around)).toEqual(err(code))
  })

  it("lets IFERROR and IFNA catch what they name", () => {
    expect(calc('IFERROR(1/0,"none")')).toBe("none")
    expect(calc("IFNA(#N/A,1)")).toBe(1)
    expect(calc("IFNA(1/0,1)")).toEqual(err("#DIV/0!"))
    expect(calc("IFERROR(FOO(),2)")).toBe(2)
  })
})

describe("cross-tab references", () => {
  const others = { "My tab": { A1: 10, A2: 20, A3: "=A1+A2" }, Sheet2: { B1: 7 }, "It's": { A1: "quoted" }, Café: { A1: 3 } }

  it.each([
    ["'My tab'!A1*2", 20],
    ["SUM('My tab'!A1:A3)", 60],
    ["Sheet2!B1+1", 8],
    ["sheet2!b1", 7],
    ["'It''s'!A1", "quoted"],
    ["Café!A1*2", 6],
    ["'My tab'!A3", 30],
    ["Sheet2!A1:'My tab'!A2", err("#REF!")],
  ])("%s → %j", (formula, expected) => {
    expect(calc(formula, {}, others)).toEqual(expected)
  })
})

describe("cycles", () => {
  it("marks every cell on a cycle #CIRC! and leaves the rest alone", () => {
    const { values } = evaluateSheet(
      book({ A1: "=B1", B1: "=C1+1", C1: "=A1", D1: "=A1*2", E1: 5, F1: "=F1", G2: "=SUM(G1:G3)", H1: "=E1+1" }),
      { now: NOW }
    )

    for (const address of ["A1", "B1", "C1", "D1", "F1", "G2"]) {
      expect(values.get(`t1!${address}`), address).toEqual(err("#CIRC!"))
    }
    expect(values.get("t1!E1")).toBe(5)
    expect(values.get("t1!H1")).toBe(6)
  })
})

describe("a 2000-cell dependency chain", () => {
  const chain: Record<string, string | number> = { A1: 1 }
  for (let row = 2; row <= 2000; row += 1) chain[`A${row}`] = `=A${row - 1}+1`

  it("works out the far end without running out of stack", () => {
    expect(calc("A2000", chain)).toBe(2000)
    expect(evaluateSheet(book(chain), { now: NOW }).values.get("t1!A2000")).toBe(2000)
  })

  it("closes a 2000-cell loop as #CIRC!", () => {
    expect(calc("A2000", { ...chain, A1: "=A2000" })).toEqual(err("#CIRC!"))
  })
})

describe("money accuracy", () => {
  // Qty × unit price per line, 7.5% tax rounded to the cent.
  const invoice = {
    B2: 3, C2: 19.99, D2: "=B2*C2",
    B3: 2, C3: 4.35, D3: "=B3*C3",
    B4: 7, C4: 0.15, D4: "=B4*C4",
    D5: "=SUM(D2:D4)", D6: "=ROUND(D5*7.5%,2)", D7: "=D5+D6",
  }

  it.each([
    ["0.1+0.2", 0.3],
    ["0.1+0.2=0.3", true],
    ["1/3*3", 1],
    // Excel takes a sum or difference that is only rounding left over as zero.
    ["1/3*3-1", 0],
    ["1-1/3*3", 0],
    ["0.3/0.1", 3],
    ["1.1*1.1", 1.21],
    ["INT(SUM(0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1))", 1],
    ["ROUND(2.675,2)", 2.68],
    // Binary floating point would give 1.4049999999999998, 3.4499999999999997,
    // 0.19999999999999998 and 22.999999999999996 here, and round the wrong way.
    ["ROUND(1.4+0.005,2)", 1.41],
    ["ROUND(1.15*3,1)", 3.5],
    ["ROUNDDOWN((0.3-0.1)*10,0)", 2],
    ["INT(2.3/0.1)", 23],
    ["ROUND(-2.5,0)", -3],
    ["D4", 1.05],
    ["D5", 69.72],
    ["D6", 5.23],
    ["D7", 74.95],
  ])("%s → %j", (formula, expected) => {
    expect(calc(formula, invoice)).toBe(expected)
  })
})

describe("evaluateSheet", () => {
  it("returns typed-in values, worked-out values and the cells in error", () => {
    const { values, errors } = evaluateSheet(book({ A1: 2, A2: "=A1*3", A3: "=A1/0", A4: "text" }, { Two: { A1: "=Sheet1!A2" } }), { now: NOW })

    expect(Object.fromEntries(values)).toEqual({
      "t1!A1": 2,
      "t1!A2": 6,
      "t1!A3": err("#DIV/0!"),
      "t1!A4": "text",
      "t2!A1": 6,
    })
    expect(Object.fromEntries(errors)).toEqual({ "t1!A3": "#DIV/0!" })
  })

  it("reads today in the time zone it is given", () => {
    const late = new Date("2024-02-28T23:30:00Z")

    expect(evaluateSheet(book({ A1: "=TODAY()" }), { now: late }).values.get("t1!A1")).toBe(45350)
    expect(evaluateSheet(book({ A1: "=TODAY()" }), { now: late, timeZone: "Africa/Lagos" }).values.get("t1!A1")).toBe(45351)
  })

  it("works out a 2000-row × 5-column sheet of SUM, IF and VLOOKUP quickly", () => {
    const entries: Record<string, string | number> = {}
    for (let row = 1; row <= 2000; row += 1) {
      entries[`A${row}`] = row
      entries[`B${row}`] = (row * 7) % 100
      entries[`C${row}`] = `=IF(B${row}>50,"high","low")`
      entries[`D${row}`] = `=VLOOKUP(${2001 - row},$A$1:$B$2000,2,FALSE)`
      entries[`E${row}`] = `=SUM($B$1:B${row})`
    }

    const started = performance.now()
    const { values } = evaluateSheet(book(entries), { now: NOW })
    const elapsed = performance.now() - started

    expect(values.get("t1!C2")).toBe("low")
    expect(values.get("t1!D1")).toBe((2000 * 7) % 100)
    expect(values.get("t1!E2000")).toBe(Array.from({ length: 2000 }, (_, at) => ((at + 1) * 7) % 100).reduce((a, b) => a + b))
    expect(elapsed).toBeLessThan(5000)
    console.info(`2000×5 sheet worked out in ${elapsed.toFixed(0)} ms`)
  })

  it("refuses a sheet that would take too long to work out", () => {
    const heavy = Object.fromEntries(Array.from({ length: 2000 }, (_, at) => [`AZ${at + 1}`, "=SUM(A1:AY2000)+SUM(A1:AY2000)+SUM(A1:AY2000)"]))

    expect(() => evaluateSheet(book(heavy), { now: NOW })).toThrow(RangeError)
  })
})
