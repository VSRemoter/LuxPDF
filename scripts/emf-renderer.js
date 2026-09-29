/* LuxPDF EMF rasteriser.
 *
 * Browsers cannot decode Windows Enhanced Metafiles, yet Office templates use
 * them for logos, backgrounds and clip-art. This renders the GDI record set
 * that Office produces (paths, polygons, beziers, pens/brushes, clipping,
 * mapping modes/world transforms, text and DIB bitmaps) onto a canvas.
 *
 * Exposes window.LuxEmf.rasterize(Uint8Array, maxSide) -> Promise<HTMLCanvasElement|null>.
 */
(function (global) {
    'use strict';

    const STOCK = {
        0x80000000: { kind: 'brush', style: 0, color: [255, 255, 255] },
        0x80000001: { kind: 'brush', style: 0, color: [192, 192, 192] },
        0x80000002: { kind: 'brush', style: 0, color: [128, 128, 128] },
        0x80000003: { kind: 'brush', style: 0, color: [64, 64, 64] },
        0x80000004: { kind: 'brush', style: 0, color: [0, 0, 0] },
        0x80000005: { kind: 'brush', style: 1 },
        0x80000006: { kind: 'pen', style: 0, width: 0, color: [255, 255, 255] },
        0x80000007: { kind: 'pen', style: 0, width: 0, color: [0, 0, 0] },
        0x80000008: { kind: 'pen', style: 5 },
        0x80000012: { kind: 'brush', style: 0, color: [255, 255, 255] },
        0x80000013: { kind: 'pen', style: 0, width: 0, color: [0, 0, 0] }
    };
    const DEFAULT_FONT = { kind: 'font', height: -12, weight: 400, italic: false, face: 'Arial', escapement: 0 };

    const mul = (m, n) => [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];

    function decodeDib(dv, bmiOff, bmiSize, bitsOff, bitsSize, useAlpha) {
        if (!bmiSize || bmiOff + 40 > dv.byteLength) return null;
        const hdrSize = dv.getUint32(bmiOff, true);
        let w, h, bpp, comp, clrUsed = 0;
        if (hdrSize === 12) {
            w = dv.getUint16(bmiOff + 4, true); h = dv.getInt16(bmiOff + 6, true); bpp = dv.getUint16(bmiOff + 10, true); comp = 0;
        } else {
            w = dv.getInt32(bmiOff + 4, true); h = dv.getInt32(bmiOff + 8, true);
            bpp = dv.getUint16(bmiOff + 14, true); comp = dv.getUint32(bmiOff + 16, true);
            clrUsed = dv.getUint32(bmiOff + 32, true);
        }
        if (comp === 4 || comp === 5) {
            const bytes = new Uint8Array(dv.buffer, dv.byteOffset + bitsOff, bitsSize);
            return { encoded: new Blob([bytes], { type: comp === 4 ? 'image/jpeg' : 'image/png' }) };
        }
        const topDown = h < 0;
        h = Math.abs(h);
        if (!w || !h || w > 16384 || h > 16384) return null;
        const palette = [];
        const palOff = bmiOff + hdrSize + (comp === 3 && hdrSize === 40 ? 12 : 0);
        const palCount = bpp <= 8 ? (clrUsed || (1 << bpp)) : 0;
        for (let i = 0; i < palCount; i++) {
            const o = palOff + i * (hdrSize === 12 ? 3 : 4);
            if (o + 3 > dv.byteLength) break;
            palette.push([dv.getUint8(o + 2), dv.getUint8(o + 1), dv.getUint8(o)]);
        }
        let masks = null;
        if (comp === 3) {
            const mo = hdrSize >= 52 ? bmiOff + 40 : bmiOff + hdrSize;
            masks = [dv.getUint32(mo, true), dv.getUint32(mo + 4, true), dv.getUint32(mo + 8, true)];
        }
        const stride = ((w * bpp + 31) >>> 5) * 4;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        const px = img.data;
        const shiftOf = (m) => { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return s; };
        const scaleOf = (m) => { m >>>= shiftOf(m); return m ? 255 / m : 0; };
        let anyAlpha = false;
        for (let y = 0; y < h; y++) {
            const row = bitsOff + (topDown ? y : h - 1 - y) * stride;
            if (row + stride > dv.byteLength + stride) break;
            for (let x = 0; x < w; x++) {
                let r = 0, g = 0, b = 0, a = 255;
                const safe = (o) => (o < dv.byteLength ? dv.getUint8(o) : 0);
                if (bpp === 32 || bpp === 16) {
                    if (bpp === 32 && !masks) {
                        const o = row + x * 4;
                        b = safe(o); g = safe(o + 1); r = safe(o + 2); a = safe(o + 3);
                    } else {
                        const o = row + x * (bpp / 8);
                        const v = bpp === 32 ? (o + 3 < dv.byteLength ? dv.getUint32(o, true) : 0) : (o + 1 < dv.byteLength ? dv.getUint16(o, true) : 0);
                        const mk = masks || [0x7c00, 0x03e0, 0x001f];
                        r = ((v & mk[0]) >>> shiftOf(mk[0])) * scaleOf(mk[0]);
                        g = ((v & mk[1]) >>> shiftOf(mk[1])) * scaleOf(mk[1]);
                        b = ((v & mk[2]) >>> shiftOf(mk[2])) * scaleOf(mk[2]);
                        a = bpp === 32 ? (v >>> 24) : 255;
                    }
                } else if (bpp === 24) {
                    const o = row + x * 3;
                    b = safe(o); g = safe(o + 1); r = safe(o + 2);
                } else {
                    const bitPos = x * bpp;
                    const byte = safe(row + (bitPos >> 3));
                    const idx = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
                    const c = palette[idx] || [0, 0, 0];
                    r = c[0]; g = c[1]; b = c[2];
                }
                const p = (y * w + x) * 4;
                px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = a;
                if (bpp === 32 && a !== 0) anyAlpha = true;
            }
        }
        if (bpp === 32) {
            for (let p = 0; p < px.length; p += 4) {
                if (!useAlpha || !anyAlpha) { px[p + 3] = 255; continue; }
                const a = px[p + 3];
                if (a && a < 255) { px[p] = Math.min(255, px[p] * 255 / a); px[p + 1] = Math.min(255, px[p + 1] * 255 / a); px[p + 2] = Math.min(255, px[p + 2] * 255 / a); }
            }
        }
        ctx.putImageData(img, 0, 0);
        return { canvas };
    }

    async function dibToImage(dib) {
        if (!dib) return null;
        if (dib.canvas) return dib.canvas;
        const url = URL.createObjectURL(dib.encoded);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } catch (_) {
            return null;
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }
    }

    async function rasterize(bytes, maxSide = 4000) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length < 88 || dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464d4520) return null;
        const i32 = (o) => dv.getInt32(o, true);
        const u32 = (o) => dv.getUint32(o, true);
        const f32 = (o) => dv.getFloat32(o, true);
        const bounds = [i32(8), i32(12), i32(16), i32(20)];
        const frame = [i32(24), i32(28), i32(32), i32(36)];
        const devW = i32(72), devH = i32(76), mmW = i32(80), mmH = i32(84);
        const pxmmX = mmW > 0 ? devW / mmW : 3.78, pxmmY = mmH > 0 ? devH / mmH : 3.78;
        let fx0 = frame[0] / 100 * pxmmX, fy0 = frame[1] / 100 * pxmmY;
        let fx1 = frame[2] / 100 * pxmmX, fy1 = frame[3] / 100 * pxmmY;
        if (!(fx1 > fx0 && fy1 > fy0)) { fx0 = bounds[0]; fy0 = bounds[1]; fx1 = bounds[2] + 1; fy1 = bounds[3] + 1; }
        if (!(fx1 > fx0 && fy1 > fy0)) return null;
        const inW = Math.max(0.01, (frame[2] - frame[0]) / 2540), inH = Math.max(0.01, (frame[3] - frame[1]) / 2540);
        let longSide = Math.max(1200, Math.min(maxSide, Math.max(inW, inH) * 300));
        const aspect = (fx1 - fx0) / (fy1 - fy0);
        const outW = Math.max(1, Math.round(aspect >= 1 ? longSide : longSide * aspect));
        const outH = Math.max(1, Math.round(aspect >= 1 ? longSide / aspect : longSide));
        const canvas = document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        const base = [outW / (fx1 - fx0), 0, 0, outH / (fy1 - fy0), -fx0 * outW / (fx1 - fx0), -fy0 * outH / (fy1 - fy0)];

        const objects = [];
        let dc = {
            mapMode: 1, winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1], world: [1, 0, 0, 1, 0, 0],
            pen: STOCK[0x80000007], brush: STOCK[0x80000000], font: DEFAULT_FONT, textColor: [0, 0, 0], bkColor: [255, 255, 255],
            bkMode: 2, textAlign: 0, fillRule: 'evenodd', clips: [], cur: [0, 0], miter: 10
        };
        const stack = [];
        let path = null; // Path2D in device space while inside BEGINPATH
        let pathStarted = false;
        let finishedPath = null;

        const pageToDevice = () => {
            const s = dc;
            if (s.mapMode === 7 || s.mapMode === 8) {
                const sx = s.winExt[0] ? s.vpExt[0] / s.winExt[0] : 1;
                let sy = s.winExt[1] ? s.vpExt[1] / s.winExt[1] : 1;
                let sxx = sx;
                if (s.mapMode === 7) { const m = Math.min(Math.abs(sx), Math.abs(sy)); sxx = Math.sign(sx) * m; sy = Math.sign(sy) * m; }
                return [sxx, 0, 0, sy, s.vpOrg[0] - s.winOrg[0] * sxx, s.vpOrg[1] - s.winOrg[1] * sy];
            }
            const unit = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 }[s.mapMode];
            if (unit) {
                const sx = unit * pxmmX, sy = -unit * pxmmY;
                return [sx, 0, 0, sy, s.vpOrg[0] - s.winOrg[0] * sx, s.vpOrg[1] - s.winOrg[1] * sy];
            }
            return [1, 0, 0, 1, s.vpOrg[0] - s.winOrg[0], s.vpOrg[1] - s.winOrg[1]];
        };
        let M = [1, 0, 0, 1, 0, 0];
        const updateM = () => { M = mul(pageToDevice(), dc.world); };
        const tx = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
        const scaleOfM = () => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
        const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        const colorAt = (o) => [dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2)];

        const withClip = (fn) => {
            ctx.save();
            ctx.setTransform(...base);
            for (const c of dc.clips) ctx.clip(c.path, c.rule);
            fn();
            ctx.restore();
        };
        const target = () => {
            if (path) return path;
            return new Path2D();
        };
        const fillAndStroke = (p, doFill, doStroke) => {
            withClip(() => {
                const b = dc.brush;
                if (doFill && b && b.style !== 1) {
                    if (b.pattern) {
                        const pat = ctx.createPattern(b.pattern, 'repeat');
                        ctx.fillStyle = pat || rgb(b.color || [128, 128, 128]);
                    } else ctx.fillStyle = rgb(b.color || [0, 0, 0], b.style === 2 ? 0.6 : 1);
                    ctx.fill(p, dc.fillRule);
                }
                const pen = dc.pen;
                if (doStroke && pen && (pen.style & 0xf) !== 5) {
                    const geometric = (pen.style & 0x10000) !== 0;
                    const w = pen.width > 0 ? pen.width * scaleOfM() : 1;
                    ctx.lineWidth = geometric || pen.width > 1 ? Math.max(w, 0.5) : Math.max(1, w);
                    const endcap = pen.style & 0xf00, join = pen.style & 0xf000;
                    ctx.lineCap = endcap === 0x100 ? 'square' : endcap === 0x200 ? 'butt' : 'round';
                    ctx.lineJoin = join === 0x1000 ? 'bevel' : join === 0x2000 ? 'miter' : 'round';
                    ctx.miterLimit = dc.miter || 10;
                    const lw = ctx.lineWidth;
                    const dash = { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[pen.style & 0xf];
                    if (dash) ctx.setLineDash(dash.map((d) => d * lw * 2));
                    ctx.strokeStyle = rgb(pen.color || [0, 0, 0]);
                    ctx.stroke(p);
                }
            });
        };
        const readPoints = (off, count, small) => {
            const pts = [];
            for (let i = 0; i < count; i++) {
                const o = off + i * (small ? 4 : 8);
                if (o + (small ? 4 : 8) > dv.byteLength) break;
                pts.push(small ? tx(dv.getInt16(o, true), dv.getInt16(o + 2, true)) : tx(i32(o), i32(o + 4)));
            }
            return pts;
        };
        const addPoly = (p, pts, close, move = true) => {
            if (!pts.length) return;
            if (move) p.moveTo(pts[0][0], pts[0][1]); else p.lineTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
            if (close) p.closePath();
        };
        const addBezier = (p, pts, startWithMove) => {
            let i = 0;
            if (startWithMove) { p.moveTo(pts[0][0], pts[0][1]); i = 1; }
            for (; i + 2 < pts.length; i += 3) p.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1]);
        };
        const curDev = () => tx(dc.cur[0], dc.cur[1]);
        const ensurePathStart = (p) => { if (!pathStarted) { const c = curDev(); p.moveTo(c[0], c[1]); pathStarted = true; } };
        const rectPath = (l, t, r, b) => {
            const p = new Path2D();
            addPoly(p, [tx(l, t), tx(r, t), tx(r, b), tx(l, b)], true);
            return p;
        };
        const ellipsePath = (l, t, r, b, p = new Path2D()) => {
            const c = tx((l + r) / 2, (t + b) / 2);
            const k = 0.5522847498;
            const rx = (r - l) / 2, ry = (b - t) / 2;
            const cx = (l + r) / 2, cy = (t + b) / 2;
            const P = (x, y) => tx(x, y);
            const p0 = P(cx + rx, cy);
            p.moveTo(p0[0], p0[1]);
            const segs = [
                [cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry],
                [cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
                [cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry],
                [cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy]
            ];
            for (const s of segs) { const a = P(s[0], s[1]), b2 = P(s[2], s[3]), e = P(s[4], s[5]); p.bezierCurveTo(a[0], a[1], b2[0], b2[1], e[0], e[1]); }
            p.closePath();
            void c;
            return p;
        };
        const arcPoints = (l, t, r, b, xs, ys, xe, ye, steps = 48) => {
            const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
            let a0 = Math.atan2((ys - cy) / (ry || 1), (xs - cx) / (rx || 1));
            let a1 = Math.atan2((ye - cy) / (ry || 1), (xe - cx) / (rx || 1));
            // GDI default arc direction is counter-clockwise (in y-down logical space, decreasing angle).
            while (a1 >= a0) a1 -= Math.PI * 2;
            const pts = [];
            for (let i = 0; i <= steps; i++) {
                const a = a0 + (a1 - a0) * i / steps;
                pts.push(tx(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
            }
            return { pts, center: tx(cx, cy) };
        };
        const clipOp = (p, rule, mode) => {
            if (mode === 5 || mode === undefined) dc.clips = [{ path: p, rule }];
            else if (mode === 1) dc.clips = dc.clips.concat([{ path: p, rule }]);
            else if (mode === 4) {
                const q = new Path2D();
                q.rect(-1e7, -1e7, 2e7, 2e7);
                q.addPath(p);
                dc.clips = dc.clips.concat([{ path: q, rule: 'evenodd' }]);
            } else dc.clips = [{ path: p, rule }];
        };
        const drawBitmap = async (dib, xd, yd, wd, hd, xs, ys, ws, hs, alpha = 1) => {
            const img = await dibToImage(dib);
            if (!img) return;
            const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
            if (!ws) ws = iw;
            if (!hs) hs = ih;
            withClip(() => {
                ctx.transform(...M);
                ctx.globalAlpha = alpha;
                let dx = xd, dy = yd, dw = wd, dh = hd;
                if (dw < 0) { dx += dw; dw = -dw; }
                if (dh < 0) { dy += dh; dh = -dh; }
                try { ctx.drawImage(img, xs, ys, ws, hs, dx, dy, dw, dh); } catch (_) { /* bad source rect */ }
            });
        };

        updateM();
        let p = 0;
        let guard = 0;
        while (p + 8 <= bytes.length && guard++ < 2000000) {
            const type = u32(p), size = u32(p + 4);
            if (size < 8 || p + size > bytes.length) break;
            const r = p;
            try {
                switch (type) {
                    case 14: p = bytes.length; continue; // EOF
                    case 17: dc.mapMode = u32(r + 8); updateM(); break;
                    case 9: dc.winExt = [i32(r + 8), i32(r + 12)]; updateM(); break;
                    case 10: dc.winOrg = [i32(r + 8), i32(r + 12)]; updateM(); break;
                    case 11: dc.vpExt = [i32(r + 8), i32(r + 12)]; updateM(); break;
                    case 12: dc.vpOrg = [i32(r + 8), i32(r + 12)]; updateM(); break;
                    case 31: { // SCALEVIEWPORTEXTEX
                        const xn = i32(r + 8), xd = i32(r + 12) || 1, yn = i32(r + 16), yd = i32(r + 20) || 1;
                        dc.vpExt = [dc.vpExt[0] * xn / xd, dc.vpExt[1] * yn / yd]; updateM(); break;
                    }
                    case 32: {
                        const xn = i32(r + 8), xd = i32(r + 12) || 1, yn = i32(r + 16), yd = i32(r + 20) || 1;
                        dc.winExt = [dc.winExt[0] * xn / xd, dc.winExt[1] * yn / yd]; updateM(); break;
                    }
                    case 35: dc.world = [f32(r + 8), f32(r + 12), f32(r + 16), f32(r + 20), f32(r + 24), f32(r + 28)]; updateM(); break;
                    case 36: {
                        const x = [f32(r + 8), f32(r + 12), f32(r + 16), f32(r + 20), f32(r + 24), f32(r + 28)];
                        const mode = u32(r + 32);
                        if (mode === 1) dc.world = [1, 0, 0, 1, 0, 0];
                        else if (mode === 2) dc.world = mul(dc.world, x);
                        else if (mode === 3) dc.world = mul(x, dc.world);
                        else if (mode === 4) dc.world = x;
                        updateM();
                        break;
                    }
                    case 33: stack.push({ ...dc, clips: dc.clips.slice(), cur: dc.cur.slice() }); break;
                    case 34: {
                        const n = i32(r + 8);
                        let idx = n < 0 ? stack.length + n : n - 1;
                        if (idx >= 0 && idx < stack.length) { dc = stack[idx]; stack.length = idx; updateM(); }
                        break;
                    }
                    case 38: // CREATEPEN
                        objects[u32(r + 8)] = { kind: 'pen', style: u32(r + 12), width: i32(r + 16), color: colorAt(r + 24) };
                        break;
                    case 95: { // EXTCREATEPEN
                        const style = u32(r + 28), width = u32(r + 32), bstyle = u32(r + 36);
                        objects[u32(r + 8)] = { kind: 'pen', style: bstyle === 1 ? 5 : style, width, color: colorAt(r + 40) };
                        break;
                    }
                    case 39: // CREATEBRUSHINDIRECT
                        objects[u32(r + 8)] = { kind: 'brush', style: u32(r + 12), color: colorAt(r + 16) };
                        break;
                    case 93: case 94: { // CREATEMONOBRUSH / CREATEDIBPATTERNBRUSHPT
                        const dib = decodeDib(dv, r + u32(r + 16), u32(r + 20), r + u32(r + 24), u32(r + 28), false);
                        objects[u32(r + 8)] = { kind: 'brush', style: 3, color: [128, 128, 128], pattern: dib && dib.canvas };
                        break;
                    }
                    case 82: { // EXTCREATEFONTINDIRECTW
                        let face = '';
                        for (let k = 0; k < 32; k++) {
                            const c = dv.getUint16(r + 12 + 28 + k * 2, true);
                            if (!c) break;
                            face += String.fromCharCode(c);
                        }
                        objects[u32(r + 8)] = {
                            kind: 'font', height: i32(r + 12), escapement: i32(r + 20), weight: i32(r + 28) || 400,
                            italic: dv.getUint8(r + 32) !== 0, face: face || 'Arial'
                        };
                        break;
                    }
                    case 37: { // SELECTOBJECT
                        const h = u32(r + 8);
                        const obj = h & 0x80000000 ? STOCK[h] || (h >= 0x8000000a && h <= 0x80000011 ? DEFAULT_FONT : null) : objects[h];
                        if (obj) dc[obj.kind] = obj;
                        break;
                    }
                    case 40: objects[u32(r + 8)] = undefined; break;
                    case 19: dc.fillRule = u32(r + 8) === 2 ? 'nonzero' : 'evenodd'; break;
                    case 24: dc.textColor = colorAt(r + 8); break;
                    case 25: dc.bkColor = colorAt(r + 8); break;
                    case 18: dc.bkMode = u32(r + 8); break;
                    case 22: dc.textAlign = u32(r + 8); break;
                    case 58: dc.miter = f32(r + 8) || 10; break;
                    case 27: // MOVETOEX
                        dc.cur = [i32(r + 8), i32(r + 12)];
                        if (path) { const c = curDev(); path.moveTo(c[0], c[1]); pathStarted = true; }
                        break;
                    case 54: { // LINETO
                        const from = curDev();
                        dc.cur = [i32(r + 8), i32(r + 12)];
                        const to = curDev();
                        if (path) { ensurePathStart(path); path.lineTo(to[0], to[1]); } else {
                            const q = new Path2D(); q.moveTo(from[0], from[1]); q.lineTo(to[0], to[1]); fillAndStroke(q, false, true);
                        }
                        break;
                    }
                    case 5: case 6: case 88: case 89: { // POLYBEZIERTO / POLYLINETO (+16)
                        const small = type >= 88;
                        const n = u32(r + 24);
                        const pts = readPoints(r + 28, n, small);
                        const q = path || new Path2D();
                        if (path) ensurePathStart(q); else { const c = curDev(); q.moveTo(c[0], c[1]); }
                        if (type === 5 || type === 88) addBezier(q, pts, false); else addPoly(q, pts, false, false);
                        if (!path) fillAndStroke(q, false, true);
                        if (n) {
                            const lo = r + 28 + (n - 1) * (small ? 4 : 8);
                            dc.cur = small ? [dv.getInt16(lo, true), dv.getInt16(lo + 2, true)] : [i32(lo), i32(lo + 4)];
                        }
                        break;
                    }
                    case 2: case 3: case 4: case 85: case 86: case 87: { // POLYBEZIER / POLYGON / POLYLINE (+16)
                        const small = type >= 85;
                        const n = u32(r + 24);
                        const pts = readPoints(r + 28, n, small);
                        const q = target();
                        const kind = small ? type - 83 : type; // 2 bezier, 3 polygon, 4 polyline
                        if (kind === 2) addBezier(q, pts, true); else addPoly(q, pts, kind === 3);
                        if (path) pathStarted = true;
                        else fillAndStroke(q, kind === 3, true);
                        break;
                    }
                    case 7: case 8: case 90: case 91: { // POLYPOLYLINE / POLYPOLYGON (+16)
                        const small = type >= 90;
                        const nPolys = u32(r + 24);
                        const counts = [];
                        for (let k = 0; k < nPolys; k++) counts.push(u32(r + 32 + k * 4));
                        let off = r + 32 + nPolys * 4;
                        const polygon = type === 8 || type === 91;
                        const q = target();
                        for (const c of counts) {
                            addPoly(q, readPoints(off, c, small), polygon);
                            off += c * (small ? 4 : 8);
                        }
                        if (path) pathStarted = true;
                        else fillAndStroke(q, polygon, true);
                        break;
                    }
                    case 43: { // RECTANGLE
                        const q = rectPath(i32(r + 8), i32(r + 12), i32(r + 16), i32(r + 20));
                        if (path) path.addPath(q); else fillAndStroke(q, true, true);
                        break;
                    }
                    case 44: { // ROUNDRECT
                        const l = i32(r + 8), t = i32(r + 12), rr = i32(r + 16), b = i32(r + 20);
                        const cw = i32(r + 24) / 2, ch = i32(r + 28) / 2;
                        const q = new Path2D();
                        const k = 0.5522847498;
                        const P = (x, y) => tx(x, y);
                        const m0 = P(l + cw, t); q.moveTo(m0[0], m0[1]);
                        const L = (x, y) => { const d = P(x, y); q.lineTo(d[0], d[1]); };
                        const Cb = (x1, y1, x2, y2, x, y) => { const a = P(x1, y1), b2 = P(x2, y2), e = P(x, y); q.bezierCurveTo(a[0], a[1], b2[0], b2[1], e[0], e[1]); };
                        L(rr - cw, t); Cb(rr - cw + cw * k, t, rr, t + ch - ch * k, rr, t + ch);
                        L(rr, b - ch); Cb(rr, b - ch + ch * k, rr - cw + cw * k, b, rr - cw, b);
                        L(l + cw, b); Cb(l + cw - cw * k, b, l, b - ch + ch * k, l, b - ch);
                        L(l, t + ch); Cb(l, t + ch - ch * k, l + cw - cw * k, t, l + cw, t);
                        q.closePath();
                        if (path) path.addPath(q); else fillAndStroke(q, true, true);
                        break;
                    }
                    case 42: { // ELLIPSE
                        const q = ellipsePath(i32(r + 8), i32(r + 12), i32(r + 16), i32(r + 20));
                        if (path) path.addPath(q); else fillAndStroke(q, true, true);
                        break;
                    }
                    case 45: case 46: case 47: case 55: { // ARC, CHORD, PIE, ARCTO
                        const { pts, center } = arcPoints(i32(r + 8), i32(r + 12), i32(r + 16), i32(r + 20), i32(r + 24), i32(r + 28), i32(r + 32), i32(r + 36));
                        const q = path || new Path2D();
                        if (type === 55) { ensurePathStart(q); addPoly(q, pts, false, false); } else if (type === 47) {
                            q.moveTo(center[0], center[1]); addPoly(q, pts, true, false);
                        } else addPoly(q, pts, type === 46);
                        if (!path) fillAndStroke(q, type !== 45 && type !== 55, true);
                        break;
                    }
                    case 59: path = new Path2D(); pathStarted = false; break; // BEGINPATH
                    case 60: finishedPath = path; path = null; break; // ENDPATH
                    case 61: if (path) path.closePath(); break; // CLOSEFIGURE
                    case 68: path = null; finishedPath = null; break; // ABORTPATH
                    case 62: if (finishedPath) fillAndStroke(finishedPath, true, false); finishedPath = null; break;
                    case 63: if (finishedPath) fillAndStroke(finishedPath, true, true); finishedPath = null; break;
                    case 64: if (finishedPath) fillAndStroke(finishedPath, false, true); finishedPath = null; break;
                    case 67: if (finishedPath) clipOp(finishedPath, dc.fillRule, u32(r + 8)); finishedPath = null; break;
                    case 30: // INTERSECTCLIPRECT
                        clipOp(rectPath(i32(r + 8), i32(r + 12), i32(r + 16), i32(r + 20)), 'nonzero', 1);
                        break;
                    case 29: // EXCLUDECLIPRECT
                        clipOp(rectPath(i32(r + 8), i32(r + 12), i32(r + 16), i32(r + 20)), 'nonzero', 4);
                        break;
                    case 75: { // EXTSELECTCLIPRGN
                        const cb = u32(r + 8), mode = u32(r + 12);
                        if (!cb) { if (mode === 5) dc.clips = []; break; }
                        const n = u32(r + 16 + 8);
                        const q = new Path2D();
                        for (let k = 0; k < n; k++) {
                            const o = r + 16 + 32 + k * 16;
                            q.rect(i32(o), i32(o + 4), i32(o + 8) - i32(o), i32(o + 12) - i32(o + 4));
                        }
                        clipOp(q, 'nonzero', mode);
                        break;
                    }
                    case 84: case 83: { // EXTTEXTOUTW / EXTTEXTOUTA
                        const wide = type === 84;
                        const refX = i32(r + 36), refY = i32(r + 40);
                        const n = u32(r + 44), offStr = u32(r + 48), offDx = u32(r + 72);
                        let text = '';
                        for (let k = 0; k < n; k++) text += String.fromCharCode(wide ? dv.getUint16(r + offStr + k * 2, true) : dv.getUint8(r + offStr + k));
                        if (!text.trim()) break;
                        const dxs = [];
                        if (offDx) for (let k = 0; k < n; k++) dxs.push(i32(r + offDx + k * 4));
                        const f = dc.font || DEFAULT_FONT;
                        const align = dc.textAlign;
                        withClip(() => {
                            ctx.transform(...M);
                            const flipY = M[3] < 0 ? -1 : 1;
                            ctx.translate(refX, refY);
                            if (flipY < 0) ctx.scale(1, -1);
                            if (f.escapement) ctx.rotate(-f.escapement / 10 * Math.PI / 180);
                            const em = Math.abs(f.height) * (f.height > 0 ? 0.82 : 1) || 12;
                            ctx.font = `${f.italic ? 'italic ' : ''}${f.weight} ${em}px "${f.face.replace(/"/g, '')}", Arial, sans-serif`;
                            ctx.fillStyle = rgb(dc.textColor);
                            const vAlign = align & 24;
                            ctx.textBaseline = vAlign === 24 ? 'alphabetic' : vAlign === 8 ? 'bottom' : 'top';
                            const hAlign = align & 6;
                            let total = dxs.length ? dxs.reduce((a, b) => a + b, 0) : ctx.measureText(text).width;
                            let x0 = hAlign === 6 ? -total / 2 : hAlign === 2 ? -total : 0;
                            if (dxs.length) {
                                let x = x0;
                                for (let k = 0; k < text.length; k++) { ctx.fillText(text[k], x, 0); x += dxs[k]; }
                            } else ctx.fillText(text, x0, 0);
                        });
                        break;
                    }
                    case 81: { // STRETCHDIBITS
                        const dib = decodeDib(dv, r + u32(r + 48), u32(r + 52), r + u32(r + 56), u32(r + 60), false);
                        await drawBitmap(dib, i32(r + 24), i32(r + 28), i32(r + 72), i32(r + 76), i32(r + 32), i32(r + 36), i32(r + 40), i32(r + 44));
                        break;
                    }
                    case 80: { // SETDIBITSTODEVICE
                        const dib = decodeDib(dv, r + u32(r + 48), u32(r + 52), r + u32(r + 56), u32(r + 60), false);
                        await drawBitmap(dib, i32(r + 24), i32(r + 28), i32(r + 40), i32(r + 44), i32(r + 32), i32(r + 36), i32(r + 40), i32(r + 44));
                        break;
                    }
                    case 76: case 77: { // BITBLT / STRETCHBLT
                        const xd = i32(r + 24), yd = i32(r + 28), wd = i32(r + 32), hd = i32(r + 36);
                        const cbBmi = u32(r + 88);
                        if (!cbBmi) {
                            const rop = u32(r + 40);
                            if (rop === 0x00f00021 || rop === 0x00000042 || rop === 0x00ff0062) {
                                const save = dc.brush;
                                if (rop === 0x00000042) dc.brush = STOCK[0x80000004];
                                if (rop === 0x00ff0062) dc.brush = STOCK[0x80000000];
                                fillAndStroke(rectPath(xd, yd, xd + wd, yd + hd), true, false);
                                dc.brush = save;
                            }
                            break;
                        }
                        const dib = decodeDib(dv, r + u32(r + 84), cbBmi, r + u32(r + 92), u32(r + 96), false);
                        const ws = type === 77 ? i32(r + 100) : wd, hs = type === 77 ? i32(r + 104) : hd;
                        await drawBitmap(dib, xd, yd, wd, hd, i32(r + 44), i32(r + 48), ws, hs);
                        break;
                    }
                    case 114: { // ALPHABLEND
                        const blend = u32(r + 40);
                        const constAlpha = ((blend >>> 16) & 0xff) / 255;
                        const srcAlpha = ((blend >>> 24) & 0xff) === 1;
                        const dib = decodeDib(dv, r + u32(r + 84), u32(r + 88), r + u32(r + 92), u32(r + 96), srcAlpha);
                        await drawBitmap(dib, i32(r + 24), i32(r + 28), i32(r + 32), i32(r + 36), i32(r + 44), i32(r + 48), i32(r + 100), i32(r + 104), constAlpha);
                        break;
                    }
                    default: break;
                }
            } catch (err) {
                // Skip malformed records but keep drawing the rest.
            }
            p += size;
        }
        return canvas;
    }

    global.LuxEmf = { rasterize };
})(window);
