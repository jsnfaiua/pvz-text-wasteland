// 文字具现像素预览器：在低分辨率 Canvas 上绘制，再由 CSS 整数放大。

const PALETTE = {
    bg: '#0a0c0b', ink: '#d8d2bd', dark: '#171b19', wedge: '#c0794a', core: '#c7904f',
    orange: '#a65f3f', orangeLight: '#d18452', green: '#667c45', greenLight: '#8da65d',
    wood: '#8b5d3b', woodLight: '#b47a4d', woodDark: '#4c3425', herb: '#527a45', herbLight: '#7daa62',
};

function rect(list, x, y, w, h, color, at) { list.push({ x, y, w, h, color, at }); }

function carrotPixels() {
    const px = [];
    rect(px, 34, 6, 2, 7, PALETTE.green, 0.05);
    rect(px, 29, 8, 5, 2, PALETTE.greenLight, 0.12);
    rect(px, 36, 8, 6, 2, PALETTE.green, 0.18);
    rect(px, 31, 11, 10, 3, PALETTE.orange, 0.25);
    rect(px, 29, 14, 14, 4, PALETTE.orangeLight, 0.36);
    rect(px, 30, 18, 12, 5, PALETTE.orange, 0.48);
    rect(px, 32, 23, 8, 5, PALETTE.orange, 0.62);
    rect(px, 34, 28, 4, 3, PALETTE.orangeLight, 0.78);
    rect(px, 32, 15, 2, 2, '#e7a06a', 0.70);
    rect(px, 38, 20, 2, 2, '#6e3828', 0.72);
    return px;
}

function herbPixels() {
    const px = [];
    rect(px, 35, 14, 2, 16, PALETTE.herb, 0.18);
    rect(px, 27, 12, 8, 4, PALETTE.herbLight, 0.30);
    rect(px, 24, 9, 6, 4, PALETTE.herb, 0.42);
    rect(px, 37, 16, 9, 4, PALETTE.herbLight, 0.35);
    rect(px, 43, 13, 6, 4, PALETTE.herb, 0.50);
    rect(px, 29, 21, 6, 4, PALETTE.herb, 0.58);
    rect(px, 37, 23, 7, 4, PALETTE.herbLight, 0.68);
    rect(px, 30, 30, 12, 2, PALETTE.woodDark, 0.82);
    return px;
}

function woodPixels() {
    const px = [];
    rect(px, 21, 10, 30, 16, PALETTE.woodDark, 0.18);
    rect(px, 23, 8, 28, 15, PALETTE.wood, 0.30);
    rect(px, 25, 10, 24, 4, PALETTE.woodLight, 0.42);
    rect(px, 25, 16, 18, 2, PALETTE.woodDark, 0.54);
    rect(px, 31, 20, 18, 2, PALETTE.woodLight, 0.64);
    rect(px, 21, 10, 4, 13, '#6e4931', 0.72);
    rect(px, 22, 13, 2, 5, PALETTE.woodLight, 0.78);
    return px;
}

