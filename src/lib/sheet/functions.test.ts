import { describe, expect, it } from "vitest"

import { calc, err } from "@/lib/sheet/sheet.test-support"

type Case = [string, unknown]

const check = (around: Parameters<typeof calc>[1]) => (formula: string, expected: unknown) => {
  expect(calc(formula, around)).toEqual(expected)
}

describe("logic", () => {
  it.each<Case>([
    ['IF(1>2,"a","b")', "b"],
    ["IF(FALSE,1)", false],
    ["IF(TRUE,,2)", 0],
    ['IFS(1>2,"a",TRUE,"b")', "b"],
    ["IFS(FALSE,1)", err("#N/A")],
    ["IFS(TRUE)", err("#VALUE!")],
    ["AND(TRUE,1)", true],
    ["AND(TRUE,0)", false],
    ["AND(A1:A3)", err("#VALUE!")],
    ["AND(B1:B2)", true],
    ['AND("x")', err("#VALUE!")],
    ["OR(FALSE,0)", false],
    ["OR(B1:B2,FALSE)", true],
    ["NOT(0)", true],
    ['NOT("abc")', err("#VALUE!")],
  ])("%s → %j", check({ B1: true, B2: "text" }))
})

describe("maths", () => {
  const around = { A1: 1, A2: "2", A3: true, A4: null, A5: 3, B1: "x" }

  it.each<Case>([
    ['SUM(1,"2",TRUE)', 4],
    ["SUM(A1:A5)", 4],
    ["SUM(A2)", 0],
    ['SUM("x")', err("#VALUE!")],
    ["SUM()", err("#VALUE!")],
    ["COUNT(A1:A5)", 2],
    ['COUNT(1,"2",TRUE,"x")', 3],
    ["COUNTA(A1:A5)", 4],
    ["COUNTBLANK(A1:A5)", 1],
    ["COUNTBLANK(C1:C2)", 2],
    ["COUNTBLANK(1)", err("#VALUE!")],
    ["AVERAGE(A1:A5)", 2],
    ["AVERAGE(B1)", err("#DIV/0!")],
    ["MIN(A1:A5)", 1],
    ["MIN(C1:C3)", 0],
    ["MAX(1,5,3)", 5],
    ["MAX(-1,A4)", -1],
    ["PRODUCT(2,3,4)", 24],
    ["PRODUCT(C1:C2)", 0],
    ["ROUND(3.14159,2)", 3.14],
    ["ROUND(1234.5,-2)", 1200],
    ["ROUND(2.5,0)", 3],
    ["ROUNDUP(3.141,2)", 3.15],
    ["ROUNDUP(-3.141,2)", -3.15],
    ["ROUNDDOWN(-3.149,2)", -3.14],
    ["ROUNDDOWN(3.99,0.9)", 3],
    ["ABS(-3)", 3],
    ["MOD(10,3)", 1],
    ["MOD(-3,2)", 1],
    ["MOD(3,-2)", -1],
    ["MOD(5.5,1)", 0.5],
    ["MOD(5,0)", err("#DIV/0!")],
    ["INT(-1.5)", -2],
    ["INT(1.9)", 1],
    ["SQRT(16)", 4],
    ["SQRT(-1)", err("#NUM!")],
    ["POWER(2,10)", 1024],
    ["POWER(-8,1/3)", err("#NUM!")],
    ["POWER(0,-1)", err("#DIV/0!")],
  ])("%s → %j", check(around))
})

describe("conditional aggregates", () => {
  const around = {
    A1: 100, A2: 250, A3: "Paid", A4: "paid", A5: "Pending", A6: null,
    B1: 1, B2: 2, B3: 3, B4: 4, B5: 5, B6: 6,
    C1: "a*", C2: "ab", D1: "1", D2: 1, L1: "a".repeat(5000),
  }

  it.each<Case>([
    ['COUNTIF(A1:A6,">=100")', 2],
    ['COUNTIF(A1:A6,">100")', 1],
    ['COUNTIF(A1:A6,"<>Paid")', 4],
    ['COUNTIF(A1:A6,"Pai*")', 2],
    ['COUNTIF(A1:A6,"P?id")', 2],
    ['COUNTIF(A1:A6,"p*")', 3],
    ['COUNTIF(A1:A6,"")', 1],
    ['COUNTIF(A1:A6,"<>")', 5],
    ["COUNTIF(A1:A6,100)", 1],
    ['COUNTIF(A1:A6,"100")', 1],
    ['COUNTIF(A1:A6,"=Paid")', 2],
    ['COUNTIF(A1:A6,"<Q")', 3],
    ['COUNTIF(C1:C2,"a~*")', 1],
    // Would backtrack for ages as a regular expression.
    ['COUNTIF(L1,"*a*a*a*a*a*a*a*a*a*a*b")', 0],
    ["COUNTIF(D1:D2,1)", 2],
    ['SUMIF(A1:A6,"paid",B1:B6)', 7],
    ['SUMIF(A1:A6,">100")', 250],
    ['SUMIF(A1:A6,"paid",B1:B2)', err("#VALUE!")],
    ['SUMIFS(B1:B6,A1:A6,"P*",B1:B6,">3")', 9],
    ['SUMIFS(B1:B6,A1:A6,"P*",B1:B5,">3")', err("#VALUE!")],
    ['COUNTIFS(A1:A6,"p*",B1:B6,"<4")', 1],
    ['AVERAGEIF(A1:A6,">0")', 175],
    ['AVERAGEIF(A1:A6,"Pai*",B1:B6)', 3.5],
    ['AVERAGEIF(A1:A6,"zzz")', err("#DIV/0!")],
    ['COUNTIF(A1:A6,1/0)', err("#DIV/0!")],
  ])("%s → %j", check(around))
})

