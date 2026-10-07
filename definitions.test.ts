import { describe, expect, it } from "vitest";
import { definitionPatterns, languageOf, parseGitGrep, rankDefinitions, type GrepMatch } from "./definitions";

function definesIn(path: string, symbol: string, line: string): boolean {
  return definitionPatterns(languageOf(path), symbol).some((pattern) => pattern.test(line));
}

describe("definitionPatterns", () => {
  it.each([
    ["a.go", "Serve", "func Serve(ctx context.Context) error {"],
    ["a.go", "Serve", "func (s *Server) Serve[T any](ctx context.Context) {"],
    ["a.go", "Server", "type Server struct {"],
    ["a.go", "MaxRetries", "const MaxRetries = 3"],
    ["a.go", "StatusOK", "\tStatusOK Status = 200"],
    ["a.go", "client", "\tclient *http.Client"],
    ["a.go", "result", "\tresult := compute()"],
    ["a.ts", "loadBoard", "export async function loadBoard(refresh: boolean) {"],
    ["a.ts", "Board", "export interface Board {"],
    ["a.ts", "render", "  private async render(view: View): Promise<void> {"],
    ["a.ts", "fetchedAt", "  fetchedAt: string;"],
    ["a.py", "parse", "async def parse(raw):"],
    ["a.rs", "Config", "pub struct Config {"],
    ["a.c", "MAX_LEN", "#define MAX_LEN 64"],
    ["a.c", "encode", "static int encode(const uint8_t *in, size_t len) {"],
    ["a.proto", "Subscriber", "message Subscriber {"],
  ])("%s recognises the definition of %s in %j", (path, symbol, line) => {
    expect(definesIn(path, symbol, line)).toBe(true);
  });

  it.each([
    ["a.go", "Serve", "\treturn s.Serve(ctx)"],
    ["a.go", "Serve", "\tServe(ctx)"],
    ["a.go", "ok", "\tif ok == true {"],
    ["a.go", "ServeHTTP", "func Serve(ctx context.Context) error {"],
    ["a.ts", "loadBoard", "  await loadBoard(true);"],
    ["a.c", "encode", "  return encode(buf, n);"],
    ["a.c", "encode", "  n = encode(buf, n);"],
  ])("%s does not treat %s in %j as a definition", (path, symbol, line) => {
    expect(definesIn(path, symbol, line)).toBe(false);
  });
});

describe("parseGitGrep", () => {
  it("strips the revision prefix and splits NUL-separated fields", () => {
    const sha = "a".repeat(40);
    const raw = `${sha}:internal/x.go\u000012\u0000func Run() {\n${sha}:cmd/main.go\u00003\u0000\tRun()\n`;
    expect(parseGitGrep(raw, sha)).toEqual([
      { path: "internal/x.go", line: 12, text: "func Run() {" },
      { path: "cmd/main.go", line: 3, text: "\tRun()" },
    ]);
  });
});

describe("rankDefinitions", () => {
  it("keeps definitions only and prefers the same file, then package, then tests and vendored code", () => {
    const matches: GrepMatch[] = [
      { path: "vendor/x/run.go", line: 1, text: "func Run() {}" },
      { path: "pkg/b/run_test.go", line: 5, text: "func Run() {}" },
      { path: "pkg/b/other.go", line: 9, text: "func Run() {}" },
      { path: "pkg/a/run.go", line: 4, text: "func Run() {}" },
      { path: "pkg/a/caller.go", line: 20, text: "\tRun()" },
      { path: "web/run.ts", line: 2, text: "export function Run() {}" },
      { path: "pkg/a/caller.go", line: 2, text: "func Run() {}" },
    ];
    expect(rankDefinitions(matches, "pkg/a/caller.go", "Run").map((definition) => definition.path)).toEqual([
      "pkg/a/caller.go",
      "pkg/a/run.go",
      "pkg/b/other.go",
      "pkg/b/run_test.go",
      "web/run.ts",
      "vendor/x/run.go",
    ]);
  });
});
