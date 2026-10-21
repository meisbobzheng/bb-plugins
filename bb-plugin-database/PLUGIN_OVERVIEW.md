A Postgres GUI in your sidebar, with the AWS login you already have.

## What you get

- **Connections** to RDS clusters through your AWS SSO profile, with a fresh
  IAM token for every session and a clear `aws sso login` hint when it has
  expired, or to any Postgres with a password.
- A **schema browser**, a **SQL editor** that completes your tables and
  columns, and a **results grid** with cell inspection and export to Markdown,
  CSV, or JSON.
- **Ask in plain English**: describe the data you want, get the SQL in the
  editor, and see the rows. Statements that change data are shown, never run.
- **Explain** and **Analyze** plan trees with per-node time shares and
  misestimate warnings.
- **Read-only by default**, with a per-connection switch to allow writes.
- **History** and **saved queries** in the side panel.
- `db_query` and `db_schema` tools plus a `bb db` command so agents can answer
  questions from your data without ever writing to it.

## How it works

Everything stays on your machine: connections and history in the plugin's
SQLite database, queries through a small connection pool, and plain-language
requests through your local `claude` CLI.
