import hashlib,json,os,re,textwrap,urllib.request
from pathlib import Path
out=Path(os.environ['PUBLIC']);out.mkdir(exist_ok=True)
ref=os.environ['GUIDE_COMMIT'];candidate=os.environ['CANDIDATE']
def fetch(path):return urllib.request.urlopen(f'https://raw.githubusercontent.com/lord007tn/nibleaf/{ref}/{path}',timeout=60).read()
for name,path in [('upgrade-en','docs/self-hosting/upgrade-v0-2.mdx'),('upgrade-ar','docs/ar/self-hosting/upgrade-v0-2.mdx'),('backup-en','docs/self-hosting/backups-upgrades.mdx'),('backup-ar','docs/ar/self-hosting/backups-upgrades.mdx')]:
 data=fetch(path).decode();(out/f'{name}.mdx').write_text(data)
 blocks=[]
 for i,m in enumerate(re.finditer(r'(?m)^\s*```(\w*)\n(.*?)^\s*```',data,re.S)):
  original=textwrap.dedent(m[2]);blocks.append(original)
  (out/f'{name}-original-{i}.txt').write_text(original)
  rendered=original
  if name.startswith('upgrade') and i==14:
   rendered=rendered.replace('https://github.com/lord007tn/nibleaf/releases/download/v0.2.0/docker-compose.yml',f'https://raw.githubusercontent.com/lord007tn/nibleaf/{ref}/docker-compose.prod.yml')
   rendered=rendered.replace('curl -fsSLo "$d/SHA256SUMS" https://github.com/lord007tn/nibleaf/releases/download/v0.2.0/SHA256SUMS',f'''curl -fsSLo "$d/self-host.json" https://raw.githubusercontent.com/lord007tn/nibleaf/{ref}/release/self-host.json
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["composeSha256"] + "  docker-compose.yml")' "$d/self-host.json" > "$d/SHA256SUMS"''')
  rendered=rendered.replace('v0.2.0',candidate)
  (out/f'{name}-{i}.sh').write_text(rendered)
 if name=='upgrade-en':
  assert len(blocks)==30
  (out/'expected-migrations.txt').write_text('\n'.join(sorted(set(re.findall(r'`(202[0-9]{11}_[a-z_]+)`',data))))+'\n')
  assert 'LIMIT 8' in blocks[17]
  # The prose authorizes skipping only this one logical command.
  logical=re.findall(r'(?:[^\n]*\\\n)*[^\n]*\n',blocks[24])
  skipped=[x for x in logical if '--rollback --apply' not in x]
  assert len(logical)-len(skipped)==1
  (out/'rollback-skip-only-apply.sh').write_text(''.join(skipped))
 for locale in []:pass
 (out/f'{name}-blocks.json').write_text(json.dumps(blocks,ensure_ascii=False))
mirrors={}
for section in ['upgrade','backup']:
 a=json.loads((out/f'{section}-en-blocks.json').read_text());b=json.loads((out/f'{section}-ar-blocks.json').read_text())
 mirrors[section]={'en':len(a),'ar':len(b),'different':[i for i,(x,y) in enumerate(zip(a,b)) if x!=y]}
(out/'mirrors.json').write_text(json.dumps(mirrors,indent=2));assert all(not x['different'] and x['en']==x['ar'] for x in mirrors.values())
for path,name in [('scripts/install.sh','installer-template.sh'),('scripts/self-host-release.mjs','self-host-release.mjs'),('docker-compose.prod.yml','compose.yml'),('release/self-host.json','self-host.json')]:
 (out/name).write_bytes(fetch(path))
manifest=json.loads((out/'self-host.json').read_text());assert hashlib.sha256((out/'compose.yml').read_bytes()).hexdigest()==manifest['composeSha256']
(out/'substitutions.txt').write_text(f'''Guide and Compose commit: {ref}
Candidate image: {candidate}
1. Future v0.2.0 Compose and corresponding SHA256SUMS downloads use PR-head docker-compose.prod.yml and PR release/self-host.json composeSha256 rendered into SHA256SUMS. Original checksum verification is unchanged.
2. Executable v0.2.0 image references use {candidate}. Fresh PR installer uses NIBLEAF_VERSION override, NIBLEAF_COMPOSE_URL pointing at the PR file and its manifest checksum. Template placeholders are rendered by the PR's renderInstaller() as release automation does; release version remains v0.2.0.
No other guide command text is substituted. Markdown indentation is removed. Prose-authorized branches select/skip commands as stated. Separate disposable failure injection/fixtures are labelled in receipts.
''')
print(f'Pinned source {ref}; EN/AR fences identical; eight-migration LIMIT 8 present')
