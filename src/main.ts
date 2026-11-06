import './style.css';

// TODO allow font selection from browser fonts?
// TODO sequential mode: all characters in ascii range
//      sparse mode: specified characters one by one
// TODO from the previews it's not clear that the font is actually fixed width like Nimbus Sans' digits

const padding = 1;

const fontFileInput = document.getElementById('fontFile') as HTMLInputElement;
const fontNameInput = document.getElementById('fontName') as HTMLInputElement;
const charactersInput = document.getElementById('characters') as HTMLInputElement;
const fontSizeInput = document.getElementById('fontSize') as HTMLInputElement;
const alphaThresholdInput = document.getElementById('alphaThreshold') as HTMLInputElement;
const fixedHeightInput = document.getElementById('fixedHeight') as HTMLInputElement;
const yOffsetInput = document.getElementById('yOffset') as HTMLInputElement;
const previewScaleInput = document.getElementById('previewScale') as HTMLInputElement;
const renderButton = document.getElementById('render') as HTMLButtonElement;
const previewsDiv = document.getElementById('previews') as HTMLDivElement;

let currentFont = '';

fontFileInput.addEventListener('change', async () => {
    await loadFont();
    currentFont = 'DynamicFont';
    generate();
});
fontNameInput.addEventListener('change', () => {
    currentFont = fontNameInput.value;
    generate();
});
charactersInput.addEventListener('change', () => generate());
fontSizeInput.addEventListener('change', () => generate());
alphaThresholdInput.addEventListener('change', () => generate());
fixedHeightInput.addEventListener('change', () => generate());
yOffsetInput.addEventListener('change', () => generate());
previewScaleInput.addEventListener('change', () => generate());
renderButton.addEventListener('click', () => generate());

async function generate() {
    // Deduplicate and sort chars
    const chars = [...new Set(charactersInput.value)].sort();
    charactersInput.value = chars.join('');

    previewsDiv.replaceChildren();
    const glyphs: Glyph[] = [];
    for (const c of chars) {
        const glyph = getGlyph(c);
        glyphs[c.charCodeAt(0)] = glyph;
        drawPreview(glyph);
    }
    // TODO output box in page
    const header = generateFontHeader('font', glyphs);
    console.info(header);
}

async function loadFont() {
    const file = fontFileInput.files?.[0];
    if (!file)
        return;

    const data = await file.arrayBuffer();
    const font = new FontFace('DynamicFont', data);
    await font.load();
    document.fonts.add(font);
}

interface Glyph {
    width: number;
    height: number;
    pixels: number[][];
    xAdvance: number;
    xOffset: number;
    yOffset: number;
}

function getGlyph(character: string): Glyph {
    const fontSize = Number(fontSizeInput.value);
    const alphaThreshold = Number(alphaThresholdInput.value);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    ctx.font = `${fontSize}px ${currentFont}`;
    ctx.textBaseline = 'alphabetic';

    const metrics = ctx.measureText(character);
    const left = metrics.actualBoundingBoxLeft;
    const right = metrics.actualBoundingBoxRight;
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;

    const width = Math.max(1, Math.ceil(left + right) + padding * 2);
    const height = Math.max(1, Math.ceil(ascent + descent) + padding * 2);

    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.font = `${fontSize}px ${currentFont}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.clearRect(0, 0, width, height);

    const baselineX = padding + left;
    const baselineY = padding + ascent;
    ctx.fillText(character, baselineX, baselineY);

    const image = ctx.getImageData(0, 0, width, height);
    const pixels = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const alpha = image.data[index + 3];
            row.push(alpha >= alphaThreshold ? 1 : 0);
        }
        pixels.push(row);
    }

    return {
        width,
        height,
        pixels,
        xAdvance: metrics.width,
        xOffset: -padding,
        yOffset: -baselineY,
    };
}

function drawPreview(glyph: Glyph) {
    const scale = Number(previewScaleInput.value) || 1;

    const canvas = document.createElement('canvas');
    canvas.width = glyph.width * scale;
    canvas.height = glyph.height * scale;

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < glyph.height; y++)
        for (let x = 0; x < glyph.width; x++)
            if (glyph.pixels[y][x])
                ctx.fillRect(x * scale, y * scale, scale, scale);

    ctx.strokeStyle = '#ff0000';
    ctx.strokeRect(
        0,
        Number(yOffsetInput.value) * scale,
        glyph.width * scale,
        Number(fixedHeightInput.value) * scale);

    previewsDiv.append(canvas);
}

function generateFontHeader(
    fontName: string,
    glyphs: Glyph[],
) {
    // TODO handle ascent and descent as an alternative to fixedHeight to handle baseline across different fonts/sizes
    const fixedHeight = Number(fixedHeightInput.value);
    const yOffset = Number(yOffsetInput.value) || 0;

    const chars = Object.keys(glyphs).map(Number).sort((a, b) => Number(a) - Number(b));
    const firstChar = chars.at(0)!;
    const lastChar = chars.at(-1)!;

    const bitmapData = [];
    const glyphData = [];
    for (let char = firstChar; char <= lastChar; char++) {
        const glyph = glyphs[char];
        if (!glyph) {
            glyphData.push({
                char: 0,
                offset: bitmapData.length,
                width: 0,
                height: 0,
                xOffset: 0,
                xAdvance: 0,
            });
            continue;
        }

        // TODO note that heights not multiple of 8 are rounded up
        const offset = bitmapData.length;
        const pages = Math.ceil(fixedHeight / 8);
        for (let x = 0; x < glyph.width; x++) {
            for (let page = 0; page < pages; page++) {
                let value = 0;
                for (let bit = 0; bit < 8; bit++) {
                    const y = page * 8 + yOffset + bit;
                    if (y < glyph.height && glyph.pixels[y][x]) {
                        value |= (1 << bit);
                    }
                }
                bitmapData.push(value);
            }
        }

        glyphData.push({
            char,
            offset,
            width: glyph.width,
            height: fixedHeight,
            xOffset: glyph.xOffset,
            xAdvance: Math.round(glyph.xAdvance),
        });
    }

    const bitmapLines = [];
    for (let i = 0; i < bitmapData.length; i += 16) {
        const line = bitmapData
            .slice(i, i + 16)
            .map(v => `0x${v.toString(16).padStart(2, '0').toUpperCase()}`)
            .join(', ');
        bitmapLines.push(`    ${line},`);
    }

    const glyphLines = glyphData.map(g =>
        `    { ${g.offset}, ${g.width}, ${g.height}, ${g.xOffset}, ${g.xAdvance} }, // ${String.fromCharCode(g.char)}`);

    return `#pragma once

#include <stdint.h>

typedef struct {
    uint16_t bitmap_offset;
    uint8_t width;
    uint8_t height;
    int8_t x_offset;
    uint8_t x_advance;
} ssd1306_glyph_t;

typedef struct {
    uint8_t font_height;
    uint16_t first_char;
    uint16_t last_char;
    const ssd1306_glyph_t *glyphs;
    const uint8_t *bitmap;
} ssd1306_font_t;

static const uint8_t ${fontName}_bitmap[] = {
${bitmapLines.join('\n')}
};

static const ssd1306_glyph_t ${fontName}_glyphs[] = {
${glyphLines.join('\n')}
};

static const ssd1306_font_t ${fontName} = {
    .font_height = ${fixedHeight},
    .first_char = ${firstChar},
    .last_char = ${lastChar},
    .glyphs = ${fontName}_glyphs,
    .bitmap = ${fontName}_bitmap,
};
`;
}
