"""Deterministically extract and package generated artwork using hatch-pet tools."""
import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'art-run'
SKILL = Path('C:/Users/WangHangang/.codex/skills/hatch-pet/scripts')
EXTRAS = ['side-lie', 'stretch-paws', 'grooming', 'stretching', 'sleeping',
          'waking', 'pouncing', 'dragging', 'eating', 'meowing']

def load(name):
    spec = importlib.util.spec_from_file_location(name, SKILL / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def run(name, *args):
    subprocess.run([sys.executable, str(SKILL / name), *map(str, args)], check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--available', action='store_true', help='Export ready clips for development, never final acceptance.')
    parser.add_argument('--method', choices=['auto', 'stable-slots'], default='auto')
    parser.add_argument('--stable-states', default=None, help='Override persisted QA-confirmed stable-source rows.')
    args = parser.parse_args()
    decisions_file = RUN / 'qa' / 'extraction-decisions.json'
    persisted = json.loads(decisions_file.read_text(encoding='utf-8')) if decisions_file.exists() else {}
    stable_states = ({s for s in args.stable_states.split(',') if s}
                     if args.stable_states is not None else set(persisted.get('stable_states', [])))
    extract, atlas, preview = [load(x) for x in ['extract_strip_frames', 'compose_atlas', 'render_animation_previews']]
    original_remove = extract.remove_chroma_background
    def remove_key_and_spill(image, key, threshold):
        result = original_remove(image, key, threshold)
        # Generated fur edges mix with magenta. Remove chroma-dominant pixels
        # independently of Euclidean distance; warm fur and neutral pink stay.
        pixels = np.array(result, dtype=np.uint8)
        rgb = pixels[:, :, :3].astype(np.int16)
        if key[0] > 220 and key[2] > 220 and key[1] < 30:
            spill = ((rgb[:, :, 0] - rgb[:, :, 1] > 25)
                     & (rgb[:, :, 2] - rgb[:, :, 1] > 16))
            # Restrict despill to background-connected edges so the cat's
            # enclosed pink nose and inner ears cannot become transparent.
            mask = Image.fromarray(((spill | (pixels[:, :, 3] == 0)) * 255).astype(np.uint8))
            ImageDraw.floodfill(mask, (0, 0), 128)
            pixels[np.asarray(mask) == 128] = 0
        pixels[pixels[:, :, 3] == 0] = 0
        return Image.fromarray(pixels, 'RGBA')
    extract.remove_chroma_background = remove_key_and_spill
    standard_counts = dict(extract.ROW_FRAME_COUNTS)
    extract.ROW_FRAME_COUNTS.update({state: 6 for state in EXTRAS})
    key = extract.load_chroma_key(RUN / 'decoded', None)
    frame_root = RUN / 'frames'
    (RUN / 'qa').mkdir(exist_ok=True)
    (RUN / 'final').mkdir(exist_ok=True)
    assets = ROOT / 'assets'
    (assets / 'extra').mkdir(parents=True, exist_ok=True)
    if (frame_root / 'frames-manifest.json').exists():
        old = json.loads((frame_root / 'frames-manifest.json').read_text(encoding='utf-8'))
        rows = {row['state']: row for row in old['rows']}
    else:
        rows = {}
    for state in extract.ROW_FRAME_COUNTS:
        source = RUN / 'decoded' / f'{state}.png'
        if not source.exists():
            if args.available:
                continue
            raise SystemExit(f'Missing generated source: {source}')
        method = 'stable-slots' if state in stable_states else args.method
        rows[state] = extract.extract_state(source, state, frame_root, key, 150, method)
        for frame_file in rows[state]['frames']:
            frame = Image.open(frame_file).convert('RGBA')
            pixels = np.array(frame)
            rgb = pixels[:, :, :3].astype(np.float32)
            alpha = pixels[:, :, 3]
            eroded = np.asarray(frame.getchannel('A').filter(ImageFilter.MinFilter(7)))
            edge = (alpha > 0) & (eroded < 240)
            contaminated = edge & (rgb[:, :, 2] > rgb[:, :, 1] * .85) & (rgb[:, :, 0] > rgb[:, :, 1] * 1.15)
            # Orange fur has blue below green. Only fringe pixels on the
            # alpha boundary are corrected; interior pink nose/ears remain.
            rgb[:, :, 2][contaminated] = np.minimum(rgb[:, :, 2][contaminated], rgb[:, :, 1][contaminated] * .70)
            rgb[:, :, 0][contaminated] = np.minimum(rgb[:, :, 0][contaminated], rgb[:, :, 1][contaminated] * 1.5 + 30)
            pixels[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
            pixels[alpha == 0] = 0
            Image.fromarray(pixels, 'RGBA').save(frame_file)
    (frame_root / 'frames-manifest.json').write_text(json.dumps({
        'ok': True, 'chroma_key': {'hex': '#%02X%02X%02X' % key, 'rgb': list(key), 'threshold': 150},
        'rows': list(rows.values())}, indent=2), encoding='utf-8')
    animations = {}
    for state, row in rows.items():
        count = len(row['frames'])
        frames = [atlas.clear_transparent_rgb(Image.open(file).convert('RGBA')) for file in row['frames']]
        sheet = Image.new('RGBA', (192 * count, 208))
        for index, frame in enumerate(frames):
            sheet.alpha_composite(frame, (index * 192, 0))
        file = f'extra/{state}.webp'
        atlas.clear_transparent_rgb(sheet).save(assets / file, lossless=True, exact=True)
        durations = preview.ROW_DURATIONS.get(state, [200, 180, 180, 180, 200, 360])
        if state in ['side-lie', 'sleeping']:
            durations = [550] * count
        if state == 'meowing':
            durations = [250, 200, 300, 200, 250, 400]
        preview.save_preview(frames, durations, RUN / 'qa' / 'previews' / f'{state}.gif')
        native_durations = list(durations)
        if state == 'idle':
            native_durations[0] = 2800
        animations[state] = {'file': file, 'frames': count, 'row': 0, 'columns': count,
                             'durations': native_durations, 'loop': state not in ['waking', 'pouncing', 'stretching']}
    (assets / 'animations.json').write_text(json.dumps({'cellWidth': 192, 'cellHeight': 208,
        'animations': animations}, ensure_ascii=False, indent=2), encoding='utf-8')

    # Contact sheets contain only generated frames; the code never draws pet artwork.
    states = [s for s in extract.ROW_FRAME_COUNTS if s in rows]
    contact = Image.new('RGB', (192 * 8 + 140, 238 * len(states)), '#e7e6e3')
    dark_contact = Image.new('RGB', contact.size, '#25282b')
    draw = ImageDraw.Draw(contact)
    dark_draw = ImageDraw.Draw(dark_contact)
    for i, state in enumerate(states):
        draw.text((8, i * 238 + 100), state, fill='#323535')
        dark_draw.text((8, i * 238 + 100), state, fill='#efefef')
        for j, file in enumerate(rows[state]['frames']):
            frame = Image.open(file).convert('RGBA')
            contact.paste(frame, (140 + j * 192, i * 238 + 16), frame)
            dark_contact.paste(frame, (140 + j * 192, i * 238 + 16), frame)
    contact.save(RUN / 'qa' / 'all-animations-contact-sheet.png')
    dark_contact.save(RUN / 'qa' / 'all-animations-dark-contact-sheet.png')
    pages = RUN / 'qa' / 'contact-pages'
    pages.mkdir(exist_ok=True)
    for start in range(0, len(states), 4):
        contact.crop((0, start * 238, contact.width, min(len(states), start + 4) * 238)).save(
            pages / f'page-{start // 4 + 1:02d}.png')
        dark_contact.crop((0, start * 238, contact.width, min(len(states), start + 4) * 238)).save(
            pages / f'dark-page-{start // 4 + 1:02d}.png')
    if args.available:
        print(json.dumps({'development_only': True, 'ready_states': list(animations)}))
        return
    run('inspect_frames.py', '--frames-root', frame_root, '--json-out', RUN / 'qa' / 'review.json',
        '--require-components', *(['--allow-stable-slots'] if args.method == 'stable-slots' or stable_states else []))
    # Also run the same structural inspection over the extra states.
    inspector = load('inspect_frames')
    inspector.ROW_FRAME_COUNTS = {s: 6 for s in EXTRAS}
    old_argv = sys.argv
    try:
        sys.argv = ['inspect_frames', '--frames-root', str(frame_root), '--json-out', str(RUN / 'qa' / 'extra-review.json'),
                    '--require-components', *(['--allow-stable-slots'] if args.method == 'stable-slots' or stable_states else [])]
        try:
            inspector.main()
        except SystemExit as e:
            if e.code:
                raise
    finally:
        sys.argv = old_argv
    run('compose_atlas.py', '--frames-root', frame_root, '--output', RUN / 'final' / 'spritesheet.png',
        '--webp-output', RUN / 'final' / 'spritesheet.webp')
    run('validate_atlas.py', RUN / 'final' / 'spritesheet.webp', '--json-out', RUN / 'final' / 'validation.json')
    run('make_contact_sheet.py', RUN / 'final' / 'spritesheet.webp', '--output', RUN / 'qa' / 'contact-sheet.png')
    print(json.dumps({'ok': True, 'states': list(animations), 'codex_frames': sum(standard_counts.values())}))

if __name__ == '__main__':
    main()
