import hashlib,json,os,re,textwrap,urllib.request
from pathlib import Path
out=Path(os.environ['RUNNER_TEMP'])/'guide-public';out.mkdir(exist_ok=True)
commit=os.environ['GUIDE_COMMIT']; candidate=os.environ['CANDIDATE']; rev=candidate.removeprefix('sha-')
def fetch(path,ref=commit):
 return urllib.request.urlopen(f'https://raw.githubusercontent.com/lord007tn/nibleaf/{ref}/{path}').read().decode()
sources=[fetch('docs/self-hosting/upgrade-v0-2.mdx'),fetch('docs/ar/self-hosting/upgrade-v0-2.mdx')]
allblocks=[]
for locale,s in zip(['en','ar'],sources):
 (out/f'{locale}.mdx').write_text(s)
 blocks=[textwrap.dedent(m[2]) for m in re.finditer(r'(?m)^\s*```(bash|text)\n(.*?)^\s*```',s,re.S)]
 allblocks.append(blocks)
manifest=json.loads(fetch('release/self-host.json',rev))
compose=fetch('docker-compose.prod.yml',rev)
assert hashlib.sha256(compose.encode()).hexdigest()==manifest['composeSha256'], 'candidate manifest compose checksum is stale'
(out/'substitutions.txt').write_text(f'Guide source: {commit}\nCandidate image: {candidate}\n1. Replace v0.2.0 with {candidate} in executable blocks.\n2. Replace release Compose URL with raw candidate-commit docker-compose.prod.yml.\n3. Replace nonexistent release SHA256SUMS fetch with candidate release/self-host.json composeSha256 rendered as a SHA256SUMS entry. Keep the guide checksum-verification command unchanged.\nNo other guide command text is substituted. Runner fixtures, assertions and separately labelled diagnostic repairs are harness commands.\n')
for i,b in enumerate(allblocks[0]):
 original=b
 if i==14:
  b=b.replace('https://github.com/lord007tn/nibleaf/releases/download/v0.2.0/docker-compose.yml',f'https://raw.githubusercontent.com/lord007tn/nibleaf/{rev}/docker-compose.prod.yml')
  b=b.replace('curl -fsSLo "$d/SHA256SUMS" https://github.com/lord007tn/nibleaf/releases/download/v0.2.0/SHA256SUMS',f'''curl -fsSLo "$d/self-host.json" https://raw.githubusercontent.com/lord007tn/nibleaf/{rev}/release/self-host.json
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["composeSha256"] + "  docker-compose.yml")' "$d/self-host.json" > "$d/SHA256SUMS"''')
 b=b.replace('v0.2.0',candidate)
 (out/f'block-{i}.sh').write_text(b)
 (out/f'original-{i}.txt').write_text(original)
# Comments may be translated; compare executable block contents byte-for-byte first.
diffs=[i for i,(a,b) in enumerate(zip(*allblocks)) if a!=b]
(out/'mirror.json').write_text(json.dumps({'en_blocks':len(allblocks[0]),'ar_blocks':len(allblocks[1]),'differing_blocks':diffs},indent=2))
for i in diffs: (out/f'ar-block-{i}.txt').write_text(allblocks[1][i])
print(f'EXTRACTED {len(allblocks[0])} blocks; Arabic differing blocks={diffs}; candidate checksum matches manifest')
