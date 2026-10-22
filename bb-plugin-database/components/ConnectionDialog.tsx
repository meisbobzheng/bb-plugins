import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Connection, ConnectionInput, TestResult } from "../contract";
import { Confirm, Spinner } from "./bits";
import { errorMessage, refreshSession, useDbRpc, useStatus } from "./hooks";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

export interface ConnectionDialogProps {
  open: boolean;
  connection: Connection | null;
  onClose(): void;
  onSaved(connection: Connection): void;
}

interface Form {
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  userFollowsDatabase: boolean;
  authKind: "rds-iam" | "password";
  profile: string;
  region: string;
  password: string;
  ssl: boolean;
}

function formOf(connection: Connection | null, defaults: { profile: string; region: string }): Form {
  if (connection === null) {
    return { name: "", host: "", port: "5432", database: "", user: "", userFollowsDatabase: true, authKind: "rds-iam", profile: defaults.profile, region: defaults.region, password: "", ssl: true };
  }
  return {
    name: connection.name,
    host: connection.host,
    port: String(connection.port),
    database: connection.database,
    user: connection.user,
    userFollowsDatabase: connection.userFollowsDatabase,
    authKind: connection.auth.kind,
    profile: connection.auth.kind === "rds-iam" ? connection.auth.profile : defaults.profile,
    region: connection.auth.kind === "rds-iam" ? connection.auth.region : defaults.region,
    password: "",
    ssl: connection.ssl,
  };
}

