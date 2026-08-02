// Interactive, one-time OAuth2 flow to obtain YOUTUBE_REFRESH_TOKEN.
// Run locally — NEVER in CI (see docs/SETUP.md §3):
//   npm run youtube:oauth-setup --workspace=services/youtube-uploader
//
// Uses a loopback redirect (http://localhost:PORT), not the deprecated
// "urn:ietf:wg:oauth:2.0:oob" out-of-band flow Google shut down — a Google
// Cloud OAuth client of type "Desktop app" allows any loopback redirect URI
// without registering a specific port.
import "dotenv/config";
import { createServer } from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first, from a Google Cloud ` +
        'OAuth client of type "Desktop app" (APIs & Services > Credentials).',
    );
  }
  return value;
}

async function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`Google returned an error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("No authorization code in the redirect. You can close this tab.");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Authorized — you can close this tab and return to the terminal.");
      server.close();
      resolve(code);
    });
    server.listen(PORT);
  });
}

async function main() {
  const clientId = requireEnv("YOUTUBE_CLIENT_ID");
  const clientSecret = requireEnv("YOUTUBE_CLIENT_SECRET");
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back, not just a short-lived access_token
    prompt: "consent", // forces re-consent even if this account already authorized this app, which is what forces Google to actually issue a NEW refresh_token
    scope: SCOPES,
  });

  console.log("1. Open this URL, sign in with the channel's Google account, and approve access:\n");
  console.log(`   ${authUrl}\n`);
  console.log(`2. Waiting for the redirect back to ${REDIRECT_URI} ...\n`);

  const code = await waitForAuthCode();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. This usually means this Google account already authorized this " +
        "app previously without being forced to re-consent — revoke access at " +
        "https://myaccount.google.com/permissions and run this again.",
    );
  }

  console.log("Success. Add this to your .env (and as a GitHub Actions secret):\n");
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
