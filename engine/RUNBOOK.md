# Deploy runbook — Fly.io (Windows PowerShell)

Copy-paste, top to bottom. Fly builds the image on its own remote builders, so you do **not**
need Docker installed locally. Run everything from the `engine/` directory unless noted.

## 0. Install flyctl + log in (one time)

```powershell
# Install flyctl (installs to ~\.fly\bin and adds it to PATH for new shells)
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
# If `fly` isn't found in THIS shell, add it for the session:
$env:Path += ";$HOME\.fly\bin"

fly version          # confirm it's installed
fly auth login       # opens a browser — sign in / create a Fly account
```

## 1. Create the app

The name must be globally unique. Pick one and use it everywhere below.

```powershell
cd C:\Users\toddf\tures-demo\engine
$APP = "tures-engine-tf"          # <- change if taken
fly apps create $APP
```

Then set that name in `fly.toml` (the `app = "..."` line at the top):

```powershell
(Get-Content fly.toml) -replace '^app = ".*"', "app = `"$APP`"" | Set-Content fly.toml -Encoding utf8
```

## 2. Set secrets (each one unlocks a capability — all optional, but set VAULT_KEY for any real deploy)

```powershell
# Vault encryption key (32 bytes) — without it, connected creds are lost on restart
fly secrets set VAULT_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") --app $APP

# Real flight search (Duffel TEST token — test-mode, no real money). Get it at app.duffel.com
fly secrets set DUFFEL_API_TOKEN=duffel_test_xxxxx --app $APP

# Real agent loop (Claude tool-use planning). Get it at console.anthropic.com
fly secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx --app $APP

# OPTIONAL — payments. Needs a PaymentMethod connected via /connections to actually charge.
# fly secrets set STRIPE_SECRET_KEY=sk_test_xxxxx --app $APP
```

`ALLOW_LIVE_BOOKING` stays unset (false) — real-money bookings are refused. CORS for the demo's
GitHub Pages origin is already in `fly.toml`.

## 3. Deploy

```powershell
fly deploy --app $APP
```

## 4. Verify the live engine

```powershell
# Health — shows which capabilities are live given your secrets
curl https://$APP.fly.dev/health

# Prose → structured brief (real Claude extraction if ANTHROPIC_API_KEY is set)
curl -X POST https://$APP.fly.dev/parse -H "content-type: application/json" `
  -d '{\"text\":\"a long weekend in Lisbon for two, business class, a design hotel\"}'
```

`/health` should report `"supplier":"duffel"` (if Duffel token set), `"agentLoop":true`,
`"vault":true`. If something's off, `fly logs --app $APP`.

## 5. Point the demo at it

Open this in a browser (replace the app name):

```
https://toddfishman.github.io/tures-demo/v5/03-paste-trip.html?engine=https://tures-engine-tf.fly.dev
```

Type a trip and send. You should see: "Reading that as SFO → LIS…", a live event log
(search → score → propose) streaming into the thread, then the real proposed flight + stay.
The header will read **"Live engine · …"**. (To turn it back off: `tures.forget()` in the console.)

Then try `04-connections.html?engine=…` (toggles create real vault grants) and, after a plan,
`05-execution.html?trip=<tripId>&engine=…` (streams real execution events).

## Report back
The `https://<app>.fly.dev` URL + the output of `/health`, and anything from `fly logs` if a step
failed. I'll debug from there.
