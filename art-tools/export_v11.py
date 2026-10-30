"""Extract only newly generated V1.1 strips; no locally synthesized cat poses."""
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SKILL = Path('C:/Users/WangHangang/.codex/skills/hatch-pet/scripts')
def load(name):
    spec = importlib.util.spec_from_file_location(name, SKILL / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

state, source = sys.argv[1:3]
extract = load('extract_strip_frames')
extract.ROW_FRAME_COUNTS[state] = 6
qa = ROOT / 'qa' / 'v11-art'
qa.mkdir(parents=True, exist_ok=True)
row = extract.extract_state(Path(source), state, qa / 'frames', (255, 0, 255), 150, 'stable-slots')
frames = []
for file in row['frames']:
    frame = Image.open(file).convert('RGBA')
    pixels = np.array(frame)
    rgb = pixels[:, :, :3].astype(np.float32)
    alpha = pixels[:, :, 3]
    edge = (alpha > 0) & (np.asarray(frame.getchannel('A').filter(ImageFilter.MinFilter(7))) < 240)
    fringe = edge & (rgb[:, :, 2] > rgb[:, :, 1] * .85) & (rgb[:, :, 0] > rgb[:, :, 1] * 1.15)
    rgb[:, :, 2][fringe] = np.minimum(rgb[:, :, 2][fringe], rgb[:, :, 1][fringe] * .70)
    rgb[:, :, 0][fringe] = np.minimum(rgb[:, :, 0][fringe], rgb[:, :, 1][fringe] * 1.5 + 30)
    pixels[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    pixels[alpha == 0] = 0
    frame = Image.fromarray(pixels, 'RGBA')
    frame.save(file)
    frames.append(frame)
sheet = Image.new('RGBA', (1152, 208))
for i, frame in enumerate(frames):
    sheet.alpha_composite(frame, (192*i, 0))
file = f'extra/{state}.webp'
sheet.save(ROOT / 'assets' / file, lossless=True, exact=True)
durations = {'yawning': [260, 300, 360, 400, 360, 320], 'head-tilt': [200, 220, 300, 360, 300, 220],
             'lying-down': [180, 180, 180, 220, 240, 300]}[state]
manifest_path = ROOT / 'assets' / 'animations.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['animations'][state] = {'file': file, 'frames': 6, 'row': 0, 'columns': 6, 'durations': durations, 'loop': False}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
contact = Image.new('RGBA', sheet.size, '#d8dedb')
contact.alpha_composite(sheet)
contact.convert('RGB').save(qa / f'{state}-contact.jpg')
load('render_animation_previews').save_preview(frames, durations, qa / f'{state}.gif')
(qa / f'{state}.json').write_text(json.dumps({'state': state, 'source': source, 'frames': row['frames'], 'method': 'stable-slots', 'durations': durations}, indent=2), encoding='utf-8')
print(json.dumps({'state': state, 'file': file, 'frames': 6, 'duration': sum(durations)}))