function genericPixels(kind) {
    const px = [];
    const metal = '#65727a', metalLight = '#9aa5a8', metalDark = '#30383a';
    const gold = '#c7904f', blue = '#4f7f9b', earth = '#786044';
    if (kind === 'corn') {
        rect(px, 32, 8, 8, 20, gold, 0.25); rect(px, 30, 12, 2, 14, PALETTE.green, 0.40);
        rect(px, 40, 15, 3, 11, PALETTE.greenLight, 0.52); rect(px, 34, 10, 2, 16, '#e0b95e', 0.64);
    } else if (kind === 'potato' || kind === 'food') {
        rect(px, 27, 12, 18, 14, earth, 0.25); rect(px, 30, 10, 12, 18, '#9b7b50', 0.38);
        rect(px, 32, 14, 2, 2, '#4e3d2c', 0.58); rect(px, 39, 21, 2, 2, '#4e3d2c', 0.68);
    } else if (kind === 'stone') {
        rect(px, 25, 18, 22, 10, metalDark, 0.22); rect(px, 28, 13, 16, 14, metal, 0.38);
        rect(px, 31, 13, 9, 3, metalLight, 0.58); rect(px, 39, 18, 5, 5, '#4a5355', 0.68);
    } else if (kind === 'water') {
        rect(px, 33, 9, 6, 7, '#7eb3c5', 0.20); rect(px, 30, 15, 12, 12, blue, 0.38);
        rect(px, 27, 27, 18, 2, '#78aabd', 0.64);
    } else if (kind === 'fert') {
        rect(px, 27, 10, 18, 19, '#514235', 0.22); rect(px, 30, 8, 12, 4, '#77604a', 0.38);
        rect(px, 31, 16, 10, 7, PALETTE.green, 0.58);
    } else if (kind === 'sun') {
        rect(px, 31, 11, 10, 14, gold, 0.20); rect(px, 28, 14, 16, 8, '#e2bd62', 0.38);
        rect(px, 35, 6, 2, 4, gold, 0.55); rect(px, 35, 26, 2, 4, gold, 0.58);
        rect(px, 24, 17, 4, 2, gold, 0.62); rect(px, 44, 17, 4, 2, gold, 0.65);
    } else if (kind === 'gem') {
        rect(px, 30, 10, 12, 5, '#7db7c5', 0.22); rect(px, 27, 15, 18, 7, blue, 0.38);
        rect(px, 31, 22, 10, 7, '#3e718c', 0.52); rect(px, 32, 12, 4, 10, '#b8d9dc', 0.68);
    } else if (kind === 'part' || kind === 'mechanical') {
        rect(px, 29, 11, 14, 16, metal, 0.20); rect(px, 25, 15, 22, 8, metalDark, 0.35);
        rect(px, 33, 15, 6, 8, PALETTE.bg, 0.48); rect(px, 31, 13, 10, 12, metalLight, 0.64);
    } else if (['axe', 'axe-heavy', 'pick', 'hoe', 'wrench', 'shovel', 'blade', 'blade-long', 'spear', 'knife'].includes(kind)) {
        const long = ['blade-long', 'spear', 'hoe', 'shovel', 'pick'].includes(kind);
        rect(px, long ? 21 : 27, 20, long ? 35 : 27, 3, PALETTE.wood, 0.24);
        if (kind.includes('blade') || kind === 'knife') rect(px, 43, 14, long ? 15 : 10, 6, metalLight, 0.42);
        else if (kind === 'spear') rect(px, 54, 17, 8, 7, metalLight, 0.42);
        else if (kind === 'wrench') { rect(px, 43, 15, 9, 3, metalLight, 0.42); rect(px, 48, 12, 4, 8, metal, 0.52); }
        else { rect(px, 43, 12, 10, 10, metal, 0.42); rect(px, 47, 10, 8, 5, metalLight, 0.58); }
    } else if (kind === 'bow') {
        rect(px, 24, 9, 3, 20, PALETTE.wood, 0.22); rect(px, 27, 7, 3, 5, PALETTE.woodLight, 0.38);
        rect(px, 27, 26, 3, 5, PALETTE.woodLight, 0.42); rect(px, 30, 9, 1, 19, PALETTE.ink, 0.58);
        rect(px, 30, 18, 25, 2, metalLight, 0.68);
    } else if (['pistol', 'longgun', 'smg', 'sniper', 'firearm'].includes(kind)) {
        const long = kind !== 'pistol';
        rect(px, long ? 18 : 29, 14, long ? 39 : 24, 7, metal, 0.20);
        rect(px, long ? 24 : 34, 12, long ? 19 : 12, 3, metalLight, 0.38);
        rect(px, long ? 40 : 39, 21, 7, 9, metalDark, 0.48);
        rect(px, long ? 55 : 51, 16, long ? 10 : 7, 3, '#aab2b1', 0.58);
        if (kind === 'sniper') rect(px, 34, 9, 16, 3, '#7f918f', 0.66);
    } else if (['ammo', 'ammo-long', 'shell', 'arrow'].includes(kind)) {
        if (kind === 'arrow') { rect(px, 18, 18, 38, 2, PALETTE.woodLight, 0.28); rect(px, 54, 15, 8, 8, metalLight, 0.48); }
        else {
            for (let i = 0; i < 4; i++) { rect(px, 25 + i * 7, 13, 4, 15, kind === 'shell' ? '#a3533f' : gold, 0.22 + i * 0.11); rect(px, 25 + i * 7, 11, 4, 4, metalLight, 0.42 + i * 0.08); }
        }
    } else {
        rect(px, 27, 11, 18, 18, PALETTE.wood, 0.25); rect(px, 30, 9, 12, 4, PALETTE.woodLight, 0.42);
        rect(px, 31, 16, 10, 8, PALETTE.ink, 0.60);
    }
    return px;
}

function pixelsFor(recipe) {
    if (recipe.visual === 'carrot') return carrotPixels();
    if (recipe.visual === 'herb') return herbPixels();
    if (recipe.visual === 'wood') return woodPixels();
    return genericPixels(recipe.visual || recipe.category);
}

function drawGlyphs(ctx, recipe, progress) {
    const fade = progress < 0.2 ? 1 : Math.max(0, 1 - (progress - 0.2) / 0.65);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const gap = 15;
    const start = 36 - ((recipe.glyphs.length - 1) * gap) / 2;
    recipe.glyphs.forEach((char, index) => {
        const jitter = progress > 0.08 && progress < 0.2 && index % 2 ? 1 : 0;
        ctx.fillText(char, start + index * gap, 18 + jitter);
        if (index < recipe.glyphs.length - 1) {
            ctx.fillStyle = PALETTE.wedge;
            ctx.fillRect(start + index * gap + 6, 17, 3, 3);
            ctx.fillStyle = PALETTE.ink;
        }
    });
    ctx.restore();
}

function drawObject(ctx, recipe, progress) {
    const phase = Math.max(0, (progress - 0.18) / 0.72);
    for (const p of pixelsFor(recipe)) {
        if (phase + 0.001 < p.at) continue;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    if (progress >= 0.86) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(25, 32, 24, 2);
        ctx.fillStyle = PALETTE.core;
        ctx.fillRect(35, 18, 2, 2);
    }
}

export function drawManifestation(canvas, recipe, progress) {
    if (!canvas || !recipe) return;
    canvas.width = 72;
    canvas.height = 36;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGlyphs(ctx, recipe, Math.max(0, Math.min(1, progress)));
    drawObject(ctx, recipe, Math.max(0, Math.min(1, progress)));
}
