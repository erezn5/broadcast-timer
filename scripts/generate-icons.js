#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE = fs.existsSync(path.resolve(ROOT, "assets/icons/icon.ico"))
  ? "assets/icons/icon.ico"
  : fs.existsSync(path.resolve(ROOT, "assets/icons/CueClock Icon2.ico"))
    ? "assets/icons/CueClock Icon2.ico"
    : fs.existsSync(path.resolve(ROOT, "assets/icons/CueClock.ico"))
      ? "assets/icons/CueClock.ico"
      : "logo.png";
const SOURCE = path.resolve(ROOT, process.argv[2] || DEFAULT_SOURCE);
const SOURCE_STEM = path.basename(SOURCE, path.extname(SOURCE));
const OUTPUT_DIR = path.resolve(ROOT, "assets/icons");
const ICONSET_DIR = path.resolve(OUTPUT_DIR, "icon.iconset");
const LINUX_DIR = path.resolve(OUTPUT_DIR, "linux");
const SOURCE_PNG = path.resolve(OUTPUT_DIR, "icon-source.png");
const SCALED_PNG = path.resolve(OUTPUT_DIR, "icon-scaled.png");
const BASE_PNG = path.resolve(OUTPUT_DIR, "icon-base-1024.png");
const ICO_PNG = path.resolve(OUTPUT_DIR, "icon-256.png");
const PNG_OUT = path.resolve(OUTPUT_DIR, "icon.png");
const ICNS_OUT = path.resolve(OUTPUT_DIR, "icon.icns");
const ICO_OUT = path.resolve(OUTPUT_DIR, "icon.ico");
const NAMED_PNG_OUT = path.resolve(OUTPUT_DIR, `${SOURCE_STEM}.png`);
const NAMED_ICNS_OUT = path.resolve(OUTPUT_DIR, `${SOURCE_STEM}.icns`);
const NAMED_ICO_OUT = path.resolve(OUTPUT_DIR, `${SOURCE_STEM}.ico`);
const PAD_COLOR = "05070d";
const KEEP_TEMP = process.argv.includes("--keep-temp");
const LINUX_SIZES = [1024, 512, 256, 128, 64, 48, 32];

const ICONSET_SIZES = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function runOrFail(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    fail(`${command} failed.\n${stderr || stdout}`);
  }
}

function getImageDimensions(imagePath) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    fail(`Failed reading image dimensions for ${imagePath}.\n${stderr}`);
  }

  const output = result.stdout || "";
  const widthMatch = output.match(/pixelWidth:\s*(\d+)/);
  const heightMatch = output.match(/pixelHeight:\s*(\d+)/);

  if (!widthMatch || !heightMatch) {
    fail(`Could not parse image dimensions for ${imagePath}.`);
  }

  return {
    width: Number.parseInt(widthMatch[1], 10),
    height: Number.parseInt(heightMatch[1], 10),
  };
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

function makeIcoFromPng(pngPath, outPath) {
  const pngData = fs.readFileSync(pngPath);

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // images count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width: 0 means 256
  entry.writeUInt8(0, 1); // height: 0 means 256
  entry.writeUInt8(0, 2); // palette colors
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngData.length, 8); // image bytes
  entry.writeUInt32LE(22, 12); // offset

  fs.writeFileSync(outPath, Buffer.concat([header, entry, pngData]));
}

function makeIcnsFromPngFiles(typeToFile, outPath) {
  const chunks = [];

  for (const [type, filePath] of typeToFile) {
    const data = fs.readFileSync(filePath);
    const chunk = Buffer.alloc(8);
    chunk.write(type, 0, "ascii");
    chunk.writeUInt32BE(data.length + 8, 4);
    chunks.push(Buffer.concat([chunk, data]));
  }

  const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(totalLength, 4);

  fs.writeFileSync(outPath, Buffer.concat([header, ...chunks]));
}

function copyIfDifferent(fromPath, toPath) {
  if (path.resolve(fromPath) === path.resolve(toPath)) {
    return false;
  }
  fs.copyFileSync(fromPath, toPath);
  return true;
}

if (!fs.existsSync(SOURCE)) {
  fail(`Source image not found: ${SOURCE}`);
}

