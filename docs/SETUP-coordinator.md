# Coordinator setup — learn-app + media pipeline (browser only) · 26 Oct 2026

Secrets go only into GitHub's secret settings. Never paste them into any chat.
Do the parts in order. Each step says what you should see.

## A. GitHub repo (5 min)
1. github.com → payojana-foundation → study-84000 → Settings → General → Repository name:
   `learn-app` → Rename. You see: page reloads at …/payojana-foundation/learn-app.
2. Unzip `learn-kiro-inputs.zip` into `C:\Users\buphk\Projects\learn-app` so it has
   `design\`, `data\source\`, `docs\`. In Kiro: clone/open learn-app there (same as vacana-app).

## B. Google Cloud — let GitHub act as media-pipeline@ (Cloud Shell, 10 min)
1. console.cloud.google.com → top bar project picker → `tipitaka-automation`.
2. Top right: Activate Cloud Shell (>_ icon). You see a terminal at the bottom.
3. Paste these lines one block at a time:
```
PROJECT_ID=tipitaka-automation
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA=media-pipeline@tipitaka-automation.iam.gserviceaccount.com
REPO=payojana-foundation/learn-app
gcloud services enable drive.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project=$PROJECT_ID
```
   You see: "Operation … finished successfully" (or nothing if already on).
```
gcloud iam workload-identity-pools create github --project=$PROJECT_ID --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers create-oidc learn-app --project=$PROJECT_ID --location=global --workload-identity-pool=github --display-name="learn-app repo" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" --attribute-condition="assertion.repository=='$REPO'"
```
   You see: "Created workload identity pool [github]" and "…provider [learn-app]".
```
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT_ID --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
echo projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/learn-app
```
   You see: "Updated IAM policy…" and one line starting `projects/` — copy it (not a secret).
   If any line shows an error with "constraint" or "policy": stop, copy the error text into this chat.
4. Drive: share the pilot folder (Ven. Yon Yi, វេស្សន្តរជាតក) with
   media-pipeline@tipitaka-automation.iam.gserviceaccount.com as **Viewer**.
   (The word-audio input folder is already shared as Editor.)

## C. Cloudflare R2 token (5 min)
1. dash.cloudflare.com → R2 Object Storage → Manage API tokens → Create API token.
2. Name `learn-app-pipeline` · Permissions **Object Read & Write** · Specify buckets:
   `word-audio`, `course-media` · Create.
3. You see Access Key ID, Secret Access Key and an endpoint
   `https://<account-id>.r2.cloudflarestorage.com`. Keep the page open for step D.

## D. GitHub secrets and variables (5 min)
github.com → learn-app → Settings → Secrets and variables → Actions.
Secrets tab → New repository secret (twice):
- `R2_ACCESS_KEY_ID` = Access Key ID
- `R2_SECRET_ACCESS_KEY` = Secret Access Key
Variables tab → New repository variable:
- `R2_ENDPOINT` = the endpoint URL
- `GCP_WIF_PROVIDER` = the `projects/…/providers/learn-app` line from B3
- `GCP_SERVICE_ACCOUNT` = media-pipeline@tipitaka-automation.iam.gserviceaccount.com
- `WORD_AUDIO_DRIVE_FOLDER` = 1NNmePYxy83xaiUSh0fW2cHpTinVIpn_6
You see: 2 secrets (values hidden) and 4 variables.

## E. Run (after Kiro pushes P2)
1. learn-app → Actions → "word-audio-upload" → Run workflow → limit `1` → Run.
2. Green tick = one file passed. Click the run → download the log; check the curl line shows 200.
3. Run again with limit `0` (all). Green tick + "1366 matching" twice in the log.
4. Send to the audio chat: run link, the two checksum lines, the curl line,
   Drive path of `r2_listing_023.txt`.
5. Then "course-audio" → Run workflow → drive_file_id `1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT`.
   Listen to https://media.84000.digital/audio/1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT-a64.mp3
   and tell the audio chat how it sounds.

## F. Website deploy of learn-app (after Kiro pushes P1)
Same as vacana-app: Workers & Pages → Create → Import a repository → learn-app →
build `npm run build`, deploy `npx wrangler deploy` → Save and deploy.
You see: build success; learn.84000.digital shows the app with a version label.
