import hashlib
import io
from pathlib import Path
import sys
import zlib
from fontTools import subset
from fontTools.ttLib import TTFont

source = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == '76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31'
chars = '작업계획서가상시험'
font = TTFont(io.BytesIO(source))
options = subset.Options()
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=chars)
subsetter.subset(font)
# The OFL reserves the original family names; the subset has its own name.
for record in font['name'].names:
    if record.nameID in (1, 2, 3, 4, 6, 16, 17):
        record.string = ('Regular' if record.nameID in (2, 17) else 'JWebKoreanFixture').encode(record.getEncoding())
font_data = io.BytesIO()
font.save(font_data)
cmap = font.getBestCmap()
gids = [font.getGlyphID(cmap[ord(char)]) for char in chars]
assert len(set(gids)) == len(chars) and 0 not in gids
units = font['head'].unitsPerEm
widths = [round(font['hmtx'][cmap[ord(char)]][0] * 1000 / units) for char in chars]
def stream(data, extra=b''):
    return b'<< /Length %d ' % len(data) + extra + b' >>\nstream\n' + data + b'\nendstream'
def encoded(text):
    return ''.join(f'{chars.index(char)+1:04X}' for char in text)
unicode_map = ('/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n'
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
    '/CMapName /JWebKorean def /CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
    f'{len(chars)} beginbfchar\n' + '\n'.join(f'<{i+1:04X}> <{ord(c):04X}>' for i,c in enumerate(chars)) +
    '\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end').encode()
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [10 0 R] >>',
    stream(f'0 0 0 rg BT /F1 24 Tf 20 145 Td <{encoded("작업계획서")}> Tj 0 -40 Td <{encoded("가상시험")}> Tj ET'.encode()),
    b'<< /Type /Font /Subtype /Type0 /BaseFont /JWebKoreanFixture /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 9 0 R >>',
    ('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /JWebKoreanFixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /CIDToGIDMap 12 0 R /DW 1000 /W [1 [' + ' '.join(map(str,widths)) + ']] >>').encode(),
    b'<< /Type /FontDescriptor /FontName /JWebKoreanFixture /Flags 4 /FontBBox [-200 -300 1200 1100] /ItalicAngle 0 /Ascent 1000 /Descent -300 /CapHeight 1000 /StemV 80 /FontFile2 8 0 R >>',
    stream(zlib.compress(font_data.getvalue()), b'/Filter /FlateDecode /Length1 %d' % len(font_data.getvalue())),
    stream(unicode_map),
    b'<< /Type /Annot /Subtype /Stamp /Rect [190 20 270 70] /F 4 /AP << /N 11 0 R >> >>',
    stream(f'1 0 0 RG 2 w 2 2 76 46 re S 1 0 0 rg BT /F1 24 Tf 17 15 Td <{encoded("시험")}> Tj ET'.encode(), b'/Type /XObject /Subtype /Form /BBox [0 0 80 50] /Resources << /Font << /F1 5 0 R >> >>'),
    stream(b'\0\0' + b''.join(gid.to_bytes(2,'big') for gid in gids)),
]
data = b'%PDF-1.7\n'
offsets = []
for index, obj in enumerate(objects, 1):
    offsets.append(len(data))
    data += f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n'
start = len(data)
data += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
data += b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets)
data += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
output = Path(__file__).with_name('synthetic-korean.pdf')
output.write_bytes(data)
print(f'{output.name}: {len(data)} bytes; sha256={hashlib.sha256(data).hexdigest()}')
