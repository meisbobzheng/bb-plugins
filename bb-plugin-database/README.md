# bb-plugin-database

A Postgres GUI inside bb: browse schemas, write SQL with schema-aware
autocomplete, ask for a query in plain English, and connect to RDS with the
AWS SSO session you already have.

## Use it

**Connect**

- Open **Database** in the sidebar and click **Add connection**. For an RDS
  cluster choose **RDS IAM token (AWS SSO)**, pick the AWS profile from
  `~/.aws/config`, and leave TLS on. A short-lived IAM token is minted for every
  new connection, so there is no password to store. When the SSO session has
  expired, the error tells you the exact `aws sso login` command to run.
- Turn on **Role follows database** for nucleus-style clusters, where the
  database, role, and schema share one name. Switching databases in the header
  then switches the role too.
- Any other Postgres works with a password, which stays on the bb server.
- **Test connection** checks the login before you save.

**Query**

- The header shows the active connection and its database; both are drop-downs.
  The database list comes from the server.
- The schema browser lists every schema, table, view, and column. Filter it,
  click a column to insert its name, hover a table to **preview** 100 rows or
  **describe** it with indexes and foreign keys.
- The editor completes keywords, tables, and columns as you type. Press
  **⌘↵** to run the selection or the whole editor, **⇧⌘↵** for the plan.
  **Esc** cancels a running query.
- Results show the type of each column, `NULL` in italics, and the first rows
  up to the cap in the plugin settings (500 by default). Click a cell to see
  its full value, double-click to copy it. **Export** copies the grid as a
  Markdown table, CSV, or JSON, or downloads a CSV or JSON file.
- **Explain** shows the planner's tree; **Analyze** runs the statement inside a
  rolled-back transaction and shows real timings, with each node's share of
  the time as a bar and rows that are off by more than 10× from the estimate
  in amber.

**Ask in plain English**

- Type what you want above the editor, for example "active subscribers per
  plan, most popular first", and press **Ask**. The plugin sends your request
  and the schema to the local `claude` CLI, puts the generated SQL in the
  editor, and runs it when it only reads. If the first attempt fails, it fixes
  the statement once with the error message.
- SQL that would change data is shown but never run on its own.
- The model is a plugin setting (`sonnet` by default), as is the path to the
  `claude` binary.

**Writes**

- Every connection starts read-only: sessions set
  `default_transaction_read_only`. Flip the header switch to allow writes on
  one connection after confirming; the toolbar turns amber while writes are on.

**History and saved queries**

- The side panel's **History** tab lists every query run from the editor, the
  Ask bar, agents, and the CLI, with its connection, duration, and row count.
  Click one to load it, or run it again from its hover actions.
- **Save** in the toolbar names the current SQL. The **Saved** tab lists saved
  queries for the active connection plus global ones; rename or delete them
  there.

**Agents and the CLI**

- Threads get two tools: `db_query` runs read-only SQL and `db_schema` lists
  tables or describes one. Both refuse writes and cap their output.
- `bb db` offers the same from a shell: `connections`, `use`, `query`,
  `schema`, `databases`, `ask`, `history`, and `test`. Run `bb db --help`.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Rows fetched per result | 500 | Cap on rows returned to the grid and exports |
| Statement timeout | 60 s | `statement_timeout` for every session; 0 disables it |
| Model for plain-language requests | `sonnet` | Passed to `claude --model` |
| claude CLI path | `claude` | Binary used for plain-language requests |

## How it works

Connections, history, and saved queries live in this plugin's SQLite database
on the bb server. Queries go through a small `pg` pool per connection with all
values fetched as text. Single `SELECT`s run through a server-side cursor so a
query over a large table fetches only the rows shown. RDS IAM tokens come from
`@aws-sdk/rds-signer` with credentials resolved from the chosen SSO profile.
Plain-language requests run `claude -p` with tools disabled and a system prompt
that asks for one SQL statement.

## Develop

```
npm install
npm run check          # typecheck, tests, build
bb plugin install .    # register this checkout in bb
bb plugin dev          # rebuild and reload on save
```

The integration tests need a PostgreSQL to talk to:

```
BB_DATABASE_TEST_URL=postgres://postgres@127.0.0.1:5432/bbtest npm test
```

They expect the sample schema in `test/seed.sql`.
