# Eterna elephant mark

Source of truth for the extension icons. Geometry is generated, not
hand-edited: edit `build.py` and re-run, never patch the SVG path data.

| File | Use |
| --- | --- |
| `eterna-elephant-mark.svg` | primary logomark, `currentColor` + root `color` so CSS can recolor it |
| `eterna-elephant-mono.svg` | single-colour variant |
| `eterna-elephant-app-icon.svg` | ink-ground square icon |
| `*-1024.png` | raster previews |

Palette: mark `#ff5a36`, ink ground `#191614`, ear tone `#ff8f6b`.

## Regenerating

```bash
python3 brand/eterna-elephant/build.py            # brand SVGs
python3 brand/eterna-elephant/build-app-icons.py  # packages/browser-ext/assets/icon{16,48,128}.svg
```

`build-app-icons.py` imports `build.py`, so run both from this directory.
The 16px icon deliberately omits the eye counterform: under ~24px it is
below one pixel and only muddies the head mass. PNGs are rendered from the
SVGs with headless Chrome at exact pixel sizes.

The mark's construction, palette rationale and review score are documented in
the `animal-logo` skill gallery (`references/examples/elephant-eterna.md`).
