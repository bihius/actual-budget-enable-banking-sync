# actualbudget-bank-sync

[![Docker Image CI](https://github.com/bihius/actualbudget-bank-sync/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/bihius/actualbudget-bank-sync/actions/workflows/docker-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatic bank transaction sync from **Enable Banking** (PSD2/Open Banking) to **Actual Budget**.

Connect your bank once via a simple web UI -- transactions appear in Actual Budget automatically, every 6 hours. Supports 2,500+ banks across 30+ EU countries (Revolut, N26, Monzo, ING, Deutsche Bank, BNP Paribas, mBank, and more).

---

## Features

- **Web UI** for bank authorization and account mapping.
- **Country selector** -- choose your country to see available banks.
- **Auto sync** via configurable cron schedule (default: every 6 hours).
- **Deduplication** -- safe to run multiple times, no duplicate transactions.
- **Create new accounts** directly from the mapping UI.
- **Per-account error isolation** -- one failing account does not block others.
- **Session monitoring** -- dashboard shows connection status, expiry dates, and recent sync activity logs.

---

## Data & Security

In personal finance, privacy is paramount. This application is designed to keep your data strictly on your own hardware.

- **RSA Keys:** Your RSA private key (`keys/private.pem`) is never committed and is mounted read-only into the container.
- **Local Storage:** Session tokens and account mappings are stored locally in `data/state.json`.
- **Direct Communication:** No data is sent to any third-party telemetry or middleware. Communication happens *only* between your local server and the Enable Banking API, and then directly into your local Actual Budget instance.

---

## Prerequisites

1. **Docker + Docker Compose** installed on your server.
2. **Enable Banking Account:** Register at [Enable Banking](https://enablebanking.com) and create an application.
3. **Actual Budget:** A running, self-hosted instance of Actual Budget.
4. **Public HTTPS Callback URL:** Enable Banking requires a publicly reachable URL for the OAuth redirect (e.g., `https://banking.your-domain.com/auth/callback`).

> **Note on the Public URL:** The container itself does not need to be permanently exposed to the internet. Only the `/auth/callback` endpoint must be reachable during the initial bank authorization step. After that, all sync communication is outbound only.

### No Public IP?

If you are behind a CGNAT or cannot open ports on your router, you can use a tunnel service to handle the OAuth callback:

- **Cloudflare Tunnel (Recommended):** Securely connects your local server to the internet without opening ports. Point a subdomain to `http://localhost:3000`.
- **Tailscale Funnel:** Expose your local service to the internet if you use Tailscale (`tailscale funnel 3000`).
- **Ngrok:** For a quick, temporary setup (`ngrok http 3000`). Remember that Enable Banking requires the *exact same* redirect URL every time you authorize a bank.

---

## Installation

You do not need to clone this repository to run the application. Pre-built Docker images are provided via the GitHub Container Registry.

### 1. Prepare Directory and Files

Create a directory for the sync service and download the required configuration files:

```bash
mkdir actual-eb-sync
cd actual-eb-sync
mkdir data keys

# Download the docker-compose file and environment template
curl -O https://raw.githubusercontent.com/bihius/actualbudget-bank-sync/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/bihius/actualbudget-bank-sync/main/.env.example
```

### 2. Generate RSA Key Pair

Enable Banking uses RS256 JWT authentication. You must generate the key pair yourself.

```bash
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

Go to your **Enable Banking Control Panel -> Application -> RSA key**, and paste the contents of `keys/public.pem`. 
Keep `keys/private.pem` secret.

### 3. Configure Environment

Edit the `.env` file with your specific values:

| Variable | Description |
|---|---|
| `ENABLE_BANKING_APP_ID` | UUID of your Enable Banking application |
| `ACTUAL_PASSWORD` | Actual Budget server password |
| `ACTUAL_SYNC_ID` | Budget sync ID (Settings -> Show advanced settings) |
| `REDIRECT_BASE_URL` | Public HTTPS base URL, e.g. `https://banking.your-domain.com` |

*Optional Variables:*
- `ACTUAL_SERVER_URL` (default: `http://actual:5006`)
- `SYNC_CRON` (default: `0 */6 * * *`)
- `PORT` (default: `3000`)

### 4. Register the Callback URL

In your Enable Banking Control Panel -> Application -> Redirect URIs, add your callback URL:
`https://banking.your-domain.com/auth/callback`

### 5. Start the Service

Make sure your Docker network is configured correctly (if Actual Budget runs on the same host, they must share a Docker network, e.g., `actual_default`).

**Note on Permissions (Linux):**
The container runs as a non-root user (UID 1001). If you encounter permission errors, run the following on your host:
```bash
sudo chown -R 1001:1001 data keys
```

```bash
docker compose up -d
docker compose logs -f
```

Open `http://localhost:3000` (or your reverse proxy URL) to access the web UI.

---

## Usage

1. Open the web UI and click **Add Bank Connection**.
2. Select your country and choose your bank to start the authorization flow.
3. Complete the authorization on your bank's secure portal.
4. On the mapping screen, link your bank accounts to existing Actual Budget accounts, or create new ones.
5. Transactions will sync immediately, and then automatically based on your cron schedule.

### Handling Session Expiry

For security reasons (PSD2 regulations), bank sessions typically expire every 90 or 180 days. 
- When a session expires, the dashboard will show a red **"Expired - Reconnect needed"** message.
- Click the **"Reconnect"** button next to the account. 
- Follow the authorization process again. 
- The system will automatically update your existing connection and preserve your sync history, so you won't have to re-download old transactions.

---

## Under the Hood

### Architecture

```text
Your Bank ---- PSD2 OAuth ----> Enable Banking API
                                       |
                                       |  RS256 JWT auth
                                       v
                              actualbudget-bank-sync
                              +---------------------+
                              |  Web UI (:3000)     |
                              |  Cron sync (6h)     |
                              |  Account mapping    |
                              +---------------------+
                                       |
                                       |  @actual-app/api
                                       v
                               Actual Budget Server
```

### Sync Logic
- **Window:** Each sync fetches transactions from the **last 7 days** up to today. This overlap ensures delayed transactions are never missed.
- **Initial Sync:** The very first sync for a newly mapped account fetches the last **90 days** of history.
- **Rate Limits:** The service intelligently handles HTTP 429 Rate Limit errors from banks with exponential backoff and pagination delays.

### Transaction Mapping

| Enable Banking Field | Actual Budget Field | Notes |
|---|---|---|
| `booking_date` | `date` | YYYY-MM-DD |
| `transaction_amount.amount` | `amount` | Converted to integer cents |
| `credit_debit_indicator` (DBIT) | negative `amount` | Debit = money out |
| `creditor.name` / `debtor.name` | `payee_name` | Fallbacks to remittance info if missing |
| `remittance_information[]` | `notes` | Joined with space |
| `transaction_id` / `entry_reference` | `imported_id` | Primary deduplication key |
| SHA256 hash | `imported_id` | Fallback when bank omits ID |
| status `BOOK` | `cleared: true` | Pending transactions are skipped |

---

## Reverse Proxy Examples

### HAProxy
```haproxy
acl host_banking hdr(host) -i banking.your-domain.com
use_backend banking if host_banking

backend banking
    server banking 127.0.0.1:3000
```

### Nginx
```nginx
server {
    listen 443 ssl;
    server_name banking.your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

---

## Development

If you wish to modify the code:

1. Clone the repository.
2. Run `npm install`.
3. Use `npm run lint` and `npm run format` for code quality.
4. Use `npm test` to run the Vitest suite (unit and integration tests).

## License

MIT
