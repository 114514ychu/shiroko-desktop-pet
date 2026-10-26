"""Import character assets from your own existing portable copy; does not download."""
import argparse,json,struct
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('portable',type=Path,help='Folder containing ShirokoPet.exe and resources/app.asar')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[1]
count=0
with (args.portable/'resources/app.asar').open('rb') as stream:
    first=stream.read(16); base=8+struct.unpack_from('<I',first,4)[0]
    header=json.loads(stream.read(struct.unpack_from('<I',first,12)[0]).decode('utf-8'))
    def walk(node,prefix=''):
        global count
        for name,e in node.get('files',{}).items():
            rel=f'{prefix}/{name}' if prefix else name
            if 'files' in e:walk(e,rel);continue
            parts=Path(rel).parts
            if len(parts)<3 or parts[0]!='characters' or parts[2]!='assets':continue
            dest=(repo/rel).resolve()
            if not dest.is_relative_to(repo):raise RuntimeError('Invalid archive path')
            if e.get('link') or e.get('unpacked'):raise RuntimeError('Unsupported entry')
            stream.seek(base+int(e['offset']));content=stream.read(e['size'])
            if len(content)!=e['size']:raise RuntimeError('Truncated archive')
            dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(content);count+=1
    walk(header)
print(f'Imported {count} local character assets. These files remain ignored by Git.')
