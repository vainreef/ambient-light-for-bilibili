const fs = require('fs');
const path = require('path');

const iconsData = JSON.parse(fs.readFileSync('/Users/freevian/.gemini/antigravity/brain/0b140111-2f31-44d4-82b1-bb159bb22f61/.system_generated/steps/1385/output.txt', 'utf8').split('\n')[2]);

const iconsDir = path.resolve(__dirname, '../icons');
for (const [key, dataUri] of Object.entries(iconsData)) {
  const base64Data = dataUri.replace(/^data:image\/png;base64,/, '');
  const filePath = path.join(iconsDir, `${key}.png`);
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  console.log(`Saved ${filePath} (${fs.statSync(filePath).size} bytes)`);
}
