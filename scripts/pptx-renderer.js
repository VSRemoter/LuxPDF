/* LuxPDF native PPTX renderer.
 *
 * Reads the OOXML package directly and paints every slide onto a canvas,
 * following PowerPoint's own rules: master -> layout -> slide inheritance,
 * placeholder matching, theme colours + colour maps, theme/embedded/web fonts,
 * paragraph/run style cascades, preset & custom geometry, fills, lines,
 * shadows, pictures (crop/clip), groups, tables and SmartArt drawings.
 *
 * Exposes window.LuxPptxRenderer.open(arrayBuffer) -> Deck.
 */
(function (global) {
    'use strict';

    const EMU_PER_PT = 12700;
    const emu2pt = (v) => v / EMU_PER_PT;
    const DEG = Math.PI / 180;
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

    /* ------------------------------------------------------------------ */
    /* ZIP                                                                 */
    /* ------------------------------------------------------------------ */

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream === 'function') {
            try {
                const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                return new Uint8Array(await new Response(stream).arrayBuffer());
            } catch (err) {
                if (!(global.pako && global.pako.inflateRaw)) throw err;
            }
        }
        if (global.pako && global.pako.inflateRaw) return global.pako.inflateRaw(bytes);
        throw new Error('This browser cannot decompress PPTX files');
    }

    class ZipArchive {
        constructor(buffer) {
            this.bytes = new Uint8Array(buffer);
            this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
            this.entries = new Map();
            this.lowerNames = new Map();
            this.parse();
        }

        parse() {
            const v = this.view;
            const n = this.bytes.length;
            let eocd = -1;
            for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
                if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) throw new Error('Not a valid PPTX file (zip directory missing)');
            let count = v.getUint16(eocd + 10, true);
            let cdOffset = v.getUint32(eocd + 16, true);
            if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) {
                const z64 = Number(v.getBigUint64(eocd - 12, true));
                count = Number(v.getBigUint64(z64 + 32, true));
                cdOffset = Number(v.getBigUint64(z64 + 48, true));
            }
            const dec = new TextDecoder('utf-8');
            let p = cdOffset;
            for (let k = 0; k < count && p + 46 <= n; k++) {
                if (v.getUint32(p, true) !== 0x02014b50) break;
                const method = v.getUint16(p + 10, true);
                let compSize = v.getUint32(p + 20, true);
                let size = v.getUint32(p + 24, true);
                const nameLen = v.getUint16(p + 28, true);
                const extraLen = v.getUint16(p + 30, true);
                const commentLen = v.getUint16(p + 32, true);
                let localOffset = v.getUint32(p + 42, true);
                const name = dec.decode(this.bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/').replace(/^\/+/, '');
                if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
                    let e = p + 46 + nameLen;
                    const end = e + extraLen;
                    while (e + 4 <= end) {
                        const id = v.getUint16(e, true);
                        const len = v.getUint16(e + 2, true);
                        if (id === 1) {
                            let q = e + 4;
                            if (size === 0xffffffff) { size = Number(v.getBigUint64(q, true)); q += 8; }
                            if (compSize === 0xffffffff) { compSize = Number(v.getBigUint64(q, true)); q += 8; }
                            if (localOffset === 0xffffffff) { localOffset = Number(v.getBigUint64(q, true)); }
                        }
                        e += 4 + len;
                    }
                }
                this.entries.set(name, { method, compSize, size, localOffset });
                this.lowerNames.set(name.toLowerCase(), name);
                p += 46 + nameLen + extraLen + commentLen;
            }
        }

        resolveName(name) {
            if (this.entries.has(name)) return name;
            return this.lowerNames.get(String(name).toLowerCase()) || null;
        }

        has(name) { return !!this.resolveName(name); }

        async read(name) {
            const real = this.resolveName(name);
            if (!real) return null;
            const e = this.entries.get(real);
            const v = this.view;
            const lo = e.localOffset;
            if (v.getUint32(lo, true) !== 0x04034b50) return null;
            const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
            const data = this.bytes.subarray(start, start + e.compSize);
            if (e.method === 0) return data.slice();
            if (e.method === 8) return inflateRaw(data);
            throw new Error('Unsupported zip compression method ' + e.method);
        }

        async text(name) {
            const bytes = await this.read(name);
            return bytes ? new TextDecoder('utf-8').decode(bytes) : null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* XML helpers                                                         */
    /* ------------------------------------------------------------------ */

    function parseXml(text) {
        const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('Malformed XML part');
        return doc;
    }
    function child(el, name) {
        if (!el) return null;
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
        return null;
    }
    function children(el, name) {
        const out = [];
        if (!el) return out;
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c);
        return out;
    }
    function dig(el, ...names) {
        for (const n of names) { el = child(el, n); if (!el) return null; }
        return el;
    }
    function attr(el, name) {
        if (!el) return null;
        const v = el.getAttribute(name);
        return v === '' ? v : v;
    }
    function num(el, name, def) {
        if (!el) return def;
        const v = el.getAttribute(name);
        if (v == null || v === '') return def;
        const n = Number(v);
        return Number.isFinite(n) ? n : def;
    }
    function bool(el, name, def) {
        if (!el) return def;
        const v = el.getAttribute(name);
        if (v == null) return def;
        return v === '1' || v === 'true' || v === 'on';
    }
    function relAttr(el, local) {
        if (!el) return null;
        for (const a of Array.from(el.attributes)) {
            if (a.localName === local && a.namespaceURI && /relationships/i.test(a.namespaceURI)) return a.value;
        }
        return el.getAttribute('r:' + local);
    }
    function lastDefined(list) {
        for (let i = list.length - 1; i >= 0; i--) if (list[i]) return list[i];
        return null;
    }
    function resolvePath(baseDir, target) {
        let t = target;
        try { t = decodeURIComponent(target); } catch (_) { /* keep raw */ }
        if (t.startsWith('/')) return t.slice(1);
        const parts = baseDir ? baseDir.split('/') : [];
        for (const seg of t.split('/')) {
            if (seg === '..') parts.pop();
            else if (seg !== '.' && seg !== '') parts.push(seg);
        }
        return parts.join('/');
    }
    function dirOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }

    /* ------------------------------------------------------------------ */
    /* Colour                                                              */
    /* ------------------------------------------------------------------ */

    const PRESET_COLORS = {
        black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
        cyan: '00FFFF', magenta: 'FF00FF', gray: '808080', grey: '808080', darkGray: 'A9A9A9', dkGray: 'A9A9A9',
        lightGray: 'D3D3D3', ltGray: 'D3D3D3', orange: 'FFA500', purple: '800080', navy: '000080', maroon: '800000',
        olive: '808000', teal: '008080', silver: 'C0C0C0', lime: '00FF00', brown: 'A52A2A', pink: 'FFC0CB',
        gold: 'FFD700', darkBlue: '00008B', dkBlue: '00008B', darkRed: '8B0000', dkRed: '8B0000',
        darkGreen: '006400', dkGreen: '006400', lightBlue: 'ADD8E6', ltBlue: 'ADD8E6', indigo: '4B0082',
        violet: 'EE82EE', tan: 'D2B48C', coral: 'FF7F50', salmon: 'FA8072', khaki: 'F0E68C', beige: 'F5F5DC',
        crimson: 'DC143C', turquoise: '40E0D0', skyBlue: '87CEEB', steelBlue: '4682B4', royalBlue: '4169E1',
        orangeRed: 'FF4500', darkOrange: 'FF8C00', dkOrange: 'FF8C00', lightGreen: '90EE90', ltGreen: '90EE90',
        darkCyan: '008B8B', dkCyan: '008B8B', darkMagenta: '8B008B', dkMagenta: '8B008B', lavender: 'E6E6FA'
    };
    const SYS_COLORS = {
        windowText: '000000', window: 'FFFFFF', btnFace: 'F0F0F0', btnText: '000000', highlight: '0078D7',
        highlightText: 'FFFFFF', grayText: '6D6D6D', menu: 'F0F0F0', menuText: '000000', captionText: '000000',
        '3dDkShadow': '696969', '3dLight': 'E3E3E3', btnShadow: 'A0A0A0', btnHighlight: 'FFFFFF'
    };

    function hexColor(hex) {
        const h = String(hex || '000000').replace(/[^0-9a-f]/gi, '').padEnd(6, '0');
        return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 };
    }
    function rgbToHsl(c) {
        const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0);
            else if (max === c.g) h = (c.b - c.r) / d + 2;
            else h = (c.r - c.g) / d + 4;
            h /= 6;
        }
        return { h, s, l };
    }
    function hslToRgb(h, s, l, a) {
        const hue = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        if (s === 0) return { r: l, g: l, b: l, a };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return { r: hue(p, q, h + 1 / 3), g: hue(p, q, h), b: hue(p, q, h - 1 / 3), a };
    }
    const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

    function applyColorMods(color, el) {
        let c = { ...color };
        const withHsl = (fn) => {
            const hsl = rgbToHsl(c);
            fn(hsl);
            c = hslToRgb(((hsl.h % 1) + 1) % 1, clamp01(hsl.s), clamp01(hsl.l), c.a);
        };
        for (let m = el.firstElementChild; m; m = m.nextElementSibling) {
            const v = num(m, 'val', 0) / 100000;
            switch (m.localName) {
                case 'alpha': c.a = v; break;
                case 'alphaMod': c.a *= v; break;
                case 'alphaOff': c.a += v; break;
                case 'lumMod': withHsl((h) => { h.l *= v; }); break;
                case 'lumOff': withHsl((h) => { h.l += v; }); break;
                case 'lum': withHsl((h) => { h.l = v; }); break;
                case 'satMod': withHsl((h) => { h.s *= v; }); break;
                case 'satOff': withHsl((h) => { h.s += v; }); break;
                case 'sat': withHsl((h) => { h.s = v; }); break;
                case 'hue': withHsl((h) => { h.h = num(m, 'val', 0) / 60000 / 360; }); break;
                case 'hueOff': withHsl((h) => { h.h += num(m, 'val', 0) / 60000 / 360; }); break;
                case 'hueMod': withHsl((h) => { h.h *= v; }); break;
                case 'comp': withHsl((h) => { h.h += 0.5; }); break;
                case 'tint':
                    c = { r: toSrgb(toLin(c.r) * v + (1 - v)), g: toSrgb(toLin(c.g) * v + (1 - v)), b: toSrgb(toLin(c.b) * v + (1 - v)), a: c.a };
                    break;
                case 'shade':
                    c = { r: toSrgb(toLin(c.r) * v), g: toSrgb(toLin(c.g) * v), b: toSrgb(toLin(c.b) * v), a: c.a };
                    break;
                case 'inv': c = { r: 1 - c.r, g: 1 - c.g, b: 1 - c.b, a: c.a }; break;
                case 'gray': { const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; c = { r: y, g: y, b: y, a: c.a }; break; }
                case 'red': c.r = v; break;
                case 'redMod': c.r *= v; break;
                case 'redOff': c.r += v; break;
                case 'green': c.g = v; break;
                case 'greenMod': c.g *= v; break;
                case 'greenOff': c.g += v; break;
                case 'blue': c.b = v; break;
                case 'blueMod': c.b *= v; break;
                case 'blueOff': c.b += v; break;
                default: break;
            }
        }
        return { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: clamp01(c.a) };
    }

    const COLOR_ELEMENTS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'hslClr', 'scrgbClr']);

    function resolveColorEl(el, cctx) {
        if (!el) return null;
        let base = null;
        switch (el.localName) {
            case 'srgbClr': base = hexColor(attr(el, 'val')); break;
            case 'sysClr': base = hexColor(attr(el, 'lastClr') || SYS_COLORS[attr(el, 'val')] || '000000'); break;
            case 'prstClr': base = hexColor(PRESET_COLORS[attr(el, 'val')] || '000000'); break;
            case 'scrgbClr':
                base = { r: toSrgb(num(el, 'r', 0) / 100000), g: toSrgb(num(el, 'g', 0) / 100000), b: toSrgb(num(el, 'b', 0) / 100000), a: 1 };
                break;
            case 'hslClr':
                base = hslToRgb(num(el, 'hue', 0) / 60000 / 360, num(el, 'sat', 0) / 100000, num(el, 'lum', 0) / 100000, 1);
                break;
            case 'schemeClr': {
                const val = attr(el, 'val');
                if (val === 'phClr') base = cctx.phClr ? { ...cctx.phClr } : null;
                else {
                    const mapped = (cctx.clrMap && cctx.clrMap[val]) || DEFAULT_CLRMAP[val] || val;
                    const hex = cctx.theme.colors[mapped];
                    base = hex ? hexColor(hex) : null;
                }
                break;
            }
            default: return null;
        }
        if (!base) return null;
        return applyColorMods(base, el);
    }
    const DEFAULT_CLRMAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

    function firstColor(parent, cctx) {
        if (!parent) return null;
        for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
            if (COLOR_ELEMENTS.has(c.localName)) return resolveColorEl(c, cctx);
        }
        return null;
    }
    function colorElOf(parent) {
        if (!parent) return null;
        for (let c = parent.firstElementChild; c; c = c.nextElementSibling) if (COLOR_ELEMENTS.has(c.localName)) return c;
        return null;
    }
    function css(c, alphaMul = 1) {
        if (!c) return 'rgba(0,0,0,0)';
        return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${+(c.a * alphaMul).toFixed(4)})`;
    }
    function mix(c, target, t) {
        return { r: c.r + (target.r - c.r) * t, g: c.g + (target.g - c.g) * t, b: c.b + (target.b - c.b) * t, a: c.a };
    }

    /* ------------------------------------------------------------------ */
    /* Fills, lines, effects                                               */
    /* ------------------------------------------------------------------ */

    const FILL_ELEMENTS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
    function fillElOf(parent) {
        if (!parent) return null;
        for (let c = parent.firstElementChild; c; c = c.nextElementSibling) if (FILL_ELEMENTS.has(c.localName)) return c;
        return null;
    }

    function parsePaint(fillEl, cctx, part) {
        if (!fillEl) return null;
        switch (fillEl.localName) {
            case 'noFill': return { type: 'none' };
            case 'solidFill': {
                const c = firstColor(fillEl, cctx);
                return c ? { type: 'solid', color: c } : { type: 'none' };
            }
            case 'gradFill': {
                const stops = children(child(fillEl, 'gsLst'), 'gs')
                    .map((gs) => ({ pos: num(gs, 'pos', 0) / 100000, color: firstColor(gs, cctx) }))
                    .filter((s) => s.color)
                    .sort((a, b) => a.pos - b.pos);
                if (!stops.length) return { type: 'none' };
                const lin = child(fillEl, 'lin');
                const path = child(fillEl, 'path');
                const ftr = child(path, 'fillToRect');
                return {
                    type: 'grad',
                    stops,
                    angle: lin ? num(lin, 'ang', 0) / 60000 : 90,
                    scaled: lin ? bool(lin, 'scaled', false) : false,
                    path: path ? (attr(path, 'path') || 'circle') : null,
                    fillToRect: ftr ? {
                        l: num(ftr, 'l', 0) / 100000, t: num(ftr, 't', 0) / 100000,
                        r: num(ftr, 'r', 0) / 100000, b: num(ftr, 'b', 0) / 100000
                    } : null
                };
            }
            case 'blipFill': return { type: 'blip', el: fillEl, part, cctx };
            case 'pattFill': {
                const fg = firstColor(child(fillEl, 'fgClr'), cctx) || hexColor('000000');
                const bg = firstColor(child(fillEl, 'bgClr'), cctx) || hexColor('FFFFFF');
                return { type: 'patt', prst: attr(fillEl, 'prst') || 'pct50', fg, bg };
            }
            case 'grpFill': return { type: 'grp' };
            default: return null;
        }
    }

    const DASHES = {
        solid: null, dot: [1, 3], dash: [4, 3], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3],
        lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDash: [3, 1], sysDot: [1, 1], sysDashDot: [3, 1, 1, 1],
        sysDashDotDot: [3, 1, 1, 1, 1, 1]
    };

    // pairs: [[lnEl, cctx], ...] from lowest to highest priority
    function parseLine(pairs, part) {
        let found = false;
        const L = { w: 0.75, paint: null, dash: null, cap: 'butt', join: 'round', head: null, tail: null };
        for (const [ln, cctx] of pairs) {
            if (!ln) continue;
            found = true;
            if (ln.hasAttribute('w')) L.w = emu2pt(num(ln, 'w', 9525));
            const cap = attr(ln, 'cap');
            if (cap) L.cap = cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt';
            const f = fillElOf(ln);
            if (f) L.paint = parsePaint(f, cctx, part);
            const dash = child(ln, 'prstDash');
            if (dash) L.dash = DASHES[attr(dash, 'val')] || null;
            if (child(ln, 'custDash')) {
                const ds = children(child(ln, 'custDash'), 'ds');
                const arr = [];
                ds.forEach((d) => { arr.push(num(d, 'd', 100000) / 100000, num(d, 'sp', 100000) / 100000); });
                if (arr.length) L.dash = arr;
            }
            if (child(ln, 'round')) L.join = 'round';
            else if (child(ln, 'bevel')) L.join = 'bevel';
            else if (child(ln, 'miter')) L.join = 'miter';
            for (const endName of ['headEnd', 'tailEnd']) {
                const e = child(ln, endName);
                if (!e) continue;
                const type = attr(e, 'type') || 'none';
                L[endName === 'headEnd' ? 'head' : 'tail'] = type === 'none' ? null : { type, w: attr(e, 'w') || 'med', len: attr(e, 'len') || 'med' };
            }
        }
        if (!found) return null;
        return L;
    }

    function parseShadow(effectLst, cctx) {
        const sh = child(effectLst, 'outerShdw');
        if (!sh) return null;
        const color = firstColor(sh, cctx) || { r: 0, g: 0, b: 0, a: 0.4 };
        return {
            blur: emu2pt(num(sh, 'blurRad', 0)),
            dist: emu2pt(num(sh, 'dist', 0)),
            dir: num(sh, 'dir', 0) / 60000,
            color
        };
    }

    /* ------------------------------------------------------------------ */
    /* Geometry                                                            */
    /* ------------------------------------------------------------------ */

    class PathBuilder {
        constructor() { this.paths = []; this.cur = null; }
        begin(opts = {}) {
            this.cur = { cmds: [], fill: opts.fill || 'norm', stroke: opts.stroke !== false, x: 0, y: 0, sx: 0, sy: 0 };
            this.paths.push(this.cur);
            return this;
        }
        ensure() { if (!this.cur) this.begin(); return this.cur; }
        M(x, y) { const c = this.ensure(); c.cmds.push(['M', x, y]); c.x = c.sx = x; c.y = c.sy = y; return this; }
        L(x, y) { const c = this.ensure(); c.cmds.push(['L', x, y]); c.x = x; c.y = y; return this; }
        C(x1, y1, x2, y2, x, y) { const c = this.ensure(); c.cmds.push(['C', x1, y1, x2, y2, x, y]); c.x = x; c.y = y; return this; }
        Q(x1, y1, x, y) { const c = this.ensure(); c.cmds.push(['Q', x1, y1, x, y]); c.x = x; c.y = y; return this; }
        // DrawingML arcTo: radii + start angle + sweep (degrees), from the current point.
        A(wR, hR, stAng, swAng) {
            const c = this.ensure();
            if (wR <= 0 || hR <= 0) return this;
            const param = (a) => Math.atan2(wR * Math.sin(a * DEG), hR * Math.cos(a * DEG));
            const t0 = param(stAng);
            let t1;
            if (Math.abs(swAng) >= 360) t1 = t0 + Math.sign(swAng) * 2 * Math.PI;
            else {
                let d = param(stAng + swAng) - t0;
                if (swAng > 0) while (d < 0) d += 2 * Math.PI;
                if (swAng < 0) while (d > 0) d -= 2 * Math.PI;
                if (swAng === 0) d = 0;
                t1 = t0 + d;
            }
            const cx = c.x - wR * Math.cos(t0);
            const cy = c.y - hR * Math.sin(t0);
            const ex = cx + wR * Math.cos(t1);
            const ey = cy + hR * Math.sin(t1);
            c.cmds.push(['E', cx, cy, wR, hR, t0, t1, swAng < 0, ex, ey]);
            c.x = ex; c.y = ey;
            return this;
        }
        ellipse(x, y, w, h) {
            this.M(x + w, y + h / 2);
            this.A(w / 2, h / 2, 0, 360);
            return this.Z();
        }
        rect(x, y, w, h) { return this.M(x, y).L(x + w, y).L(x + w, y + h).L(x, y + h).Z(); }
        poly(points) {
            points.forEach(([x, y], i) => (i ? this.L(x, y) : this.M(x, y)));
            return this.Z();
        }
        Z() { const c = this.ensure(); c.cmds.push(['Z']); c.x = c.sx; c.y = c.sy; return this; }
    }

    function cmdsToPath2D(cmds, trimStart = 0, trimEnd = 0) {
        const p = new Path2D();
        const list = cmds.map((c) => c.slice());
        if (trimStart && list.length > 1 && list[0][0] === 'M' && list[1][0] === 'L') {
            const [, x0, y0] = list[0]; const [, x1, y1] = list[1];
            const d = Math.hypot(x1 - x0, y1 - y0);
            if (d > trimStart) { list[0][1] = x0 + (x1 - x0) * trimStart / d; list[0][2] = y0 + (y1 - y0) * trimStart / d; }
        }
        if (trimEnd && list.length > 1) {
            const last = list[list.length - 1];
            const prev = list[list.length - 2];
            if (last[0] === 'L') {
                const px = prev[0] === 'E' ? prev[8] : prev[prev.length - 2];
                const py = prev[0] === 'E' ? prev[9] : prev[prev.length - 1];
                const d = Math.hypot(last[1] - px, last[2] - py);
                if (d > trimEnd) { last[1] -= (last[1] - px) * trimEnd / d; last[2] -= (last[2] - py) * trimEnd / d; }
            }
        }
        for (const c of list) {
            switch (c[0]) {
                case 'M': p.moveTo(c[1], c[2]); break;
                case 'L': p.lineTo(c[1], c[2]); break;
                case 'C': p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
                case 'Q': p.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
                case 'E': p.ellipse(c[1], c[2], c[3], c[4], 0, c[5], c[6], c[7]); break;
                case 'Z': p.closePath(); break;
                default: break;
            }
        }
        return p;
    }

    // Endpoints + incoming directions for arrowheads.
    function pathEnds(cmds) {
        const pts = [];
        for (const c of cmds) {
            if (c[0] === 'M' || c[0] === 'L') pts.push([c[1], c[2]]);
            else if (c[0] === 'C') { pts.push([c[3], c[4]]); pts.push([c[5], c[6]]); }
            else if (c[0] === 'Q') { pts.push([c[1], c[2]]); pts.push([c[3], c[4]]); }
            else if (c[0] === 'E') {
                const t = c[6] - (c[7] ? -0.01 : 0.01);
                pts.push([c[1] + c[3] * Math.cos(t), c[2] + c[4] * Math.sin(t)]);
                pts.push([c[8], c[9]]);
            }
        }
        if (pts.length < 2) return null;
        return { start: pts[0], afterStart: pts[1], end: pts[pts.length - 1], beforeEnd: pts[pts.length - 2] };
    }

    // ---- guide formula engine (custGeom + a few presets) ----
    function guideContext(w, h) {
        const ss = Math.min(w, h), ls = Math.max(w, h);
        return {
            w, h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, ss, ls,
            wd2: w / 2, hd2: h / 2, wd3: w / 3, hd3: h / 3, wd4: w / 4, hd4: h / 4, wd5: w / 5, hd5: h / 5,
            wd6: w / 6, hd6: h / 6, wd8: w / 8, hd8: h / 8, wd10: w / 10, hd10: h / 10, wd12: w / 12, hd12: h / 12,
            wd32: w / 32, hd32: h / 32, ssd2: ss / 2, ssd4: ss / 4, ssd6: ss / 6, ssd8: ss / 8, ssd16: ss / 16, ssd32: ss / 32,
            cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000
        };
    }
    function evalGuides(gdEls, g) {
        const val = (tok) => (tok in g ? g[tok] : Number(tok) || 0);
        const ang = (v) => v / 60000 * DEG;
        for (const gd of gdEls) {
            const name = attr(gd, 'name');
            const parts = String(attr(gd, 'fmla') || '').trim().split(/\s+/);
            const [op] = parts;
            const x = val(parts[1]), y = val(parts[2]), z = val(parts[3]);
            let r = 0;
            switch (op) {
                case '*/': r = z ? x * y / z : 0; break;
                case '+-': r = x + y - z; break;
                case '+/': r = z ? (x + y) / z : 0; break;
                case '?:': r = x > 0 ? y : z; break;
                case 'abs': r = Math.abs(x); break;
                case 'at2': r = Math.atan2(y, x) / DEG * 60000; break;
                case 'cat2': r = x * Math.cos(Math.atan2(z, y)); break;
                case 'cos': r = x * Math.cos(ang(y)); break;
                case 'max': r = Math.max(x, y); break;
                case 'min': r = Math.min(x, y); break;
                case 'mod': r = Math.sqrt(x * x + y * y + z * z); break;
                case 'pin': r = y < x ? x : y > z ? z : y; break;
                case 'sat2': r = x * Math.sin(Math.atan2(z, y)); break;
                case 'sin': r = x * Math.sin(ang(y)); break;
                case 'sqrt': r = Math.sqrt(Math.max(0, x)); break;
                case 'tan': r = x * Math.tan(ang(y)); break;
                case 'val': r = x; break;
                default: r = 0;
            }
            g[name] = r;
        }
        return g;
    }

    function buildCustGeom(geom, w, h) {
        // Guides are evaluated in EMU (as authored), paths are scaled to pt.
        const W = w * EMU_PER_PT, H = h * EMU_PER_PT;
        const g = guideContext(W, H);
        evalGuides(children(child(geom, 'avLst'), 'gd'), g);
        evalGuides(children(child(geom, 'gdLst'), 'gd'), g);
        const v = (tok) => (tok in g ? g[tok] : Number(tok) || 0);
        const pb = new PathBuilder();
        for (const path of children(child(geom, 'pathLst'), 'path')) {
            const pw = num(path, 'w', 0), ph = num(path, 'h', 0);
            const sx = pw ? w / pw : 1 / EMU_PER_PT;
            const sy = ph ? h / ph : 1 / EMU_PER_PT;
            const fillAttr = attr(path, 'fill');
            pb.begin({ fill: fillAttr === 'none' ? 'none' : (fillAttr || 'norm'), stroke: attr(path, 'stroke') !== '0' && attr(path, 'stroke') !== 'false' });
            const pt = (el) => { const p = child(el, 'pt'); return [v(attr(p, 'x')) * sx, v(attr(p, 'y')) * sy]; };
            for (const cmd of children(path)) {
                switch (cmd.localName) {
                    case 'moveTo': pb.M(...pt(cmd)); break;
                    case 'lnTo': pb.L(...pt(cmd)); break;
                    case 'cubicBezTo': {
                        const ps = children(cmd, 'pt').map((p) => [v(attr(p, 'x')) * sx, v(attr(p, 'y')) * sy]);
                        if (ps.length === 3) pb.C(ps[0][0], ps[0][1], ps[1][0], ps[1][1], ps[2][0], ps[2][1]);
                        break;
                    }
                    case 'quadBezTo': {
                        const ps = children(cmd, 'pt').map((p) => [v(attr(p, 'x')) * sx, v(attr(p, 'y')) * sy]);
                        if (ps.length === 2) pb.Q(ps[0][0], ps[0][1], ps[1][0], ps[1][1]);
                        break;
                    }
                    case 'arcTo':
                        pb.A(v(attr(cmd, 'wR')) * sx, v(attr(cmd, 'hR')) * sy, v(attr(cmd, 'stAng')) / 60000, v(attr(cmd, 'swAng')) / 60000);
                        break;
                    case 'close': pb.Z(); break;
                    default: break;
                }
            }
        }
        return pb.paths;
    }

    function regularPolygon(pb, n, w, h, rot0, hf = 1, vf = 1) {
        const rx = w / 2 * hf, ry = h / 2 * vf, cx = w / 2, cy = h / 2 * vf;
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = (rot0 + i * 360 / n) * DEG;
            pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
        }
        pb.poly(pts);
    }
    function star(pb, n, w, h, adj, hf = 1, vf = 1) {
        const rx = w / 2 * hf, ry = h / 2 * vf, cx = w / 2, cy = h / 2 * vf;
        const ir = adj / 50000;
        const pts = [];
        for (let i = 0; i < n * 2; i++) {
            const a = (-90 + i * 180 / n) * DEG;
            const k = i % 2 ? ir : 1;
            pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
        }
        pb.poly(pts);
    }
    function roundRectPath(pb, w, h, rtl, rtr, rbr, rbl, snip = {}) {
        pb.M(snip.tl ? snip.tl : rtl, 0);
        if (snip.tr) { pb.L(w - snip.tr, 0).L(w, snip.tr); } else { pb.L(w - rtr, 0); if (rtr) pb.A(rtr, rtr, 270, 90); }
        if (snip.br) { pb.L(w, h - snip.br).L(w - snip.br, h); } else { pb.L(w, h - rbr); if (rbr) pb.A(rbr, rbr, 0, 90); }
        if (snip.bl) { pb.L(snip.bl, h).L(0, h - snip.bl); } else { pb.L(rbl, h); if (rbl) pb.A(rbl, rbl, 90, 90); }
        if (snip.tl) { pb.L(0, snip.tl); } else { pb.L(0, rtl); if (rtl) pb.A(rtl, rtl, 180, 90); }
        pb.Z();
    }
    function calloutRect(pb, w, h, tipX, tipY, r) {
        // Rectangle (optionally rounded) with a wedge pointing at (tipX, tipY).
        const dx = tipX - w / 2, dy = tipY - h / 2;
        const inside = tipX >= 0 && tipX <= w && tipY >= 0 && tipY <= h;
        const vertical = Math.abs(dy) * w > Math.abs(dx) * h;
        const xa = dx < 0 ? w * 2 / 12 : w * 7 / 12, xb = dx < 0 ? w * 5 / 12 : w * 10 / 12;
        const ya = dy < 0 ? h * 2 / 12 : h * 7 / 12, yb = dy < 0 ? h * 5 / 12 : h * 10 / 12;
        pb.M(r, 0);
        if (!inside && vertical && dy < 0) pb.L(xa, 0).L(tipX, tipY).L(xb, 0);
        pb.L(w - r, 0); if (r) pb.A(r, r, 270, 90);
        if (!inside && !vertical && dx > 0) pb.L(w, ya).L(tipX, tipY).L(w, yb);
        pb.L(w, h - r); if (r) pb.A(r, r, 0, 90);
        if (!inside && vertical && dy > 0) pb.L(xb, h).L(tipX, tipY).L(xa, h);
        pb.L(r, h); if (r) pb.A(r, r, 90, 90);
        if (!inside && !vertical && dx < 0) pb.L(0, yb).L(tipX, tipY).L(0, ya);
        pb.L(0, r); if (r) pb.A(r, r, 180, 90);
        pb.Z();
    }

    const PRESET_DEFAULTS = {
        roundRect: { adj: 16667 }, snip1Rect: { adj: 16667 }, snip2SameRect: { adj1: 16667, adj2: 0 },
        snip2DiagRect: { adj1: 0, adj2: 16667 }, snipRoundRect: { adj1: 16667, adj2: 16667 }, round1Rect: { adj: 16667 },
        round2SameRect: { adj1: 16667, adj2: 0 }, round2DiagRect: { adj1: 16667, adj2: 0 },
        triangle: { adj: 50000 }, parallelogram: { adj: 25000 }, trapezoid: { adj: 25000 }, hexagon: { adj: 25000, vf: 115470 },
        octagon: { adj: 29289 }, star4: { adj: 12500 }, star5: { adj: 19098, hf: 105146, vf: 110557 },
        star6: { adj: 28868, hf: 115470 }, star7: { adj: 34601, hf: 102572, vf: 105210 }, star8: { adj: 37500 },
        star10: { adj: 42533, hf: 105146 }, star12: { adj: 37500 }, star16: { adj: 37500 }, star24: { adj: 37500 },
        star32: { adj: 37500 }, rightArrow: { adj1: 50000, adj2: 50000 }, leftArrow: { adj1: 50000, adj2: 50000 },
        upArrow: { adj1: 50000, adj2: 50000 }, downArrow: { adj1: 50000, adj2: 50000 },
        leftRightArrow: { adj1: 50000, adj2: 50000 }, upDownArrow: { adj1: 50000, adj2: 50000 },
        notchedRightArrow: { adj1: 50000, adj2: 50000 }, stripedRightArrow: { adj1: 50000, adj2: 50000 },
        chevron: { adj: 50000 }, homePlate: { adj: 50000 }, plus: { adj: 25000 }, donut: { adj: 25000 }, frame: { adj1: 12500 },
        can: { adj: 25000 }, cube: { adj: 25000 }, pie: { adj1: 0, adj2: 16200000 }, arc: { adj1: 16200000, adj2: 0 },
        chord: { adj1: 2700000, adj2: 16200000 }, blockArc: { adj1: 10800000, adj2: 0, adj3: 25000 },
        teardrop: { adj: 100000 }, wedgeRectCallout: { adj1: -20833, adj2: 62500 },
        wedgeRoundRectCallout: { adj1: -20833, adj2: 62500, adj3: 16667 }, wedgeEllipseCallout: { adj1: -20833, adj2: 62500 },
        leftBracket: { adj: 8333 }, rightBracket: { adj: 8333 }, leftBrace: { adj1: 8333, adj2: 50000 },
        rightBrace: { adj1: 8333, adj2: 50000 }, bracketPair: { adj: 16667 }, bracePair: { adj: 8333 },
        bentConnector3: { adj1: 50000 }, bentConnector4: { adj1: 50000, adj2: 50000 },
        bentConnector5: { adj1: 50000, adj2: 50000, adj3: 50000 }, curvedConnector3: { adj1: 50000 },
        curvedConnector4: { adj1: 50000, adj2: 50000 }, curvedConnector5: { adj1: 50000, adj2: 50000, adj3: 50000 },
        corner: { adj1: 50000, adj2: 50000 }, diagStripe: { adj: 50000 }, plaque: { adj: 16667 }, foldedCorner: { adj: 16667 },
        bevel: { adj: 12500 }, wave: { adj1: 12500, adj2: 0 }, doubleWave: { adj1: 6250, adj2: 0 },
        mathPlus: { adj1: 23520 }, mathMinus: { adj1: 23520 }, mathEqual: { adj1: 23520, adj2: 11760 },
        mathMultiply: { adj1: 23520 }, halfFrame: { adj1: 33333, adj2: 33333 }, borderCallout1: { adj1: 18750, adj2: -8333, adj3: 112500, adj4: -38333 },
        flowChartOfflineStorage: {}, moon: { adj: 50000 }, smileyFace: { adj: 4653 }, noSmoking: { adj: 18750 },
        rightArrowCallout: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 }, leftArrowCallout: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
        downArrowCallout: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 }, upArrowCallout: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
        heptagon: { hf: 102572, vf: 105210 }, pentagon: { hf: 105146, vf: 110557 }, decagon: { vf: 105146 }, dodecagon: {}
    };

    function buildPresetGeom(prst, w, h, adjIn) {
        const a = Object.assign({}, PRESET_DEFAULTS[prst] || {}, adjIn || {});
        const ss = Math.min(w, h);
        const pb = new PathBuilder();
        const pin = (lo, v, hi) => Math.max(lo, Math.min(hi, v));
        switch (prst) {
            case 'rect': case 'flowChartProcess': case 'textBox': pb.rect(0, 0, w, h); break;
            case 'roundRect': { const r = ss * pin(0, a.adj, 50000) / 100000; roundRectPath(pb, w, h, r, r, r, r); break; }
            case 'flowChartAlternateProcess': { const r = ss / 6; roundRectPath(pb, w, h, r, r, r, r); break; }
            case 'round1Rect': { const r = ss * pin(0, a.adj, 50000) / 100000; roundRectPath(pb, w, h, 0, r, 0, 0); break; }
            case 'round2SameRect': {
                const r1 = ss * pin(0, a.adj1, 50000) / 100000, r2 = ss * pin(0, a.adj2, 50000) / 100000;
                roundRectPath(pb, w, h, r1, r1, r2, r2); break;
            }
            case 'round2DiagRect': {
                const r1 = ss * pin(0, a.adj1, 50000) / 100000, r2 = ss * pin(0, a.adj2, 50000) / 100000;
                roundRectPath(pb, w, h, r1, r2, r1, r2); break;
            }
            case 'snip1Rect': { const s = ss * pin(0, a.adj, 50000) / 100000; roundRectPath(pb, w, h, 0, 0, 0, 0, { tr: s }); break; }
            case 'snip2SameRect': {
                const s1 = ss * pin(0, a.adj1, 50000) / 100000, s2 = ss * pin(0, a.adj2, 50000) / 100000;
                roundRectPath(pb, w, h, 0, 0, 0, 0, { tl: s1, tr: s1, br: s2, bl: s2 }); break;
            }
            case 'snip2DiagRect': {
                const s1 = ss * pin(0, a.adj1, 50000) / 100000, s2 = ss * pin(0, a.adj2, 50000) / 100000;
                roundRectPath(pb, w, h, 0, 0, 0, 0, { tl: s1, br: s1, tr: s2, bl: s2 }); break;
            }
            case 'snipRoundRect': {
                const r = ss * pin(0, a.adj1, 50000) / 100000, s = ss * pin(0, a.adj2, 50000) / 100000;
                roundRectPath(pb, w, h, r, 0, 0, 0, { tr: s }); break;
            }
            case 'ellipse': case 'flowChartConnector': pb.ellipse(0, 0, w, h); break;
            case 'triangle': case 'flowChartExtract': {
                const x = w * (prst === 'triangle' ? pin(0, a.adj, 100000) / 100000 : 0.5);
                pb.poly([[x, 0], [w, h], [0, h]]); break;
            }
            case 'flowChartMerge': pb.poly([[0, 0], [w, 0], [w / 2, h]]); break;
            case 'rtTriangle': pb.poly([[0, h], [0, 0], [w, h]]); break;
            case 'diamond': case 'flowChartDecision': pb.poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
            case 'parallelogram': {
                const x = ss * pin(0, a.adj, 100000 * w / ss) / 100000;
                pb.poly([[0, h], [x, 0], [w, 0], [w - x, h]]); break;
            }
            case 'flowChartInputOutput': pb.poly([[0, h], [w / 5, 0], [w, 0], [w * 4 / 5, h]]); break;
            case 'trapezoid': {
                const x = ss * pin(0, a.adj, 50000 * w / ss) / 100000;
                pb.poly([[0, h], [x, 0], [w - x, 0], [w, h]]); break;
            }
            case 'flowChartManualOperation': pb.poly([[0, 0], [w, 0], [w * 4 / 5, h], [w / 5, h]]); break;
            case 'pentagon': regularPolygon(pb, 5, w, h, -90, a.hf / 100000, a.vf / 100000); break;
            case 'hexagon': {
                const x = ss * pin(0, a.adj, 50000 * w / ss) / 100000;
                const dy = h / 2 * (a.vf / 100000) * Math.sin(60 * DEG);
                pb.poly([[0, h / 2], [x, h / 2 - dy], [w - x, h / 2 - dy], [w, h / 2], [w - x, h / 2 + dy], [x, h / 2 + dy]]); break;
            }
            case 'flowChartPreparation': pb.poly([[0, h / 2], [w / 5, 0], [w * 4 / 5, 0], [w, h / 2], [w * 4 / 5, h], [w / 5, h]]); break;
            case 'heptagon': regularPolygon(pb, 7, w, h, -90, a.hf / 100000, a.vf / 100000); break;
            case 'octagon': {
                const x = ss * pin(0, a.adj, 50000) / 100000;
                pb.poly([[0, x], [x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x]]); break;
            }
            case 'decagon': regularPolygon(pb, 10, w, h, 0, 1, 1); break;
            case 'dodecagon': regularPolygon(pb, 12, w, h, 0, 1, 1); break;
            case 'star4': star(pb, 4, w, h, a.adj); break;
            case 'star5': star(pb, 5, w, h, a.adj, a.hf / 100000, a.vf / 100000); break;
            case 'star6': star(pb, 6, w, h, a.adj, a.hf / 100000, 1); break;
            case 'star7': star(pb, 7, w, h, a.adj, a.hf / 100000, a.vf / 100000); break;
            case 'star8': star(pb, 8, w, h, a.adj); break;
            case 'star10': star(pb, 10, w, h, a.adj, a.hf / 100000, 1); break;
            case 'star12': star(pb, 12, w, h, a.adj); break;
            case 'star16': star(pb, 16, w, h, a.adj); break;
            case 'star24': star(pb, 24, w, h, a.adj); break;
            case 'star32': star(pb, 32, w, h, a.adj); break;
            case 'rightArrow': case 'leftArrow': case 'notchedRightArrow': case 'stripedRightArrow': {
                const a1 = pin(0, a.adj1, 100000), a2 = pin(0, a.adj2, 100000 * w / ss);
                const dx = ss * a2 / 100000, dy = h * a1 / 200000;
                let pts = [[0, h / 2 - dy], [w - dx, h / 2 - dy], [w - dx, 0], [w, h / 2], [w - dx, h], [w - dx, h / 2 + dy], [0, h / 2 + dy]];
                if (prst === 'notchedRightArrow') pts.push([dy * (w - dx) ? Math.min(dx, w - dx) * (dy / (h / 2)) : 0, h / 2]);
                if (prst === 'leftArrow') pts = pts.map(([x, y]) => [w - x, y]);
                pb.poly(pts); break;
            }
            case 'upArrow': case 'downArrow': {
                const a1 = pin(0, a.adj1, 100000), a2 = pin(0, a.adj2, 100000 * h / ss);
                const dy = ss * a2 / 100000, dx = w * a1 / 200000;
                let pts = [[w / 2 - dx, 0], [w / 2 + dx, 0], [w / 2 + dx, h - dy], [w, h - dy], [w / 2, h], [0, h - dy], [w / 2 - dx, h - dy]];
                if (prst === 'upArrow') pts = pts.map(([x, y]) => [x, h - y]);
                pb.poly(pts); break;
            }
            case 'leftRightArrow': {
                const a1 = pin(0, a.adj1, 100000), a2 = pin(0, a.adj2, 50000 * w / ss);
                const x2 = ss * a2 / 100000, dy = h * a1 / 200000;
                pb.poly([[0, h / 2], [x2, 0], [x2, h / 2 - dy], [w - x2, h / 2 - dy], [w - x2, 0], [w, h / 2], [w - x2, h], [w - x2, h / 2 + dy], [x2, h / 2 + dy], [x2, h]]); break;
            }
            case 'upDownArrow': {
                const a1 = pin(0, a.adj1, 100000), a2 = pin(0, a.adj2, 50000 * h / ss);
                const y2 = ss * a2 / 100000, dx = w * a1 / 200000;
                pb.poly([[w / 2, 0], [w, y2], [w / 2 + dx, y2], [w / 2 + dx, h - y2], [w, h - y2], [w / 2, h], [0, h - y2], [w / 2 - dx, h - y2], [w / 2 - dx, y2], [0, y2]]); break;
            }
            case 'chevron': {
                const x = ss * pin(0, a.adj, 100000 * w / ss) / 100000;
                pb.poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]); break;
            }
            case 'homePlate': {
                const x = w - ss * pin(0, a.adj, 100000 * w / ss) / 100000;
                pb.poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]); break;
            }
            case 'plus': case 'mathPlus': {
                if (prst === 'mathPlus') {
                    const dx1 = w * 73490 / 200000, dy1 = h * 73490 / 200000, d = ss * pin(0, a.adj1, 73490) / 200000;
                    const cx = w / 2, cy = h / 2;
                    pb.poly([[cx - dx1, cy - d], [cx - d, cy - d], [cx - d, cy - dy1], [cx + d, cy - dy1], [cx + d, cy - d], [cx + dx1, cy - d],
                        [cx + dx1, cy + d], [cx + d, cy + d], [cx + d, cy + dy1], [cx - d, cy + dy1], [cx - d, cy + d], [cx - dx1, cy + d]]);
                    break;
                }
                const x = ss * pin(0, a.adj, 50000) / 100000;
                pb.poly([[0, x], [x, x], [x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x]]); break;
            }
            case 'mathMinus': {
                const dy = h * pin(0, a.adj1, 100000) / 200000, dx = w * 73490 / 200000;
                pb.rect(w / 2 - dx, h / 2 - dy, dx * 2, dy * 2); break;
            }
            case 'mathEqual': {
                const t = h * pin(0, a.adj1, 36745) / 100000, gap = h * pin(0, a.adj2, 100000) / 100000, dx = w * 73490 / 200000;
                pb.rect(w / 2 - dx, h / 2 - gap / 2 - t, dx * 2, t);
                pb.rect(w / 2 - dx, h / 2 + gap / 2, dx * 2, t); break;
            }
            case 'mathMultiply': {
                const t = ss * pin(0, a.adj1, 51965) / 200000;
                const cx = w / 2, cy = h / 2, L = Math.min(w, h) * 0.36;
                const arm = (ang) => {
                    const ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux;
                    return [[cx - ux * L + px * t, cy - uy * L + py * t], [cx + ux * L + px * t, cy + uy * L + py * t], [cx + ux * L - px * t, cy + uy * L - py * t], [cx - ux * L - px * t, cy - uy * L - py * t]];
                };
                pb.poly(arm(45 * DEG)); pb.poly(arm(135 * DEG)); break;
            }
            case 'donut': {
                const d = ss * pin(0, a.adj, 50000) / 100000;
                pb.ellipse(0, 0, w, h);
                pb.M(d, h / 2).A(w / 2 - d, h / 2 - d, 180, -360).Z();
                break;
            }
            case 'noSmoking': case 'blockArcRing': {
                const d = ss * pin(0, a.adj, 50000) / 100000;
                pb.ellipse(0, 0, w, h);
                pb.M(d, h / 2).A(w / 2 - d, h / 2 - d, 180, -360).Z();
                break;
            }
            case 'frame': {
                const d = ss * pin(0, a.adj1, 50000) / 100000;
                pb.rect(0, 0, w, h);
                pb.M(d, d).L(d, h - d).L(w - d, h - d).L(w - d, d).Z();
                break;
            }
            case 'halfFrame': {
                const x1 = ss * pin(0, a.adj2, 100000) / 100000, y1 = ss * pin(0, a.adj1, 100000) / 100000;
                pb.poly([[0, 0], [w, 0], [w, y1], [x1, y1], [x1, h], [0, h]]); break;
            }
            case 'corner': {
                const x1 = ss * pin(0, a.adj2, 100000) / 100000, y1 = h - ss * pin(0, a.adj1, 100000) / 100000;
                pb.poly([[0, 0], [x1, 0], [x1, y1], [w, y1], [w, h], [0, h]]); break;
            }
            case 'diagStripe': {
                const x = w * pin(0, a.adj, 100000) / 100000, y = h * pin(0, a.adj, 100000) / 100000;
                pb.poly([[0, y], [x, 0], [w, 0], [0, h]]); break;
            }
            case 'can': case 'flowChartMagneticDisk': {
                const ry = prst === 'can' ? ss * pin(0, a.adj, 50000 * h / ss) / 200000 : h / 6;
                pb.begin();
                pb.M(0, ry).A(w / 2, ry, 180, -180).L(w, h - ry).A(w / 2, ry, 0, 180).Z();
                pb.begin({ fill: 'lighten' });
                pb.M(0, ry).A(w / 2, ry, 180, 360).Z();
                break;
            }
            case 'cube': {
                const d = ss * pin(0, a.adj, 100000) / 100000;
                pb.begin(); pb.poly([[0, d], [w - d, d], [w - d, h], [0, h]]);
                pb.begin({ fill: 'lighten' }); pb.poly([[0, d], [d, 0], [w, 0], [w - d, d]]);
                pb.begin({ fill: 'darken' }); pb.poly([[w - d, h], [w - d, d], [w, 0], [w, h - d]]);
                break;
            }
            case 'bevel': {
                const d = ss * pin(0, a.adj, 50000) / 100000;
                pb.begin(); pb.rect(d, d, w - 2 * d, h - 2 * d);
                pb.begin({ fill: 'lightenLess' }); pb.poly([[0, 0], [w, 0], [w - d, d], [d, d]]);
                pb.begin({ fill: 'darkenLess' }); pb.poly([[0, h], [d, h - d], [w - d, h - d], [w, h]]);
                pb.begin({ fill: 'lighten' }); pb.poly([[0, 0], [d, d], [d, h - d], [0, h]]);
                pb.begin({ fill: 'darken' }); pb.poly([[w, 0], [w, h], [w - d, h - d], [w - d, d]]);
                break;
            }
            case 'pie': case 'arc': case 'chord': {
                const st = a.adj1 / 60000, en = a.adj2 / 60000;
                let sw = en - st; if (sw <= 0) sw += 360;
                const px = (deg) => { const t = Math.atan2(w * Math.sin(deg * DEG), h * Math.cos(deg * DEG)); return [w / 2 + w / 2 * Math.cos(t), h / 2 + h / 2 * Math.sin(t)]; };
                const [sx, sy] = px(st);
                if (prst === 'arc') {
                    pb.begin({ stroke: false }); pb.M(sx, sy).A(w / 2, h / 2, st, sw).L(w / 2, h / 2).Z();
                    pb.begin({ fill: 'none' }); pb.M(sx, sy).A(w / 2, h / 2, st, sw);
                } else if (prst === 'pie') {
                    pb.M(w / 2, h / 2).L(sx, sy).A(w / 2, h / 2, st, sw).Z();
                } else {
                    pb.M(sx, sy).A(w / 2, h / 2, st, sw).Z();
                }
                break;
            }
            case 'blockArc': {
                const st = a.adj1 / 60000, en = a.adj2 / 60000;
                let sw = en - st; if (sw <= 0) sw += 360;
                const d = ss * pin(0, a.adj3, 50000) / 100000;
                const pt = (deg, rx, ry) => { const t = Math.atan2(rx * Math.sin(deg * DEG), ry * Math.cos(deg * DEG)); return [w / 2 + rx * Math.cos(t), h / 2 + ry * Math.sin(t)]; };
                const [sx, sy] = pt(st, w / 2, h / 2);
                const [ix, iy] = pt(en, w / 2 - d, h / 2 - d);
                pb.M(sx, sy).A(w / 2, h / 2, st, sw).L(ix, iy).A(w / 2 - d, h / 2 - d, en, -sw).Z();
                break;
            }
            case 'teardrop': {
                const k = pin(0, a.adj, 200000) / 100000;
                const cx = w / 2 + w / 2 * k, cy = h / 2 - h / 2 * k;
                pb.M(0, h / 2).A(w / 2, h / 2, 180, 90).L(cx, cy).L(w, h / 2).A(w / 2, h / 2, 0, 180).Z();
                break;
            }
            case 'heart': {
                const dx1 = w * 49 / 48, dx2 = w * 10 / 48, y1 = -h / 3;
                pb.M(w / 2, h / 4).C(w / 2 + dx2, y1, w / 2 + dx1, h / 4, w / 2, h).C(w / 2 - dx1, h / 4, w / 2 - dx2, y1, w / 2, h / 4).Z();
                break;
            }
            case 'wave': case 'doubleWave': {
                const dy = h * pin(0, a.adj1, prst === 'wave' ? 20000 : 12500) / 100000;
                const dy2 = dy * 10 / 3;
                if (prst === 'wave') {
                    pb.M(0, dy).C(w / 3, dy - dy2, w * 2 / 3, dy + dy2, w, dy).L(w, h - dy).C(w * 2 / 3, h - dy + dy2, w / 3, h - dy - dy2, 0, h - dy).Z();
                } else {
                    pb.M(0, dy).C(w / 6, dy - dy2, w / 3, dy + dy2, w / 2, dy).C(w * 2 / 3, dy - dy2, w * 5 / 6, dy + dy2, w, dy)
                        .L(w, h - dy).C(w * 5 / 6, h - dy + dy2, w * 2 / 3, h - dy - dy2, w / 2, h - dy).C(w / 3, h - dy + dy2, w / 6, h - dy - dy2, 0, h - dy).Z();
                }
                break;
            }
            case 'plaque': {
                const r = ss * pin(0, a.adj, 50000) / 100000;
                pb.M(0, r).A(r, r, 90, -90).L(w - r, 0).A(r, r, 180, -90).L(w, h - r).A(r, r, 270, -90).L(r, h).A(r, r, 0, -90).Z();
                break;
            }
            case 'foldedCorner': {
                const d = ss * pin(0, a.adj, 50000) / 100000;
                pb.begin(); pb.poly([[0, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]);
                pb.begin({ fill: 'darkenLess' }); pb.poly([[w - d, h], [w - d * 0.8, h - d * 0.8], [w, h - d]]);
                break;
            }
            case 'flowChartTerminator': {
                const rx = w * 3475 / 21600;
                pb.M(rx, 0).L(w - rx, 0).A(rx, h / 2, 270, 180).L(rx, h).A(rx, h / 2, 90, 180).Z();
                break;
            }
            case 'flowChartDocument': {
                const k = w / 21600, j = h / 21600;
                pb.M(0, 0).L(w, 0).L(w, 17322 * j).C(10800 * k, 17322 * j, 10800 * k, 23922 * j, 0, 20172 * j).Z();
                break;
            }
            case 'flowChartMultidocument': {
                const k = w / 21600, j = h / 21600;
                pb.M(0, 3675 * j).L(18800 * k, 3675 * j).L(18800 * k, 18022 * j).C(9400 * k, 18022 * j, 9400 * k, 21600 * j, 0, 20400 * j).Z();
                pb.begin({ fill: 'norm' });
                pb.M(1350 * k, 3675 * j).L(1350 * k, 1815 * j).L(20250 * k, 1815 * j).L(20250 * k, 16252 * j).L(18800 * k, 16252 * j).L(18800 * k, 3675 * j).Z();
                pb.begin({ fill: 'norm' });
                pb.M(2700 * k, 1815 * j).L(2700 * k, 0).L(w, 0).L(w, 14392 * j).L(20250 * k, 14392 * j).L(20250 * k, 1815 * j).Z();
                break;
            }
            case 'flowChartPredefinedProcess': {
                pb.rect(0, 0, w, h);
                pb.begin({ fill: 'none' }); pb.M(w / 8, 0).L(w / 8, h); pb.M(w * 7 / 8, 0).L(w * 7 / 8, h);
                break;
            }
            case 'flowChartInternalStorage': {
                pb.rect(0, 0, w, h);
                pb.begin({ fill: 'none' }); pb.M(w / 8, 0).L(w / 8, h); pb.M(0, h / 8).L(w, h / 8);
                break;
            }
            case 'flowChartManualInput': pb.poly([[0, h / 5], [w, 0], [w, h], [0, h]]); break;
            case 'flowChartOffpageConnector': pb.poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]); break;
            case 'flowChartPunchedCard': pb.poly([[0, h / 5], [w / 5, 0], [w, 0], [w, h], [0, h]]); break;
            case 'flowChartDelay': pb.M(0, 0).L(w / 2, 0).A(w / 2, h / 2, 270, 180).L(0, h).Z(); break;
            case 'flowChartDisplay': pb.M(0, h / 2).L(w / 6, 0).L(w * 5 / 6, 0).A(w / 6, h / 2, 270, 180).L(w / 6, h).Z(); break;
            case 'flowChartCollate': pb.poly([[0, 0], [w, 0], [w / 2, h / 2], [w, h], [0, h], [w / 2, h / 2]]); break;
            case 'flowChartSort': {
                pb.poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
                pb.begin({ fill: 'none' }); pb.M(0, h / 2).L(w, h / 2);
                break;
            }
            case 'flowChartSummingJunction': case 'flowChartOr': {
                pb.ellipse(0, 0, w, h);
                pb.begin({ fill: 'none' });
                if (prst === 'flowChartOr') { pb.M(w / 2, 0).L(w / 2, h); pb.M(0, h / 2).L(w, h / 2); } else {
                    const dx = w / 2 * Math.SQRT1_2, dy = h / 2 * Math.SQRT1_2;
                    pb.M(w / 2 - dx, h / 2 - dy).L(w / 2 + dx, h / 2 + dy); pb.M(w / 2 + dx, h / 2 - dy).L(w / 2 - dx, h / 2 + dy);
                }
                break;
            }
            case 'flowChartOnlineStorage': pb.M(w / 6, 0).L(w, 0).A(w / 6, h / 2, 270, -180).L(w / 6, h).A(w / 6, h / 2, 90, 180).Z(); break;
            case 'flowChartOfflineStorage': pb.poly([[0, 0], [w, 0], [w / 2, h]]); break;
            case 'wedgeRectCallout': calloutRect(pb, w, h, w / 2 + w * a.adj1 / 100000, h / 2 + h * a.adj2 / 100000, 0); break;
            case 'wedgeRoundRectCallout': calloutRect(pb, w, h, w / 2 + w * a.adj1 / 100000, h / 2 + h * a.adj2 / 100000, ss * pin(0, a.adj3, 50000) / 100000); break;
            case 'wedgeEllipseCallout': case 'cloudCallout': {
                const tx = w / 2 + w * a.adj1 / 100000, ty = h / 2 + h * a.adj2 / 100000;
                const ang = Math.atan2((ty - h / 2) / h, (tx - w / 2) / w) / DEG;
                const st = ang + 11;
                const t = Math.atan2(w * Math.sin(st * DEG), h * Math.cos(st * DEG));
                pb.M(w / 2 + w / 2 * Math.cos(t), h / 2 + h / 2 * Math.sin(t)).A(w / 2, h / 2, st, 338).L(tx, ty).Z();
                break;
            }
            case 'borderCallout1': case 'callout1': case 'accentCallout1': {
                pb.rect(0, 0, w, h);
                pb.begin({ fill: 'none' }); pb.M(w * a.adj2 / 100000, h * a.adj1 / 100000).L(w * a.adj4 / 100000, h * a.adj3 / 100000);
                break;
            }
            case 'rightArrowCallout': case 'leftArrowCallout': case 'upArrowCallout': case 'downArrowCallout': {
                const horiz = prst === 'rightArrowCallout' || prst === 'leftArrowCallout';
                const W = horiz ? w : h, H = horiz ? h : w;
                const s2 = Math.min(W, H);
                const dy1 = s2 * a.adj2 / 100000, dy2 = s2 * a.adj1 / 200000, dx = s2 * a.adj3 / 100000, x2 = W * a.adj4 / 100000;
                let pts = [[0, 0], [x2, 0], [x2, H / 2 - dy2], [W - dx, H / 2 - dy2], [W - dx, H / 2 - dy1], [W, H / 2], [W - dx, H / 2 + dy1], [W - dx, H / 2 + dy2], [x2, H / 2 + dy2], [x2, H], [0, H]];
                if (prst === 'leftArrowCallout') pts = pts.map(([x, y]) => [W - x, y]);
                if (!horiz) pts = pts.map(([x, y]) => [y, x]);
                if (prst === 'upArrowCallout') pts = pts.map(([x, y]) => [x, h - y]);
                pb.poly(pts); break;
            }
            case 'leftBracket': case 'rightBracket': {
                const r = Math.min(h / 2, ss * a.adj / 100000);
                pb.begin({ stroke: false });
                if (prst === 'rightBracket') pb.M(0, 0).A(w, r, 270, 90).L(w, h - r).A(w, r, 0, 90).Z();
                else pb.M(w, h).A(w, r, 90, 90).L(0, r).A(w, r, 180, 90).Z();
                pb.begin({ fill: 'none' });
                if (prst === 'rightBracket') pb.M(0, 0).A(w, r, 270, 90).L(w, h - r).A(w, r, 0, 90);
                else pb.M(w, h).A(w, r, 90, 90).L(0, r).A(w, r, 180, 90);
                break;
            }
            case 'leftBrace': case 'rightBrace': {
                const r = ss * a.adj1 / 100000, y3 = h * a.adj2 / 100000;
                const draw = () => {
                    if (prst === 'rightBrace') pb.M(0, 0).A(w / 2, r, 270, 90).L(w / 2, y3 - r).A(w / 2, r, 180, -90).A(w / 2, r, 270, -90).L(w / 2, h - r).A(w / 2, r, 0, 90);
                    else pb.M(w, h).A(w / 2, r, 90, 90).L(w / 2, y3 + r).A(w / 2, r, 0, -90).A(w / 2, r, 90, -90).L(w / 2, r).A(w / 2, r, 180, 90);
                };
                pb.begin({ stroke: false }); draw(); pb.Z();
                pb.begin({ fill: 'none' }); draw();
                break;
            }
            case 'bracketPair': case 'bracePair': {
                const r = ss * a.adj / 100000;
                pb.begin({ stroke: false }); roundRectPath(pb, w, h, r, r, r, r);
                pb.begin({ fill: 'none' });
                pb.M(r, h).A(r, r, 90, 90).L(0, r).A(r, r, 180, 90);
                pb.M(w - r, 0).A(r, r, 270, 90).L(w, h - r).A(r, r, 0, 90);
                break;
            }
            case 'moon': {
                const g = ss * a.adj / 100000;
                pb.M(w, h).A(w, h / 2, 90, 180).C(w - g, 0, w - g, h, w, h).Z();
                break;
            }
            case 'smileyFace': {
                pb.ellipse(0, 0, w, h);
                pb.begin({ fill: 'darkenLess' });
                pb.ellipse(w * 0.3, h * 0.33, w * 0.1, h * 0.1);
                pb.ellipse(w * 0.6, h * 0.33, w * 0.1, h * 0.1);
                pb.begin({ fill: 'none' });
                pb.M(w * 0.3, h * 0.72).Q(w * 0.5, h * 0.72 + h * a.adj / 100000 * 4, w * 0.7, h * 0.72);
                break;
            }
            case 'line': case 'straightConnector1':
                pb.begin({ fill: 'none' }); pb.M(0, 0).L(w, h); break;
            case 'bentConnector2': pb.begin({ fill: 'none' }); pb.M(0, 0).L(w, 0).L(w, h); break;
            case 'bentConnector3': {
                const x = w * a.adj1 / 100000;
                pb.begin({ fill: 'none' }); pb.M(0, 0).L(x, 0).L(x, h).L(w, h); break;
            }
            case 'bentConnector4': {
                const x = w * a.adj1 / 100000, y = h * a.adj2 / 100000;
                pb.begin({ fill: 'none' }); pb.M(0, 0).L(x, 0).L(x, y).L(w, y).L(w, h); break;
            }
            case 'bentConnector5': {
                const x1 = w * a.adj1 / 100000, y = h * a.adj2 / 100000, x3 = w * a.adj3 / 100000;
                pb.begin({ fill: 'none' }); pb.M(0, 0).L(x1, 0).L(x1, y).L(x3, y).L(x3, h).L(w, h); break;
            }
            case 'curvedConnector2': pb.begin({ fill: 'none' }); pb.M(0, 0).C(w / 2, 0, w, h / 2, w, h); break;
            case 'curvedConnector3': case 'curvedConnector4': case 'curvedConnector5': {
                const x2 = w * a.adj1 / 100000;
                pb.begin({ fill: 'none' }); pb.M(0, 0).C(x2 / 2, 0, x2, h / 4, x2, h / 2).C(x2, h * 3 / 4, (w + x2) / 2, h, w, h); break;
            }
            case 'cloud': {
                // Scalloped approximation of PowerPoint's cloud outline.
                const bumps = [[0.18, 0.62, 0.19, 0.2], [0.14, 0.38, 0.17, 0.2], [0.3, 0.18, 0.2, 0.18], [0.52, 0.14, 0.2, 0.18],
                    [0.72, 0.2, 0.18, 0.18], [0.84, 0.44, 0.16, 0.2], [0.78, 0.7, 0.18, 0.2], [0.56, 0.82, 0.2, 0.17], [0.34, 0.8, 0.2, 0.18]];
                bumps.forEach(([cx, cy, rx, ry]) => pb.ellipse((cx - rx) * w, (cy - ry) * h, rx * 2 * w, ry * 2 * h));
                pb.ellipse(0.2 * w, 0.22 * h, 0.6 * w, 0.58 * h);
                break;
            }
            default:
                pb.rect(0, 0, w, h);
        }
        return pb.paths;
    }

    function presetTextRect(prst, w, h) {
        switch (prst) {
            case 'ellipse': case 'flowChartConnector': case 'wedgeEllipseCallout': case 'donut': case 'smileyFace': {
                const k = (1 - Math.SQRT1_2) / 2;
                return { x: w * k, y: h * k, w: w * (1 - 2 * k), h: h * (1 - 2 * k) };
            }
            case 'triangle': return { x: w / 4, y: h / 2, w: w / 2, h: h / 2 };
            case 'rtTriangle': return { x: w / 12, y: h * 7 / 12, w: w / 2, h: h * 5 / 12 };
            case 'diamond': case 'flowChartDecision': return { x: w / 4, y: h / 4, w: w / 2, h: h / 2 };
            case 'roundRect': { const r = Math.min(w, h) * 0.16667 * 0.29289; return { x: r, y: r, w: w - 2 * r, h: h - 2 * r }; }
            default: return { x: 0, y: 0, w, h };
        }
    }

    /* ------------------------------------------------------------------ */
    /* Fonts                                                               */
    /* ------------------------------------------------------------------ */

    // Metric-compatible (or visually close) web substitutes for common Office fonts.
    const FONT_SUBSTITUTES = {
        'calibri': 'Carlito', 'calibri light': 'Carlito', 'cambria': 'Caladea', 'arial': 'Arimo', 'helvetica': 'Arimo',
        'helvetica neue': 'Arimo', 'arial nova': 'Arimo', 'times new roman': 'Tinos', 'times': 'Tinos', 'courier new': 'Cousine',
        'courier': 'Cousine', 'georgia': 'Gelasio', 'segoe ui': 'Open Sans', 'segoe ui light': 'Open Sans', 'segoe ui semibold': 'Open Sans',
        'verdana': 'PT Sans', 'tahoma': 'PT Sans', 'trebuchet ms': 'Fira Sans', 'century gothic': 'Questrial',
        'gill sans mt': 'Lato', 'gill sans': 'Lato', 'franklin gothic book': 'Libre Franklin', 'franklin gothic medium': 'Libre Franklin',
        'garamond': 'EB Garamond', 'book antiqua': 'Crimson Text', 'palatino linotype': 'Crimson Text', 'palatino': 'Crimson Text',
        'consolas': 'Inconsolata', 'lucida console': 'Cousine', 'aptos': 'Open Sans', 'aptos display': 'Open Sans',
        'corbel': 'Open Sans', 'candara': 'Open Sans', 'constantia': 'Gelasio', 'rockwell': 'Roboto Slab',
        'impact': 'Oswald', 'arial black': 'Archivo Black', 'arial narrow': 'Archivo Narrow', 'comic sans ms': 'Comic Neue',
        'baskerville old face': 'Libre Baskerville', 'baskerville': 'Libre Baskerville', 'bookman old style': 'Libre Baskerville',
        'avenir': 'Nunito Sans', 'system font': 'Inter', 'system font regular': 'Inter', 'sf pro': 'Inter', 'sf pro text': 'Inter', 'sf pro display': 'Inter', '.sf ns': 'Inter', 'arial nova light': 'Arimo', 'grandview': 'Open Sans', 'seaford': 'Open Sans', 'bahnschrift': 'Barlow', 'dubai': 'Open Sans', 'meiryo': 'Noto Sans JP', 'yu gothic': 'Noto Sans JP', 'ms gothic': 'Noto Sans JP', 'microsoft yahei': 'Noto Sans SC', 'simsun': 'Noto Serif SC', 'malgun gothic': 'Noto Sans KR', 'avenir next': 'Nunito Sans', 'futura': 'Jost', 'optima': 'Marcellus', 'didot': 'Playfair Display'
    };
    // Office line-height ratios (winAscent + winDescent) where browser metrics differ.
    const FONT_LINE_METRICS = {
        'calibri': [0.952, 0.269], 'calibri light': [0.952, 0.269], 'carlito': [0.952, 0.269],
        'cambria': [0.95, 0.222], 'caladea': [0.95, 0.222], 'arial': [0.905 + 0.033, 0.212], 'arimo': [0.905 + 0.033, 0.212],
        'times new roman': [0.891 + 0.042, 0.216], 'tinos': [0.891 + 0.042, 0.216]
    };
    const WEIGHT_WORDS = {
        thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400,
        medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900
    };

    function genericFallback(family) {
        const f = family.toLowerCase();
        if (/mono|courier|consol|code/.test(f)) return 'monospace';
        if (/serif|times|georgia|garamond|roman|cambria|caladea|tinos|baskerville|palatino|book|bodoni|didot|minion|playfair|merriweather|lora|crimson|gelasio/.test(f) && !/sans/.test(f)) return 'serif';
        return 'sans-serif';
    }

    class FontManager {
        constructor() {
            this.available = new Map();
            this.registered = new Set();
            this.metricCache = new Map();
            this.faces = [];
            const c = document.createElement('canvas');
            c.width = c.height = 8;
            this.probe = c.getContext('2d');
        }

        isLocal(family) {
            if (this.available.has(family)) return this.available.get(family);
            const ctx = this.probe;
            const sample = 'mmmWWWlli10O@#abcDEFgjpqy';
            const measure = (font) => { ctx.font = `72px ${font}`; return ctx.measureText(sample).width; };
            const q = `"${family.replace(/"/g, '')}"`;
            const ok = measure(`${q}, monospace`) !== measure('monospace') || measure(`${q}, serif`) !== measure('serif');
            this.available.set(family, ok);
            return ok;
        }

        cssFamily(family) {
            const fam = (family || 'Arial').replace(/"/g, '');
            const generic = genericFallback(fam);
            const alt = generic === 'serif' ? '"Tinos", "Times New Roman", serif' : generic === 'monospace' ? '"Cousine", "Courier New", monospace' : '"Arimo", Arial, Helvetica, sans-serif';
            return `"${fam}", ${alt}`;
        }

        lineMetrics(family, bold, italic) {
            const key = `${family}|${bold}|${italic}`;
            if (this.metricCache.has(key)) return this.metricCache.get(key);
            let res = FONT_LINE_METRICS[String(family).toLowerCase()];
            if (res) res = { asc: res[0], desc: res[1] };
            if (!res) {
                const ctx = this.probe;
                ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${this.cssFamily(family)}`;
                const m = ctx.measureText('Hg');
                if (m.fontBoundingBoxAscent != null && m.fontBoundingBoxAscent > 0) {
                    res = { asc: m.fontBoundingBoxAscent / 100, desc: m.fontBoundingBoxDescent / 100 };
                } else res = { asc: 0.905, desc: 0.212 };
                // Guard against broken metrics (e.g. symbol fonts)
                if (res.asc + res.desc < 0.9 || res.asc + res.desc > 2.2) res = { asc: 0.905, desc: 0.245 };
            }
            this.metricCache.set(key, res);
            return res;
        }

        async registerBinary(family, data, weight, style) {
            try {
                const face = new FontFace(family, data, { weight: String(weight), style });
                await face.load();
                document.fonts.add(face);
                this.faces.push(face);
                this.registered.add(family);
                return true;
            } catch (_) {
                return false;
            }
        }

        async fetchGoogleCss(apiFamily, weights) {
            const fam = encodeURIComponent(apiFamily).replace(/%20/g, '+');
            const variants = weights
                ? [`ital,wght@${weights.map((w) => `0,${w}`).concat(weights.map((w) => `1,${w}`)).join(';')}`, `wght@${weights.join(';')}`, '']
                : ['ital,wght@0,400;0,700;1,400;1,700', 'wght@400;700', 'ital@0;1', ''];
            for (const v of variants) {
                const url = `https://fonts.googleapis.com/css2?family=${fam}${v ? ':' + v : ''}&display=block`;
                try {
                    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
                    const res = await fetch(url, { mode: 'cors', signal: ctl ? ctl.signal : undefined });
                    if (timer) clearTimeout(timer);
                    if (res.ok) return await res.text();
                } catch (_) { /* try next variant */ }
            }
            return '';
        }

        // Registers the Google Fonts faces of `apiFamily` under `asFamily`.
        async registerGoogle(asFamily, apiFamily, weightMap) {
            const cssText = await this.fetchGoogleCss(apiFamily, weightMap ? Object.keys(weightMap).map(Number).sort((x, y) => x - y) : null);
            if (!cssText) return false;
            const blocks = cssText.match(/@font-face\s*{[^}]*}/g) || [];
            let added = 0;
            for (const block of blocks) {
                const src = (block.match(/src:\s*url\(([^)]+)\)/) || [])[1];
                if (!src) continue;
                const style = ((block.match(/font-style:\s*([a-z]+)/) || [])[1]) || 'normal';
                let weight = Number(((block.match(/font-weight:\s*(\d+)/) || [])[1]) || 400);
                if (weightMap) {
                    if (!(weight in weightMap)) continue;
                    weight = weightMap[weight];
                }
                const range = ((block.match(/unicode-range:\s*([^;]+);/) || [])[1]) || undefined;
                try {
                    const desc = { style, weight: String(weight) };
                    if (range) desc.unicodeRange = range.trim();
                    const face = new FontFace(asFamily, `url(${src.replace(/['"]/g, '')})`, desc);
                    document.fonts.add(face);
                    this.faces.push(face);
                    added++;
                } catch (_) { /* skip face */ }
            }
            if (added) this.registered.add(asFamily);
            return added > 0;
        }

        async ensure(family, embedded) {
            if (!family || this.registered.has(family)) return;
            if (embedded && embedded.length) {
                let any = false;
                for (const e of embedded) any = (await this.registerBinary(family, e.data, e.weight, e.style)) || any;
                if (any) return;
            }
            if (this.isLocal(family)) return;
            const alias = (target, weight) => {
                if (weight && weight !== 400) {
                    this.aliasWeights = this.aliasWeights || {};
                    this.aliasWeights[family] = { base: target, weight };
                } else {
                    this.aliasFamilies = this.aliasFamilies || {};
                    this.aliasFamilies[family] = target;
                }
                return true;
            };
            const tryFamily = async (name, weight) => {
                const sub = FONT_SUBSTITUTES[name.toLowerCase()];
                if (this.isLocal(name)) return alias(name, weight);
                if (sub && this.isLocal(sub)) return alias(sub, weight);
                const api = sub || name;
                if (weight && weight !== 400) {
                    const bw = Math.min(900, weight + 300);
                    if (await this.registerGoogle(family, api, { [weight]: 400, [bw]: 700 })) return true;
                    if (await this.registerGoogle(family, api, { [weight]: 400 })) return true;
                }
                return this.registerGoogle(family, api);
            };
            // Candidate names: as written, de-duplicated ("Saira Condensed Condensed"),
            // with a trailing weight word split off ("IBM Plex Sans Light" -> 300).
            const words = family.split(/\s+/);
            const deduped = words.filter((wd, i) => i === 0 || wd.toLowerCase() !== words[i - 1].toLowerCase()).join(' ');
            const candidates = [[family, 400]];
            if (deduped !== family) candidates.push([deduped, 400]);
            const m = deduped.match(/^(.*?)[\s-]+(thin|hairline|extra ?light|ultra ?light|light|regular|normal|book|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy)$/i);
            if (m) candidates.push([m[1].trim(), WEIGHT_WORDS[m[2].replace(/\s+/g, '').toLowerCase()] || 400]);
            const baseWords = (m ? m[1].trim() : deduped).split(/\s+/);
            if (baseWords.length > 1) candidates.push([baseWords.slice(0, -1).join(' '), m ? (WEIGHT_WORDS[m[2].replace(/\s+/g, '').toLowerCase()] || 400) : 400]);
            for (const [name, weight] of candidates) {
                if (await tryFamily(name, weight)) return;
            }
        }

        familyFor(family) {
            if (this.aliasFamilies && this.aliasFamilies[family]) return this.aliasFamilies[family];
            return family;
        }

        async waitFor(fontStrings, sample) {
            const text = sample || 'AaBbCc 0123';
            const jobs = fontStrings.map((f) => document.fonts.load(f, text).catch(() => []));
            await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 12000))]);
            this.metricCache.clear();
        }
    }

    // Embedded fonts (.fntdata) are EOT containers; only uncompressed payloads
    // can be handed to the browser directly (MTX-compressed ones fall back to web fonts).
    function extractEotFont(bytes) {
        if (!bytes || bytes.length < 82) return null;
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const ttfSig = v.getUint32(0, false);
        if (ttfSig === 0x00010000 || ttfSig === 0x4f54544f || ttfSig === 0x74727565) return bytes;
        const eotSize = v.getUint32(0, true);
        const fontDataSize = v.getUint32(4, true);
        const flags = v.getUint32(12, true);
        const magic = v.getUint16(34, true);
        if (magic !== 0x504c || eotSize !== bytes.length || fontDataSize > bytes.length) return null;
        if (flags & 0x4) return null; // MicroType Express compressed
        const data = bytes.slice(bytes.length - fontDataSize);
        if (flags & 0x10000000) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
        return data;
    }

    /* ------------------------------------------------------------------ */
    /* Text helpers                                                        */
    /* ------------------------------------------------------------------ */

    const WINGDINGS = {
        0x6c: '●', 0x6e: '■', 0x71: '❏', 0x75: '◆', 0x76: '❖', 0xd8: '➢', 0xfc: '✔',
        0xa7: '▪', 0x9f: '•', 0x6f: '□', 0x70: '◻', 0x77: '⬥', 0xe0: '➔', 0xe8: '➔',
        0xf0: '⇨', 0xa8: '◻', 0x3e: '✇', 0x4a: '☺', 0x4c: '☹', 0xfb: '✘', 0xfd: '☒',
        0xfe: '☑', 0xa1: '○', 0xa4: '◉', 0x6d: '❍', 0x73: '⬧', 0x74: '⧫', 0xd7: '➤',
        0xdf: '⬅', 0xe2: '⬆', 0x7a: '⌘', 0x7b: '❀', 0x7c: '✿', 0xaa: '✦', 0xab: '★'
    };
    const WINGDINGS3 = {
        0x70: '\u25B2', 0x71: '\u25BC', 0x74: '\u25C0', 0x75: '\u25B6', 0x7d: '\u25B6', 0x7c: '\u25C0', 0x5b: '\u25B2', 0x5c: '\u25BC',
        0x3a: '\u2197', 0x3b: '\u2198', 0x3c: '\u2199', 0x3d: '\u2196', 0x22: '\u2192', 0x21: '\u2190', 0x23: '\u2191', 0x24: '\u2193',
        0xc4: '\u27A2', 0xc5: '\u27A2', 0xc6: '\u2B9E', 0xc7: '\u2B9C'
    };
    const WINGDINGS2 = { 0x97: '\u25CF', 0x98: '\u25CF', 0x9e: '\u25CF', 0xa1: '\u25CB', 0xa2: '\u25CB', 0xa3: '\u25A0', 0xa4: '\u25A0', 0xf0: '\u25A0', 0x50: '\u2714', 0x4f: '\u2718' };
    const SYMBOL = { 0xb7: '•', 0xde: '⇒', 0xae: '→', 0xac: '←', 0xa8: '♣', 0xa9: '♦', 0xaa: '♥', 0xab: '♠', 0x2d: '−', 0xd8: '¬', 0xb0: '°', 0xe0: '◊' };

    function mapSymbolChar(ch, font) {
        if (!ch) return '•';
        let code = ch.codePointAt(0);
        if (code >= 0xf000 && code <= 0xf0ff) code -= 0xf000;
        const f = String(font || '').toLowerCase();
        if (f.startsWith('wingdings 3')) return WINGDINGS3[code] || '\u25B6';
        if (f.startsWith('wingdings 2')) return WINGDINGS2[code] || '\u25A0';
        if (f.startsWith('wingdings')) return WINGDINGS[code] || '▪';
        if (f === 'symbol') return SYMBOL[code] || String.fromCharCode(code);
        if (ch.codePointAt(0) >= 0xf000 && ch.codePointAt(0) <= 0xf0ff) return WINGDINGS[code] || '•';
        return ch;
    }

    function toRoman(n) {
        const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
        let out = '';
        for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
        return out;
    }
    function toAlpha(n) {
        let s = '';
        while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
        return s;
    }
    function formatAutoNum(type, n) {
        const t = type || 'arabicPeriod';
        let body;
        if (/^roman/.test(t)) body = toRoman(n);
        else if (/^alpha/.test(t)) body = toAlpha(n);
        else body = String(n);
        if (/Uc/.test(t)) body = body.toUpperCase();
        if (/ParenBoth/.test(t)) return `(${body})`;
        if (/ParenR/.test(t)) return `${body})`;
        if (/Period/.test(t)) return `${body}.`;
        if (/Minus/.test(t)) return `- ${body} -`;
        return body;
    }

    function defaultPPr() {
        return {
            algn: 'l', marL: 0, marR: 0, indent: 0, lnSpc: { pct: 1 }, spcBef: { pts: 0 }, spcAft: { pts: 0 },
            defTab: 72, tabs: [], bu: { type: 'none' }, buColor: null, buColorTx: true, buSize: { pct: 1 }, buFont: null,
            rPr: {}
        };
    }
    function parseSpacing(el) {
        if (!el) return null;
        const pct = child(el, 'spcPct'), pts = child(el, 'spcPts');
        if (pct) return { pct: num(pct, 'val', 100000) / 100000 };
        if (pts) return { pts: num(pts, 'val', 0) / 100 };
        return null;
    }

    function mergeRPr(r, el) {
        if (!el) return r;
        if (el.hasAttribute('sz')) r.sz = num(el, 'sz', 1800) / 100;
        if (el.hasAttribute('b')) r.b = bool(el, 'b', false);
        if (el.hasAttribute('i')) r.i = bool(el, 'i', false);
        if (el.hasAttribute('u')) r.u = attr(el, 'u');
        if (el.hasAttribute('strike')) r.strike = attr(el, 'strike');
        if (el.hasAttribute('baseline')) r.baseline = num(el, 'baseline', 0) / 100000;
        if (el.hasAttribute('cap')) r.cap = attr(el, 'cap');
        if (el.hasAttribute('spc')) r.spc = num(el, 'spc', 0) / 100;
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
            switch (c.localName) {
                case 'solidFill': case 'gradFill': case 'noFill': case 'pattFill': case 'blipFill': r.fill = c; delete r.fillColor; break;
                case 'latin': if (attr(c, 'typeface')) r.latin = attr(c, 'typeface'); break;
                case 'ea': if (attr(c, 'typeface')) r.ea = attr(c, 'typeface'); break;
                case 'cs': if (attr(c, 'typeface')) r.cs = attr(c, 'typeface'); break;
                case 'sym': if (attr(c, 'typeface')) r.sym = attr(c, 'typeface'); break;
                case 'highlight': r.highlight = c; break;
                case 'hlinkClick': r.hlink = c; break;
                case 'ln': r.ln = c; break;
                case 'effectLst': r.effectLst = c; break;
                default: break;
            }
        }
        return r;
    }

    function mergePPr(p, el) {
        if (!el) return p;
        if (el.hasAttribute('algn')) p.algn = attr(el, 'algn');
        if (el.hasAttribute('marL')) p.marL = emu2pt(num(el, 'marL', 0));
        if (el.hasAttribute('marR')) p.marR = emu2pt(num(el, 'marR', 0));
        if (el.hasAttribute('indent')) p.indent = emu2pt(num(el, 'indent', 0));
        if (el.hasAttribute('defTabSz')) p.defTab = emu2pt(num(el, 'defTabSz', 914400)) || 72;
        if (el.hasAttribute('rtl')) p.rtl = bool(el, 'rtl', false);
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
            switch (c.localName) {
                case 'lnSpc': p.lnSpc = parseSpacing(c) || p.lnSpc; break;
                case 'spcBef': p.spcBef = parseSpacing(c) || p.spcBef; break;
                case 'spcAft': p.spcAft = parseSpacing(c) || p.spcAft; break;
                case 'buNone': p.bu = { type: 'none' }; break;
                case 'buChar': p.bu = { type: 'char', char: attr(c, 'char') || '•' }; break;
                case 'buAutoNum': p.bu = { type: 'auto', scheme: attr(c, 'type') || 'arabicPeriod', startAt: num(c, 'startAt', 1) }; break;
                case 'buBlip': p.bu = { type: 'char', char: '•' }; break;
                case 'buClrTx': p.buColor = null; p.buColorTx = true; break;
                case 'buClr': p.buColor = colorElOf(c); p.buColorTx = false; break;
                case 'buSzTx': p.buSize = { pct: 1 }; break;
                case 'buSzPct': p.buSize = { pct: num(c, 'val', 100000) / 100000 }; break;
                case 'buSzPts': p.buSize = { pts: num(c, 'val', 1800) / 100 }; break;
                case 'buFontTx': p.buFont = null; break;
                case 'buFont': p.buFont = attr(c, 'typeface'); break;
                case 'tabLst':
                    p.tabs = children(c, 'tab').map((t) => ({ pos: emu2pt(num(t, 'pos', 0)), algn: attr(t, 'algn') || 'l' })).sort((x, y) => x.pos - y.pos);
                    break;
                case 'defRPr': mergeRPr(p.rPr, c); break;
                default: break;
            }
        }
        return p;
    }

    function clonePPr(p) {
        return { ...p, lnSpc: { ...p.lnSpc }, spcBef: { ...p.spcBef }, spcAft: { ...p.spcAft }, bu: { ...p.bu }, buSize: { ...p.buSize }, tabs: p.tabs.slice(), rPr: { ...p.rPr } };
    }

    /* ------------------------------------------------------------------ */
    /* Deck                                                                */
    /* ------------------------------------------------------------------ */

    const TABLE_STYLE_MEDIUM2 = `<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}" styleName="Medium Style 2 - Accent 1">
<a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>
<a:left><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:left><a:right><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:right>
<a:top><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top><a:bottom><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom>
<a:insideH><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideH><a:insideV><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideV>
</a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>
<a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
<a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H>
<a:band1V><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1V>
<a:band2V><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2V>
<a:lastCol><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:lastCol>
<a:firstCol><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstCol>
<a:lastRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:top><a:ln w="38100"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:lastRow>
<a:firstRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:bottom><a:ln w="38100"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>
</a:tblStyle>`;

    const SUPPORTED_MC = new Set(['p14', 'p15', 'a14', 'a15', 'a16', 'p16', 'p159', 'a13', 'v', 'mv', 'o', 'wps', 'wpg', 'asvg', 'ahyp', 'dsp', 'dgm', 'p188']);

    class Deck {
        constructor(zip) {
            this.zip = zip;
            this.xmlCache = new Map();
            this.relsCache = new Map();
            this.imageCache = new Map();
            this.objectUrls = [];
            this.fonts = new FontManager();
            this.measureCtx = document.createElement('canvas').getContext('2d');
            this.measureCache = new Map();
            this.disableSvg = false;
            this.letterSpacingSupported = 'letterSpacing' in CanvasRenderingContext2D.prototype;
        }

        async xml(path) {
            if (!path) return null;
            if (this.xmlCache.has(path)) return this.xmlCache.get(path);
            const text = await this.zip.text(path);
            const doc = text == null ? null : parseXml(text);
            this.xmlCache.set(path, doc);
            return doc;
        }

        async rels(partPath) {
            if (this.relsCache.has(partPath)) return this.relsCache.get(partPath);
            const dir = dirOf(partPath);
            const base = partPath.slice(dir.length ? dir.length + 1 : 0);
            const relsPath = (dir ? dir + '/' : '') + '_rels/' + base + '.rels';
            const map = new Map();
            const doc = await this.xml(relsPath).catch(() => null);
            if (doc) {
                for (const r of children(doc.documentElement, 'Relationship')) {
                    const external = attr(r, 'TargetMode') === 'External';
                    const target = attr(r, 'Target') || '';
                    map.set(attr(r, 'Id'), {
                        type: attr(r, 'Type') || '',
                        target: external ? target : resolvePath(dir, target),
                        external
                    });
                }
            }
            this.relsCache.set(partPath, map);
            return map;
        }

        relOfType(rels, suffix) {
            for (const r of rels.values()) if (r.type.endsWith('/' + suffix)) return r;
            return null;
        }

        async part(path) {
            const doc = await this.xml(path);
            if (!doc) return null;
            return { path, doc, root: doc.documentElement, rels: await this.rels(path) };
        }

        async init() {
            const rootRels = await this.rels('');
            const officeRel = this.relOfType(rootRels, 'officeDocument');
            this.presPath = officeRel ? officeRel.target : 'ppt/presentation.xml';
            const pres = await this.part(this.presPath);
            if (!pres) throw new Error('presentation.xml not found in PPTX');
            this.pres = pres;
            const sz = child(pres.root, 'sldSz');
            this.widthEmu = num(sz, 'cx', 9144000);
            this.heightEmu = num(sz, 'cy', 6858000);
            this.widthPt = emu2pt(this.widthEmu);
            this.heightPt = emu2pt(this.heightEmu);
            this.defaultTextStyle = child(pres.root, 'defaultTextStyle');
            this.firstSlideNum = num(pres.root, 'firstSlideNum', 1);

            this.slides = [];
            for (const sid of children(child(pres.root, 'sldIdLst'), 'sldId')) {
                const rel = pres.rels.get(relAttr(sid, 'id'));
                if (!rel || rel.external || !this.zip.has(rel.target)) continue;
                this.slides.push({ path: rel.target });
            }

            // Table styles
            this.tableStyles = new Map();
            const tsRel = this.relOfType(pres.rels, 'tableStyles');
            const tsDoc = tsRel ? await this.xml(tsRel.target).catch(() => null) : null;
            if (tsDoc) for (const s of children(tsDoc.documentElement, 'tblStyle')) this.tableStyles.set(attr(s, 'styleId'), s);
            this.defaultTableStyleId = tsDoc ? attr(tsDoc.documentElement, 'def') : null;

            // Resolve slide -> layout -> master -> theme
            this.parts = new Map();
            for (const s of this.slides) {
                s.part = await this.part(s.path);
                s.hidden = attr(s.part.root, 'show') === '0';
                const layoutRel = this.relOfType(s.part.rels, 'slideLayout');
                s.layout = layoutRel ? await this.cachedPart(layoutRel.target) : null;
                const masterRel = s.layout ? this.relOfType(s.layout.rels, 'slideMaster') : null;
                s.master = masterRel ? await this.cachedPart(masterRel.target) : null;
                if (s.master && !s.master.theme) {
                    const themeRel = this.relOfType(s.master.rels, 'theme');
                    s.master.theme = this.parseTheme(themeRel ? await this.xml(themeRel.target) : null);
                }
            }
            this.visibleSlides = this.slides.filter((s) => !s.hidden);
            if (!this.visibleSlides.length) this.visibleSlides = this.slides.slice();
        }

        async cachedPart(path) {
            if (!this.parts.has(path)) this.parts.set(path, await this.part(path));
            return this.parts.get(path);
        }

        parseTheme(doc) {
            const theme = { colors: {}, major: 'Calibri Light', minor: 'Calibri', majorEa: '', minorEa: '', fill: [], bgFill: [], line: [], effect: [] };
            if (!doc) {
                Object.assign(theme.colors, { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' });
                return theme;
            }
            const el = dig(doc.documentElement, 'themeElements');
            for (const c of children(child(el, 'clrScheme'))) {
                const ce = colorElOf(c);
                if (!ce) continue;
                if (ce.localName === 'srgbClr') theme.colors[c.localName] = attr(ce, 'val');
                else if (ce.localName === 'sysClr') theme.colors[c.localName] = attr(ce, 'lastClr') || SYS_COLORS[attr(ce, 'val')] || '000000';
                else {
                    const rgb = resolveColorEl(ce, { theme: { colors: {} } }) || { r: 0, g: 0, b: 0 };
                    theme.colors[c.localName] = [rgb.r, rgb.g, rgb.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
                }
            }
            const fs = child(el, 'fontScheme');
            theme.major = attr(dig(fs, 'majorFont', 'latin'), 'typeface') || theme.major;
            theme.minor = attr(dig(fs, 'minorFont', 'latin'), 'typeface') || theme.minor;
            const fmt = child(el, 'fmtScheme');
            theme.fill = children(child(fmt, 'fillStyleLst'));
            theme.bgFill = children(child(fmt, 'bgFillStyleLst'));
            theme.line = children(child(fmt, 'lnStyleLst'), 'ln');
            theme.effect = children(child(fmt, 'effectStyleLst'), 'effectStyle');
            return theme;
        }

        clrMapFor(slide) {
            const fromOvr = (root) => {
                const ov = dig(root, 'clrMapOvr', 'overrideClrMapping');
                return ov ? ov : null;
            };
            const el = fromOvr(slide.part.root) || (slide.layout && fromOvr(slide.layout.root)) || (slide.master && child(slide.master.root, 'clrMap'));
            const map = {};
            if (el) for (const a of Array.from(el.attributes)) map[a.localName] = a.value;
            return map;
        }

        resolveFontName(name, theme) {
            if (!name) return null;
            if (name.startsWith('+mj')) return theme.major;
            if (name.startsWith('+mn')) return theme.minor;
            return name;
        }

        /* ---------------- fonts ---------------- */

        async prepareFonts(onProgress) {
            const families = new Set();
            let sample = '';
            const collect = (root, theme) => {
                const all = root.getElementsByTagName('*');
                for (let i = 0; i < all.length; i++) {
                    const el = all[i];
                    const ln = el.localName;
                    if ((ln === 'latin' || ln === 'buFont' || ln === 'sym') && el.getAttribute('typeface')) {
                        const f = this.resolveFontName(el.getAttribute('typeface'), theme);
                        if (f && !/^(wingdings|symbol|webdings)/i.test(f)) families.add(f);
                    } else if (ln === 't' && sample.length < 4000) {
                        sample += el.textContent;
                    }
                }
            };
            const seen = new Set();
            for (const s of this.visibleSlides) {
                const theme = (s.master && s.master.theme) || this.parseTheme(null);
                families.add(theme.major);
                families.add(theme.minor);
                for (const p of [s.part, s.layout, s.master]) {
                    if (!p || seen.has(p.path)) continue;
                    seen.add(p.path);
                    collect(p.root, theme);
                }
                if (this.defaultTextStyle && !seen.has('dts')) { seen.add('dts'); collect(this.defaultTextStyle, theme); }
            }
            // Embedded fonts
            const embedded = new Map();
            for (const ef of children(child(this.pres.root, 'embeddedFontLst'), 'embeddedFont')) {
                const face = attr(child(ef, 'font'), 'typeface');
                if (!face) continue;
                const list = [];
                for (const [tag, weight, style] of [['regular', 400, 'normal'], ['bold', 700, 'normal'], ['italic', 400, 'italic'], ['boldItalic', 700, 'italic']]) {
                    const rid = relAttr(child(ef, tag), 'id');
                    const rel = rid && this.pres.rels.get(rid);
                    if (!rel) continue;
                    const data = extractEotFont(await this.zip.read(rel.target).catch(() => null));
                    if (data) list.push({ data, weight, style });
                }
                embedded.set(face, list);
            }
            const fams = Array.from(families).filter(Boolean);
            if (onProgress) onProgress(`Loading fonts (${fams.length})...`);
            await Promise.all(fams.map((f) => this.fonts.ensure(f, embedded.get(f)).catch(() => { })));
            const fontStrings = [];
            fams.forEach((f) => {
                const cssFam = this.fonts.cssFamily(this.fonts.familyFor(f));
                fontStrings.push(`16px ${cssFam}`, `bold 16px ${cssFam}`, `italic 16px ${cssFam}`, `italic bold 16px ${cssFam}`);
            });
            await this.fonts.waitFor(fontStrings, (sample + ' AaBb0123').slice(0, 4000));
            this.measureCache.clear();
        }

        /* ---------------- images ---------------- */

        loadImage(path) {
            if (this.imageCache.has(path)) return this.imageCache.get(path);
            const job = (async () => {
                const bytes = await this.zip.read(path);
                if (!bytes) return null;
                const ext = (path.split('.').pop() || '').toLowerCase();
                const mime = {
                    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
                    svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon', avif: 'image/avif'
                }[ext];
                if ((ext === 'emf' || ext === 'emz') && global.LuxEmf) {
                    let data = bytes;
                    if (ext === 'emz' && typeof DecompressionStream === 'function') {
                        data = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
                    }
                    return global.LuxEmf.rasterize(data);
                }
                if (!mime) return null; // wmf/wdp cannot be decoded by browsers
                const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
                this.objectUrls.push(url);
                const img = new Image();
                img.decoding = 'async';
                img.src = url;
                try { await img.decode(); } catch (_) {
                    await new Promise((res) => { if (img.complete) res(); else { img.onload = res; img.onerror = res; } });
                }
                if (!img.naturalWidth && mime !== 'image/svg+xml') return null;
                return img;
            })().catch(() => null);
            this.imageCache.set(path, job);
            return job;
        }

        async blipImage(blip, part) {
            if (!blip || !part) return null;
            if (!this.disableSvg) {
                const svgEl = Array.from(blip.getElementsByTagName('*')).find((e) => e.localName === 'svgBlip');
                const svgRel = svgEl && part.rels.get(relAttr(svgEl, 'embed'));
                if (svgRel && !svgRel.external) {
                    const img = await this.loadImage(svgRel.target);
                    if (img) return img;
                }
            }
            const rel = part.rels.get(relAttr(blip, 'embed'));
            if (!rel || rel.external) return null;
            return this.loadImage(rel.target);
        }

        /* ---------------- rendering ---------------- */

        async renderSlide(index, pxPerPt) {
            const slide = this.visibleSlides[index];
            const W = Math.max(1, Math.round(this.widthPt * pxPerPt));
            const H = Math.max(1, Math.round(this.heightPt * pxPerPt));
            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.setTransform(W / this.widthPt, 0, 0, H / this.heightPt, 0, 0);
            ctx.textBaseline = 'alphabetic';

            const theme = (slide.master && slide.master.theme) || this.parseTheme(null);
            const cctx = { theme, clrMap: this.clrMapFor(slide) };
            const r = new SlidePainter(this, slide, ctx, cctx, pxPerPt, this.slides.indexOf(slide) + this.firstSlideNum);
            await r.paint();
            return { canvas, text: r.textRuns };
        }

        dispose() {
            this.objectUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) { } });
            this.objectUrls = [];
            this.imageCache.clear();
            this.fonts.faces.forEach((f) => { try { document.fonts.delete(f); } catch (_) { } });
        }
    }

    /* ------------------------------------------------------------------ */
    /* Slide painter                                                       */
    /* ------------------------------------------------------------------ */

    class SlidePainter {
        constructor(deck, slide, ctx, cctx, scale, slideNumber) {
            this.deck = deck;
            this.slide = slide;
            this.ctx = ctx;
            this.cctx = cctx;
            this.scale = scale;
            this.slideNumber = slideNumber;
            this.textRuns = [];
            this.theme = cctx.theme;
        }

        async paint() {
            const { slide } = this;
            await this.paintBackground();
            const showMasterOnLayout = !slide.layout || attr(slide.layout.root, 'showMasterSp') !== '0';
            const showOnSlide = attr(slide.part.root, 'showMasterSp') !== '0';
            const identity = (off, ext) => ({ x: emu2pt(off.x), y: emu2pt(off.y), w: emu2pt(ext.cx), h: emu2pt(ext.cy) });
            if (slide.master && showMasterOnLayout && showOnSlide) {
                await this.paintTree(dig(slide.master.root, 'cSld', 'spTree'), { kind: 'master', part: slide.master }, identity);
            }
            if (slide.layout && showOnSlide) {
                await this.paintTree(dig(slide.layout.root, 'cSld', 'spTree'), { kind: 'layout', part: slide.layout }, identity);
            }
            await this.paintTree(dig(slide.part.root, 'cSld', 'spTree'), { kind: 'slide', part: slide.part }, identity);
        }

        async paintBackground() {
            const { ctx, slide } = this;
            const W = this.deck.widthPt, H = this.deck.heightPt;
            const box = { x: 0, y: 0, w: W, h: H };
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);
            for (const p of [slide.part, slide.layout, slide.master]) {
                const bg = p && dig(p.root, 'cSld', 'bg');
                if (!bg) continue;
                const bgPr = child(bg, 'bgPr');
                let paint = null;
                if (bgPr) paint = parsePaint(fillElOf(bgPr), this.cctx, p);
                else {
                    const ref = child(bg, 'bgRef');
                    if (ref) paint = this.styleFill(ref);
                }
                if (paint) {
                    const path = new Path2D();
                    path.rect(0, 0, W, H);
                    await this.fillPath(path, paint, box, 'nonzero');
                }
                return;
            }
        }

        styleFill(ref) {
            const idx = num(ref, 'idx', 0);
            if (!idx) return null;
            const phClr = firstColor(ref, this.cctx);
            const list = idx >= 1000 ? this.theme.bgFill : this.theme.fill;
            const el = list[(idx >= 1000 ? idx - 1001 : idx - 1)];
            if (!el) return phClr ? { type: 'solid', color: phClr } : null;
            return parsePaint(el, { ...this.cctx, phClr }, this.slide.master);
        }

        async paintTree(tree, fc, map) {
            if (!tree) return;
            for (const el of children(tree)) {
                try {
                    await this.paintElement(el, fc, map);
                } catch (err) {
                    console.warn('PPTX: skipped element', el.localName, err);
                }
            }
        }

        async paintElement(el, fc, map) {
            switch (el.localName) {
                case 'sp': case 'cxnSp': return this.paintShape(el, fc, map);
                case 'pic': return this.paintPicture(el, fc, map);
                case 'grpSp': return this.paintGroup(el, fc, map);
                case 'graphicFrame': return this.paintGraphicFrame(el, fc, map);
                case 'AlternateContent': {
                    const choice = children(el, 'Choice').find((c) => (attr(c, 'Requires') || '').split(/\s+/).every((ns) => SUPPORTED_MC.has(ns)));
                    const pick = choice || child(el, 'Fallback');
                    if (pick) for (const c of children(pick)) await this.paintElement(c, fc, map);
                    return undefined;
                }
                default: return undefined;
            }
        }

        nvProps(el) {
            for (const c of children(el)) if (/^nv/.test(c.localName)) return c;
            return null;
        }

        isHidden(el) {
            const nv = this.nvProps(el);
            return bool(child(nv, 'cNvPr'), 'hidden', false);
        }

        // Placeholder inheritance: returns { layout, master, type } source elements.
        findInherited(phEl) {
            const { slide } = this;
            const type = attr(phEl, 'type') || 'obj';
            const idx = attr(phEl, 'idx');
            const listFor = (part) => {
                if (!part) return [];
                if (!part.__ph) {
                    part.__ph = [];
                    const walk = (tree) => {
                        for (const c of children(tree)) {
                            if (c.localName === 'grpSp') { walk(c); continue; }
                            const ph = dig(this.nvProps(c), 'nvPr', 'ph');
                            if (ph) part.__ph.push({ el: c, type: attr(ph, 'type') || 'obj', idx: attr(ph, 'idx') });
                        }
                    };
                    walk(dig(part.root, 'cSld', 'spTree'));
                }
                return part.__ph;
            };
            const norm = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
            const layoutList = listFor(slide.layout);
            let layoutPh = null;
            if (idx != null) layoutPh = layoutList.find((p) => p.idx === idx) || null;
            if (!layoutPh) layoutPh = layoutList.find((p) => p.type === type) || null;
            if (!layoutPh && type !== 'obj') layoutPh = layoutList.find((p) => norm(p.type) === norm(type)) || null;
            const effType = layoutPh ? layoutPh.type : type;
            const masterList = listFor(slide.master);
            const mType = ['ctrTitle', 'title'].includes(effType) ? 'title'
                : ['dt', 'ftr', 'sldNum', 'hdr'].includes(effType) ? effType : 'body';
            const masterPh = masterList.find((p) => p.type === mType) || null;
            return { layout: layoutPh && layoutPh.el, master: masterPh && masterPh.el, type: type !== 'obj' ? type : effType };
        }

        parseXfrm(xfrm) {
            if (!xfrm) return null;
            const off = child(xfrm, 'off'), ext = child(xfrm, 'ext');
            return {
                off: { x: num(off, 'x', 0), y: num(off, 'y', 0) },
                ext: { cx: num(ext, 'cx', 0), cy: num(ext, 'cy', 0) },
                chOff: child(xfrm, 'chOff') ? { x: num(child(xfrm, 'chOff'), 'x', 0), y: num(child(xfrm, 'chOff'), 'y', 0) } : null,
                chExt: child(xfrm, 'chExt') ? { cx: num(child(xfrm, 'chExt'), 'cx', 0), cy: num(child(xfrm, 'chExt'), 'cy', 0) } : null,
                rot: num(xfrm, 'rot', 0) / 60000,
                flipH: bool(xfrm, 'flipH', false),
                flipV: bool(xfrm, 'flipV', false)
            };
        }

        applyXfrm(rect, rot, flipH, flipV) {
            const { ctx } = this;
            ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
            if (rot) ctx.rotate(rot * DEG);
            if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            ctx.translate(-rect.w / 2, -rect.h / 2);
        }

        geometry(geomEl, w, h) {
            if (geomEl && geomEl.localName === 'custGeom') {
                const paths = buildCustGeom(geomEl, w, h);
                return { paths: paths.length ? paths : buildPresetGeom('rect', w, h), textRect: { x: 0, y: 0, w, h } };
            }
            const prst = geomEl ? attr(geomEl, 'prst') || 'rect' : 'rect';
            const adj = {};
            for (const gd of children(child(geomEl, 'avLst'), 'gd')) {
                const m = String(attr(gd, 'fmla') || '').match(/^val\s+(-?[\d.]+)/);
                if (m) adj[attr(gd, 'name')] = Number(m[1]);
            }
            return { paths: buildPresetGeom(prst, w, h, adj), textRect: presetTextRect(prst, w, h), prst };
        }

        shadowFor(spPrs, styleEl) {
            let effectLst = null;
            for (const s of spPrs) {
                if (!s) continue;
                const e = child(s, 'effectLst');
                if (e) effectLst = e;
            }
            if (effectLst) return parseShadow(effectLst, this.cctx);
            const ref = child(styleEl, 'effectRef');
            if (ref && num(ref, 'idx', 0) > 0) {
                const es = this.theme.effect[num(ref, 'idx', 0) - 1];
                const phClr = firstColor(ref, this.cctx);
                return parseShadow(child(es, 'effectLst'), { ...this.cctx, phClr });
            }
            return null;
        }

        // Draws a shadow for `drawFn` without painting the shape itself (offscreen trick).
        withShadow(shadow, drawFn) {
            if (!shadow || shadow.color.a <= 0) return;
            const { ctx } = this;
            const m = ctx.getTransform();
            const D = 20000;
            ctx.save();
            const ox = shadow.dist * Math.cos(shadow.dir * DEG) * this.scale;
            const oy = shadow.dist * Math.sin(shadow.dir * DEG) * this.scale;
            ctx.shadowColor = css(shadow.color);
            ctx.shadowBlur = shadow.blur * this.scale;
            ctx.shadowOffsetX = ox + D * m.a;
            ctx.shadowOffsetY = oy + D * m.b;
            ctx.translate(-D, 0);
            drawFn();
            ctx.restore();
        }

        async paintShape(el, fc, map, extra = {}) {
            if (this.isHidden(el)) return;
            const nv = this.nvProps(el);
            const phEl = dig(nv, 'nvPr', 'ph');
            if (phEl && fc.kind !== 'slide') return; // layout/master placeholders are prompts only
            const inh = phEl ? this.findInherited(phEl) : { layout: null, master: null };
            const spPr = child(el, 'spPr');
            const spPrs = [inh.master && child(inh.master, 'spPr'), inh.layout && child(inh.layout, 'spPr'), spPr];
            const xf = this.parseXfrm(lastDefined(spPrs.map((s) => child(s, 'xfrm'))));
            if (!xf) return;
            const rect = map(xf.off, xf.ext);
            const styleEl = child(el, 'style');
            const geomEl = lastDefined(spPrs.map((s) => child(s, 'prstGeom') || child(s, 'custGeom')));
            const geom = this.geometry(geomEl, rect.w, rect.h);

            let paint = null;
            for (const s of spPrs) { const f = fillElOf(s); if (f) paint = parsePaint(f, this.cctx, fc.part); }
            if (!paint && styleEl) paint = this.styleFill(child(styleEl, 'fillRef'));
            if (paint && paint.type === 'grp') paint = fc.groupFill || null;

            const lnPairs = [];
            const lnRef = child(styleEl, 'lnRef');
            if (lnRef && num(lnRef, 'idx', 0) > 0) {
                lnPairs.push([this.theme.line[num(lnRef, 'idx', 0) - 1], { ...this.cctx, phClr: firstColor(lnRef, this.cctx) }]);
            }
            spPrs.forEach((s) => lnPairs.push([child(s, 'ln'), this.cctx]));
            const line = parseLine(lnPairs, fc.part);
            const shadow = this.shadowFor(spPrs, styleEl);

            const { ctx } = this;
            ctx.save();
            this.applyXfrm(rect, xf.rot, xf.flipH, xf.flipV);
            await this.drawGeometry(geom.paths, paint, line, shadow, { x: 0, y: 0, w: rect.w, h: rect.h });
            ctx.restore();

            const txBody = child(el, 'txBody');
            if (txBody && this.hasText(txBody)) {
                const kind = phEl ? this.textStyleKind(inh.type) : 'other';
                const layers = [
                    { lst: this.deck.defaultTextStyle },
                    { lst: this.masterTxStyle(kind) }
                ];
                const fontRef = child(styleEl, 'fontRef');
                if (fontRef) {
                    const fr = {};
                    const c = colorElOf(fontRef);
                    if (c) fr.fillColor = resolveColorEl(c, this.cctx);
                    const idx = attr(fontRef, 'idx');
                    if (idx === 'major') fr.latin = '+mj-lt';
                    else if (idx === 'minor') fr.latin = '+mn-lt';
                    layers.push({ rPr: fr });
                }
                if (inh.master) layers.push({ lst: dig(inh.master, 'txBody', 'lstStyle') });
                if (inh.layout) layers.push({ lst: dig(inh.layout, 'txBody', 'lstStyle') });
                layers.push({ lst: child(txBody, 'lstStyle') });
                const bodyPrs = [inh.master && dig(inh.master, 'txBody', 'bodyPr'), inh.layout && dig(inh.layout, 'txBody', 'bodyPr'), child(txBody, 'bodyPr')];

                let textRect = rect;
                let rot = xf.rot;
                let local = geom.textRect;
                if (extra.txXfrm) {
                    const tx = this.parseXfrm(extra.txXfrm);
                    textRect = map(tx.off, tx.ext);
                    rot = tx.rot;
                    local = { x: 0, y: 0, w: textRect.w, h: textRect.h };
                }
                ctx.save();
                this.applyXfrm(textRect, rot + (xf.flipV && !extra.txXfrm ? 180 : 0), false, false);
                await this.drawTextBody(txBody, local, { layers, bodyPrs, part: fc.part });
                ctx.restore();
            }
        }

        textStyleKind(type) {
            if (type === 'title' || type === 'ctrTitle') return 'title';
            if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) return 'other';
            return 'body';
        }

        masterTxStyle(kind) {
            const tx = this.slide.master && child(this.slide.master.root, 'txStyles');
            if (!tx) return null;
            return child(tx, kind === 'title' ? 'titleStyle' : kind === 'body' ? 'bodyStyle' : 'otherStyle');
        }

        hasText(txBody) {
            for (const p of children(txBody, 'p')) {
                for (const r of children(p)) {
                    if ((r.localName === 'r' || r.localName === 'fld') && (child(r, 't') || {}).textContent) return true;
                }
            }
            return false;
        }

        async fillPath(path, paint, box, rule) {
            const { ctx } = this;
            if (!paint || paint.type === 'none') return;
            if (paint.type === 'solid') {
                ctx.fillStyle = css(paint.color);
                ctx.fill(path, rule);
            } else if (paint.type === 'grad') {
                this.fillGradient(path, paint, box, rule);
            } else if (paint.type === 'patt') {
                ctx.fillStyle = this.patternStyle(paint);
                ctx.fill(path, rule);
            } else if (paint.type === 'blip') {
                const blip = child(paint.el, 'blip');
                const img = await this.deck.blipImage(blip, paint.part);
                if (!img) return;
                ctx.save();
                ctx.clip(path, rule);
                this.drawBlip(img, paint.el, box);
                ctx.restore();
            }
        }

        fillGradient(path, g, box, rule) {
            const { ctx } = this;
            ctx.save();
            ctx.clip(path, rule);
            let grad;
            if (g.path) {
                const fr = g.fillToRect || { l: 0.5, t: 0.5, r: 0.5, b: 0.5 };
                const cx = box.x + box.w * (fr.l + (1 - fr.r)) / 2;
                const cy = box.y + box.h * (fr.t + (1 - fr.b)) / 2;
                const rad = Math.max(...[[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
                grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad || 1);
                g.stops.forEach((s) => grad.addColorStop(clamp01(s.pos), css(s.color)));
                ctx.fillStyle = grad;
                ctx.fillRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
            } else {
                const t = g.angle * DEG;
                const cos = Math.cos(t), sin = Math.sin(t);
                if (g.scaled && box.w > 0 && box.h > 0) {
                    ctx.translate(box.x, box.y);
                    ctx.scale(box.w, box.h);
                    const L = Math.abs(cos) + Math.abs(sin);
                    grad = ctx.createLinearGradient(0.5 - cos * L / 2, 0.5 - sin * L / 2, 0.5 + cos * L / 2, 0.5 + sin * L / 2);
                    g.stops.forEach((s) => grad.addColorStop(clamp01(s.pos), css(s.color)));
                    ctx.fillStyle = grad;
                    ctx.fillRect(-0.01, -0.01, 1.02, 1.02);
                } else {
                    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
                    const L = Math.abs(box.w * cos) + Math.abs(box.h * sin);
                    grad = ctx.createLinearGradient(cx - cos * L / 2, cy - sin * L / 2, cx + cos * L / 2, cy + sin * L / 2);
                    g.stops.forEach((s) => grad.addColorStop(clamp01(s.pos), css(s.color)));
                    ctx.fillStyle = grad;
                    ctx.fillRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
                }
            }
            ctx.restore();
        }

        patternStyle(p) {
            const c = document.createElement('canvas');
            const n = 8;
            c.width = c.height = n;
            const x = c.getContext('2d');
            x.fillStyle = css(p.bg);
            x.fillRect(0, 0, n, n);
            x.fillStyle = css(p.fg);
            const pct = (p.prst.match(/^pct(\d+)/) || [])[1];
            if (pct) {
                // Ordered dither for percentage patterns.
                const bayer = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
                const th = Number(pct) / 100 * 64;
                for (let i = 0; i < 64; i++) if (bayer[i] < th) x.fillRect(i % 8, Math.floor(i / 8), 1, 1);
            } else {
                const P = p.prst;
                const lineH = /horz|Horz/.test(P), lineV = /vert|Vert/.test(P);
                const dn = /dnDiag|DnDiag/.test(P), up = /upDiag|UpDiag/.test(P);
                const heavy = /^dk|^wd/.test(P) ? 2 : 1;
                if (lineH || /cross|Grid|grid/.test(P)) x.fillRect(0, 0, n, heavy);
                if (lineV || /cross|Grid|grid/.test(P)) x.fillRect(0, 0, heavy, n);
                if (dn || /diagCross/.test(P)) for (let i = 0; i < n; i++) x.fillRect(i, i, heavy, 1);
                if (up || /diagCross/.test(P)) for (let i = 0; i < n; i++) x.fillRect(n - 1 - i, i, heavy, 1);
                if (!(lineH || lineV || dn || up || /cross|Grid|grid|diagCross/.test(P))) { x.globalAlpha = 0.5; x.fillRect(0, 0, n, n); }
            }
            const pat = this.ctx.createPattern(c, 'repeat');
            if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scale(0.75 / 1, 0.75 / 1));
            return pat || css(p.fg);
        }

        drawBlip(img, blipFill, box) {
            const { ctx } = this;
            const iw = img.naturalWidth || img.width || box.w;
            const ih = img.naturalHeight || img.height || box.h;
            const blip = child(blipFill, 'blip');
            const alphaEl = child(blip, 'alphaModFix');
            const alpha = alphaEl ? num(alphaEl, 'amt', 100000) / 100000 : 1;
            const filters = [];
            if (child(blip, 'grayscl')) filters.push('grayscale(1)');
            const lum = child(blip, 'lum');
            if (lum) {
                const bright = num(lum, 'bright', 0) / 100000, contrast = num(lum, 'contrast', 0) / 100000;
                if (bright) filters.push(`brightness(${1 + bright})`);
                if (contrast) filters.push(`contrast(${1 + contrast})`);
            }
            ctx.save();
            if (alpha < 1) ctx.globalAlpha *= alpha;
            if (filters.length && 'filter' in ctx) ctx.filter = filters.join(' ');
            const tile = child(blipFill, 'tile');
            if (tile) {
                const sx = num(tile, 'sx', 100000) / 100000, sy = num(tile, 'sy', 100000) / 100000;
                const tx = emu2pt(num(tile, 'tx', 0)), ty = emu2pt(num(tile, 'ty', 0));
                const pat = ctx.createPattern(img, 'repeat');
                if (pat) {
                    // image pixels at 96dpi -> points
                    pat.setTransform(new DOMMatrix().translate(box.x + tx, box.y + ty).scale(sx * 0.75, sy * 0.75));
                    ctx.fillStyle = pat;
                    ctx.fillRect(box.x, box.y, box.w, box.h);
                }
                ctx.restore();
                return;
            }
            let target = { ...box };
            const fr = dig(blipFill, 'stretch', 'fillRect');
            if (fr) {
                const l = num(fr, 'l', 0) / 100000, t = num(fr, 't', 0) / 100000, r = num(fr, 'r', 0) / 100000, b = num(fr, 'b', 0) / 100000;
                target = { x: box.x + box.w * l, y: box.y + box.h * t, w: box.w * (1 - l - r), h: box.h * (1 - t - b) };
            }
            const src = child(blipFill, 'srcRect');
            const l = num(src, 'l', 0) / 100000, t = num(src, 't', 0) / 100000, r = num(src, 'r', 0) / 100000, b = num(src, 'b', 0) / 100000;
            const visW = 1 - l - r, visH = 1 - t - b;
            if (visW <= 0 || visH <= 0) { ctx.restore(); return; }
            const fullW = target.w / visW, fullH = target.h / visH;
            ctx.beginPath();
            ctx.rect(target.x, target.y, target.w, target.h);
            ctx.clip();
            ctx.drawImage(img, 0, 0, iw, ih, target.x - l * fullW, target.y - t * fullH, fullW, fullH);
            ctx.restore();
        }

        async drawGeometry(paths, paint, line, shadow, box) {
            const { ctx } = this;
            const strokeOn = line && line.paint && line.paint.type !== 'none';
            const fillOn = paint && paint.type !== 'none';
            const arrowTrim = (end) => {
                if (!strokeOn || !end || !['triangle', 'stealth', 'arrow'].includes(end.type)) return 0;
                const lw = Math.max(line.w, 0.5);
                const f = { sm: 2, med: 3, lg: 5 }[end.len] || 3;
                return end.type === 'arrow' ? lw / 2 : f * lw * (end.type === 'stealth' ? 0.6 : 0.9);
            };

            if (shadow) {
                this.withShadow(shadow, () => {
                    ctx.fillStyle = '#000';
                    ctx.strokeStyle = '#000';
                    for (const p of paths) {
                        const p2 = cmdsToPath2D(p.cmds);
                        if (fillOn && p.fill !== 'none') ctx.fill(p2);
                        else if (strokeOn && p.stroke) { ctx.lineWidth = Math.max(line.w, 1 / this.scale); ctx.stroke(p2); }
                    }
                });
            }

            for (const p of paths) {
                if (!fillOn || p.fill === 'none') continue;
                let pp = paint;
                if (p.fill !== 'norm' && paint.type === 'solid') {
                    const t = { lighten: [1, 0.4], lightenLess: [1, 0.2], darken: [0, 0.4], darkenLess: [0, 0.2] }[p.fill];
                    if (t) pp = { type: 'solid', color: mix(paint.color, t[0] ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 }, t[1]) };
                }
                await this.fillPath(cmdsToPath2D(p.cmds), pp, box, 'evenodd');
            }
            if (!strokeOn) return;
            const lw = line.w > 0 ? line.w : 1 / this.scale;
            ctx.save();
            ctx.lineWidth = lw;
            ctx.lineCap = line.cap;
            ctx.lineJoin = line.join;
            ctx.miterLimit = 8;
            if (line.dash) ctx.setLineDash(line.dash.map((d) => d * lw));
            const strokeStyle = line.paint.type === 'solid' ? css(line.paint.color)
                : line.paint.type === 'grad' ? css(line.paint.stops[0].color) : line.paint.type === 'patt' ? css(line.paint.fg) : '#000';
            ctx.strokeStyle = strokeStyle;
            ctx.fillStyle = strokeStyle;
            const stroked = paths.filter((p) => p.stroke);
            stroked.forEach((p, i) => {
                const isLast = i === stroked.length - 1;
                const ends = pathEnds(p.cmds);
                const trimS = i === 0 ? arrowTrim(line.head) : 0;
                const trimE = isLast ? arrowTrim(line.tail) : 0;
                ctx.stroke(cmdsToPath2D(p.cmds, trimS, trimE));
                if (ends) {
                    ctx.setLineDash([]);
                    if (i === 0 && line.head) this.drawArrow(line.head, ends.start, ends.afterStart, lw);
                    if (isLast && line.tail) this.drawArrow(line.tail, ends.end, ends.beforeEnd, lw);
                    if (line.dash) ctx.setLineDash(line.dash.map((d) => d * lw));
                }
            });
            ctx.restore();
        }

        drawArrow(end, tip, from, lw) {
            const { ctx } = this;
            const dx = tip[0] - from[0], dy = tip[1] - from[1];
            const d = Math.hypot(dx, dy);
            if (!d) return;
            const ux = dx / d, uy = dy / d, px = -uy, py = ux;
            const base = Math.max(lw, 0.75);
            const W = ({ sm: 2, med: 3, lg: 5 }[end.w] || 3) * base;
            const L = ({ sm: 2, med: 3, lg: 5 }[end.len] || 3) * base;
            const [tx, ty] = tip;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'miter';
            const p = new Path2D();
            switch (end.type) {
                case 'triangle':
                    p.moveTo(tx, ty); p.lineTo(tx - ux * L + px * W / 2, ty - uy * L + py * W / 2); p.lineTo(tx - ux * L - px * W / 2, ty - uy * L - py * W / 2); p.closePath();
                    ctx.fill(p); break;
                case 'stealth':
                    p.moveTo(tx, ty); p.lineTo(tx - ux * L + px * W / 2, ty - uy * L + py * W / 2); p.lineTo(tx - ux * L * 0.6, ty - uy * L * 0.6); p.lineTo(tx - ux * L - px * W / 2, ty - uy * L - py * W / 2); p.closePath();
                    ctx.fill(p); break;
                case 'arrow':
                    p.moveTo(tx - ux * L + px * W / 2, ty - uy * L + py * W / 2); p.lineTo(tx, ty); p.lineTo(tx - ux * L - px * W / 2, ty - uy * L - py * W / 2);
                    ctx.stroke(p); break;
                case 'oval':
                    p.ellipse(tx, ty, W / 2, L / 2, Math.atan2(uy, ux) + Math.PI / 2, 0, Math.PI * 2);
                    ctx.fill(p); break;
                case 'diamond':
                    p.moveTo(tx + ux * L / 2, ty + uy * L / 2); p.lineTo(tx + px * W / 2, ty + py * W / 2); p.lineTo(tx - ux * L / 2, ty - uy * L / 2); p.lineTo(tx - px * W / 2, ty - py * W / 2); p.closePath();
                    ctx.fill(p); break;
                default: break;
            }
            ctx.restore();
        }

        async paintPicture(el, fc, map) {
            if (this.isHidden(el)) return;
            const nv = this.nvProps(el);
            const phEl = dig(nv, 'nvPr', 'ph');
            if (phEl && fc.kind !== 'slide') return;
            const inh = phEl ? this.findInherited(phEl) : { layout: null, master: null };
            const spPr = child(el, 'spPr');
            const spPrs = [inh.master && child(inh.master, 'spPr'), inh.layout && child(inh.layout, 'spPr'), spPr];
            const xf = this.parseXfrm(lastDefined(spPrs.map((s) => child(s, 'xfrm'))));
            if (!xf) return;
            const rect = map(xf.off, xf.ext);
            const blipFill = child(el, 'blipFill');
            const blip = child(blipFill, 'blip');
            const img = await this.deck.blipImage(blip, fc.part);
            const geomEl = lastDefined(spPrs.map((s) => child(s, 'prstGeom') || child(s, 'custGeom')));
            const geom = this.geometry(geomEl, rect.w, rect.h);
            const styleEl = child(el, 'style');
            const lnPairs = [];
            const lnRef = child(styleEl, 'lnRef');
            if (lnRef && num(lnRef, 'idx', 0) > 0) lnPairs.push([this.theme.line[num(lnRef, 'idx', 0) - 1], { ...this.cctx, phClr: firstColor(lnRef, this.cctx) }]);
            spPrs.forEach((s) => lnPairs.push([child(s, 'ln'), this.cctx]));
            const line = parseLine(lnPairs, fc.part);
            const shadow = this.shadowFor(spPrs, styleEl);
            let bgPaint = null;
            for (const s of spPrs) { const f = fillElOf(s); if (f) bgPaint = parsePaint(f, this.cctx, fc.part); }

            const { ctx } = this;
            ctx.save();
            this.applyXfrm(rect, xf.rot, xf.flipH, xf.flipV);
            const box = { x: 0, y: 0, w: rect.w, h: rect.h };
            const clip = new Path2D();
            geom.paths.filter((p) => p.fill !== 'none').forEach((p) => clip.addPath(cmdsToPath2D(p.cmds)));
            const isRect = !geom.prst || geom.prst === 'rect';
            if (shadow && img) {
                this.withShadow(shadow, () => {
                    ctx.save();
                    if (!isRect) ctx.clip(clip);
                    this.drawBlip(img, blipFill, box);
                    ctx.restore();
                });
            }
            if (bgPaint && bgPaint.type !== 'none') await this.fillPath(clip, bgPaint, box, 'nonzero');
            if (img) {
                ctx.save();
                ctx.clip(clip);
                this.drawBlip(img, blipFill, box);
                ctx.restore();
            }
            if (line) await this.drawGeometry(geom.paths, null, line, null, box);
            ctx.restore();
        }

        async paintGroup(el, fc, map) {
            if (this.isHidden(el)) return;
            const xf = this.parseXfrm(dig(el, 'grpSpPr', 'xfrm'));
            const { ctx } = this;
            let groupFill = null;
            const f = fillElOf(child(el, 'grpSpPr'));
            if (f) groupFill = parsePaint(f, this.cctx, fc.part);
            if (!xf) {
                await this.paintTree(el, { ...fc, groupFill }, map);
                return;
            }
            const rect = map(xf.off, xf.ext);
            const chOff = xf.chOff || xf.off;
            const chExt = xf.chExt || xf.ext;
            const sx = chExt.cx ? rect.w / emu2pt(chExt.cx) : 1;
            const sy = chExt.cy ? rect.h / emu2pt(chExt.cy) : 1;
            ctx.save();
            this.applyXfrm(rect, xf.rot, xf.flipH, xf.flipV);
            const childMap = (off, ext) => ({
                x: (emu2pt(off.x) - emu2pt(chOff.x)) * sx,
                y: (emu2pt(off.y) - emu2pt(chOff.y)) * sy,
                w: emu2pt(ext.cx) * sx,
                h: emu2pt(ext.cy) * sy
            });
            for (const c of children(el)) {
                if (c.localName === 'nvGrpSpPr' || c.localName === 'grpSpPr') continue;
                try { await this.paintElement(c, { ...fc, groupFill: groupFill || fc.groupFill }, childMap); } catch (err) { console.warn('PPTX: skipped group child', err); }
            }
            ctx.restore();
        }

        async paintGraphicFrame(el, fc, map) {
            if (this.isHidden(el)) return;
            const xf = this.parseXfrm(child(el, 'xfrm'));
            if (!xf) return;
            const rect = map(xf.off, xf.ext);
            const gd = dig(el, 'graphic', 'graphicData');
            if (!gd) return;
            const uri = attr(gd, 'uri') || '';
            const { ctx } = this;
            if (/table$/.test(uri)) {
                const tbl = child(gd, 'tbl');
                if (!tbl) return;
                ctx.save();
                this.applyXfrm(rect, xf.rot, xf.flipH, xf.flipV);
                await this.paintTable(tbl, rect, fc);
                ctx.restore();
            } else if (/diagram$/.test(uri)) {
                await this.paintDiagram(gd, rect, xf, fc);
            } else if (/chart$/.test(uri)) {
                const rid = relAttr(child(gd, 'chart'), 'id');
                const rel = rid && fc.part.rels.get(rid);
                if (rel) {
                    const chartPart = await this.deck.part(rel.target).catch(() => null);
                    if (chartPart) {
                        ctx.save();
                        this.applyXfrm(rect, xf.rot, false, false);
                        await this.paintChart(chartPart, { x: 0, y: 0, w: rect.w, h: rect.h });
                        ctx.restore();
                    }
                }
            } else {
                // OLE objects & others: render any preview picture they carry.
                const ole = Array.from(gd.getElementsByTagName('*')).find((e) => e.localName === 'pic');
                if (ole) {
                    const blipFill = child(ole, 'blipFill');
                    const img = await this.deck.blipImage(child(blipFill, 'blip'), fc.part);
                    if (img) {
                        ctx.save();
                        this.applyXfrm(rect, xf.rot, xf.flipH, xf.flipV);
                        this.drawBlip(img, blipFill, { x: 0, y: 0, w: rect.w, h: rect.h });
                        ctx.restore();
                    }
                }
            }
        }

        async paintDiagram(gd, rect, xf, fc) {
            const relIds = child(gd, 'relIds');
            const dmRel = fc.part.rels.get(relAttr(relIds, 'dm'));
            let drawingPath = null;
            if (dmRel) {
                const dm = await this.deck.xml(dmRel.target).catch(() => null);
                const ext = dm && Array.from(dm.getElementsByTagName('*')).find((e) => e.localName === 'dataModelExt');
                const rid = ext && attr(ext, 'relId');
                const r = rid && fc.part.rels.get(rid);
                if (r) drawingPath = r.target;
            }
            if (!drawingPath) {
                const drawings = Array.from(fc.part.rels.values()).filter((r) => /diagramDrawing$/.test(r.type));
                if (drawings.length === 1) drawingPath = drawings[0].target;
            }
            if (!drawingPath) return;
            const part = await this.deck.part(drawingPath).catch(() => null);
            if (!part) return;
            const tree = child(part.root, 'spTree');
            const { ctx } = this;
            ctx.save();
            this.applyXfrm(rect, xf.rot, xf.flipH, xf.flipV);
            const childMap = (off, ext) => ({ x: emu2pt(off.x), y: emu2pt(off.y), w: emu2pt(ext.cx), h: emu2pt(ext.cy) });
            for (const c of children(tree)) {
                try {
                    if (c.localName === 'sp') await this.paintShape(c, { kind: 'drawing', part }, childMap, { txXfrm: child(c, 'txXfrm') });
                    else await this.paintElement(c, { kind: 'drawing', part }, childMap);
                } catch (err) { console.warn('PPTX: skipped diagram shape', err); }
            }
            ctx.restore();
        }

        /* ---------------- tables ---------------- */

        async paintTable(tbl, rect, fc) {
            const { ctx } = this;
            const tblPr = child(tbl, 'tblPr');
            const cols = children(child(tbl, 'tblGrid'), 'gridCol').map((c) => emu2pt(num(c, 'w', 0)));
            const rows = children(tbl, 'tr');
            const flags = {
                firstRow: bool(tblPr, 'firstRow', false), lastRow: bool(tblPr, 'lastRow', false),
                firstCol: bool(tblPr, 'firstCol', false), lastCol: bool(tblPr, 'lastCol', false),
                bandRow: bool(tblPr, 'bandRow', false), bandCol: bool(tblPr, 'bandCol', false)
            };
            const styleIdEl = child(tblPr, 'tableStyleId');
            const styleId = styleIdEl ? styleIdEl.textContent.trim() : null;
            let style = styleId ? this.deck.tableStyles.get(styleId) : null;
            if (!style && styleId === '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}') {
                style = parseXml(TABLE_STYLE_MEDIUM2).documentElement;
            }
            const nRows = rows.length, nCols = cols.length;
            const partsFor = (r, c) => {
                const list = ['wholeTbl'];
                if (flags.bandCol) {
                    const ci = c - (flags.firstCol ? 1 : 0);
                    if (!(flags.firstCol && c === 0) && !(flags.lastCol && c === nCols - 1)) list.push(ci % 2 === 0 ? 'band1V' : 'band2V');
                }
                if (flags.bandRow) {
                    const ri = r - (flags.firstRow ? 1 : 0);
                    if (!(flags.firstRow && r === 0) && !(flags.lastRow && r === nRows - 1)) list.push(ri % 2 === 0 ? 'band1H' : 'band2H');
                }
                if (flags.lastCol && c === nCols - 1) list.push('lastCol');
                if (flags.firstCol && c === 0) list.push('firstCol');
                if (flags.lastRow && r === nRows - 1) list.push('lastRow');
                if (flags.firstRow && r === 0) list.push('firstRow');
                return list.map((n) => child(style, n)).filter(Boolean);
            };
            const stylePaint = (tcStyle) => {
                const fillWrap = child(tcStyle, 'fill');
                if (fillWrap) return parsePaint(fillElOf(fillWrap), this.cctx, fc.part);
                const fr = child(tcStyle, 'fillRef');
                return fr ? this.styleFill(fr) : null;
            };
            const styleLine = (bdr, side) => {
                const s = child(bdr, side);
                if (!s) return undefined;
                const ln = child(s, 'ln');
                if (ln) return parseLine([[ln, this.cctx]], fc.part);
                const lr = child(s, 'lnRef');
                if (lr) return parseLine([[this.theme.line[num(lr, 'idx', 1) - 1], { ...this.cctx, phClr: firstColor(lr, this.cctx) }]], fc.part);
                return undefined;
            };

            // Row heights grow to fit content.
            const heights = rows.map((tr) => emu2pt(num(tr, 'h', 0)));
            const cells = [];
            for (let r = 0; r < nRows; r++) {
                const tcs = children(rows[r], 'tc');
                for (let c = 0; c < tcs.length && c < nCols; c++) {
                    const tc = tcs[c];
                    if (bool(tc, 'hMerge', false) || bool(tc, 'vMerge', false)) continue;
                    const gs = num(tc, 'gridSpan', 1), rs = num(tc, 'rowSpan', 1);
                    const parts = style ? partsFor(r, c) : [];
                    const tcPr = child(tc, 'tcPr');
                    const txt = {};
                    parts.forEach((p) => {
                        const ts = child(p, 'tcTxStyle');
                        if (!ts) return;
                        if (ts.hasAttribute('b')) txt.b = bool(ts, 'b', false);
                        if (ts.hasAttribute('i')) txt.i = bool(ts, 'i', false);
                        const ce = colorElOf(ts);
                        if (ce) txt.fillColor = resolveColorEl(ce, this.cctx);
                        const fr = child(ts, 'fontRef');
                        if (fr) txt.latin = attr(fr, 'idx') === 'major' ? '+mj-lt' : '+mn-lt';
                    });
                    const width = cols.slice(c, c + gs).reduce((a, b) => a + b, 0);
                    const mar = {
                        l: emu2pt(num(tcPr, 'marL', 91440)), r: emu2pt(num(tcPr, 'marR', 91440)),
                        t: emu2pt(num(tcPr, 'marT', 45720)), b: emu2pt(num(tcPr, 'marB', 45720))
                    };
                    const cell = { r, c, gs, rs, tc, tcPr, parts, txt, width, mar };
                    cells.push(cell);
                    const txBody = child(tc, 'txBody');
                    if (txBody) {
                        const layers = [{ lst: this.deck.defaultTextStyle }, { lst: this.masterTxStyle('other') }, { rPr: txt }, { lst: child(txBody, 'lstStyle') }];
                        cell.layers = layers;
                        const h = this.measureTextHeight(txBody, width - mar.l - mar.r, layers) + mar.t + mar.b;
                        if (rs === 1 && h > heights[r]) heights[r] = h;
                    }
                }
            }
            const colX = [0];
            cols.forEach((w, i) => colX.push(colX[i] + w));
            const rowY = [0];
            heights.forEach((h, i) => rowY.push(rowY[i] + h));

            // Fills
            for (const cell of cells) {
                const x = colX[cell.c], y = rowY[cell.r];
                const w = colX[Math.min(nCols, cell.c + cell.gs)] - x, h = rowY[Math.min(nRows, cell.r + cell.rs)] - y;
                cell.box = { x, y, w, h };
                let paint = null;
                cell.parts.forEach((p) => { const pp = stylePaint(child(p, 'tcStyle')); if (pp) paint = pp; });
                const own = fillElOf(cell.tcPr);
                if (own) paint = parsePaint(own, this.cctx, fc.part);
                if (paint && paint.type !== 'none') {
                    const path = new Path2D(); path.rect(x, y, w, h);
                    await this.fillPath(path, paint, cell.box, 'nonzero');
                }
            }
            // Text
            for (const cell of cells) {
                const txBody = child(cell.tc, 'txBody');
                if (!txBody || !this.hasText(txBody)) continue;
                const { x, y, w, h } = cell.box;
                const anchor = attr(cell.tcPr, 'anchor') || 't';
                const vert = attr(cell.tcPr, 'vert');
                const bodyPr = parseXml(`<a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" lIns="${Math.round(cell.mar.l * EMU_PER_PT)}" rIns="${Math.round(cell.mar.r * EMU_PER_PT)}" tIns="${Math.round(cell.mar.t * EMU_PER_PT)}" bIns="${Math.round(cell.mar.b * EMU_PER_PT)}" anchor="${anchor}"${vert ? ` vert="${vert}"` : ''}/>`).documentElement;
                await this.drawTextBody(txBody, { x, y, w, h }, { layers: cell.layers, bodyPrs: [bodyPr], part: fc.part });
            }
            // Borders
            const drawBorder = (line, x1, y1, x2, y2) => {
                if (!line || !line.paint || line.paint.type === 'none') return;
                ctx.save();
                ctx.lineWidth = Math.max(line.w, 1 / this.scale);
                ctx.strokeStyle = line.paint.type === 'solid' ? css(line.paint.color) : '#000';
                if (line.dash) ctx.setLineDash(line.dash.map((d) => d * line.w));
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                ctx.restore();
            };
            for (const cell of cells) {
                const { x, y, w, h } = cell.box;
                const sides = { lnL: undefined, lnR: undefined, lnT: undefined, lnB: undefined };
                const endR = cell.r + cell.rs - 1, endC = cell.c + cell.gs - 1;
                cell.parts.forEach((p) => {
                    const bdr = dig(p, 'tcStyle', 'tcBdr');
                    if (!bdr) return;
                    const pick = (side, inner, isEdge) => { const v = styleLine(bdr, isEdge ? side : inner); return v; };
                    const L = pick('left', 'insideV', cell.c === 0), R = pick('right', 'insideV', endC === nCols - 1);
                    const T = pick('top', 'insideH', cell.r === 0), B = pick('bottom', 'insideH', endR === nRows - 1);
                    if (L !== undefined) sides.lnL = L; if (R !== undefined) sides.lnR = R;
                    if (T !== undefined) sides.lnT = T; if (B !== undefined) sides.lnB = B;
                    // Part-specific edges (e.g. firstRow bottom) override inside borders.
                    if (p.localName !== 'wholeTbl') {
                        const l2 = styleLine(bdr, 'left'), r2 = styleLine(bdr, 'right'), t2 = styleLine(bdr, 'top'), b2 = styleLine(bdr, 'bottom');
                        if (l2 !== undefined) sides.lnL = l2; if (r2 !== undefined) sides.lnR = r2;
                        if (t2 !== undefined) sides.lnT = t2; if (b2 !== undefined) sides.lnB = b2;
                    }
                });
                for (const k of ['lnL', 'lnR', 'lnT', 'lnB']) {
                    const own = child(cell.tcPr, k);
                    if (own) sides[k] = parseLine([[own, this.cctx]], fc.part);
                }
                drawBorder(sides.lnT, x, y, x + w, y);
                drawBorder(sides.lnB, x, y + h, x + w, y + h);
                drawBorder(sides.lnL, x, y, x, y + h);
                drawBorder(sides.lnR, x + w, y, x + w, y + h);
            }
        }

        /* ---------------- charts (basic) ---------------- */

        async paintChart(part, box) {
            const { ctx } = this;
            const root = part.root;
            const chart = child(root, 'chart');
            const plotArea = child(chart, 'plotArea');
            if (!plotArea) return;
            const cctx = this.cctx;
            const fonts = this.deck.fonts;
            const accentHex = (i) => this.theme.colors['accent' + ((i % 6) + 1)] || '4472C4';
            const defaultSeriesColor = (i) => {
                const base = hexColor(accentHex(i));
                const cycle = Math.floor(i / 6);
                if (!cycle) return base;
                return cycle % 2 ? mix(base, { r: 0, g: 0, b: 0 }, 0.4) : mix(base, { r: 1, g: 1, b: 1 }, 0.4);
            };

            // ---- text styles ----
            const spaceDef = dig(root, 'txPr', 'p', 'pPr', 'defRPr');
            const defRPrOf = (el) => dig(el, 'txPr', 'p', 'pPr', 'defRPr') || dig(el, 'tx', 'rich', 'p', 'pPr', 'defRPr');
            const textStyle = (el, fallbackSz, fallbackBold) => {
                const r = { sz: fallbackSz, b: fallbackBold, i: false, latin: '+mn-lt' };
                const grey = resolveColorEl(parseXml('<a:schemeClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>').documentElement, cctx);
                r.fillColor = grey;
                for (const d of [spaceDef, el]) {
                    if (!d) continue;
                    if (d.hasAttribute('sz')) r.sz = num(d, 'sz', 1000) / 100;
                    if (d.hasAttribute('b')) r.b = bool(d, 'b', false);
                    if (d.hasAttribute('i')) r.i = bool(d, 'i', false);
                    const f = fillElOf(d);
                    if (f && f.localName === 'solidFill') r.fillColor = firstColor(f, cctx) || r.fillColor;
                    const lat = attr(child(d, 'latin'), 'typeface');
                    if (lat) r.latin = lat;
                }
                return this.runStyle(r, 1);
            };
            const setFont = (st) => { ctx.font = st.font; ctx.fillStyle = css(st.color); };
            const textW = (st, t) => this.measure(st, t);
            const drawText = (st, t, x, y, align = 'left', baseline = 'alphabetic') => {
                if (!t) return;
                setFont(st);
                ctx.textAlign = align;
                ctx.textBaseline = baseline;
                ctx.fillText(t, x, y);
                const w = textW(st, t);
                const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
                const yb = baseline === 'middle' ? y + st.size * 0.35 : baseline === 'top' ? y + st.size * 0.8 : y;
                this.recordText(t, x0, yb, w, st.size);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
            };
            const wrapWords = (st, t, maxW) => {
                const words = String(t).split(/\s+/).filter(Boolean);
                const lines = [];
                let cur = '';
                for (const wd of words) {
                    const test = cur ? cur + ' ' + wd : wd;
                    if (cur && textW(st, test) > maxW) { lines.push(cur); cur = wd; } else cur = test;
                }
                if (cur) lines.push(cur);
                return lines.length ? lines : [''];
            };

            // ---- number formats ----
            const fmtNumber = (v, code) => {
                if (v == null || !Number.isFinite(v)) return '';
                let c = String(code || 'General').split(';')[v < 0 ? 1 : 0] || String(code || 'General').split(';')[0];
                if (/^general$/i.test(c.trim())) {
                    const a = Math.abs(v);
                    if (a !== 0 && (a >= 1e11 || a < 1e-9)) return v.toExponential(2);
                    return String(+v.toPrecision(10));
                }
                const pct = /%/.test(c);
                let x = pct ? v * 100 : v;
                c = c.replace(/\[[^\]]*\]/g, (m) => { const cur = m.match(/^\[\$([^-\]]*)/); return cur ? cur[1] : ''; });
                const lits = [];
                c = c.replace(/"([^"]*)"/g, (_, s) => { lits.push(s); return `\u0000${lits.length - 1}\u0000`; }).replace(/\\(.)/g, (_, s) => { lits.push(s); return `\u0000${lits.length - 1}\u0000`; });
                const m = c.match(/[#0?,]*\.?[#0?]*(E\+?0+)?/i) || [''];
                let core = '';
                for (const mm of c.matchAll(/[#0?,.]+/g)) { if (/[0#?]/.test(mm[0])) { core = mm[0]; break; } }
                void m;
                const dec = core.includes('.') ? (core.split('.')[1].match(/[0#?]/g) || []).length : 0;
                const minDec = core.includes('.') ? (core.split('.')[1].match(/0/g) || []).length : 0;
                const thousands = /[0#],[0#]/.test(core);
                const scaleCommas = (core.match(/,+$/) || [''])[0].length;
                if (scaleCommas) x /= Math.pow(1000, scaleCommas);
                let s = Math.abs(x).toFixed(dec);
                if (dec > minDec) s = s.replace(new RegExp(`0{1,${dec - minDec}}$`), '').replace(/\.$/, '');
                if (thousands) { const [ip, fp] = s.split('.'); s = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fp ? '.' + fp : ''); }
                let out = core ? c.replace(core, s) : c + s;
                out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => lits[+i]).replace(/[_*]./g, '');
                if (v < 0 && !String(code).includes(';')) out = '-' + out;
                return out.trim();
            };

            // ---- data extraction ----
            const cache = (el) => dig(el, 'numRef', 'numCache') || dig(el, 'strRef', 'strCache') || child(el, 'numLit') || child(el, 'strLit') || dig(el, 'multiLvlStrRef', 'multiLvlStrCache', 'lvl');
            const values = (el) => {
                const c = cache(el);
                const out = [];
                children(c, 'pt').forEach((pt) => { const v = parseFloat((child(pt, 'v') || {}).textContent); out[num(pt, 'idx', 0)] = Number.isFinite(v) ? v : null; });
                const n = num(child(c, 'ptCount'), 'val', out.length);
                for (let i = 0; i < n; i++) if (out[i] === undefined) out[i] = null;
                return { vals: out, format: (child(c, 'formatCode') || {}).textContent || 'General' };
            };
            const labels = (el) => {
                const c = cache(el);
                const out = [];
                const fc = (child(c, 'formatCode') || {}).textContent;
                children(c, 'pt').forEach((pt) => {
                    const raw = (child(pt, 'v') || {}).textContent || '';
                    const f = attr(pt, 'formatCode') || fc;
                    out[num(pt, 'idx', 0)] = f && /[0#]/.test(f) && raw !== '' && Number.isFinite(+raw) ? fmtNumber(+raw, f) : raw;
                });
                const n = num(child(c, 'ptCount'), 'val', out.length);
                for (let i = 0; i < n; i++) if (out[i] === undefined) out[i] = '';
                return out;
            };
            const seriesColor = (ser, i, forLine) => {
                const sp = child(ser, 'spPr');
                const f = parsePaint(fillElOf(sp), cctx, part);
                const lnF = parsePaint(fillElOf(child(sp, 'ln')), cctx, part);
                if (forLine && lnF && lnF.type === 'solid') return lnF.color;
                if (f && f.type === 'solid') return f.color;
                if (f && f.type === 'grad') return f.stops[0].color;
                if (lnF && lnF.type === 'solid') return lnF.color;
                return defaultSeriesColor(num(child(ser, 'idx'), 'val', i));
            };
            const pointColor = (ser, idx, fallback) => {
                const dpt = children(ser, 'dPt').find((d) => num(child(d, 'idx'), 'val', -1) === idx);
                const f = dpt && parsePaint(fillElOf(child(dpt, 'spPr')), cctx, part);
                return f && f.type === 'solid' ? f.color : fallback;
            };

            const groups = children(plotArea).filter((c) => /Chart$/.test(c.localName));
            if (!groups.length) return;
            const allSeries = [];
            groups.forEach((g) => children(g, 'ser').forEach((s) => allSeries.push({ g, s })));

            // ---- chart space background ----
            const spaceBg = parsePaint(fillElOf(child(root, 'spPr')), cctx, part);
            if (spaceBg && spaceBg.type !== 'none') { const p = new Path2D(); p.rect(box.x, box.y, box.w, box.h); await this.fillPath(p, spaceBg, box, 'nonzero'); }

            const pad = Math.min(box.w, box.h) * 0.03 + 4;
            let inner = { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 };

            // ---- title ----
            const titleEl = child(chart, 'title');
            const autoDeleted = bool(child(chart, 'autoTitleDeleted'), 'val', false);
            let titleText = '';
            let titleStyle = null;
            if (titleEl) {
                const rich = dig(titleEl, 'tx', 'rich');
                if (rich) titleText = children(rich, 'p').map((p) => Array.from(p.getElementsByTagName('*')).filter((e) => e.localName === 't').map((e) => e.textContent).join('')).join('\n');
                else if (dig(titleEl, 'tx', 'strRef')) titleText = labels(child(titleEl, 'tx'))[0] || '';
                else if (allSeries.length === 1) titleText = labels(child(allSeries[0].s, 'tx'))[0] || '';
                const firstRun = rich && Array.from(rich.getElementsByTagName('*')).find((e) => e.localName === 'rPr');
                titleStyle = textStyle(defRPrOf(titleEl), 14, false);
                if (firstRun) {
                    const r2 = { sz: titleStyle.size, b: titleStyle.weight >= 600, latin: '+mn-lt', fillColor: titleStyle.color };
                    mergeRPr(r2, firstRun);
                    if (!r2.fill) r2.fillColor = titleStyle.color;
                    titleStyle = this.runStyle(r2, 1);
                }
            } else if (!autoDeleted && allSeries.length === 1 && groups[0].localName.startsWith('pie')) {
                titleText = labels(child(allSeries[0].s, 'tx'))[0] || '';
                titleStyle = textStyle(null, 14, false);
            }
            if (autoDeleted && !titleEl) titleText = '';
            if (titleText && titleStyle) {
                const lines = titleText.split('\n').flatMap((l) => wrapWords(titleStyle, l, inner.w * 0.9));
                const lh = titleStyle.size * 1.2;
                const ml = dig(titleEl, 'layout', 'manualLayout');
                let tx0 = box.x + box.w / 2, ty0 = inner.y;
                const widest = Math.max(...lines.map((l) => textW(titleStyle, l)));
                if (ml && attr(child(ml, 'xMode'), 'val') !== 'factor') {
                    tx0 = box.x + num(child(ml, 'x'), 'val', 0) * box.w + widest / 2;
                    ty0 = box.y + num(child(ml, 'y'), 'val', 0) * box.h;
                }
                lines.forEach((l, i) => drawText(titleStyle, l, tx0, ty0 + lh * i + titleStyle.size * 0.95, 'center'));
                if (!bool(child(titleEl, 'overlay'), 'val', false)) {
                    const used = ty0 + lh * lines.length + 4 - inner.y;
                    inner = { x: inner.x, y: inner.y + used, w: inner.w, h: inner.h - used };
                }
            }

            // ---- legend ----
            const legendEl = child(chart, 'legend');
            const isPieLike = groups.some((g) => /^(pie|doughnut|pie3D|ofPie)Chart$/.test(g.localName));
            let legendItems = [];
            if (legendEl) {
                if (isPieLike && allSeries.length) {
                    const s = allSeries[0].s;
                    const cats = labels(child(s, 'cat'));
                    const vary = bool(child(allSeries[0].g, 'varyColors'), 'val', true);
                    legendItems = cats.map((c, i) => ({ text: c, color: pointColor(s, i, vary ? defaultSeriesColor(i) : seriesColor(s, 0)), kind: 'box' }));
                } else {
                    legendItems = allSeries.map(({ g, s }, i) => ({
                        text: labels(child(s, 'tx'))[0] || `Series${i + 1}`,
                        color: seriesColor(s, i, /line|scatter|radar/i.test(g.localName)),
                        kind: /line|scatter|radar/i.test(g.localName) ? 'line' : 'box'
                    }));
                }
                const deleted = new Set(children(legendEl, 'legendEntry').filter((e) => bool(child(e, 'delete'), 'val', false)).map((e) => num(child(e, 'idx'), 'val', -1)));
                legendItems = legendItems.filter((_, i) => !deleted.has(i));
            }
            if (legendItems.length) {
                const st = textStyle(defRPrOf(legendEl), 10, false);
                const pos = attr(child(legendEl, 'legendPos'), 'val') || 'r';
                const sw = st.size * 0.7, gap = st.size * 0.6;
                const itemW = (it) => sw + 4 + textW(st, it.text);
                const lh = st.size * 1.35;
                const ml = dig(legendEl, 'layout', 'manualLayout');
                const overlay = bool(child(legendEl, 'overlay'), 'val', false);
                const drawItem = (it, x, y) => {
                    ctx.fillStyle = css(it.color);
                    if (it.kind === 'line') ctx.fillRect(x, y - st.size * 0.3, sw + 2, Math.max(1.5, st.size * 0.12));
                    else ctx.fillRect(x, y - st.size * 0.62, sw, sw);
                    drawText(st, it.text, x + sw + 4, y);
                };
                if (pos === 'r' || pos === 'l' || pos === 'tr') {
                    const colW = Math.max(...legendItems.map(itemW));
                    const totalH = legendItems.length * lh;
                    let lx = pos === 'l' ? inner.x : inner.x + inner.w - colW;
                    let ly = inner.y + (inner.h - totalH) / 2 + st.size;
                    if (ml && attr(child(ml, 'xMode'), 'val') !== 'factor' && child(ml, 'x')) {
                        lx = box.x + num(child(ml, 'x'), 'val', 0) * box.w;
                        ly = box.y + num(child(ml, 'y'), 'val', 0) * box.h + st.size;
                    }
                    if (pos === 'tr') ly = inner.y + st.size;
                    legendItems.forEach((it, i) => drawItem(it, lx, ly + i * lh));
                    if (!overlay) {
                        if (pos === 'l') inner = { x: inner.x + colW + gap, y: inner.y, w: inner.w - colW - gap, h: inner.h };
                        else inner = { x: inner.x, y: inner.y, w: inner.w - colW - gap, h: inner.h };
                    }
                } else {
                    // Horizontal legend rows (top / bottom).
                    const rows = [[]];
                    let rowW = 0;
                    for (const it of legendItems) {
                        const w = itemW(it) + gap * 1.5;
                        if (rowW + w > inner.w && rows[rows.length - 1].length) { rows.push([]); rowW = 0; }
                        rows[rows.length - 1].push(it);
                        rowW += w;
                    }
                    const totalH = rows.length * lh;
                    let ly = pos === 't' ? inner.y + st.size : inner.y + inner.h - totalH + st.size;
                    if (ml && attr(child(ml, 'yMode'), 'val') !== 'factor' && child(ml, 'y')) ly = box.y + num(child(ml, 'y'), 'val', 0) * box.h + st.size;
                    rows.forEach((row, ri) => {
                        const w = row.reduce((a, it) => a + itemW(it) + gap * 1.5, -gap * 1.5);
                        let lx = inner.x + (inner.w - w) / 2;
                        row.forEach((it) => { drawItem(it, lx, ly + ri * lh); lx += itemW(it) + gap * 1.5; });
                    });
                    if (!overlay) {
                        if (pos === 't') inner = { x: inner.x, y: inner.y + totalH + gap, w: inner.w, h: inner.h - totalH - gap };
                        else inner = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - totalH - gap };
                    }
                }
            }

            // ---- plot area rectangle ----
            const plotMl = dig(plotArea, 'layout', 'manualLayout');
            let plot = null;
            let plotIsInner = false;
            if (plotMl && child(plotMl, 'w') && attr(child(plotMl, 'xMode'), 'val') !== 'factor') {
                plot = {
                    x: box.x + num(child(plotMl, 'x'), 'val', 0) * box.w, y: box.y + num(child(plotMl, 'y'), 'val', 0) * box.h,
                    w: num(child(plotMl, 'w'), 'val', 1) * box.w, h: num(child(plotMl, 'h'), 'val', 1) * box.h
                };
                plotIsInner = attr(child(plotMl, 'layoutTarget'), 'val') === 'inner';
            }

            const plotSp = child(plotArea, 'spPr');

            // ---------------- pie / doughnut ----------------
            if (isPieLike) {
                const { g, s } = allSeries[0] || {};
                if (!s) return;
                const vals = values(child(s, 'val'));
                const cats = labels(child(s, 'cat'));
                const area = plot || inner;
                const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
                const r = Math.max(1, Math.min(area.w, area.h) / 2 * (plot ? 1 : 0.9));
                const hole = g.localName === 'doughnutChart' ? num(child(g, 'holeSize'), 'val', 50) / 100 : 0;
                const total = vals.vals.reduce((a, b) => a + Math.abs(b || 0), 0) || 1;
                const vary = bool(child(g, 'varyColors'), 'val', true);
                let a0 = -Math.PI / 2 + num(child(g, 'firstSliceAng'), 'val', 0) * DEG;
                const lnPaint = parsePaint(fillElOf(dig(s, 'spPr', 'ln')), cctx, part);
                const dl = child(s, 'dLbls') || child(g, 'dLbls');
                const dlSt = textStyle(defRPrOf(dl), 10, false);
                const labelsToDraw = [];
                vals.vals.forEach((v, i) => {
                    const sweep = Math.abs(v || 0) / total * Math.PI * 2;
                    const a1 = a0 + sweep;
                    ctx.fillStyle = css(pointColor(s, i, vary ? defaultSeriesColor(i) : seriesColor(s, 0)));
                    ctx.beginPath();
                    if (hole) { ctx.arc(cx, cy, r, a0, a1); ctx.arc(cx, cy, r * hole, a1, a0, true); } else { ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); }
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = lnPaint && lnPaint.type === 'solid' ? css(lnPaint.color) : '#ffffff';
                    ctx.lineWidth = lnPaint && lnPaint.type === 'none' ? 0 : 1;
                    if (ctx.lineWidth) ctx.stroke();
                    if (dl && (bool(child(dl, 'showVal'), 'val', false) || bool(child(dl, 'showPercent'), 'val', false) || bool(child(dl, 'showCatName'), 'val', false))) {
                        const parts = [];
                        if (bool(child(dl, 'showCatName'), 'val', false)) parts.push(cats[i]);
                        if (bool(child(dl, 'showVal'), 'val', false)) parts.push(fmtNumber(v, attr(child(dl, 'numFmt'), 'formatCode') || vals.format));
                        if (bool(child(dl, 'showPercent'), 'val', false)) parts.push(Math.round(Math.abs(v || 0) / total * 100) + '%');
                        const mid = (a0 + a1) / 2;
                        const rr = hole ? r * (1 + hole) / 2 : r * 0.65;
                        labelsToDraw.push([parts.join(', '), cx + Math.cos(mid) * rr, cy + Math.sin(mid) * rr]);
                    }
                    a0 = a1;
                });
                labelsToDraw.forEach(([t, x, y]) => drawText(dlSt, t, x, y, 'center', 'middle'));
                return;
            }

            // ---------------- axis-based charts ----------------
            const axes = new Map();
            for (const ax of children(plotArea).filter((c) => /Ax$/.test(c.localName))) axes.set(attr(child(ax, 'axId'), 'val'), ax);
            const g0 = groups[0];
            const axIds = children(g0, 'axId').map((a) => attr(a, 'val'));
            const isScatter = g0.localName === 'scatterChart' || g0.localName === 'bubbleChart';
            const catAx = isScatter ? axes.get(axIds[0]) : (axes.get(axIds[0]) && axes.get(axIds[0]).localName !== 'valAx' ? axes.get(axIds[0]) : Array.from(axes.values()).find((a) => a.localName !== 'valAx'));
            const valAx = isScatter ? axes.get(axIds[1]) : (Array.from(axes.values()).find((a) => a.localName === 'valAx' && axIds.includes(attr(child(a, 'axId'), 'val'))) || Array.from(axes.values()).find((a) => a.localName === 'valAx'));
            const horizontalBars = g0.localName.startsWith('bar') && attr(child(g0, 'barDir'), 'val') === 'bar';
            const grouping = attr(child(g0, 'grouping'), 'val') || 'clustered';
            const stacked = grouping === 'stacked' || grouping === 'percentStacked';
            const percent = grouping === 'percentStacked';

            const series = allSeries.filter((x) => x.g === g0).map(({ s }, i) => ({
                el: s, i,
                vals: values(child(s, isScatter ? 'yVal' : 'val')),
                xs: isScatter ? values(child(s, 'xVal')).vals : null,
                name: labels(child(s, 'tx'))[0] || `Series${i + 1}`,
                color: seriesColor(s, i, /line|scatter|radar/i.test(g0.localName))
            }));
            const cats = series.length ? labels(child(series[0].el, 'cat')) : [];
            const nCat = Math.max(cats.length, ...series.map((s) => s.vals.vals.length), 1);

            // value range
            let vmin = Infinity, vmax = -Infinity;
            if (percent) { vmin = 0; vmax = 1; } else if (stacked) {
                for (let c = 0; c < nCat; c++) {
                    let pos = 0, neg = 0;
                    series.forEach((s) => { const v = s.vals.vals[c] || 0; if (v >= 0) pos += v; else neg += v; });
                    vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
                }
            } else series.forEach((s) => s.vals.vals.forEach((v) => { if (v != null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); } }));
            if (!Number.isFinite(vmin)) { vmin = 0; vmax = 1; }
            const niceScale = (lo, hi, length, forceZero, minSpacing = 22) => {
                if (forceZero) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
                if (hi === lo) hi = lo + 1;
                const span0 = hi - lo;
                if (hi > 0) hi += span0 * 0.05;
                if (lo < 0) lo -= span0 * 0.05;
                const maxIntervals = Math.max(2, Math.min(10, Math.floor(length / minSpacing)));
                const raw = (hi - lo) / maxIntervals;
                const mag = Math.pow(10, Math.floor(Math.log10(raw)));
                const unit = [1, 2, 5, 10].map((k) => k * mag).find((u) => u >= raw - 1e-12) || mag * 10;
                return { min: Math.floor(lo / unit + 1e-9) * unit, max: Math.ceil(hi / unit - 1e-9) * unit, unit };
            };
            const scalingOf = (ax) => {
                const sc = child(ax, 'scaling');
                return {
                    min: child(sc, 'min') ? num(child(sc, 'min'), 'val', 0) : null, max: child(sc, 'max') ? num(child(sc, 'max'), 'val', 0) : null,
                    reverse: attr(child(sc, 'orientation'), 'val') === 'maxMin',
                    unit: child(ax, 'majorUnit') ? num(child(ax, 'majorUnit'), 'val', 0) : null
                };
            };
            const vs = scalingOf(valAx);
            const vLen = horizontalBars ? (plot ? plot.w : inner.w) : (plot ? plot.h : inner.h);
            const valSt0 = textStyle(defRPrOf(valAx), 10, false);
            const fmt0 = attr(child(valAx, 'numFmt'), 'formatCode') || (series[0] && series[0].vals.format) || 'General';
            const spacing = horizontalBars
                ? Math.max(...[vmin, vmax, (vmax - vmin) / 7].map((v) => this.measure(valSt0, fmtNumber(v, percent ? '0%' : fmt0)))) + valSt0.size * 1.6
                : valSt0.size * 2.4;
            const vScale = niceScale(vs.min != null ? vs.min : vmin, vs.max != null ? vs.max : vmax, vLen, vs.min == null, spacing);
            if (vs.min != null) vScale.min = vs.min;
            if (vs.max != null) vScale.max = vs.max;
            if (vs.unit) vScale.unit = vs.unit;
            if (percent && vs.max == null) { vScale.min = 0; vScale.max = 1; vScale.unit = vs.unit || 0.1; }

            // x scale for scatter
            let xScale = null;
            if (isScatter) {
                let xmin = Infinity, xmax = -Infinity;
                series.forEach((s) => (s.xs || []).forEach((v) => { if (v != null) { xmin = Math.min(xmin, v); xmax = Math.max(xmax, v); } }));
                if (!Number.isFinite(xmin)) { xmin = 0; xmax = nCat; }
                const xs = scalingOf(catAx);
                xScale = niceScale(xs.min != null ? xs.min : xmin, xs.max != null ? xs.max : xmax, plot ? plot.w : inner.w, xs.min == null && xmin >= 0);
                if (xs.min != null) xScale.min = xs.min;
                if (xs.max != null) xScale.max = xs.max;
            }

            const valFmt = (() => {
                const nf = child(valAx, 'numFmt');
                if (percent && (!nf || bool(nf, 'sourceLinked', false))) return '0%';
                if (nf && !(bool(nf, 'sourceLinked', false) && series[0])) return attr(nf, 'formatCode') || 'General';
                return (series[0] && series[0].vals.format) || attr(nf, 'formatCode') || 'General';
            })();
            const catFmt = attr(child(catAx, 'numFmt'), 'formatCode') || 'General';
            const valDeleted = bool(child(valAx, 'delete'), 'val', false);
            const catDeleted = bool(child(catAx, 'delete'), 'val', false);
            const valLblNone = attr(child(valAx, 'tickLblPos'), 'val') === 'none';
            const catLblNone = attr(child(catAx, 'tickLblPos'), 'val') === 'none';
            const valSt = textStyle(defRPrOf(valAx), 10, false);
            const catSt = textStyle(defRPrOf(catAx), 10, false);
            const ticks = [];
            for (let v = vScale.min, k = 0; v <= vScale.max + vScale.unit * 1e-6 && k < 200; v += vScale.unit, k++) ticks.push(+v.toPrecision(12));
            const tickLabels = ticks.map((v) => fmtNumber(v, valFmt));

            // Auto layout: reserve label space around the plot.
            if (!plot || !plotIsInner) {
                const base = plot || inner;
                let left = 0, bottom = 0;
                const valLabelW = valDeleted || valLblNone ? 0 : Math.max(...tickLabels.map((t) => textW(valSt, t))) + 6;
                if (horizontalBars) {
                    const catW = catDeleted || catLblNone ? 0 : Math.min(base.w * 0.4, Math.max(...cats.map((c) => textW(catSt, c)), 0) + 8);
                    left = catW;
                    bottom = valDeleted || valLblNone ? 0 : valSt.size * 1.6;
                } else {
                    left = valLabelW;
                    bottom = catDeleted || catLblNone ? 0 : catSt.size * 1.6;
                    if (!catDeleted && !catLblNone && !isScatter) {
                        const band = (base.w - left) / nCat;
                        const maxLines = Math.max(...cats.map((c) => wrapWords(catSt, c, band * 0.95).length), 1);
                        bottom = catSt.size * (0.6 + 1.2 * Math.min(maxLines, 3));
                    }
                }
                plot = { x: base.x + left, y: base.y + (plot ? 0 : 4), w: base.w - left - (plot ? 0 : 6), h: base.h - bottom - (plot ? 0 : 4) };
            }
            if (plot.w <= 2 || plot.h <= 2) return;

            // plot background
            const pBg = parsePaint(fillElOf(plotSp), cctx, part);
            if (pBg && pBg.type !== 'none') { const p = new Path2D(); p.rect(plot.x, plot.y, plot.w, plot.h); await this.fillPath(p, pBg, plot, 'nonzero'); }

            const vPos = (v) => {
                let t = (v - vScale.min) / (vScale.max - vScale.min || 1);
                if (vs.reverse) t = 1 - t;
                return horizontalBars ? plot.x + t * plot.w : plot.y + plot.h - t * plot.h;
            };
            const cs = scalingOf(catAx);
            const between = attr(child(valAx, 'crossBetween'), 'val') !== 'midCat' || g0.localName.startsWith('bar');
            const catPos = (i) => {
                // Centre of category i along the category axis.
                const n = between ? nCat : Math.max(1, nCat - 1);
                let t = between ? (i + 0.5) / nCat : (nCat === 1 ? 0.5 : i / n);
                if (horizontalBars) { if (!cs.reverse) t = 1 - t; return plot.y + t * plot.h; }
                if (cs.reverse) t = 1 - t;
                return plot.x + t * plot.w;
            };
            const xPos = (v) => plot.x + (v - xScale.min) / (xScale.max - xScale.min || 1) * plot.w;
            const lineOf = (el) => {
                const ln = dig(el, 'spPr', 'ln');
                if (!ln) return null;
                return parseLine([[ln, cctx]], part);
            };
            const strokeLine = (L, x1, y1, x2, y2, fallback) => {
                const l = L || fallback;
                if (!l || !l.paint || l.paint.type === 'none') return;
                ctx.save();
                ctx.strokeStyle = l.paint.type === 'solid' ? css(l.paint.color) : '#bfbfbf';
                ctx.lineWidth = Math.max(l.w, 0.5);
                if (l.dash) ctx.setLineDash(l.dash.map((d) => d * l.w));
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                ctx.restore();
            };
            const greyLine = { w: 0.75, paint: { type: 'solid', color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } } };

            // gridlines
            const valGrid = child(valAx, 'majorGridlines');
            if (valGrid) {
                const gl = lineOf(valGrid) || greyLine;
                ticks.forEach((v) => {
                    const p = vPos(v);
                    if (horizontalBars) strokeLine(gl, p, plot.y, p, plot.y + plot.h); else strokeLine(gl, plot.x, p, plot.x + plot.w, p);
                });
            }
            const catGrid = child(catAx, 'majorGridlines');
            if (catGrid && !isScatter) {
                const gl = lineOf(catGrid) || greyLine;
                for (let i = 0; i <= nCat; i++) {
                    const t = i / nCat;
                    if (horizontalBars) strokeLine(gl, plot.x, plot.y + t * plot.h, plot.x + plot.w, plot.y + t * plot.h);
                    else strokeLine(gl, plot.x + t * plot.w, plot.y, plot.x + t * plot.w, plot.y + plot.h);
                }
            }
            if (isScatter && catGrid) {
                const gl = lineOf(catGrid) || greyLine;
                for (let v = xScale.min; v <= xScale.max + 1e-9; v += xScale.unit) strokeLine(gl, xPos(v), plot.y, xPos(v), plot.y + plot.h);
            }

            // ---- series ----
            const zero = vPos(Math.max(vScale.min, Math.min(vScale.max, 0)));
            const dLblsOf = (s) => child(s.el, 'dLbls') || child(g0, 'dLbls');
            const showVal = (s) => { const d = dLblsOf(s); return d && !bool(child(d, 'delete'), 'val', false) && bool(child(d, 'showVal'), 'val', false); };
            const pendingLabels = [];
            if (g0.localName.startsWith('bar')) {
                const gapW = num(child(g0, 'gapWidth'), 'val', 150) / 100;
                const overlap = (child(g0, 'overlap') ? num(child(g0, 'overlap'), 'val', 0) : stacked ? 100 : 0) / 100;
                const nSer = series.length || 1;
                const band = (horizontalBars ? plot.h : plot.w) / nCat;
                const groupW = band / (1 + gapW);
                const barW = stacked ? groupW : groupW / (nSer - (nSer - 1) * overlap);
                const posAcc = new Array(nCat).fill(0), negAcc = new Array(nCat).fill(0);
                const totals = [];
                for (let c = 0; c < nCat; c++) totals[c] = series.reduce((a, s) => a + Math.abs(s.vals.vals[c] || 0), 0) || 1;
                series.forEach((s, si) => {
                    const invert = bool(child(s.el, 'invertIfNegative'), 'val', false);
                    const lnS = lineOf(s.el);
                    for (let c = 0; c < nCat; c++) {
                        let v = s.vals.vals[c];
                        if (v == null) continue;
                        if (percent) v /= totals[c];
                        let from = 0, to = v;
                        if (stacked) {
                            if (v >= 0) { from = posAcc[c]; to = from + v; posAcc[c] = to; } else { from = negAcc[c]; to = from + v; negAcc[c] = to; }
                        }
                        const center = catPos(c);
                        const offset = stacked ? 0 : (si - (nSer - 1) / 2) * barW * (1 - overlap);
                        const a = vPos(Math.max(vScale.min, Math.min(vScale.max, from))), b = vPos(Math.max(vScale.min, Math.min(vScale.max, to)));
                        let color = pointColor(s.el, c, s.color);
                        if (invert && v < 0) color = { r: 1, g: 1, b: 1, a: 1 };
                        ctx.fillStyle = css(color);
                        let rx, ry, rw, rh;
                        if (horizontalBars) {
                            const y = center - offset - barW / 2;
                            rx = Math.min(a, b); ry = y; rw = Math.abs(b - a); rh = barW;
                        } else {
                            const x = center + offset - barW / 2;
                            rx = x; ry = Math.min(a, b); rw = barW; rh = Math.abs(b - a);
                        }
                        ctx.fillRect(rx, ry, rw, rh);
                        if (lnS && lnS.paint && lnS.paint.type === 'solid') { ctx.strokeStyle = css(lnS.paint.color); ctx.lineWidth = lnS.w; ctx.strokeRect(rx, ry, rw, rh); }
                        if (showVal(s)) {
                            const d = dLblsOf(s);
                            const st = textStyle(defRPrOf(d), 9, false);
                            const t = fmtNumber(s.vals.vals[c], attr(child(d, 'numFmt'), 'formatCode') || s.vals.format);
                            const posAttr = attr(child(d, 'dLblPos'), 'val') || (stacked ? 'ctr' : 'outEnd');
                            if (horizontalBars) {
                                const inside = posAttr === 'ctr' ? rx + rw / 2 : posAttr === 'inEnd' ? (v >= 0 ? rx + rw - 3 : rx + 3) : (v >= 0 ? rx + rw + 3 : rx - 3);
                                pendingLabels.push([st, t, inside, ry + rh / 2, posAttr === 'ctr' ? 'center' : (posAttr === 'inEnd') === (v >= 0) ? 'right' : 'left', 'middle']);
                            } else {
                                const y = posAttr === 'ctr' ? ry + rh / 2 + st.size * 0.35 : posAttr === 'inEnd' ? ry + st.size * 1.1 : (v >= 0 ? ry - 3 : ry + rh + st.size);
                                pendingLabels.push([st, t, rx + rw / 2, y, 'center', 'alphabetic']);
                            }
                        }
                    }
                });
            } else if (/^(line|area|radar)/.test(g0.localName) || isScatter) {
                const isArea = g0.localName.startsWith('area');
                const acc = new Array(nCat).fill(0);
                const totals = [];
                for (let c = 0; c < nCat; c++) totals[c] = series.reduce((a, s) => a + Math.abs(s.vals.vals[c] || 0), 0) || 1;
                const groupMarker = child(g0, 'marker') ? bool(child(g0, 'marker'), 'val', true) : true;
                const drawOrder = isArea && stacked ? series.slice() : series;
                const shapes = [];
                drawOrder.forEach((s) => {
                    const pts = [];
                    const baseLine = [];
                    for (let c = 0; c < (isScatter ? s.vals.vals.length : nCat); c++) {
                        let v = s.vals.vals[c];
                        if (v == null) { pts.push(null); continue; }
                        if (percent) v /= totals[c];
                        const base = stacked ? acc[c] : 0;
                        if (stacked) acc[c] += v;
                        const x = isScatter ? xPos(s.xs && s.xs[c] != null ? s.xs[c] : c + 1) : catPos(c);
                        pts.push([x, vPos(base + v), c]);
                        baseLine.push([x, vPos(base)]);
                    }
                    shapes.push({ s, pts, baseLine });
                });
                const order = isArea ? shapes.slice().reverse() : shapes;
                order.forEach(({ s, pts, baseLine }) => {
                    const valid = pts.filter(Boolean);
                    if (!valid.length) return;
                    const smooth = bool(child(s.el, 'smooth'), 'val', false);
                    const path = new Path2D();
                    let started = false;
                    const addSeg = (p, i, arr) => {
                        if (!started) { path.moveTo(p[0], p[1]); started = true; return; }
                        if (smooth && arr) {
                            const p0 = arr[i - 2] || arr[i - 1], p1 = arr[i - 1], p2 = p, p3 = arr[i + 1] || p;
                            path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
                        } else path.lineTo(p[0], p[1]);
                    };
                    valid.forEach((p, i) => addSeg(p, i, valid));
                    if (isArea) {
                        const back = stacked ? baseLine.slice().reverse() : [[valid[valid.length - 1][0], zero], [valid[0][0], zero]];
                        back.forEach((p) => path.lineTo(p[0], p[1]));
                        path.closePath();
                        ctx.fillStyle = css(s.color);
                        ctx.fill(path);
                    } else {
                        const ln = lineOf(s.el);
                        const noLine = ln && ln.paint && ln.paint.type === 'none';
                        if (!noLine && !(isScatter && attr(child(g0, 'scatterStyle'), 'val') === 'marker' && !ln)) {
                            ctx.save();
                            ctx.strokeStyle = css(ln && ln.paint && ln.paint.type === 'solid' ? ln.paint.color : s.color);
                            ctx.lineWidth = ln && ln.w ? ln.w : 2.25;
                            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
                            if (ln && ln.dash) ctx.setLineDash(ln.dash.map((d) => d * ctx.lineWidth));
                            ctx.stroke(path);
                            ctx.restore();
                        }
                        const mk = child(s.el, 'marker');
                        const symbol = attr(child(mk, 'symbol'), 'val') || (groupMarker ? 'circle' : 'none');
                        if (symbol !== 'none' && (groupMarker || child(mk, 'symbol'))) {
                            const size = num(child(mk, 'size'), 'val', 5) * 0.75 + 1;
                            const mf = parsePaint(fillElOf(child(mk, 'spPr')), cctx, part);
                            ctx.fillStyle = css(mf && mf.type === 'solid' ? mf.color : s.color);
                            valid.forEach((p) => {
                                ctx.beginPath();
                                if (symbol === 'square') ctx.rect(p[0] - size / 2, p[1] - size / 2, size, size);
                                else if (symbol === 'diamond') { ctx.moveTo(p[0], p[1] - size / 2); ctx.lineTo(p[0] + size / 2, p[1]); ctx.lineTo(p[0], p[1] + size / 2); ctx.lineTo(p[0] - size / 2, p[1]); }
                                else if (symbol === 'triangle') { ctx.moveTo(p[0], p[1] - size / 2); ctx.lineTo(p[0] + size / 2, p[1] + size / 2); ctx.lineTo(p[0] - size / 2, p[1] + size / 2); }
                                else ctx.arc(p[0], p[1], size / 2, 0, Math.PI * 2);
                                ctx.closePath();
                                ctx.fill();
                            });
                        }
                    }
                    if (showVal(s)) {
                        const d = dLblsOf(s);
                        const st = textStyle(defRPrOf(d), 9, false);
                        valid.forEach((p) => pendingLabels.push([st, fmtNumber(s.vals.vals[p[2]], attr(child(d, 'numFmt'), 'formatCode') || s.vals.format), p[0], p[1] - 5, 'center', 'alphabetic']));
                    }
                });
            }

            // ---- axes lines & labels ----
            const catLine = lineOf(catAx);
            const valLine = lineOf(valAx);
            if (!catDeleted) {
                if (horizontalBars) strokeLine(catLine, zero, plot.y, zero, plot.y + plot.h);
                else strokeLine(catLine, plot.x, zero, plot.x + plot.w, zero);
            }
            if (!valDeleted && valLine) {
                if (horizontalBars) strokeLine(valLine, plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h);
                else strokeLine(valLine, plot.x, plot.y, plot.x, plot.y + plot.h);
            }
            if (!valDeleted && !valLblNone) {
                ticks.forEach((v, i) => {
                    const p = vPos(v);
                    if (horizontalBars) drawText(valSt, tickLabels[i], p, plot.y + plot.h + valSt.size * 1.15, 'center');
                    else drawText(valSt, tickLabels[i], plot.x - 5, p, 'right', 'middle');
                });
            }
            if (!catDeleted && !catLblNone) {
                if (isScatter) {
                    for (let v = xScale.min; v <= xScale.max + 1e-9; v += xScale.unit) drawText(catSt, fmtNumber(+v.toPrecision(12), catFmt), xPos(v), plot.y + plot.h + catSt.size * 1.15, 'center');
                } else if (horizontalBars) {
                    cats.forEach((c, i) => {
                        const lines = wrapWords(catSt, c, plot.x - box.x - 8);
                        const y0 = catPos(i) - (lines.length - 1) * catSt.size * 0.6;
                        lines.forEach((l, k) => drawText(catSt, l, plot.x - 5, y0 + k * catSt.size * 1.2, 'right', 'middle'));
                    });
                } else {
                    const band = plot.w / nCat;
                    cats.forEach((c, i) => {
                        const lines = wrapWords(catSt, c, band * 0.95).slice(0, 3);
                        lines.forEach((l, k) => drawText(catSt, l, catPos(i), plot.y + plot.h + catSt.size * (1.15 + 1.2 * k), 'center'));
                    });
                }
            }
            pendingLabels.forEach(([st, t, x, y, al, bl]) => drawText(st, t, x, y, al, bl));

            // axis titles
            for (const [ax, isVal] of [[valAx, true], [catAx, false]]) {
                const tEl = child(ax, 'title');
                const rich = dig(tEl, 'tx', 'rich');
                if (!rich) continue;
                const text = Array.from(rich.getElementsByTagName('*')).filter((e) => e.localName === 't').map((e) => e.textContent).join('');
                const st = textStyle(defRPrOf(tEl), 10, true);
                const vertical = isVal !== horizontalBars;
                ctx.save();
                if (vertical) {
                    ctx.translate(box.x + st.size, plot.y + plot.h / 2);
                    ctx.rotate(-Math.PI / 2);
                    setFont(st); ctx.textAlign = 'center'; ctx.fillText(text, 0, 0);
                } else {
                    drawText(st, text, plot.x + plot.w / 2, box.y + box.h - st.size * 0.4, 'center');
                }
                ctx.restore();
            }
        }

        /* ---------------- text ---------------- */

        bodyProps(bodyPrs) {
            const b = { lIns: 7.2, tIns: 3.6, rIns: 7.2, bIns: 3.6, anchor: 't', wrap: 'square', vert: 'horz', fontScale: 1, lnSpcRed: 0, spcFirstLastPara: false, numCol: 1, spcCol: 0 };
            for (const el of bodyPrs) {
                if (!el) continue;
                if (el.hasAttribute('lIns')) b.lIns = emu2pt(num(el, 'lIns', 91440));
                if (el.hasAttribute('tIns')) b.tIns = emu2pt(num(el, 'tIns', 45720));
                if (el.hasAttribute('rIns')) b.rIns = emu2pt(num(el, 'rIns', 91440));
                if (el.hasAttribute('bIns')) b.bIns = emu2pt(num(el, 'bIns', 45720));
                if (el.hasAttribute('anchor')) b.anchor = attr(el, 'anchor');
                if (el.hasAttribute('wrap')) b.wrap = attr(el, 'wrap');
                if (el.hasAttribute('vert')) b.vert = attr(el, 'vert');
                if (el.hasAttribute('spcFirstLastPara')) b.spcFirstLastPara = bool(el, 'spcFirstLastPara', false);
                if (el.hasAttribute('numCol')) b.numCol = Math.max(1, num(el, 'numCol', 1));
                if (el.hasAttribute('spcCol')) b.spcCol = emu2pt(num(el, 'spcCol', 0));
                const na = child(el, 'normAutofit');
                if (na) { b.fontScale = num(na, 'fontScale', 100000) / 100000; b.lnSpcRed = num(na, 'lnSpcReduction', 0) / 100000; }
                else if (child(el, 'noAutofit') || child(el, 'spAutoFit')) { b.fontScale = 1; b.lnSpcRed = 0; }
            }
            return b;
        }

        levelProps(layers, lvl) {
            const p = defaultPPr();
            p.rPr = { sz: 18, b: false, i: false };
            for (const layer of layers) {
                if (layer.rPr) {
                    if (layer.rPr.fillColor) delete p.rPr.fill;
                    Object.assign(p.rPr, layer.rPr);
                    continue;
                }
                const ls = layer.lst;
                if (!ls) continue;
                const def = child(ls, 'defPPr');
                if (def) mergePPr(p, def);
                const lv = child(ls, `lvl${lvl + 1}pPr`);
                if (lv) mergePPr(p, lv);
            }
            return p;
        }

        runStyle(base, scale) {
            const r = base;
            let family = this.deck.resolveFontName(r.latin || r.ea || r.cs, this.theme) || this.theme.minor || 'Calibri';
            let weightOverride = null;
            const aliasW = this.deck.fonts.aliasWeights && this.deck.fonts.aliasWeights[family];
            if (aliasW) { family = aliasW.base; weightOverride = r.b ? Math.min(900, aliasW.weight + 300) : aliasW.weight; }
            family = this.deck.fonts.familyFor(family);
            let size = (r.sz || 18) * scale;
            let baselineShift = 0;
            if (r.baseline) { baselineShift = r.baseline * size; size *= 2 / 3; }
            let color = null;
            if (r.fill) {
                if (r.fill.localName === 'noFill') color = { r: 0, g: 0, b: 0, a: 0 };
                else if (r.fill.localName === 'solidFill') color = firstColor(r.fill, this.cctx);
                else if (r.fill.localName === 'gradFill') {
                    const gs = child(child(r.fill, 'gsLst'), 'gs');
                    color = firstColor(gs, this.cctx);
                }
            }
            if (!color && r.fillColor) color = r.fillColor;
            if (!color) {
                if (!SlidePainter.tx1El) SlidePainter.tx1El = parseXml('<a:schemeClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="tx1"/>').documentElement;
                color = resolveColorEl(SlidePainter.tx1El, this.cctx) || { r: 0, g: 0, b: 0, a: 1 };
            }
            let underline = r.u && r.u !== 'none' ? r.u : null;
            if (r.hlink) {
                const extClr = Array.from(r.hlink.getElementsByTagName('*')).find((e) => e.localName === 'hlinkClr');
                if (!(extClr && attr(extClr, 'val') === 'tx')) {
                    const h = this.theme.colors[(this.cctx.clrMap && this.cctx.clrMap.hlink) || 'hlink'];
                    if (h) color = hexColor(h);
                }
                underline = underline || 'sng';
            }
            const weight = weightOverride || (r.b ? 700 : 400);
            const fontCss = this.deck.fonts.cssFamily(family);
            const shadow = r.effectLst ? parseShadow(r.effectLst, this.cctx) : null;
            let highlight = null;
            if (r.highlight) highlight = firstColor(r.highlight, this.cctx);
            let outline = null;
            if (r.ln) { const ln = parseLine([[r.ln, this.cctx]], null); if (ln && ln.paint && ln.paint.type === 'solid') outline = ln; }
            return {
                family, size, weight, italic: !!r.i, color, underline, strike: r.strike && r.strike !== 'noStrike' ? r.strike : null,
                baselineShift, spc: (r.spc || 0) * scale, cap: r.cap || 'none', font: `${r.i ? 'italic ' : ''}${weight} ${size}px ${fontCss}`,
                fontCss, shadow, highlight, outline, metrics: this.deck.fonts.lineMetrics(family, weight >= 600, !!r.i)
            };
        }

        measure(style, text) {
            if (!text) return 0;
            const key = style.font + '\u0000' + text;
            let w = this.deck.measureCache.get(key);
            if (w === undefined) {
                const m = this.deck.measureCtx;
                m.font = `${style.italic ? 'italic ' : ''}${style.weight} 100px ${style.fontCss}`;
                w = m.measureText(text).width / 100;
                this.deck.measureCache.set(key, w);
            }
            return w * style.size + (style.spc ? style.spc * [...text].length : 0);
        }

        // Builds paragraph models: tokens with styles, bullets and paragraph props.
        buildParagraphs(txBody, layers, fontScale) {
            const paras = [];
            const counters = [];
            for (const p of children(txBody, 'p')) {
                const pPr = child(p, 'pPr');
                const lvl = Math.min(8, num(pPr, 'lvl', 0));
                const props = clonePPr(this.levelProps(layers, lvl));
                mergePPr(props, pPr);
                const baseR = props.rPr;
                const runs = [];
                for (const r of children(p)) {
                    if (r.localName === 'r' || r.localName === 'fld') {
                        const rp = { ...baseR };
                        mergeRPr(rp, child(r, 'rPr'));
                        let text = (child(r, 't') || {}).textContent || '';
                        if (r.localName === 'fld' && /slidenum/i.test(attr(r, 'type') || '')) text = String(this.slideNumber);
                        if (!text) continue;
                        text = text.replace(/\r\n?/g, '\n').replace(/\u000b/g, '\n');
                        const parts = text.split('\n');
                        parts.forEach((t, i) => {
                            if (i) runs.push({ br: true, style: this.runStyle(rp, fontScale) });
                            if (t) runs.push({ text: t, style: this.runStyle(rp, fontScale), raw: rp });
                        });
                    } else if (r.localName === 'br') {
                        const rp = { ...baseR };
                        mergeRPr(rp, child(r, 'rPr'));
                        runs.push({ br: true, style: this.runStyle(rp, fontScale) });
                    }
                }
                const endRp = { ...baseR };
                mergeRPr(endRp, child(p, 'endParaRPr'));
                const endStyle = this.runStyle(endRp, fontScale);
                const hasText = runs.some((r) => r.text);
                // Bullets
                let bullet = null;
                if (hasText && props.bu.type !== 'none') {
                    const first = runs.find((r) => r.text);
                    const fs = first.style;
                    let text;
                    let buFamily = props.buFont || null;
                    if (props.bu.type === 'char') {
                        text = mapSymbolChar(props.bu.char, props.buFont);
                        if (buFamily && /^(wingdings|symbol|webdings)/i.test(buFamily)) buFamily = null;
                    } else {
                        for (let k = lvl + 1; k < counters.length; k++) counters[k] = null;
                        const c = counters[lvl];
                        const n = c && c.scheme === props.bu.scheme ? c.n + 1 : props.bu.startAt;
                        counters[lvl] = { scheme: props.bu.scheme, n };
                        text = formatAutoNum(props.bu.scheme, n);
                        buFamily = props.buFont && !/^(wingdings|symbol)/i.test(props.buFont) ? props.buFont : null;
                    }
                    const size = props.buSize.pts ? props.buSize.pts * fontScale : fs.size * (props.buSize.pct || 1);
                    const color = props.buColor ? resolveColorEl(props.buColor, this.cctx) : fs.color;
                    const bStyle = this.runStyle({ ...first.raw, latin: buFamily ? buFamily : first.raw.latin, sz: size / fontScale, baseline: 0, u: 'none', strike: 'noStrike', hlink: null, spc: 0, cap: 'none', highlight: null }, fontScale);
                    bStyle.color = color || fs.color;
                    bullet = { text, style: bStyle };
                } else if (props.bu.type !== 'auto') {
                    // Non-numbered paragraphs at this level interrupt numbering.
                    if (hasText) counters[lvl] = null;
                }
                paras.push({ props, runs, endStyle, bullet, hasText });
            }
            return paras;
        }

        tokenize(runs) {
            // Units: {type:'br'|'space'|'tab'|'group', tokens:[...]}
            const units = [];
            let group = null;
            const pushGroup = () => { if (group) { units.push(group); group = null; } };
            const re = /(\t)|( +)|([⺀-鿿가-힯豈-﫿＀-￯　-〿])|([^\t ⺀-鿿가-힯豈-﫿＀-￯　-〿-]*-|[^\t ⺀-鿿가-힯豈-﫿＀-￯　-〿-]+)/g;
            for (const run of runs) {
                if (run.br) { pushGroup(); units.push({ type: 'br', style: run.style }); continue; }
                let text = run.text;
                if (run.style.cap === 'all' || run.style.cap === 'small') text = text.toUpperCase();
                let m;
                re.lastIndex = 0;
                while ((m = re.exec(text))) {
                    if (!m[0]) { re.lastIndex++; continue; }
                    const tok = { text: m[0], style: run.style };
                    if (m[1]) { pushGroup(); units.push({ type: 'tab', tokens: [tok] }); } else if (m[2]) { pushGroup(); tok.w = this.measure(run.style, tok.text); units.push({ type: 'space', tokens: [tok], w: tok.w }); } else if (m[3]) {
                        pushGroup();
                        tok.w = this.measure(run.style, tok.text);
                        units.push({ type: 'group', tokens: [tok], w: tok.w });
                    } else {
                        tok.w = this.measure(run.style, tok.text);
                        if (!group) group = { type: 'group', tokens: [], w: 0 };
                        group.tokens.push(tok);
                        group.w += tok.w;
                        if (tok.text.endsWith('-')) pushGroup();
                    }
                }
            }
            pushGroup();
            return units;
        }

        layoutParagraph(para, width, bp) {
            const P = para.props;
            const wrap = bp.wrap !== 'none';
            const lines = [];
            const bulletW = para.bullet ? this.measure(para.bullet.style, para.bullet.text) : 0;
            const bulletX = P.marL + P.indent;
            let firstStart = P.marL + P.indent;
            if (para.bullet) {
                const end = bulletX + bulletW;
                if (P.indent < 0 && end <= P.marL) firstStart = P.marL;
                else firstStart = P.indent < 0 ? this.nextTab(end, P) : end;
            }
            const right = width - P.marR;
            let line = null;
            const newLine = (first) => {
                line = { items: [], w: 0, start: first ? firstStart : P.marL, first, forced: false };
                lines.push(line);
            };
            newLine(true);
            const units = this.tokenize(para.runs);
            const hasContent = () => line.items.some((it) => it.kind !== 'space');
            const place = (tok, kind) => { line.items.push({ ...tok, kind, x: line.w }); line.w += tok.w; };
            for (const u of units) {
                if (u.type === 'br') { line.forced = true; line.brStyle = u.style; newLine(false); continue; }
                if (u.type === 'space') { place(u.tokens[0], 'space'); continue; }
                if (u.type === 'tab') {
                    const pos = line.start + line.w;
                    let stop = this.nextTab(pos, P);
                    if (wrap && stop > right && hasContent()) { newLine(false); stop = this.nextTab(line.start, P); }
                    const tok = { ...u.tokens[0], w: stop - (line.start + line.w), text: '' };
                    place(tok, 'tab');
                    continue;
                }
                // word group
                if (wrap && hasContent() && line.start + line.w + u.w > right + 0.01) newLine(false);
                if (wrap && line.start + line.w + u.w > right + 0.01 && !hasContent()) {
                    // Word longer than the line: break between characters.
                    for (const tok of u.tokens) {
                        let buf = '';
                        for (const ch of tok.text) {
                            const test = buf + ch;
                            const w = this.measure(tok.style, test);
                            if (buf && line.start + line.w + w > right + 0.01) {
                                place({ text: buf, style: tok.style, w: this.measure(tok.style, buf) }, 'word');
                                newLine(false);
                                buf = ch;
                            } else buf = test;
                        }
                        if (buf) place({ text: buf, style: tok.style, w: this.measure(tok.style, buf) }, 'word');
                    }
                    continue;
                }
                for (const tok of u.tokens) place(tok, 'word');
            }
            // Metrics per line
            for (const ln of lines) {
                let trail = ln.items.length;
                while (trail > 0 && ln.items[trail - 1].kind === 'space') trail--;
                ln.contentW = trail ? ln.items[trail - 1].x + ln.items[trail - 1].w : 0;
                ln.trail = trail;
                let asc = 0, desc = 0, maxSize = 0;
                const styles = ln.items.length ? ln.items.map((i) => i.style) : [ln.brStyle || (para.runs.length ? para.runs[para.runs.length - 1].style : para.endStyle)];
                if (ln.first && para.bullet) styles.push(para.bullet.style);
                for (const s of styles) {
                    const m = s.metrics;
                    asc = Math.max(asc, m.asc * s.size);
                    desc = Math.max(desc, m.desc * s.size);
                    maxSize = Math.max(maxSize, s.size);
                }
                if (!para.hasText && !ln.items.length) {
                    const s = para.endStyle;
                    asc = s.metrics.asc * s.size; desc = s.metrics.desc * s.size; maxSize = s.size;
                }
                ln.asc = asc; ln.desc = desc; ln.maxSize = maxSize;
                const spc = P.lnSpc;
                if (spc.pts != null) {
                    ln.height = spc.pts;
                    ln.baseline = spc.pts * asc / Math.max(0.001, asc + desc);
                } else {
                    const pct = Math.max(0, spc.pct * (1 - bp.lnSpcRed));
                    ln.height = (asc + desc) * pct;
                    ln.baseline = ln.height - desc;
                }
            }
            para.lines = lines;
            para.bulletW = bulletW;
            para.bulletX = bulletX;
            return para;
        }

        nextTab(pos, P) {
            for (const t of P.tabs) if (t.pos > pos + 0.01) return t.pos;
            const d = P.defTab > 0 ? P.defTab : 72;
            return (Math.floor((pos + 0.01) / d) + 1) * d;
        }

        spacingValue(spc, para) {
            if (!spc) return 0;
            if (spc.pts != null) return spc.pts;
            const first = para.lines[0];
            return (spc.pct || 0) * (first ? first.maxSize * 1.2 : 0);
        }

        layoutBody(txBody, width, layers, bp) {
            const paras = this.buildParagraphs(txBody, layers, bp.fontScale);
            let y = 0;
            paras.forEach((para, i) => {
                this.layoutParagraph(para, width, bp);
                const bef = (i > 0 || bp.spcFirstLastPara) ? this.spacingValue(para.props.spcBef, para) : 0;
                y += bef;
                para.top = y;
                para.lines.forEach((ln) => { ln.top = y; y += ln.height; });
                const aft = (i < paras.length - 1 || bp.spcFirstLastPara) ? this.spacingValue(para.props.spcAft, para) : 0;
                y += aft;
            });
            return { paras, height: y };
        }

        measureTextHeight(txBody, width, layers) {
            const bp = this.bodyProps([child(txBody, 'bodyPr')]);
            bp.lIns = bp.rIns = bp.tIns = bp.bIns = 0;
            return this.layoutBody(txBody, width, layers, bp).height;
        }

        async drawTextBody(txBody, box, cfg) {
            const { ctx } = this;
            const bp = this.bodyProps(cfg.bodyPrs);
            let inner = { x: box.x + bp.lIns, y: box.y + bp.tIns, w: box.w - bp.lIns - bp.rIns, h: box.h - bp.tIns - bp.bIns };
            ctx.save();
            const vert = bp.vert;
            if (vert === 'vert' || vert === 'eaVert' || vert === 'wordArtVert' || vert === 'mongolianVert') {
                ctx.translate(inner.x + inner.w, inner.y);
                ctx.rotate(Math.PI / 2);
                inner = { x: 0, y: 0, w: inner.h, h: inner.w };
            } else if (vert === 'vert270') {
                ctx.translate(inner.x, inner.y + inner.h);
                ctx.rotate(-Math.PI / 2);
                inner = { x: 0, y: 0, w: inner.h, h: inner.w };
            }
            const width = Math.max(1, inner.w);
            const { paras, height } = this.layoutBody(txBody, width, cfg.layers, bp);
            let y0 = inner.y;
            if (bp.anchor === 'ctr') y0 += (inner.h - height) / 2;
            else if (bp.anchor === 'b') y0 += inner.h - height;
            for (const para of paras) {
                const P = para.props;
                para.lines.forEach((ln, li) => {
                    const avail = width - P.marR - ln.start;
                    let x = inner.x + ln.start;
                    let extraPerSpace = 0;
                    const isLastLine = li === para.lines.length - 1 || ln.forced;
                    let lineW = ln.contentW;
                    let bulletInline = false;
                    if (ln.first && para.bullet && P.algn !== 'l' && P.algn !== 'just' && P.algn !== 'dist') {
                        bulletInline = true;
                        lineW += para.bulletW;
                    }
                    if (P.algn === 'ctr') x += (avail - lineW) / 2;
                    else if (P.algn === 'r') x += avail - lineW;
                    else if ((P.algn === 'just' && !isLastLine) || P.algn === 'dist') {
                        const spaces = ln.items.slice(0, ln.trail).filter((it) => it.kind === 'space').length;
                        if (spaces > 0) extraPerSpace = (avail - ln.contentW) / spaces;
                    }
                    const baseline = y0 + ln.top + ln.baseline;
                    if (ln.first && para.bullet) {
                        const bx = bulletInline ? x : inner.x + para.bulletX;
                        this.drawRun(para.bullet.text, para.bullet.style, bx, baseline, para.bullet.style.metrics);
                        if (bulletInline) x += para.bulletW;
                    }
                    let shift = 0;
                    // Merge consecutive same-style words/spaces into a single fillText for kerning fidelity.
                    let seg = null;
                    const flush = () => {
                        if (seg) { this.drawRun(seg.text, seg.style, seg.x, baseline, seg.style.metrics, seg.w); seg = null; }
                    };
                    for (let i = 0; i < ln.items.length; i++) {
                        const it = ln.items[i];
                        const ix = x + it.x + shift;
                        if (it.kind === 'space' && extraPerSpace && i < ln.trail) shift += extraPerSpace;
                        if (it.kind === 'tab') { flush(); continue; }
                        if (i >= ln.trail && it.kind === 'space') { flush(); continue; }
                        const useMerge = !extraPerSpace;
                        if (useMerge && seg && seg.style === it.style) {
                            seg.text += it.text; seg.w += it.w;
                        } else {
                            flush();
                            seg = { text: it.text, style: it.style, x: ix, w: it.w };
                            if (!useMerge) flush();
                        }
                    }
                    flush();
                });
            }
            ctx.restore();
        }

        drawRun(text, style, x, baseline, metrics, width) {
            if (!text) return;
            const { ctx } = this;
            const y = baseline - style.baselineShift;
            const w = width != null ? width : this.measure(style, text);
            ctx.save();
            if (style.highlight) {
                ctx.fillStyle = css(style.highlight);
                ctx.fillRect(x, y - metrics.asc * style.size, w, (metrics.asc + metrics.desc) * style.size);
            }
            ctx.font = style.font;
            ctx.fillStyle = css(style.color);
            if (style.shadow) {
                ctx.shadowColor = css(style.shadow.color);
                ctx.shadowBlur = style.shadow.blur * this.scale;
                ctx.shadowOffsetX = style.shadow.dist * Math.cos(style.shadow.dir * DEG) * this.scale;
                ctx.shadowOffsetY = style.shadow.dist * Math.sin(style.shadow.dir * DEG) * this.scale;
            }
            const drawText = (fn) => {
                if (style.spc && !this.deck.letterSpacingSupported) {
                    let cx = x;
                    for (const ch of text) { fn(ch, cx, y); cx += this.measure({ ...style, spc: 0 }, ch) + style.spc; }
                } else {
                    if (style.spc) ctx.letterSpacing = `${style.spc}px`;
                    fn(text, x, y);
                }
            };
            if (style.color.a > 0) drawText((t, px, py) => ctx.fillText(t, px, py));
            if (style.outline) {
                ctx.shadowColor = 'transparent';
                ctx.strokeStyle = css(style.outline.paint.color);
                ctx.lineWidth = Math.max(style.outline.w, 0.25);
                drawText((t, px, py) => ctx.strokeText(t, px, py));
            }
            ctx.shadowColor = 'transparent';
            if (style.underline) {
                const t = Math.max(style.size / 18, 0.5) * (/heavy|Heavy/.test(style.underline) ? 2 : 1);
                ctx.fillRect(x, y + style.size * 0.12, w, t);
                if (/dbl/.test(style.underline)) ctx.fillRect(x, y + style.size * 0.12 + t * 2, w, t);
            }
            if (style.strike) {
                const t = Math.max(style.size / 18, 0.5);
                ctx.fillRect(x, y - style.size * 0.3, w, t);
                if (style.strike === 'dblStrike') ctx.fillRect(x, y - style.size * 0.3 - t * 2, w, t);
            }
            ctx.restore();
            this.recordText(text, x, y, w, style.size);
        }

        recordText(text, x, y, w, size) {
            const m = this.ctx.getTransform();
            if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || m.a <= 0 || m.d <= 0) return;
            const s = this.scale;
            this.textRuns.push({ text, x: (m.a * x + m.e) / s, y: (m.d * y + m.f) / s, w: w * m.a / s, size: size * m.d / s });
        }
    }

    async function open(buffer) {
        const zip = new ZipArchive(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
        if (!zip.has('[Content_Types].xml')) throw new Error('Not a PowerPoint (PPTX) file');
        const deck = new Deck(zip);
        await deck.init();
        if (!deck.slides.length) throw new Error('The presentation has no slides');
        return deck;
    }

    global.LuxPptxRenderer = { open, version: '1.0.0' };
})(window);
