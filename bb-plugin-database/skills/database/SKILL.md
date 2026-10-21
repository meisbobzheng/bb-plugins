---
name: database
description: Query the user's configured PostgreSQL databases read-only, inspect their schema, and turn plain-language requests into SQL with the db_query and db_schema tools or the bb db CLI. Use when the user asks about data in a database, a table's columns, how many rows match something, or wants SQL written against their schema.
---

# Database

The Database plugin keeps the user's PostgreSQL connections (RDS clusters
reached with an AWS SSO profile, or any Postgres with a password). The user
browses schemas, runs SQL, and asks for queries in plain language on the
Database page in the bb sidebar. Agents get read-only access to the same
connections.

## Answering questions about data

1. Call `db_schema` first, with `search` words from the question, to learn the
   exact table and column names. Pass `table` to see one table's columns,
   indexes, and foreign keys.
2. Call `db_query` with precise SQL. Select the columns the question needs
   rather than `SELECT *`, and prefer an aggregate when a count answers it.
3. Say which connection and database the answer came from; the tool prints
   both on its first line.

Without the tools, the same operations are CLI commands:

```
bb db connections                       # configured connections; * marks the active one
bb db schema --search invoice           # tables whose names or columns mention "invoice"
bb db schema billing.invoices           # one table in full
bb db query "select count(*) from subscribers where status = 'active'"
bb db ask "active subscribers per plan" # plain language → SQL, run when read-only
bb db history --limit 10
```

Add `--connection <name>` to target a connection other than the active one,
and `--json` for machine-readable output.

## Rules

- Every agent and CLI query runs in a read-only session, and statements that
  are not `SELECT`, `WITH`, `VALUES`, `TABLE`, `SHOW`, or `EXPLAIN` are
  refused before they reach the server. Do not look for another way to write;
  the user runs writes from the Database page after enabling them there.
- Results are capped (50 rows by default, 500 at most). Add a `LIMIT` or an
  aggregate instead of paging through a large table.
- These databases can hold subscriber identifiers and authentication material.
  Never select key material into the conversation: compare with `=` and select
  the boolean, or count the matching rows.
- An `auth` error with an `aws sso login` hint means the user's AWS SSO session
  expired. Tell them the exact command from the hint; do not retry until they
  have run it.
- A connection whose role follows the database (the nucleus convention, where
  the database, role, and schema share one name) switches role when the user
  switches database. `bb db databases` lists what the server has.
