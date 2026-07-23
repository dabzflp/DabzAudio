Railway deployment steps for dabz-audio-key-bpm

1. Push code to GitHub

   - Ensure the `dabz-audio-key-bpm` folder is committed and pushed to your GitHub repository.

2. Create a new Railway project

   - Go to https://railway.app and sign in.
   - Click "New Project" → "Deploy from GitHub".
   - Connect the GitHub repo that contains this project. If the repo contains multiple services, choose the `dabz-audio-key-bpm` folder as the deployment subdirectory.

3. Configure environment variables

   - In the Railway project settings, add the following env vars:
     - `OPENKEYSCAN_URL` = `https://your-openkeyscan-host/analyze/single` (set to your hosted OpenKeyScan endpoint; leave unset for local development fallback)
     - `NODE_ENV` = `production`

4. Start command

   - Railway will detect `package.json` and use `npm start` by default. If asked, set the start command to:

     ```bash
     npm start
     ```

5. Deploy and verify

   - Trigger a deploy from Railway or push a commit to the connected branch.
   - Watch the deploy logs (Railway Console) for build and runtime output.
   - Confirm `POST /api/key/analyze` returns JSON and logs show forwarding to `OPENKEYSCAN_URL`.

Cut cost: run the analyzer scale-to-zero (only pay per scan)

The OpenKeyScan analyzer (FastAPI on Railway) is the always-on, RAM-hungry part —
it costs money 24/7 even when nobody is scanning. Make it scale to zero so it only
runs when a user uploads a file, then shuts down. Two supported ways:

Option A — Railway App Sleeping (no code, no new account; recommended first step)

1. Open the **analyzer** service in Railway (`openkeyscan-analyzer-production`),
   not the Lyric Book or key-bpm services.
2. Settings → **Serverless / App Sleeping** → turn it **on**.
3. Railway now stops the container after a period of inactivity and wakes it on
   the next inbound HTTP request. You pay only while it's awake handling scans.

Trade-off: the first scan after it has slept pays a **cold start** (the container
boots + FastAPI + audio libs load). The Key & BPM front-end already hides most of
this — it **warms the analyzer the moment a file is picked** and **retries once**
on the transient 502/503/504/timeout a cold boot produces before falling back to
the in-browser estimator (see `landing-page/key-bpm-tool/js/analysis.js`
`warmUpOpenKeyScan` + `estimateKeyWithOpenKeyScan`). No action needed.

Option B — Google Cloud Run (purpose-built scale-to-zero, per-100ms billing)

1. Containerize the analyzer (its own repo/Dockerfile — it is **not** in this repo).
2. `gcloud run deploy openkeyscan --source . --region <r> --allow-unauthenticated \
      --min-instances 0 --memory 2Gi --timeout 120`
   `--min-instances 0` is what makes it scale to zero.
3. Point the proxy at the new URL: update `OPENKEYSCAN_URL` (dev / Railway) **and**
   `landing-page/_redirects` line 1 (`/api/key/analyze -> <cloud-run-url>/analyze/single`),
   then redeploy Netlify.

Either way, keep `_redirects` and `OPENKEYSCAN_URL` in sync with wherever the
analyzer actually lives.

Notes

- Your backend currently expects an OpenKeyScan service reachable by `OPENKEYSCAN_URL`. If you do not have a hosted OpenKeyScan, you can:
  - Host OpenKeyScan on the same Railway project (advanced), or
  - Use the browser-only fallback (the front-end can use `estimateKeyWithEssentia`) and avoid setting `OPENKEYSCAN_URL`.

- If you prefer the front-end to call Railway directly, configure Netlify redirects or set `window.API_BASE` to your Railway URL.

CLI shortcut

1. Install and login to the Railway CLI: https://railway.app/docs/cli

```bash
railway login
railway link # run this inside the project directory or follow prompts to link the project
```

2. Run the helper script to set variables (replace URL):

```bash
cd dabz-audio-key-bpm
./scripts/set-railway-env.sh "https://your-railway-app.up.railway.app/analyze/single" production
```

3. Update Netlify redirect

 - Open `landing-page/key-bpm-tool/_redirects` and replace `YOUR_RAILWAY_URL` with your Railway app host (e.g. `your-railway-app.up.railway.app`). Commit and push.

After these steps, Netlify site calls `/api/key/analyze` and Netlify will proxy those requests to Railway.
