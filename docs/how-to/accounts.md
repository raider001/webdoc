<!--meta
{ "title": "Set up accounts", "description": "Turn on sign-in, create the first administrator, declare groups, and lock down a chapter.", "assumes": ["Docs/how-to/theming", "Docs/features/access-control"], "next": ["Docs/reference/authoring"] }
-->

# Set up accounts

Six steps take a WebDocs install from open to private. Nothing here is
reversible-by-accident: every step is a line in `config.json` or a click in the
app, and turning `enabled` back to `false` restores the open library exactly.

## 1. Declare your groups and switch accounts on

Add an `auth` block to `config.json`:

```json
{
  "siteTitle": "WebDocs",
  "sources": [{ "name": "Docs", "path": "docs", "component": "WD" }],
  "auth": {
    "enabled": true,
    "allowRegistration": true,
    "groups": {
      "staff":   { "label": "Staff",           "color": "#0ea5e9" },
      "ops":     { "label": "Operations",      "color": "#f59e0b" },
      "admins":  { "label": "Administrators" }
    }
  }
}
```

Group names are what you write in a document's `access` rule; the `label` is what
readers see, and `color` fixes the colour used on the map (leave it out and one is
derived from the name, the same colour every time).

Restart the server. It prints what it has done, so you never have to read the
code to find out how exposed you are:

```text
  auth: ENABLED - 0 account(s), registration open
        accounts: C:\...\.webdoc-auth\users.json
        groups:   admins, ops, staff
        no accounts yet - the FIRST account registered becomes the administrator
```

## 2. Create the first administrator

Open the site. Because there are no accounts yet, the sign-in screen opens
straight into **Create account** and tells you the first account becomes the
administrator. Fill it in and you are signed in as an administrator.

That bootstrap only ever happens once. Every account created afterwards starts
with no groups and no administrator flag.

## 3. Close registration, or gate it

Leaving `allowRegistration` on lets anyone who reaches the server create an
account — reasonable behind a VPN, not on the open internet. Two alternatives:

- `"allowRegistration": false` — nobody self-registers; administrators create
  every account from the accounts panel.
- `"requireApproval": true` — people may register, but the account is created
  disabled and cannot sign in until an administrator enables it.

## 4. Add people and put them in groups

Click the account button in the header (it shows your initials), then **Manage
accounts…**. Each row is one person: tick the groups they belong to, and use the
two switches on the right for **Administrator** and **Disabled**. **Add an
account…** creates one directly, which is how you add people with registration
closed.

Changes take effect immediately, not at the next sign-in: altering someone's
groups, disabling them or resetting their password ends every session they have
open.

Two things the panel will not let you do, because both are one-way doors: demote
or disable the last administrator, and delete the account you are signed in as.

## 5. Change your own password

The same account button opens **Your account**, which shows who you are, the
groups you hold, and a change-password form. Changing your password signs out
every other session and keeps the tab you are in signed in.

## 6. Lock something down

Open the page that starts the chapter, click **Edit**, and use **Who can read
this** in the metadata panel on the right. Tick a group and save.

That is the whole gesture — everything the page recommends *next* inherits the
rule, recursively. The panel tells you which state you are in: its own rule,
inherited from a page upstream (and names it), or unrestricted.

For part of a page, use **+ Add block → Restricted section**. It inserts a
matching pair of markers with an empty paragraph between them; put the protected
content there and tick the groups on the opening marker. Both entries only appear
for accounts that may change access rules.

To hide a page completely rather than showing it locked, tick **Hide completely**
in the same panel — see [Locked, and
hidden](Docs/features/access-control#locked-and-hidden) for the difference.

## Before you put it on a network

The defaults are tuned for a server on `127.0.0.1`. Two of them need attention
the moment it is reachable from elsewhere:

- **Serve it over HTTPS and set `"cookieSecure": true`.** Over plain HTTP the
  password and the session cookie travel in the clear. The server warns about
  this at start-up when it is bound to anything but loopback.
- **Behind a reverse proxy, set `"trustedProxies": ["<proxy address>"]`.**
  Without it every request appears to come from the proxy, so the per-address
  login rate limiter treats all your readers as one client. The header is
  ignored unless the peer is on that list, deliberately: believing it from
  anyone would let a caller forge a new identity for every guess.

Also keep the account file out of your repository. It defaults to
`.webdoc-auth/users.json`, and the server refuses to start if that folder sits
inside a served source. Add it to `.gitignore`; a password hash is not a secret
you want in a clone.

The full list of settings is in the
[Configuration reference](Docs/reference/config).
