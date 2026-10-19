"""Render a proof image of the graphite theme from the real design tokens.

Reads client/src/styles/theme.css for the token values, and the generated
galaxy artwork, so the picture reflects what the app actually ships.

    python3 scripts/make-theme-proof.py /tmp/proof.svg
    python3 -c "import resvg_py; \
      resvg_py.svg_to_bytes(svg_path='/tmp/proof.svg', width=1600, height=900, \
      font_files=['/tmp/inter-400.ttf','/tmp/inter-600.ttf','/tmp/inter-700.ttf'])"

Inter TTFs can be produced from @fontsource/inter with fontTools when the
sandbox has no system fonts: TTFont(path).save(path.replace('.woff2', '.ttf')).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THEME = (ROOT / 'client/src/styles/theme.css').read_text()
GALAXY = (ROOT / 'client/src/assets/galaxy.svg').read_text()

W, H = 1600, 900
PANEL_W = W // 2


def tokens(selector: str) -> dict:
    """Pull `--token: value;` pairs out of one rule block."""
    start = THEME.index(selector)
    end = THEME.index('}', start)
    block = THEME[start:end]
    return {m.group(1): m.group(2).strip()
            for m in re.finditer(r'(--[a-z0-9-]+):\s*([^;]+);', block)}


def galaxy_markup(t: dict, opacity: float) -> str:
    """The galaxy with its theme variables resolved, sized like the app's."""
    size = int(PANEL_W * 1.18)
    inner = GALAXY[GALAXY.index('<svg'):]
    inner = re.sub(r'^<svg[^>]*>', '', inner)
    inner = inner.replace('</svg>', '')

    for name in ('arm', 'bright', 'core', 'star'):
        inner = inner.replace(f'var(--galaxy-{name})', t[f'--galaxy-{name}'])

    return (f'<g opacity="{opacity}" transform="translate({(PANEL_W - size) / 2},'
            f'{(H - size) / 2}) scale({size / 1000})">{inner}</g>')


def panel(x: int, t: dict, light: bool) -> str:
    """A representative slice of the interface: nav, card, buttons, chips."""
    ink = t['--text-0']
    body = t['--text-1']
    muted = t['--text-2']
    surface = t['--surface']
    border = t['--border']
    brand = t['--brand']
    brand_ink = t['--brand-ink']
    glass = t['--glass']
    radius = 14

    def card(cx, cy, w, h):
        return (f'<rect x="{cx}" y="{cy}" width="{w}" height="{h}" rx="{radius}" '
                f'fill="{surface}" stroke="{border}" stroke-width="1"/>')

    def text(cx, cy, value, size, fill, weight='400', anchor='start'):
        return (f'<text x="{cx}" y="{cy}" font-family="Inter, Helvetica, Arial, sans-serif" '
                f'font-size="{size}" font-weight="{weight}" fill="{fill}" '
                f'text-anchor="{anchor}">{value}</text>')

    def button(cx, cy, w, h, label, primary=True):
        fill = brand if primary else 'none'
        stroke = 'none' if primary else border
        colour = brand_ink if primary else body
        return (f'<rect x="{cx}" y="{cy}" width="{w}" height="{h}" rx="9" fill="{fill}" '
                f'stroke="{stroke}" stroke-width="1"/>'
                + text(cx + w / 2, cy + h / 2 + 5, label, 15, colour, '600', 'middle'))

    def chip(cx, cy, label, solid):
        w = 96
        fill = t['--ok'] if solid else 'none'
        colour = t['--text-inv'] if solid else t['--warn']
        return (f'<rect x="{cx}" y="{cy}" width="{w}" height="30" rx="8" fill="{fill}" '
                f'stroke="{border if not solid else "none"}" stroke-width="1"/>'
                + text(cx + w / 2, cy + 20, label, 12.5, colour, '600', 'middle'))

    parts = [
        # page background
        f'<rect x="{x}" y="0" width="{PANEL_W}" height="{H}" fill="{t["--bg-0"]}"/>',
        galaxy_markup(t, 0.42 if light else 0.42),
        # top navigation bar (glass)
        f'<rect x="{x}" y="0" width="{PANEL_W}" height="64" fill="{glass}"/>',
        f'<line x1="{x}" y1="64" x2="{x + PANEL_W}" y2="64" stroke="{border}"/>',
        text(x + 40, 40, 'EventTracker', 18, ink, '700'),
        text(x + 240, 40, 'Discover', 14.5, muted),
        text(x + 330, 40, 'Events', 14.5, muted),
        text(x + 410, 40, 'Chat', 14.5, muted),
        button(x + PANEL_W - 210, 16, 170, 34, 'Create event'),
        # hero
        text(x + 40, 150, 'Discover What’s Happening', 34, ink, '700'),
        text(x + 40, 192, 'Around You', 34, ink, '700'),
        text(x + 40, 228, 'Concerts, meetups, markets and match days near Nairobi.', 15, body),
        button(x + 40, 254, 150, 44, 'Explore events'),
        button(x + 202, 254, 140, 44, 'Create event', primary=False),
        # event card
        card(x + 40, 340, 330, 320),
        f'<rect x="{x + 41}" y="341" width="328" height="150" rx="13" '
        f'fill="url(#cover{int(light)})"/>',
        text(x + 60, 530, 'Jazz at the Arboretum', 19, ink, '650'),
        text(x + 60, 556, 'Sat 12 Oct · 6:00 PM', 14, muted),
        text(x + 60, 578, 'Nairobi Arboretum', 14, muted),
        text(x + 60, 620, 'Ksh 1,500', 17, ink, '650'),
        button(x + 250, 598, 100, 36, 'Buy ticket'),
        # right-hand column: status, list, ticket
        card(x + 400, 340, 350, 150),
        text(x + 424, 380, 'Ticket sales', 15, ink, '650'),
        chip(x + 424, 396, '28 sold', True),
        chip(x + 534, 396, '3 pending', False),
        text(x + 424, 456, 'Commission earned', 14, muted),
        text(x + 424, 476, 'Ksh 4,280', 22, ink, '700'),
        card(x + 400, 510, 350, 150),
        text(x + 424, 550, 'Recent activity', 15, ink, '650'),
        text(x + 424, 580, 'You bought 2 × Early bird', 14, body),
        text(x + 424, 604, 'Amina followed your event', 14, body),
        text(x + 424, 628, 'Payout settled · Ksh 4,280', 14, body),
        # footer note for the proof
        text(x + 40, H - 26, 'LIGHT THEME' if light else 'DARK THEME', 13,
             muted, '700'),
    ]
    return ''.join(parts)


light = tokens("html[data-theme='light']")
dark = tokens("html[data-theme='dark']")
root = tokens(':root {')
# brand/status live in :root as the shared defaults
for t in (light, dark):
    for key, value in root.items():
        t.setdefault(key, value)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
  <linearGradient id="cover1" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1a1a1d"/><stop offset="100%" stop-color="#333339"/>
  </linearGradient>
  <linearGradient id="cover0" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1a1a1d"/><stop offset="100%" stop-color="#333339"/>
  </linearGradient>
</defs>
{panel(0, light, True)}
{panel(PANEL_W, dark, False)}
<line x1="{PANEL_W}" y1="0" x2="{PANEL_W}" y2="{H}" stroke="rgba(128,128,128,0.45)" stroke-width="1"/>
</svg>'''

Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/proof.svg').write_text(svg)
print(f'wrote {sys.argv[1] if len(sys.argv) > 1 else "/tmp/proof.svg"}')
