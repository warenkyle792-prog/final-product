"""Point the app at self-hosted fonts instead of the Google Fonts CDN."""

import pathlib

# ---- index.html: drop the third-party font requests ----------------------
html = pathlib.Path('client/index.html')
text = html.read_text()

old = """    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap"
      rel="stylesheet"
    />"""

new = """    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <!-- Type is self-hosted: no third-party request that can hang the first
         paint, and no exception needed in the content security policy. -->
    <link rel="preload" as="font" type="font/woff2" href="/fonts/inter-400.woff2" crossorigin />
    <link rel="preload" as="font" type="font/woff2" href="/fonts/inter-600.woff2" crossorigin />"""

if old not in text:
    raise SystemExit('index.html font block not found — already updated?')

html.write_text(text.replace(old, new, 1))
print('index.html: external font links removed')

# ---- theme.css: declare the faces ----------------------------------------
theme = pathlib.Path('client/src/styles/theme.css')
css = theme.read_text()

faces = """/* =============================================================
   Type — self-hosted (client/public/fonts, latin subsets).
   Shipping the files removes a render-blocking third-party request: if the
   CDN is unreachable the page paints immediately instead of waiting.
   ============================================================= */

@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/inter-400.woff2') format('woff2');
}

@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/inter-500.woff2') format('woff2');
}

@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600 700;
  font-display: swap;
  src: url('/fonts/inter-600.woff2') format('woff2');
}

@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 500 600;
  font-display: swap;
  src: url('/fonts/plus-jakarta-sans-600.woff2') format('woff2');
}

@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/plus-jakarta-sans-700.woff2') format('woff2');
}

"""

if '@font-face' in css:
    raise SystemExit('theme.css already declares fonts')

theme.write_text(faces + css)
print('theme.css: @font-face rules added')
