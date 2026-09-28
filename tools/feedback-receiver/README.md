# Feedback receiver

Google Apps Script that receives Help > Send Feedback reports. Owned by
**cavecad.app@gmail.com**. Logic is in `Logic.gs` (tested:
`node --test 'tools/feedback-receiver/test/**/*.test.js'`); `Code.gs` wires it to Drive,
Sheets and Mail.

## One-time setup (signed in as cavecad.app@gmail.com)

1. Drive: create a folder `CaveCAD Feedback`. Copy its ID from the URL.
2. Sheets: create `CaveCAD Feedback triage`. Copy its ID from the URL.
3. script.google.com > New project `CaveCAD Feedback`. Add files `Logic.gs`
   and `Code.gs` with this folder's contents.
4. Project Settings > Script properties: `KEY` (a long random string, e.g.
   `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`),
   `FOLDER_ID`, `SHEET_ID`.
5. Triggers: `onStatusEdit` — From spreadsheet, On edit. `purgeOld` —
   Time-driven, Day timer.
6. Deploy > New deployment > Web app. Execute as: Me. Who has access:
   Anyone. Copy the `/exec` URL. Authorise Drive, Sheets, Mail when asked.
7. GitHub `Nate-the-Ace/cavecad-src` > Settings > Secrets > Actions:
   `FEEDBACK_ENDPOINT` = the `/exec` URL, `FEEDBACK_KEY` = the KEY.
8. Share the folder and the Sheet with your personal account and anyone
   you trust with cave locations. Anyone with access sees every report.
9. For tests, make a second deployment (Deploy > New deployment) and a
   second folder/Sheet pair; point a local build at it by editing
   `FeedbackConfig.js` locally (never commit it).

Redeploying after a code change: Deploy > Manage deployments > edit >
Version: New. The `/exec` URL stays the same.
