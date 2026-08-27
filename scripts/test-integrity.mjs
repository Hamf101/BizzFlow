import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"

const TEST_FILE_PATTERN = /(?:\.test\.(?:ts|tsx|mjs)|\.spec\.ts)$/
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".planning",
  "artifacts",
  "node_modules",
  "playwright-report",
  "test-results",
])
const TEST_DECLARATION_ROOTS = new Set(["it", "test"])
const TEST_GROUP_ROOTS = new Set(["describe", "it", "test"])
const DISABLED_OR_FOCUSED_MODIFIERS = new Set(["only", "skip", "todo"])

function getScriptKind(filePath) {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX
  }

  if (filePath.endsWith(".mjs")) {
    return ts.ScriptKind.JS
  }

  return ts.ScriptKind.TS
}

function getRootIdentifier(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return getRootIdentifier(expression.expression)
  }

  if (ts.isCallExpression(expression)) {
    return getRootIdentifier(expression.expression)
  }

  return null
}

function isTestInvocation(expression) {
  const rootIdentifier = getRootIdentifier(expression)
  return rootIdentifier !== null && TEST_DECLARATION_ROOTS.has(rootIdentifier)
}

function getTestCallback(callExpression) {
  return [...callExpression.arguments]
    .reverse()
    .find(
      (argument) =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
    )
}

function isAssertionCall(callExpression) {
  const rootIdentifier = getRootIdentifier(callExpression.expression)

  return (
    rootIdentifier === "assert" ||
    rootIdentifier === "expect" ||
    rootIdentifier === "expectTypeOf" ||
    (rootIdentifier !== null && /^expect[A-Z_]/.test(rootIdentifier)) ||
    (rootIdentifier !== null && /^assert[A-Z_]/.test(rootIdentifier))
  )
}

function hasAssertion(node) {
  let found = false

  function visit(child) {
    if (found) {
      return
    }

    if (ts.isCallExpression(child) && isAssertionCall(child)) {
      found = true
      return
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return found
}

function getConstantValue(node) {
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return node.kind
  }

  if (ts.isIdentifier(node) && node.text === "undefined") {
    return "undefined"
  }

  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return `${node.kind}:${node.text}`
  }

  return null
}

function isConstantAssertion(callExpression) {
  if (!ts.isPropertyAccessExpression(callExpression.expression)) {
    return false
  }

  const matcher = callExpression.expression.name.text
  const receivedCall = callExpression.expression.expression

  if (
    !["toBe", "toEqual"].includes(matcher) ||
    !ts.isCallExpression(receivedCall) ||
    getRootIdentifier(receivedCall.expression) !== "expect" ||
    receivedCall.arguments.length !== 1 ||
    callExpression.arguments.length !== 1
  ) {
    return false
  }

  const received = getConstantValue(receivedCall.arguments[0])
  const expected = getConstantValue(callExpression.arguments[0])

  return received !== null && received === expected
}

function createViolation(filePath, sourceFile, node, rule, message) {
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  )

  return {
    filePath,
    line: location.line + 1,
    message,
    rule,
  }
}

/**
 * Finds structural patterns that can let a test suite pass without observing
 * production behavior.
 *
 * @param {string} filePath - Repository-relative path used in diagnostics.
 * @param {string} source - Test source to inspect.
 * @returns {Array<{filePath: string, line: number, message: string, rule: string}>}
 *   Test-integrity violations in source order.
 */
export function findTestIntegrityViolations(filePath, source) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  )
  const violations = []

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        DISABLED_OR_FOCUSED_MODIFIERS.has(node.expression.name.text) &&
        TEST_GROUP_ROOTS.has(getRootIdentifier(node.expression) ?? "")
      ) {
        violations.push(
          createViolation(
            filePath,
            sourceFile,
            node,
            "disabled-or-focused-test",
            "Tests may not be skipped, focused, or left as todo."
          )
        )
      }

      if (isConstantAssertion(node)) {
        violations.push(
          createViolation(
            filePath,
            sourceFile,
            node,
            "constant-assertion",
            "Assertion compares a constant with itself and cannot observe behavior."
          )
        )
      }

      if (isTestInvocation(node.expression)) {
        const callback = getTestCallback(node)

        if (callback && !hasAssertion(callback.body)) {
          violations.push(
            createViolation(
              filePath,
              sourceFile,
              node,
              "assertionless-test",
              "Test body has no direct assertion or assertion helper."
            )
          )
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

function collectTestFiles(directoryPath) {
  const files = []

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...collectTestFiles(join(directoryPath, entry.name)))
      }
      continue
    }

    const filePath = join(directoryPath, entry.name)
    if (entry.isFile() && TEST_FILE_PATTERN.test(filePath)) {
      files.push(filePath)
    }
  }

  return files
}

/**
 * Scans every repository test file and returns structural integrity failures.
 *
 * @param {string} repositoryRoot - Absolute repository directory.
 * @returns {Array<{filePath: string, line: number, message: string, rule: string}>}
 *   All detected violations sorted by path and line.
 */
export function scanRepositoryTests(repositoryRoot) {
  return collectTestFiles(repositoryRoot)
    .flatMap((filePath) =>
      findTestIntegrityViolations(
        filePath.slice(repositoryRoot.length + 1),
        readFileSync(filePath, "utf8")
      )
    )
    .sort((left, right) =>
      left.filePath.localeCompare(right.filePath) || left.line - right.line
    )
}

function main() {
  const repositoryRoot = process.cwd()
  const violations = scanRepositoryTests(repositoryRoot)

  if (violations.length === 0) {
    console.log("Test integrity: no disabled, trivial, or assertionless tests.")
    return
  }

  for (const violation of violations) {
    console.error(
      `${violation.filePath}:${violation.line} [${violation.rule}] ${violation.message}`
    )
  }

  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
