/**
 * @schema 2.10
 * @input series1: string = "10,15,25,40,30,20,35,50,45,30,25,40,55,45,35"
 * @input series2: string = "5,8,12,18,14,10,15,22,20,14,12,18,25,20,16"
 * @input label1: string = "Desktop"
 * @input label2: string = "Mobile"
 * @input xLabels: string = "Mon,Tue,Wed,Thu,Fri,Sat,Sun,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Mon"
 * @input color1: color = #93c5fd
 * @input color2: color = #2563eb
 * @input stroke: number = 1.5
 * @input gridLines: number = 5
 * @input fontSize: number = 10
 */

const w = pencil.width;
const h = pencil.height;
const fontSize = pencil.input.fontSize;
const gridLines = pencil.input.gridLines;

const legendH = fontSize + 12;
const xLabelH = fontSize + 8;
const yLabelW = fontSize * 3.5;
const padTop = 8;
const padRight = 8;

const chartX = yLabelW;
const chartY = padTop;
const chartW = w - yLabelW - padRight;
const chartH = h - padTop - xLabelH - legendH;

function f(n) {
  return n.toFixed(1);
}

function parseData(str) {
  const parts = str.split(",");
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i]);
    if (!isNaN(v)) {
      result.push(v);
    }
  }
  return result;
}

function niceNum(range, round) {
  if (range <= 0) {
    return 1;
  }
  const exp = Math.floor(Math.log(range) / Math.LN10);
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) {
    if (frac < 1.5) {
      nice = 1;
    } else if (frac < 3) {
      nice = 2;
    } else if (frac < 7) {
      nice = 5;
    } else {
      nice = 10;
    }
  } else {
    if (frac <= 1) {
      nice = 1;
    } else if (frac <= 2) {
      nice = 2;
    } else if (frac <= 5) {
      nice = 5;
    } else {
      nice = 10;
    }
  }
  return nice * Math.pow(10, exp);
}

