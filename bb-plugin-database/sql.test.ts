import { describe, expect, it } from "vitest";
import { classifyStatement, cursorable, extractSql, firstKeyword, isReadOnlyScript, qualifiedName, quoteIdentifier, splitStatements, textTable, touchesSchema } from "./sql";

describe("splitStatements", () => {
  it("splits on semicolons outside quotes, comments, and dollar quotes", () => {
    const sql = [
      "select 'a;b' as x; -- trailing; comment",
      'select "we;ird" from t /* block; comment */;',
      "do $$ begin perform 1; end $$;",
      "select $tag$ x; y $tag$",
    ].join("\n");
    expect(splitStatements(sql).map((statement) => statement.text)).toEqual([
      "select 'a;b' as x",
      '-- trailing; comment\nselect "we;ird" from t /* block; comment */',
      "do $$ begin perform 1; end $$",
      "select $tag$ x; y $tag$",
    ]);
  });

  it("blanks literals and comments in the skeleton", () => {
    const [statement] = splitStatements("select 'delete from x' -- drop table y\n from t");
    expect(statement?.skeleton).toBe("select ''  \n from t");
  });

  it("handles escaped quotes and E-strings", () => {
    expect(splitStatements("select 'it''s; fine'; select E'a\\'b;c'").map((statement) => statement.text)).toEqual(["select 'it''s; fine'", "select E'a\\'b;c'"]);
  });

  it("drops empty statements", () => {
    expect(splitStatements(";;  ; select 1;")).toHaveLength(1);
    expect(splitStatements("   ")).toEqual([]);
  });
});

describe("classifyStatement", () => {
  const classify = (sql: string) => classifyStatement(splitStatements(sql)[0]!);

  it("recognises reads", () => {
    for (const sql of ["select 1", "  SELECT * FROM t WHERE name = 'delete me'", "with a as (select 1) select * from a", "values (1)", "table t", "show search_path", "explain select 1", "(select 1) union (select 2)"]) {
      expect(classify(sql), sql).toBe("read");
    }
  });

  it("recognises writes, including data-modifying CTEs and explain analyze of writes", () => {
    for (const sql of ["insert into t values (1)", "with d as (delete from t returning *) select * from d", "explain analyze delete from t", "create table x (id int)", "truncate t"]) {
      expect(classify(sql), sql).toBe("write");
    }
    expect(isReadOnlyScript("select pg_sleep(1); drop table t")).toBe(false);
  });

  it("recognises session control", () => {
    for (const sql of ["set default_transaction_read_only = off", "begin", "commit", "reset all"]) expect(classify(sql), sql).toBe("control");
  });

  it("reads the first keyword past comments and parentheses", () => {
    expect(firstKeyword("  -- hi\n (select 1)".replace("-- hi\n", " "))).toBe("select");
  });
});

describe("isReadOnlyScript and cursorable", () => {
  it("requires every statement to be a read", () => {
    expect(isReadOnlyScript("select 1; select 2")).toBe(true);
    expect(isReadOnlyScript("select 1; set x = 1")).toBe(false);
    expect(isReadOnlyScript("")).toBe(false);
  });

  it("allows cursors only for selects", () => {
    expect(cursorable(splitStatements("select 1")[0]!)).toBe(true);
    expect(cursorable(splitStatements("with x as (select 1) select * from x")[0]!)).toBe(true);
    expect(cursorable(splitStatements("show all")[0]!)).toBe(false);
    expect(cursorable(splitStatements("explain select 1")[0]!)).toBe(false);
  });

  it("notices schema changes", () => {
    expect(touchesSchema("create table t (id int)")).toBe(true);
    expect(touchesSchema("select 'create' from t")).toBe(false);
  });
});

describe("extractSql", () => {
  it("takes the fenced block and keeps the rest as the explanation", () => {
    const reply = "Here you go:\n```sql\nSELECT count(*) FROM subscribers;\n```\nCounts every subscriber.";
    expect(extractSql(reply)).toEqual({ sql: "SELECT count(*) FROM subscribers;", explanation: "Here you go: Counts every subscriber." });
  });

  it("accepts bare SQL", () => {
    expect(extractSql("select 1")).toEqual({ sql: "select 1", explanation: "" });
  });

  it("returns no SQL for prose", () => {
    expect(extractSql("I cannot answer that.")).toEqual({ sql: "", explanation: "I cannot answer that." });
  });
});

describe("textTable", () => {
  it("aligns columns and marks nulls", () => {
    expect(textTable(["id", "name"], [["1", "ann"], ["22", null]])).toBe(["id | name", "---+-----", "1  | ann", "22 | NULL"].join("\n"));
  });

  it("clips long cells", () => {
    expect(textTable(["x"], [["abcdefghij"]], 5).split("\n")[2]).toBe("abcd…");
  });
});

describe("identifiers", () => {
  it("quotes only when needed", () => {
    expect(quoteIdentifier("users")).toBe("users");
    expect(quoteIdentifier("User")).toBe('"User"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(qualifiedName("public", "t")).toBe("t");
    expect(qualifiedName("billing", "invoices")).toBe("billing.invoices");
  });
});