if (!commandExists("sips")) {
  fail("Missing required command: sips");
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
fs.mkdirSync(ICONSET_DIR, { recursive: true });
fs.rmSync(LINUX_DIR, { recursive: true, force: true });
fs.mkdirSync(LINUX_DIR, { recursive: true });

// Normalize input into a square base image with app background color.
runOrFail("sips", ["-s", "format", "png", SOURCE, "--out", SOURCE_PNG]);
const sourceSize = getImageDimensions(SOURCE_PNG);
const longestSide = Math.max(sourceSize.width, sourceSize.height, 1);
const scaleRatio = 1024 / longestSide;
const scaledWidth = Math.max(1, Math.round(sourceSize.width * scaleRatio));
const scaledHeight = Math.max(1, Math.round(sourceSize.height * scaleRatio));

runOrFail("sips", [
  "-z",
  String(scaledHeight),
  String(scaledWidth),
  SOURCE_PNG,
  "--out",
  SCALED_PNG,
]);

runOrFail("sips", [
  "--padToHeightWidth",
  "1024",
  "1024",
  "--padColor",
  PAD_COLOR,
  SCALED_PNG,
  "--out",
  BASE_PNG,
]);

for (const icon of ICONSET_SIZES) {
  runOrFail("sips", [
    "-z",
    String(icon.size),
    String(icon.size),
    BASE_PNG,
    "--out",
    path.join(ICONSET_DIR, icon.name),
  ]);
}

makeIcnsFromPngFiles(
  [
    ["icp4", path.join(ICONSET_DIR, "icon_16x16.png")], // 16x16
    ["icp5", path.join(ICONSET_DIR, "icon_32x32.png")], // 32x32
    ["icp6", path.join(ICONSET_DIR, "icon_32x32@2x.png")], // 64x64
    ["ic07", path.join(ICONSET_DIR, "icon_128x128.png")], // 128x128
    ["ic08", path.join(ICONSET_DIR, "icon_256x256.png")], // 256x256
    ["ic09", path.join(ICONSET_DIR, "icon_512x512.png")], // 512x512
    ["ic10", path.join(ICONSET_DIR, "icon_512x512@2x.png")], // 1024x1024
  ],
  ICNS_OUT
);

runOrFail("sips", ["-z", "256", "256", BASE_PNG, "--out", ICO_PNG]);
makeIcoFromPng(ICO_PNG, ICO_OUT);
runOrFail("sips", ["-z", "512", "512", BASE_PNG, "--out", PNG_OUT]);

for (const size of LINUX_SIZES) {
  runOrFail("sips", [
    "-z",
    String(size),
    String(size),
    BASE_PNG,
    "--out",
    path.join(LINUX_DIR, `icon-${size}x${size}.png`),
  ]);
}

const createdNamedIcns = copyIfDifferent(ICNS_OUT, NAMED_ICNS_OUT);
const createdNamedPng = copyIfDifferent(PNG_OUT, NAMED_PNG_OUT);
const createdNamedIco = copyIfDifferent(ICO_OUT, NAMED_ICO_OUT);

if (!KEEP_TEMP) {
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
  fs.rmSync(SOURCE_PNG, { force: true });
  fs.rmSync(SCALED_PNG, { force: true });
  fs.rmSync(BASE_PNG, { force: true });
  fs.rmSync(ICO_PNG, { force: true });
}

console.log(`Created ${path.relative(ROOT, ICNS_OUT)}`);
console.log(`Created ${path.relative(ROOT, ICO_OUT)}`);
console.log(`Created ${path.relative(ROOT, PNG_OUT)}`);
console.log(`Created ${path.relative(ROOT, LINUX_DIR)}/*.png (${LINUX_SIZES.join(", ")})`);
if (createdNamedIcns) {
  console.log(`Created ${path.relative(ROOT, NAMED_ICNS_OUT)}`);
}
if (createdNamedIco) {
  console.log(`Created ${path.relative(ROOT, NAMED_ICO_OUT)}`);
}
if (createdNamedPng) {
  console.log(`Created ${path.relative(ROOT, NAMED_PNG_OUT)}`);
}
