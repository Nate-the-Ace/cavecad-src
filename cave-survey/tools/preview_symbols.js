// preview_symbols.js -- draws tools/coverage_symbols_data.js as one SVG
// contact sheet, so a new glyph can be looked at before the template is
// touched. node tools/preview_symbols.js out.svg
var fs = require("fs");
var data = require("./coverage_symbols_data.js");
var out = process.argv[2] || "symbols.svg";
var names = Object.keys(data);
var cols = 6, cell = 150, scale = 100;
var rows = Math.ceil(names.length / cols);
var svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + cols * cell +
    '" height="' + rows * cell + '" style="background:#fff">'];
names.forEach(function(n, i) {
    var cx = (i % cols) * cell + cell / 2, cy = Math.floor(i / cols) * cell + cell / 2 - 8;
    svg.push('<rect x="' + (cx - cell / 2 + 2) + '" y="' + (cy - cell / 2 + 6) +
        '" width="' + (cell - 4) + '" height="' + (cell - 4) + '" fill="none" stroke="#ddd"/>');
    data[n].forEach(function(p) {
        var s = 'stroke="#000" stroke-width="1.6" fill="none"';
        if (p[0] === "line") {
            svg.push('<line x1="' + (cx + p[1] * scale) + '" y1="' + (cy - p[2] * scale) +
                '" x2="' + (cx + p[3] * scale) + '" y2="' + (cy - p[4] * scale) + '" ' + s + '/>');
        } else if (p[0] === "circle") {
            svg.push('<circle cx="' + (cx + p[1] * scale) + '" cy="' + (cy - p[2] * scale) +
                '" r="' + p[3] * scale + '" ' + s + '/>');
        } else {
            var a0 = p[4] * Math.PI / 180, a1 = p[5] * Math.PI / 180, r = p[3] * scale;
            var x0 = cx + p[1] * scale + r * Math.cos(a0), y0 = cy - p[2] * scale - r * Math.sin(a0);
            var x1 = cx + p[1] * scale + r * Math.cos(a1), y1 = cy - p[2] * scale - r * Math.sin(a1);
            var span = ((p[5] - p[4]) % 360 + 360) % 360;
            svg.push('<path d="M' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' +
                (span > 180 ? 1 : 0) + ' 0 ' + x1 + ' ' + y1 + '" ' + s + '/>');
        }
    });
    svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="2" fill="red"/>');
    svg.push('<text x="' + cx + '" y="' + (cy + cell / 2 - 6) + '" font-size="10" ' +
        'text-anchor="middle" font-family="Helvetica">' + n.replace("SYM_", "") + '</text>');
});
svg.push("</svg>");
fs.writeFileSync(out, svg.join("\n"));
console.log(names.length + " symbols -> " + out);
