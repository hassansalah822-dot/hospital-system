Offline copies of the PDF and chart libraries (optional).

The app loads these two files from this folder first. If they are missing, it
falls back to the internet (the CDN links in index.html), so the phone needs
internet only until the copies are added here.

To work fully offline, put these two files in this folder, with exactly these names:

  jspdf.umd.min.js  -> https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
  chart.umd.min.js  -> https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js

Open each link in a browser, save the page as the file name above, then rebuild the app.