function curveTo(pts) {
  let d = "";
  for (let j = 0; j < pts.length - 1; j++) {
    const p0 = pts[j > 0 ? j - 1 : 0];
    const p1 = pts[j];
    const p2 = pts[j + 1];
    const p3 = pts[j + 2 < pts.length ? j + 2 : pts.length - 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d +=
      " C " +
      f(cp1x) + " " + f(cp1y) + " " +
      f(cp2x) + " " + f(cp2y) + " " +
      f(p2[0]) + " " + f(p2[1]);
  }
  return d;
}

const nodes = [];

function drawSeries(data, max, color, fillOp, lineW) {
  const pts = [];
  for (let i = 0; i < data.length; i++) {
    const px = (i / (data.length - 1)) * chartW;
    const py = chartH - (data[i] / max) * chartH;
    pts.push([px, py]);
  }

  // Anchor points force the path's bounding box to the full chart area so
  // the viewBox stays stable even when the curve doesn't touch the corners.
  const anchor =
    "M 0 0 L 0 0 M " + f(chartW) + " " + f(chartH) +
    " L " + f(chartW) + " " + f(chartH) + " ";

  let ad = anchor;
  ad += "M 0 " + f(chartH);
  ad += " L " + f(pts[0][0]) + " " + f(pts[0][1]);
  ad += curveTo(pts);
  ad += " L " + f(chartW) + " " + f(chartH);
  ad += " Z";

  nodes.push({
    type: "path",
    x: chartX,
    y: chartY,
    width: chartW,
    height: chartH,
    viewBox: [0, 0, chartW, chartH],
    geometry: ad,
    fill: [
      {
        type: "gradient",
        gradientType: "linear",
        rotation: 180,
        colors: [
          { color: color, position: 0 },
          { color: color, position: 0.5 },
          { color: "#ffffff", position: 1 },
        ],
        opacity: fillOp,
      },
    ],
  });

  let ld = anchor;
  ld += "M " + f(pts[0][0]) + " " + f(pts[0][1]);
  ld += curveTo(pts);

  nodes.push({
    type: "path",
    x: chartX,
    y: chartY,
    width: chartW,
    height: chartH,
    viewBox: [0, 0, chartW, chartH],
    geometry: ld,
    stroke: {
      align: "center",
      thickness: lineW,
      fill: [{ type: "color", color: color }],
    },
  });
}

const data1 = parseData(pencil.input.series1);
const data2 = parseData(pencil.input.series2);
const xLabels = pencil.input.xLabels.split(",");

let maxVal = 0;
for (let i = 0; i < data1.length; i++) {
  if (data1[i] > maxVal) {
    maxVal = data1[i];
  }
}
for (let i = 0; i < data2.length; i++) {
  if (data2[i] > maxVal) {
    maxVal = data2[i];
  }
}

let niceMax = niceNum(maxVal, true);
let tickStep = niceNum(niceMax / gridLines, false);
if (tickStep <= 0) {
  tickStep = 1;
}
niceMax = Math.ceil(maxVal / tickStep) * tickStep;

for (let g = 0; g <= gridLines; g++) {
  const val = g * tickStep;
  if (val > niceMax) {
    break;
  }
  const gy = chartY + chartH - (val / niceMax) * chartH;

  nodes.push({
    type: "rectangle",
    x: chartX,
    y: gy,
    width: chartW,
    height: 0.5,
    fill: [{ type: "color", color: "#e5e7eb" }],
  });

  nodes.push({
    type: "text",
    x: 0,
    y: gy - fontSize / 2,
    width: yLabelW - 6,
    height: fontSize + 2,
    content: String(val),
    fontSize: fontSize,
    fontFamily: "Inter",
    textAlign: "right",
    fill: [{ type: "color", color: "#9ca3af" }],
  });
}

const maxPoints = Math.max(data1.length, data2.length);
const labelInterval = Math.max(1, Math.floor(maxPoints / 7));
for (let i = 0; i < maxPoints; i += labelInterval) {
  const lx = chartX + (i / (maxPoints - 1)) * chartW;
  const labelText = i < xLabels.length ? xLabels[i] : String(i);
  nodes.push({
    type: "text",
    x: lx - 20,
    y: chartY + chartH + 4,
    width: 40,
    height: fontSize + 4,
    content: labelText,
    fontSize: fontSize,
    fontFamily: "Inter",
    textAlign: "center",
    fill: [{ type: "color", color: "#9ca3af" }],
  });
}

if (data1.length >= 2) {
  drawSeries(data1, niceMax, pencil.input.color1, 0.18, pencil.input.stroke);
}
if (data2.length >= 2) {
  drawSeries(data2, niceMax, pencil.input.color2, 0.25, pencil.input.stroke);
}

const legendY = h - legendH + 2;
const legendX = chartX + chartW / 2 - 80;

nodes.push({
  type: "rectangle",
  x: legendX,
  y: legendY + 2,
  width: fontSize,
  height: fontSize,
  cornerRadius: 2,
  fill: [{ type: "color", color: pencil.input.color1 }],
});
nodes.push({
  type: "text",
  x: legendX + fontSize + 4,
  y: legendY,
  width: 60,
  height: fontSize + 4,
  content: pencil.input.label1,
  fontSize: fontSize,
  fontFamily: "Inter",
  fill: [{ type: "color", color: "#6b7280" }],
});
nodes.push({
  type: "rectangle",
  x: legendX + 80,
  y: legendY + 2,
  width: fontSize,
  height: fontSize,
  cornerRadius: 2,
  fill: [{ type: "color", color: pencil.input.color2 }],
});
nodes.push({
  type: "text",
  x: legendX + 80 + fontSize + 4,
  y: legendY,
  width: 60,
  height: fontSize + 4,
  content: pencil.input.label2,
  fontSize: fontSize,
  fontFamily: "Inter",
  fill: [{ type: "color", color: "#6b7280" }],
});

return nodes;
