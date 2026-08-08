// 从参考图 1:1 sprite 生成 4 方向帧 PNG(侧视镜像)
// 读取 source-code/mod-wasteland/sprites/sprite-{front,side,back}.png
// 输出 dev-tools/_qa_tmp/ours-{front,side-left,back,side-right}.png
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SPRITE_DIR = path.join(__dirname, '..', 'source-code/mod-wasteland/sprites');
const OUT = path.join(__dirname, '_qa_tmp');

function load(n) { return PNG.sync.read(fs.readFileSync(path.join(SPRITE_DIR, 'sprite-' + n + '.png'))); }
function mirrorX(src) {
    const out = new PNG({ width: src.width, height: src.height });
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
        const si = (y * src.width + x) * 4;
        const oi = (y * src.width + (src.width - 1 - x)) * 4;
        out.data[oi] = src.data[si]; out.data[oi + 1] = src.data[si + 1];
        out.data[oi + 2] = src.data[si + 2]; out.data[oi + 3] = src.data[si + 3];
    }
    return out;
}
function save(png, name) {
    fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
    console.log('写出', name, png.width + 'x' + png.height);
}

const front = load('front'), side = load('side'), back = load('back');
save(front, 'ours-front.png');
save(side, 'ours-side-left.png');         // 参考图侧视(西)脸在左 = 朝左
save(mirrorX(side), 'ours-side-right.png'); // 朝右 = 镜像
save(back, 'ours-back.png');
console.log('4 方向帧生成完毕(1:1 参考图 sprite,side 朝左/right 镜像)');