"""Prepare layout guides and prompts; never generate pet artwork locally."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'art-run'
SKILL = Path('C:/Users/WangHangang/.codex/skills/hatch-pet/scripts')
spec = importlib.util.spec_from_file_location('pet_prepare', SKILL / 'prepare_pet_run.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

EXTRAS = {
    'side-lie': 'Relaxed side-lying loop, full fluffy belly and plume tail visible, tiny breathing and one slow blink. Calm and content.',
    'stretch-paws': 'Lying sternally with both large front paws extended far forward like the real bed photo. Gently reach further, flex toes, settle back. Keep complete paws and tail visible.',
    'grooming': 'Sitting, raise one front paw, lick the paw then rub it gently against cheek, lower paw. Recognizable natural feline grooming sequence.',
    'stretching': 'Natural cat stretch: forelegs slide forward, chest lowers, hindquarters gently rise, spine stretches, then returns to standing. Four-legged anatomy, no bipedal person poses.',
    'sleeping': 'Curled asleep with eyes fully closed and plume tail tucked beside body. Subtle slow breathing and tiny ear twitch, no waking, no symbols or zzz text.',
    'waking': 'Start curled asleep, open eyes, lift head, uncurl into a relaxed sitting position and end alert. Natural gradual waking, no text.',
    'pouncing': 'One natural play-hunt sequence facing slightly right: attentive low crouch, tiny hindquarter preparation, compact forward pounce, both front paws grasp near the ground, settle in crouch. No toy or cursor drawn. All motion stays inside frame with fixed camera and consistent size.',
    'dragging': 'Gently held airborne, torso upright, hanging belly and relaxed dangling hind paws. Mild squirm: curl front paws, gently alternate hind paws and swing tail. No hand, no collar, no harness, no distress. Whole cat stays visible, subtly suspended not standing.',
    'eating': 'At ground level, lean forward and sniff, lower muzzle and nibble an implied treat, lift head and lick lips with a small pink tongue, finish content. No treat drawn: runtime draws it separately. All four legs anatomically correct.',
    'meowing': 'Seated cat asks softly for attention: look up, open mouth slightly for a short meow, close mouth, small expectant head tilt and return. No speech bubbles, symbols, floating marks or text.'
}

manifest_path = RUN / 'imagegen-jobs.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for job in manifest['jobs']:
    for entry in job.get('input_images', []):
        if entry['path'].replace('\\', '/').endswith('reference-04.jpg'):
            entry['role'] = 'STYLE ONLY: screenshot cat rendering, never copy screenshot UI or short-haired body'

for state, action in EXTRAS.items():
    guide_rel = f'references/layout-guides/{state}.png'
    module.create_layout_guide(RUN / guide_rel, state, 6)
    prompt_rel = f'prompts/extras/{state}.md'
    prompt_path = RUN / prompt_rel
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text(
        f'Create one horizontal 6-frame full-body animation strip of Xiaomi, state {state}.\n'
        'Attach canonical-base.png as authoritative identity and the layout guide for spacing only. '
        'Match the same semi-realistic softly shaded dimensional long-haired fat orange tabby male cat, '
        'same face, ruff, body mass, stripe markings, cream muzzle, yellow-green eyes, pink nose and plume tail. '
        'No white socks, clothing, human hands, accessories or props.\n'
        'Exactly SIX complete separated poses from left to right, equally spaced in SIX invisible equal-width slots '
        'on perfectly flat pure magenta #FF00FF. One complete cat per slot, full tail and paws visible with safe padding. '
        'Same apparent body scale and camera in every frame. Do not enlarge low-lying cat poses to fill slot height. '
        'No visible guide lines, labels, scenery, floor shadows, glow, detached effects, speed lines, checkerboards, text or other animals.\n'
        f'Action: {action}\n', encoding='utf-8')
    if not any(j['id'] == state for j in manifest['jobs']):
        manifest['jobs'].append({
            'id': state, 'kind': 'extra-row-strip', 'status': 'pending',
            'prompt_file': prompt_rel, 'retry_prompt_file': prompt_rel,
            'input_images': [
                {'path': 'references/canonical-base.png', 'role': 'canonical Xiaomi identity'},
                {'path': guide_rel, 'role': 'six-slot layout guide only; never draw its lines'},
            ], 'output_path': f'decoded/{state}.png', 'depends_on': ['base'],
            'generation_skill': '$imagegen', 'requires_grounded_generation': True,
            'allow_prompt_only_generation': False,
        })
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'extra_states': list(EXTRAS), 'total_jobs': len(manifest['jobs'])}))
