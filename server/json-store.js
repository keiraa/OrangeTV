const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function readJson(file, fallback, validate) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid JSON in ${path.basename(file)}; original file preserved`
    );
  }
  if (!validate(value)) {
    throw new Error(
      `Invalid data in ${path.basename(file)}; original file preserved`
    );
  }
  return value;
}

function writeJson(file, value, validate) {
  if (!validate(value))
    throw new Error(`Refusing invalid data for ${path.basename(file)}`);
  // Never replace unreadable or malformed existing user data with a fallback.
  readJson(file, null, validate);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = { readJson, writeJson };