export function inputOf(form: Form, id: string | undefined): ConnectionInput | string {
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "Port must be a number between 1 and 65535.";
  if (form.name.trim() === "") return "Give the connection a name.";
  if (form.host.trim() === "") return "Enter the host.";
  if (form.database.trim() === "") return "Enter the database name.";
  if (!form.userFollowsDatabase && form.user.trim() === "") return "Enter the database role, or turn on “Role follows database”.";
  if (form.authKind === "rds-iam" && form.profile.trim() === "") return "Choose an AWS profile.";
  return {
    ...(id === undefined ? {} : { id }),
    name: form.name.trim(),
    host: form.host.trim(),
    port,
    database: form.database.trim(),
    user: form.userFollowsDatabase ? form.database.trim() : form.user.trim(),
    userFollowsDatabase: form.userFollowsDatabase,
    auth: form.authKind === "rds-iam" ? { kind: "rds-iam", profile: form.profile.trim(), region: form.region.trim() || "us-east-1" } : { kind: "password" },
    ssl: form.ssl,
    ...(form.authKind === "password" && form.password !== "" ? { password: form.password } : {}),
  };
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint === undefined ? null : <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ConnectionDialog({ open, connection, onClose, onSaved }: ConnectionDialogProps) {
  const rpc = useDbRpc();
  const status = useStatus();
  const profiles = status?.awsProfiles ?? [];
  const defaults = { profile: profiles[0]?.name ?? "", region: profiles[0]?.region ?? "us-east-1" };
  const [form, setForm] = useState<Form>(() => formOf(connection, defaults));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setForm(formOf(connection, { profile: profiles[0]?.name ?? "", region: profiles[0]?.region ?? "us-east-1" }));
    setTest(null);
    setError(null);
    setConfirmDelete(false);
  }, [open, connection, profiles.length]);

  const runTest = async () => {
    const input = inputOf(form, connection?.id);
    if (typeof input === "string") return setError(input);
    setError(null);
    setTesting(true);
    try {
      setTest(await rpc.call("connections_test", input));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setTesting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = inputOf(form, connection?.id);
    if (typeof input === "string") return setError(input);
    setError(null);
    setSaving(true);
    try {
      const saved = await rpc.call("connections_save", input);
      await refreshSession(rpc);
      toast.success(`Saved ${saved.name}`);
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (connection === null) return;
    try {
      await rpc.call("connections_delete", { id: connection.id });
      await refreshSession(rpc);
      toast.success(`Deleted ${connection.name}`);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{connection === null ? "New connection" : `Edit ${connection.name}`}</DialogTitle>
          <DialogDescription>
            {form.authKind === "rds-iam"
              ? "RDS IAM authentication mints a short-lived token from your AWS SSO session each time a connection opens."
              : "The password is stored on the bb server, never sent to the browser."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="con-name">
              <Input id="con-name" value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="nucleus dev" autoFocus />
            </Field>
            <Field label="Database" htmlFor="con-database">
              <Input id="con-database" value={form.database} onChange={(event) => set("database", event.target.value)} placeholder="hss" className="font-mono" />
            </Field>
            <Field label="Host" htmlFor="con-host">
              <Input id="con-host" value={form.host} onChange={(event) => set("host", event.target.value)} placeholder="db.cluster-xxxx.us-east-1.rds.amazonaws.com" className="font-mono" />
            </Field>
            <Field label="Port" htmlFor="con-port">
              <Input id="con-port" value={form.port} onChange={(event) => set("port", event.target.value)} inputMode="numeric" className="font-mono" />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <span>
              Role follows database
              <span className="block text-[11px] text-muted-foreground">Log in as a role named after the database, as nucleus services do. Switching databases switches the role too.</span>
            </span>
            <Switch checked={form.userFollowsDatabase} onCheckedChange={(checked) => set("userFollowsDatabase", checked)} aria-label="Role follows database" />
          </label>
          {form.userFollowsDatabase ? null : (
            <Field label="Role" htmlFor="con-user">
              <Input id="con-user" value={form.user} onChange={(event) => set("user", event.target.value)} placeholder="readonly" className="font-mono" />
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Authentication" htmlFor="con-auth">
              <Select value={form.authKind} onValueChange={(value) => set("authKind", value as Form["authKind"])}>
                <SelectTrigger id="con-auth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rds-iam">RDS IAM token (AWS SSO)</SelectItem>
                  <SelectItem value="password">Password</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.authKind === "rds-iam" ? (
              <Field label="AWS profile" htmlFor="con-profile" hint={profiles.length === 0 ? "No profiles found in ~/.aws/config" : undefined}>
                {profiles.length === 0 ? (
                  <Input id="con-profile" value={form.profile} onChange={(event) => set("profile", event.target.value)} placeholder="nucleus-dev" className="font-mono" />
                ) : (
                  <Select
                    value={form.profile}
                    onValueChange={(value) => {
                      set("profile", value);
                      const region = profiles.find((profile) => profile.name === value)?.region;
                      if (region) set("region", region);
                    }}
                  >
                    <SelectTrigger id="con-profile">
                      <SelectValue placeholder="Choose a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.name} value={profile.name}>
                          <span className="font-mono">{profile.name}</span>
                          {profile.roleName === null ? null : <span className="ml-2 text-muted-foreground">{profile.roleName}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Password" htmlFor="con-password" hint={connection?.hasPassword ? "Leave blank to keep the saved password." : undefined}>
                <Input id="con-password" type="password" value={form.password} onChange={(event) => set("password", event.target.value)} autoComplete="off" />
              </Field>
            )}
            {form.authKind === "rds-iam" ? (
              <Field label="Region" htmlFor="con-region">
                <Input id="con-region" value={form.region} onChange={(event) => set("region", event.target.value)} placeholder="us-east-1" className="font-mono" />
              </Field>
            ) : null}
            <label className="flex items-center justify-between gap-3 self-end rounded-md border border-border px-3 py-2 text-sm">
              <span>TLS (sslmode=require)</span>
              <Switch checked={form.ssl} onCheckedChange={(checked) => set("ssl", checked)} aria-label="Require TLS" />
            </label>
          </div>
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {test === null ? null : test.ok ? (
            <p role="status" className="text-sm text-success">
              Connected to {test.database} as {test.user} on PostgreSQL {test.serverVersion} in {Math.round(test.latencyMs)} ms.
            </p>
          ) : (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              <p className="break-words font-mono text-xs">{test.error.message}</p>
              {test.error.hint === null ? null : <p className="mt-1 text-xs text-muted-foreground">{test.error.hint}</p>}
            </div>
          )}
          {confirmDelete && connection !== null ? (
            <Confirm
              title={`Delete ${connection.name}?`}
              body="Saved queries and history stay, but lose their link to this connection."
              confirmLabel="Delete connection"
              destructive
              onConfirm={() => void remove()}
              onCancel={() => setConfirmDelete(false)}
            />
          ) : (
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                {connection === null ? null : (
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => void runTest()} disabled={testing || saving}>
                  {testing ? <Spinner /> : null}
                  Test connection
                </Button>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || testing}>
                  {saving ? <Spinner /> : null}
                  Save
                </Button>
              </div>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
