# CaveCAD privacy policy

This is a notice, not an agreement: you don't need to accept anything to
use CaveCAD. It lists every time CaveCAD talks to the internet and what
happens to anything you choose to send.

## What stays on your computer

Your drawings, survey data, scans and CaveCAD's session logs never leave
your computer unless you send them with **Help > Send Feedback**.

## When CaveCAD goes online

| Feature | Service contacted | What that service learns |
|---|---|---|
| Check for Updates | GitHub (github.com) | Your IP address, and that CaveCAD checked for an update. Nothing else is sent. |
| Surface Data / aerial basemap | USGS National Map (imagery.nationalmap.gov, elevation.nationalmap.gov) | Your IP address and **the map area requested, which is roughly where your cave is**. |
| Entrance Location picker | OpenStreetMap (tile.openstreetmap.org), Esri World Imagery (server.arcgisonline.com), the Leaflet map library (unpkg.com) | Your IP address and **the map area you view**. |
| Send Feedback | Google (Apps Script and Drive, account cavecad.app@gmail.com) | Only what you choose to send. |

The map services see which area was fetched. CaveCAD sends them no cave
names and no survey data.

## Send Feedback

- **What's sent:** a type, summary and description you write; your email
  only if you give it; CaveCAD's version and your operating system; the tool
  in use and the names of your open drawings; and whichever attachments you
  tick — session logs and a screenshot (ticked by default, you can untick
  them), your drawing, survey files, scans (all unticked by default). The
  dialog's **Review** button shows exactly what will be sent. Session logs
  record the commands you used and the file paths of drawings you opened,
  which can include your computer's user name.
- **Why:** only to fix and improve CaveCAD.
- **Who sees it:** the CaveCAD maintainer and people they trust. It is
  never published, sold or passed on.
- **Where:** Google Drive under cavecad.app@gmail.com, with Google as the
  storage provider.
- **How long:** until 30 days after your report is closed, and never more
  than 12 months.
- **Deletion:** email cavecad.app@gmail.com with your report's reference
  and it will be deleted.
- **Your drawings stay yours.** Sending one lets us use it to find and fix
  the problem, nothing else.

## Contact

cavecad.app@gmail.com

---
Any new CaveCAD feature that goes online updates the table above in the
same change.
