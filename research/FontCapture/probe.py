"""Chromium foreignObject font probe.

Optional research dependencies: pip install fonttools brotli playwright
Run: python probe.py (after playwright install chromium), or set CHROMIUM_PATH.
All fonts are synthetic geometric fixtures generated in a temporary directory.
"""
import base64
import io
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, SourceDescriptor
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.varLib import build
from playwright.sync_api import sync_playwright


def make_font(weight, italic=False, cff=False):
    builder = FontBuilder(1000, isTTF=not cff)
    names = ['.notdef', 'latinA', 'cyrillicA']
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({65: 'latinA', 1040: 'cyrillicA'})
    glyphs = {}
    for name in names:
        pen = T2CharStringPen(1100, None) if cff else TTGlyphPen(None)
        if name != '.notdef':
            width = 200 + weight // 2
            skew = 180 if italic else 0
            pen.moveTo((0, 0))
            for point in [(width, 0), (width + skew, 800), (skew, 800)]:
                pen.lineTo(point)
            pen.closePath()
        glyphs[name] = pen.getCharString() if cff else pen.glyph()
    style = 'Italic' if italic else 'Regular'
    if cff:
        builder.setupCFF('FigVamProbe', {'FullName': 'FigVamProbe', 'FamilyName': 'FigVamProbe', 'Weight': style}, glyphs, {})
    else:
        builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (1100, 0) for name in names})
    builder.setupHorizontalHeader(ascent=850, descent=-150)
    builder.setupNameTable({'familyName': 'FigVamProbe', 'styleName': style,
                            'uniqueFontIdentifier': f'FigVamProbe-{weight}-{style}',
                            'fullName': 'FigVamProbe ' + style, 'psName': 'FigVamProbe-' + style})
    builder.font['head'].macStyle = 2 if italic else 0
    builder.setupOS2(sTypoAscender=850, sTypoDescender=-150, usWinAscent=850,
                     usWinDescent=150, usWeightClass=weight, fsSelection=1 if italic else 64)
    builder.setupPost(italicAngle=-12 if italic else 0)
    builder.setupMaxp()
    return builder.font


def encode(font, flavor=None):
    font.flavor = flavor
    stream = io.BytesIO()
    font.save(stream)
    return base64.b64encode(stream.getvalue()).decode('ascii')


def variable_font(directory):
    doc = DesignSpaceDocument()
    axis = AxisDescriptor()
    axis.name, axis.tag, axis.minimum, axis.default, axis.maximum = 'Weight', 'wght', 100, 100, 900
    doc.addAxis(axis)
    for weight in [100, 900]:
        path = str(Path(directory) / f'master-{weight}.ttf')
        make_font(weight).save(path)
        source = SourceDescriptor()
        source.path, source.name = path, str(weight)
        source.familyName, source.styleName = 'FigVamProbe', str(weight)
        source.location = {'Weight': weight}
        doc.addSource(source)
    result, _, _ = build(doc)
    return result


PROBE = r'''async ({data,mime,weight,style,w}) => {
  const font = new FontFace('FigVamProbe', Uint8Array.from(atob(data), c => c.charCodeAt(0)), {weight,style});
  await font.load(); document.fonts.add(font);
  try {
    const css = 'font-family:FigVamProbe,monospace;font-size:60px;font-weight:'+w+';font-style:'+style+';line-height:100px;color:black;';
    const d = document.createElement('div');
    d.style.cssText = css + 'width:500px;height:100px;background:white;'; d.textContent = 'AАAА';
    document.body.replaceChildren(d); await document.fonts.ready;
    async function draw(source) {
      const c = document.createElement('canvas'); c.width = 500; c.height = 100;
      const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,500,100);
      if (source) {
        const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
        await img.decode(); ctx.drawImage(img,0,0);
      } else {
        ctx.fillStyle = 'black'; ctx.font = style+' '+w+' 60px FigVamProbe,monospace';
        ctx.fillText('AАAА',0,75);
      }
      const pixels = ctx.getImageData(0,0,500,100).data; let ink=0,maxX=0;
      for(let i=0;i<pixels.length;i+=4) if(pixels[i]<128) { ink++; maxX=Math.max(maxX,i/4%500); }
      return {ink,maxX};
    }
    const rule = '@font-face{font-family:FigVamProbe;src:url(data:'+mime+';base64,'+data+');font-weight:'+weight+';font-style:'+style+';}';
    const svg = embedded => '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>'+(embedded ? rule : '')+'</style><div style="'+css+'width:500px;height:100px;background:white">AАAА</div></div></foreignObject></svg>';
    return {direct:await draw(null), embedded:await draw(svg(true)), fallback:await draw(svg(false))};
  } finally {document.fonts.delete(font);}
}'''


def main():
    with TemporaryDirectory() as directory:
        cases = [
            ('TTF normal', encode(make_font(400)), 'font/ttf', '400', 'normal', [400]),
            ('TTF italic', encode(make_font(400, italic=True)), 'font/ttf', '400', 'italic', [400]),
            ('OTF CFF', encode(make_font(400, cff=True)), 'font/otf', '400', 'normal', [400]),
            ('WOFF', encode(make_font(500), 'woff'), 'font/woff', '500', 'normal', [500]),
            ('WOFF2 bold', encode(make_font(700), 'woff2'), 'font/woff2', '700', 'normal', [700]),
            ('WOFF2 variable', encode(variable_font(directory), 'woff2'), 'font/woff2', '100 900', 'normal', [100,537,900]),
        ]
        with sync_playwright() as p:
            options = {'executable_path': os.environ['CHROMIUM_PATH']} if 'CHROMIUM_PATH' in os.environ else {}
            browser = p.chromium.launch(**options)
            try:
                page = browser.new_page(viewport={'width':600,'height':200})
                page.set_content('<body style="margin:0;background:white"></body>')
                for label, data, mime, weight, style, weights in cases:
                    ink = []
                    for w in weights:
                        result = page.evaluate(PROBE, dict(data=data,mime=mime,weight=weight,style=style,w=w))
                        print(label, w, result)
                        assert result['direct'] == result['embedded'], (label,w,result)
                        assert result['embedded'] != result['fallback'], (label,w,result)
                        ink.append(result['embedded']['ink'])
                    assert len(set(ink)) == len(ink), (label,ink)
            finally:
                browser.close()


if __name__ == '__main__':
    main()