describe("lookups", () => {
  const around = {
    A1: "Apple", B1: 1.5, C1: "Fruit",
    A2: "Bread", B2: 2.25, C2: "Bakery",
    A3: "Cheese", B3: 4, C3: "Dairy",
    A4: "Dates", B4: 6, C4: "Fruit",
    E1: 0, F1: 0, E2: 100, F2: 0.05, E3: 500, F3: 0.1, E4: 1000, F4: 0.15,
    G1: 30, G2: 20, G3: 10,
    H1: 10, I1: 20, J1: 30, K1: 40, H2: "a", I2: "b", J2: "c", K2: "d",
  }

  it.each<Case>([
    ['VLOOKUP("bread",A1:C4,2,FALSE)', 2.25],
    ['VLOOKUP("Zed",A1:C4,2,FALSE)', err("#N/A")],
    ['VLOOKUP("b*",A1:C4,3,FALSE)', "Bakery"],
    ['VLOOKUP("Apple",A1:C4,4,FALSE)', err("#REF!")],
    ['VLOOKUP("Apple",A1:C4,0,FALSE)', err("#VALUE!")],
    ["VLOOKUP(750,E1:F4,2,TRUE)", 0.1],
    ["VLOOKUP(750,E1:F4,2)", 0.1],
    ["VLOOKUP(5000,E1:F4,2)", 0.15],
    ["VLOOKUP(-1,E1:F4,2)", err("#N/A")],
    ['VLOOKUP("1",E1:F4,2,FALSE)', err("#N/A")],
    ["HLOOKUP(25,H1:K2,2)", "b"],
    ["HLOOKUP(30,H1:K2,2,FALSE)", "c"],
    ['MATCH("cheese",A1:A4,0)', 3],
    ["MATCH(750,E1:E4,1)", 3],
    ["MATCH(750,E1:E4)", 3],
    ["MATCH(-1,E1:E4)", err("#N/A")],
    ["MATCH(15,G1:G3,-1)", 2],
    ["MATCH(1,A1:C4,0)", err("#N/A")],
    ["INDEX(A1:C4,2,3)", "Bakery"],
    ["INDEX(A1:C4,5,1)", err("#REF!")],
    ["SUM(INDEX(E1:F4,0,2))", 0.3],
    ["INDEX(H1:K1,2)", 20],
    ['INDEX(A1:C4,MATCH("Dates",A1:A4,0),2)', 6],
    ['XLOOKUP("Cheese",A1:A4,B1:B4)', 4],
    ['XLOOKUP("Zed",A1:A4,B1:B4,"none")', "none"],
    ['XLOOKUP("Zed",A1:A4,B1:B4)', err("#N/A")],
    ["XLOOKUP(750,E1:E4,F1:F4,,-1)", 0.1],
    ["XLOOKUP(750,E1:E4,F1:F4,,1)", 0.15],
    ["XLOOKUP(500,E1:E4,F1:F4,,1)", 0.1],
    ["XLOOKUP(5000,E1:E4,F1:F4,,1)", err("#N/A")],
    ['XLOOKUP("Fruit",C1:C4,A1:A4,,0,-1)', "Dates"],
    ['XLOOKUP("Bread",A1:A4,B1:C4)', err("#VALUE!")],
    ['XLOOKUP("Cheese",A1:A4,B1:B3)', err("#VALUE!")],
  ])("%s → %j", check(around))
})

