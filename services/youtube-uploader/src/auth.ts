import { google, type youtube_v3 } from "googleapis";
import { config } from "./config.js";

/**
 * Long-lived refresh-token auth — no interactive consent at request time.
 * The refresh token itself is minted once, locally, via
 * scripts/youtube-oauth-setup.ts (see that file and docs/SETUP.md §3).
 */
export function createYoutubeClient(): youtube_v3.Youtube {
  const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });
  return google.youtube({ version: "v3", auth: oauth2Client });
}