describe("dates", () => {
  it.each<Case>([
    ["DATE(2024,2,29)", 45351],
    ["DATE(2023,2,29)", 44986],
    ["DATE(1900,2,28)", 59],
    ["DATE(1900,2,29)", 60],
    ["DATE(1900,3,1)", 61],
    ["DATE(1900,3,0)", 60],
    ["DATE(1900,1,1)", 1],
    ["DATE(24,1,1)", 8767],
    ["DATE(2024,14,1)=DATE(2025,2,1)", true],
    ["DATE(2024,1,0)=DATE(2023,12,31)", true],
    ["DATE(10000,1,1)", err("#NUM!")],
    ["DATE(1899,12,31)", 693962],
    ["DAY(60)", 29],
    ["MONTH(60)", 2],
    ["YEAR(60)", 1900],
    ["DAY(61)", 1],
    ["DAY(0)", 0],
    ["YEAR(-1)", err("#NUM!")],
    ['YEAR("2024-02-29")', 2024],
    ["EDATE(DATE(2024,1,31),1)", 45351],
    ["EDATE(DATE(2024,3,31),-1)", 45351],
    ["EDATE(DATE(2024,2,29),12)", 45716],
    ["EOMONTH(DATE(2024,1,15),1)", 45351],
    ["EOMONTH(DATE(2024,1,15),0)", 45322],
    ['DATEDIF(DATE(2020,2,29),DATE(2024,2,28),"Y")', 3],
    ['DATEDIF(DATE(2020,2,29),DATE(2024,2,28),"M")', 47],
    ['DATEDIF(DATE(2020,2,29),DATE(2024,2,28),"D")', 1460],
    ['DATEDIF(DATE(2024,1,31),DATE(2024,2,29),"m")', 0],
    ['DATEDIF(DATE(2024,2,1),DATE(2024,1,1),"D")', err("#NUM!")],
    ['DATEDIF(DATE(2024,1,1),DATE(2024,2,1),"W")', err("#NUM!")],
    ["WEEKDAY(DATE(2024,2,29))", 5],
    ["WEEKDAY(DATE(2024,2,29),2)", 4],
    ["WEEKDAY(DATE(2024,2,29),3)", 3],
    ["WEEKDAY(1)", 1],
    ["WEEKDAY(1,9)", err("#NUM!")],
    ["TODAY()", 45351],
    ["NOW()", 45351.4375],
  ])("%s → %j", check({}))
})

describe("text", () => {
  const around = { A1: "a", B1: null, C1: "c", D1: 12.5, L1: "a".repeat(5000) }

  it.each<Case>([
    ['TEXT(DATE(2024,2,29),"dd/mm/yyyy")', "29/02/2024"],
    ['TEXT(DATE(2024,2,29),"mmm yyyy")', "Feb 2024"],
    ['TEXT(DATE(2024,2,29),"yyyy-mm-dd")', "2024-02-29"],
    ['TEXT(DATE(2024,2,29),"dddd d mmmm yy")', "Thursday 29 February 24"],
    ['TEXT(NOW(),"hh:mm")', "10:30"],
    ['TEXT(1234.5,"#,##0.00")', "1,234.50"],
    ['TEXT(-1234567,"#,##0")', "-1,234,567"],
    ['TEXT(0.256,"0%")', "26%"],
    ['TEXT(0.256,"0.0%")', "25.6%"],
    ['TEXT(2.5,"0")', "3"],
    ['TEXT(1.005,"0.00")', "1.01"],
    ['TEXT(0.5,"#.00")', ".50"],
    ['TEXT(1.5,"0.0#")', "1.5"],
    ['TEXT(1234.5,"$#,##0.00")', "$1,234.50"],
    ['TEXT("abc","0.00")', "abc"],
    ['TEXT(1,"[Red]0")', err("#VALUE!")],
    ['CONCAT("x",A1:C1,1)', "xac1"],
    ['CONCATENATE("a","b",D1)', "ab12.5"],
    ["CONCATENATE(A1:C1)", err("#VALUE!")],
    ['TEXTJOIN(", ",TRUE,A1:C1,"d")', "a, c, d"],
    ['TEXTJOIN("-",FALSE,A1:C1)', "a--c"],
    ['LEFT("Hello",2)', "He"],
    ['LEFT("Hello")', "H"],
    ['LEFT("Hello",-1)', err("#VALUE!")],
    ['RIGHT("Hello",3)', "llo"],
    ['RIGHT("Hi",5)', "Hi"],
    ['MID("Hello",2,3)', "ell"],
    ['MID("Hello",9,3)', ""],
    ['MID("Hello",0,1)', err("#VALUE!")],
    ['LEN("Hello")', 5],
    ["LEN(D1)", 4],
    ["LEN(B1)", 0],
    ['UPPER("abc")', "ABC"],
    ['LOWER("ABC")', "abc"],
    ['PROPER("hello o\'neil 2-way STREET")', "Hello O'Neil 2-Way Street"],
    ['TRIM("  a   b  ")', "a b"],
    ['SUBSTITUTE("a-b-c","-","+")', "a+b+c"],
    ['SUBSTITUTE("a-b-c","-","+",2)', "a-b+c"],
    ['SUBSTITUTE("abc","","x")', "abc"],
    ['VALUE("1,234.5")', 1234.5],
    ['VALUE("abc")', err("#VALUE!")],
    ["VALUE(TRUE)", err("#VALUE!")],
    // 32,767 characters is the most a cell holds.
    ["LEN(CONCAT(L1,L1,L1,L1,L1,L1))", 30000],
    ["CONCAT(L1,L1,L1,L1,L1,L1,L1)", err("#VALUE!")],
    ["L1&L1&L1&L1&L1&L1&L1", err("#VALUE!")],
    ['TEXTJOIN("",TRUE,L1,L1,L1,L1,L1,L1,L1)', err("#VALUE!")],
    ["SUBSTITUTE(L1,A1,L1)", err("#VALUE!")],
  ])("%s → %j", check(around))
})
